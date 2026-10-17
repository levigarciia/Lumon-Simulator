import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import templateQwen from '../../assets/templates/qwen35.jinja' with { type: 'text' };
import type { BackendRuntime, EstadoMotor, ModeloCatalogo } from '../../shared/modelos';
import { resolverModeloLocal } from '../../shared/modelos';
import { baixarGguf } from './downloadModelos';
import { detectarBackend, detectarDispositivo } from './dispositivosMotor';
import { instalarRuntime } from './instalador';
import { encerrarProcesso } from './processos';
import { limiteInatividadeMotor } from './harness/respostaLocal';
import { argumentosContextoAutomatico, contextoAposFalha, contextoDoServidor } from './limitesMotor';

/** Serializa inferências sem prender a GPU durante ferramentas, pausas ou delegações. */
export class FilaMotor {
    private ultima: Promise<void> = Promise.resolve();

    async executar<T>(sinal: AbortSignal, acao: () => Promise<T>): Promise<T> {
        sinal.throwIfAborted();
        const anterior = this.ultima;
        let liberar!: () => void;
        const vaga = new Promise<void>((resolver) => { liberar = resolver; });
        this.ultima = anterior.then(() => vaga);
        let abortar!: () => void;
        const cancelamento = new Promise<never>((_resolver, rejeitar) => {
            abortar = () => rejeitar(sinal.reason);
            sinal.addEventListener('abort', abortar, { once: true });
        });
        try {
            await Promise.race([anterior, cancelamento]);
            sinal.throwIfAborted();
            return await acao();
        } finally {
            sinal.removeEventListener('abort', abortar);
            liberar();
        }
    }
}

async function reservarPorta(): Promise<number> {
    const servidor = createServer();
    return new Promise((resolver, rejeitar) => {
        servidor.once('error', rejeitar);
        servidor.listen(0, '127.0.0.1', () => {
            const endereco = servidor.address();
            if (!endereco || typeof endereco === 'string') {
                servidor.close();
                rejeitar(new Error('Porta inválida para o motor local.'));
                return;
            }
            servidor.close((erro) => erro ? rejeitar(erro) : resolver(endereco.port));
        });
    });
}

/** Mantém uma única carga local para os funcionários e prepara seus arquivos automaticamente. */
export class MotorLocal {
    readonly metricas = { inferencias: 0, esperaMs: 0, processamentoMs: 0, cargas: 0 };
    estado: EstadoMotor = { fase: 'desligado', detalhe: 'Nenhum modelo carregado' };
    private fila = new FilaMotor();
    private processo: ChildProcess | null = null;
    private encerramento = new AbortController();
    private porta = 0;
    private chave = '';
    private arquivos = new Map<string, string>();
    private backend?: BackendRuntime;
    private ultimaPublicacao = 0;

    constructor(
        private readonly raiz: string,
        private readonly publicar: (estado: EstadoMotor) => void = () => {},
    ) {}

    async usar<T>(id: string, sinal: AbortSignal,
        acao: (motor: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<T>, contextoMinimo = 2048): Promise<T> {
        if (!Number.isSafeInteger(contextoMinimo) || contextoMinimo < 2048) {
            throw new Error('Contexto mínimo inválido.');
        }
        const combinado = AbortSignal.any([sinal, this.encerramento.signal]);
        const enfileiradaEm = performance.now();
        return this.fila.executar(combinado, async () => {
            const inicio = performance.now();
            this.metricas.esperaMs += inicio - enfileiradaEm;
            try {
                await this.carregar(resolverModeloLocal(id), combinado, contextoMinimo);
                combinado.throwIfAborted();
                return await acao(this);
            } catch (erro) {
                if (!combinado.aborted) {
                    this.atualizar({ fase: 'erro', detalhe: erro instanceof Error ? erro.message : String(erro) });
                } else if (!this.processo) {
                    this.atualizar({ fase: 'desligado', detalhe: 'Preparação interrompida', progresso: undefined });
                }
                throw erro;
            } finally {
                this.metricas.processamentoMs += performance.now() - inicio;
            }
        });
    }

    async preparar(id: string, sinal: AbortSignal): Promise<void> {
        await this.usar(id, sinal, async () => {});
    }

    private async carregar(item: ModeloCatalogo, sinal: AbortSignal, contextoMinimo: number): Promise<void> {
        if (this.processo && this.estado.modeloId === item.id && (this.estado.contexto ?? 0) >= contextoMinimo) {
            this.atualizar({ fase: 'pronto', detalhe: item.nome });
            return;
        }
        this.encerrarServidor();
        this.metricas.cargas++;
        this.atualizar({ modeloId: item.id, dispositivo: undefined, contexto: undefined });
        let caminho = this.arquivos.get(item.id);
        if (!caminho) {
            caminho = await baixarGguf(join(this.raiz, 'modelos'), item, sinal, (fase, recebido) => {
                this.atualizar({ fase, detalhe: `${fase === 'baixando' ? 'Baixando' : 'Verificando'} ${item.nome}`,
                    progresso: recebido / item.tamanho * 100 }, true);
            });
            this.arquivos.set(item.id, caminho);
        }
        sinal.throwIfAborted();
        this.backend ??= await detectarBackend(sinal);
        const alternativas: BackendRuntime[] = this.backend === 'rocm' ? ['rocm', 'vulkan'] : [this.backend];
        for (let indice = 0; indice < alternativas.length; indice++) {
            const backend = alternativas[indice];
            try {
                this.atualizar({ fase: 'instalando', detalhe: `Preparando motor ${backend.toUpperCase()}`,
                    progresso: 0, backend });
                const executavel = await instalarRuntime(join(this.raiz, 'runtime'), backend, sinal,
                    (progresso) => this.atualizar({ progresso }, true));
                const dispositivo = backend === 'cpu' ? undefined
                    : await detectarDispositivo(executavel, backend, sinal);
                await this.iniciarAjustando(executavel, caminho, item, backend, dispositivo, sinal, contextoMinimo);
                this.backend = backend;
                return;
            } catch (erro) {
                this.encerrarServidor();
                sinal.throwIfAborted();
                if (indice === alternativas.length - 1) throw erro;
                const detalhe = erro instanceof Error ? erro.message : String(erro);
                this.atualizar({ detalhe: `ROCm indisponível. Preparando Vulkan. ${detalhe}` });
            }
        }
    }

    private async iniciarAjustando(
        executavel: string, caminho: string, item: ModeloCatalogo, backend: BackendRuntime,
        dispositivo: { id: string; nome: string } | undefined, sinal: AbortSignal, contextoMinimo: number,
    ): Promise<void> {
        let contextoTentado = 0;
        while (true) {
            sinal.throwIfAborted();
            try {
                await this.iniciar(executavel, caminho, item, backend, dispositivo, sinal,
                    contextoTentado, contextoMinimo);
                if ((this.estado.contexto ?? 0) >= contextoMinimo) return;
                this.encerrarServidor();
                if (contextoTentado) throw new Error('A memória disponível não comporta o contexto do pedido atual.');
                contextoTentado = contextoMinimo;
            } catch (erro) {
                this.encerrarServidor();
                sinal.throwIfAborted();
                const detalhe = erro instanceof Error ? erro.message : String(erro);
                const menor = contextoAposFalha(detalhe, contextoTentado, contextoMinimo);
                if (menor === null) throw erro;
                contextoTentado = menor;
                this.atualizar({ detalhe: `Ajustando a reserva de contexto à memória: ${menor} tokens.` });
            }
        }
    }

    private async iniciar(
        executavel: string, caminho: string, item: ModeloCatalogo, backend: BackendRuntime,
        dispositivo: { id: string; nome: string } | undefined, sinal: AbortSignal,
        contextoTentado: number, contextoMinimo: number,
    ): Promise<void> {
        this.porta = await reservarPorta();
        this.chave = randomUUID();
        const argumentosTemplate: string[] = [];
        if (item.id.startsWith('qwen3.5-')) {
            const pasta = join(this.raiz, 'runtime', 'templates');
            await mkdir(pasta, { recursive: true });
            const caminhoTemplate = join(pasta, 'qwen35.jinja');
            await writeFile(caminhoTemplate, templateQwen, 'utf8');
            argumentosTemplate.push('--chat-template-file', caminhoTemplate);
        }
        this.atualizar({ fase: 'carregando', detalhe: `Carregando ${item.nome}`, progresso: undefined,
            dispositivo: dispositivo?.nome ?? 'CPU' });
        const processo = spawn(executavel, [
            '-m', caminho, '--host', '127.0.0.1', '--port', String(this.porta), '--api-key', this.chave,
            '-np', '1', '--jinja', '--no-webui', '--reasoning-budget', '0',
            ...argumentosTemplate,
            ...argumentosContextoAutomatico(backend, contextoTentado, contextoMinimo),
            ...(dispositivo ? ['--device', dispositivo.id, '--flash-attn', backend === 'rocm' ? 'on' : 'auto'] : []),
        ], { cwd: dirname(executavel), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.processo = processo;
        let registro = '';
        let falha: Error | undefined;
        const registrar = (parte: Buffer) => { registro = (registro + parte.toString()).slice(-6000); };
        processo.stdout.on('data', registrar);
        processo.stderr.on('data', registrar);
        processo.once('error', (erro) => { falha = erro; });
        processo.once('exit', (codigo) => {
            falha = new Error(`O motor local encerrou com código ${codigo}. ${registro}`);
            if (this.processo !== processo) return;
            this.processo = null;
            this.atualizar({ fase: 'erro', detalhe: falha.message });
        });
        const inicio = Date.now();
        while (Date.now() - inicio < 240000) {
            sinal.throwIfAborted();
            if (falha) throw falha;
            const resposta = await fetch(`http://127.0.0.1:${this.porta}/health`, {
                headers: { Authorization: `Bearer ${this.chave}` },
                signal: AbortSignal.any([sinal, AbortSignal.timeout(2000)]),
            }).catch(() => null);
            if (resposta?.ok) {
                const propriedades = await fetch(`http://127.0.0.1:${this.porta}/props`, {
                    headers: { Authorization: `Bearer ${this.chave}` },
                    signal: AbortSignal.any([sinal, AbortSignal.timeout(5000)]),
                }).then((resultado) => resultado.json());
                const contexto = contextoDoServidor(propriedades);
                sinal.throwIfAborted();
                this.atualizar({ fase: 'pronto', detalhe: item.nome, contexto });
                return;
            }
            await new Promise((resolver) => setTimeout(resolver, 250));
        }
        throw new Error(`Tempo limite ao carregar ${item.nome}. ${registro}`);
    }

    async completar(corpo: Record<string, unknown>, sinal: AbortSignal): Promise<Response> {
        if (!this.processo) throw new Error('O motor local não está carregado.');
        this.metricas.inferencias++;
        const espera = new AbortController();
        const temporizador = setTimeout(() => espera.abort(new Error(
            'O motor local não iniciou a resposta no prazo. A inferência foi interrompida para liberar a fila.',
        )), limiteInatividadeMotor);
        try {
            return await fetch(`http://127.0.0.1:${this.porta}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.chave}` },
                body: JSON.stringify(corpo),
                signal: AbortSignal.any([sinal, this.encerramento.signal, espera.signal]),
            });
        } finally {
            clearTimeout(temporizador);
        }
    }

    parar(): void {
        this.encerramento.abort(new Error('Motor local encerrado.'));
        this.encerramento = new AbortController();
        this.encerrarServidor();
        this.atualizar({ fase: 'desligado', detalhe: 'Nenhum modelo carregado', progresso: undefined });
    }

    private encerrarServidor(): void {
        const processo = this.processo;
        this.processo = null;
        if (processo) encerrarProcesso(processo);
    }

    private atualizar(mudanca: Partial<EstadoMotor>, limitar = false): void {
        const faseAnterior = this.estado.fase;
        this.estado = { ...this.estado, ...mudanca };
        if (limitar && faseAnterior === this.estado.fase && Date.now() - this.ultimaPublicacao < 200) return;
        this.ultimaPublicacao = Date.now();
        this.publicar(this.estado);
    }
}

let motor: MotorLocal | undefined;

/** Configura o motor compartilhado no diretório privado da Lumon. */
export function configurarMotorLocal(raiz: string, publicar: (estado: EstadoMotor) => void): MotorLocal {
    motor?.parar();
    motor = new MotorLocal(raiz, publicar);
    return motor;
}

/** Obtém o motor único do aplicativo, inclusive em scripts executados com Bun. */
export function obterMotorLocal(): MotorLocal {
    motor ??= new MotorLocal(join(process.env.APPDATA ?? homedir(), 'Lumon'));
    return motor;
}
