import { randomUUID } from 'node:crypto';
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { estadoInicial } from '../../shared/estado';
import { esquemaCatalogoEscritorios, esquemaNomeEscritorio, type CatalogoEscritorios } from '../../shared/partidas';
import type { EventoLumon, Resultado } from '../../shared/ponte';
import { gravarJsonAtomico, lerJson } from './arquivosEstado';
import type { Escritorio } from './escritorio';
import { Partida } from './partida';
import { Persistencia } from './persistencia';

/** Isola os escritórios, suas pastas e sessões, preservando a partida ativa antes de cada troca. */
export class Partidas {
    private partida!: Partida;
    private persistencia!: Persistencia;
    private ocupado = false;
    private encerrando = false;
    private operacao: Promise<Resultado> | null = null;

    private constructor(
        private pasta: string,
        private catalogo: CatalogoEscritorios,
        private emitir: (evento: EventoLumon) => void,
    ) {}

    /** Abre o catálogo ou importa a partida anterior sem alterar o lumon.json original. */
    static async abrir(pasta: string, emitir: (evento: EventoLumon) => void): Promise<Partidas> {
        await mkdir(pasta, { recursive: true });
        const bruto = await lerJson(join(pasta, 'escritorios.json'));
        let catalogo: CatalogoEscritorios;
        if (bruto === undefined) {
            const id = randomUUID();
            catalogo = { versao: 1, ativoId: id, escritorios: [{
                id, nome: 'Escritório principal', criadoEm: new Date().toISOString(),
            }] };
            const destino = join(pasta, 'escritorios', id);
            const estado = await new Persistencia(pasta).carregar();
            try {
                await cp(join(pasta, 'geral'), join(destino, 'geral'), { recursive: true });
            } catch (erro) {
                if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro;
            }
            const persistencia = new Persistencia(destino);
            persistencia.salvar(estado);
            await persistencia.descarregar();
            await gravarJsonAtomico(join(pasta, 'escritorios.json'), catalogo);
        } else {
            const validado = esquemaCatalogoEscritorios.safeParse(bruto);
            if (!validado.success) throw new Error(`Catálogo inválido em ${pasta}: ${validado.error.message}`);
            catalogo = validado.data;
        }
        const partidas = new Partidas(pasta, catalogo, emitir);
        await partidas.carregar(catalogo.ativoId);
        return partidas;
    }

    /** Obtém os serviços atuais; chamadas durante uma troca são recusadas. */
    obter(): Escritorio {
        if (this.ocupado || this.encerrando) throw new Error('Aguarde a troca de escritório.');
        return this.partida.obter();
    }

    /** Lista os escritórios disponíveis sem expor seus históricos ou caminhos internos. */
    listar(): CatalogoEscritorios {
        return structuredClone(this.catalogo);
    }

    /** Apaga o registro do escritório ativo e confirma sua remoção das revisões anteriores. */
    async excluirRegistroHistorico(id: string): Promise<Resultado> {
        const resultado = this.obter().excluirRegistroHistorico(id);
        if (!resultado.ok) return resultado;
        await this.persistencia.esquecerRevisoes();
        return resultado;
    }

    /** Cria uma partida vazia e a seleciona sem apagar a anterior. */
    async criar(nome: string): Promise<Resultado> {
        const validado = esquemaNomeEscritorio.safeParse(nome);
        if (!validado.success) return { ok: false, erro: 'Informe um nome de 1 a 60 caracteres.' };
        return this.alterar(async () => {
            const id = randomUUID();
            const persistencia = new Persistencia(this.pastaEscritorio(id));
            persistencia.salvar(estadoInicial());
            await persistencia.descarregar();
            return { ...this.catalogo, ativoId: id, escritorios: [...this.catalogo.escritorios, {
                id, nome: validado.data, criadoEm: new Date().toISOString(),
            }] };
        });
    }

    /** Encerra a atividade atual antes de abrir o escritório escolhido. */
    async selecionar(id: string): Promise<Resultado> {
        if (!this.catalogo.escritorios.some((item) => item.id === id)) {
            return { ok: false, erro: 'Escritório não encontrado.' };
        }
        if (id === this.catalogo.ativoId) return { ok: true };
        return this.alterar(async () => ({ ...this.catalogo, ativoId: id }));
    }

    /** Reinicia somente o escritório ativo. */
    async reiniciar(): Promise<Resultado> {
        if (this.ocupado || this.encerrando) return { ok: false, erro: 'Aguarde a troca de escritório.' };
        this.ocupado = true;
        this.operacao = this.partida.reiniciar().finally(() => {
            this.ocupado = false;
            this.operacao = null;
        });
        return this.operacao;
    }

    /** Encerra agentes e confirma a persistência antes de sair. */
    async encerrar(): Promise<void> {
        this.encerrando = true;
        await this.operacao;
        this.partida.encerrar();
        try { await this.persistencia.descarregar(); }
        catch (erro) {
            this.encerrando = false;
            this.partida.reabrir();
            throw erro;
        }
    }

    private pastaEscritorio(id: string): string {
        return join(this.pasta, 'escritorios', id);
    }

    private async carregar(id: string): Promise<void> {
        const pasta = this.pastaEscritorio(id);
        if (await lerJson(join(pasta, 'estado.json')) === undefined) {
            throw new Error(`Estado ausente em ${pasta}. O escritório foi preservado para diagnóstico.`);
        }
        const persistencia = new Persistencia(pasta);
        const estado = await persistencia.carregar();
        await mkdir(join(pasta, 'geral'), { recursive: true });
        this.persistencia = persistencia;
        this.partida = new Partida(estado, persistencia, (evento) => {
            if (!this.ocupado && !this.encerrando) this.emitir(evento);
        }, join(pasta, 'geral'));
    }

    private alterar(preparar: () => Promise<CatalogoEscritorios>): Promise<Resultado> {
        if (this.ocupado || this.encerrando) {
            return Promise.resolve({ ok: false, erro: 'Aguarde a troca de escritório.' });
        }
        this.ocupado = true;
        this.operacao = this.executarTroca(preparar).finally(() => {
            this.ocupado = false;
            this.operacao = null;
        });
        return this.operacao;
    }

    private async executarTroca(preparar: () => Promise<CatalogoEscritorios>): Promise<Resultado> {
        const anterior = this.catalogo;
        const partidaAnterior = this.partida;
        const persistenciaAnterior = this.persistencia;
        this.partida.encerrar();
        try {
            await this.persistencia.descarregar();
            const novo = await preparar();
            await this.carregar(novo.ativoId);
            await gravarJsonAtomico(join(this.pasta, 'escritorios.json'), novo);
            this.catalogo = novo;
            return { ok: true };
        } catch (erro) {
            if (this.partida !== partidaAnterior) this.partida.encerrar();
            this.partida = partidaAnterior;
            this.persistencia = persistenciaAnterior;
            this.catalogo = anterior;
            this.partida.reabrir();
            this.emitir({ tipo: 'estado', estado: this.partida.obter().publico() });
            this.emitir({ tipo: 'geral', mensagens: this.partida.obter().mensagensGeral() });
            return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível trocar de escritório.' };
        }
    }
}
