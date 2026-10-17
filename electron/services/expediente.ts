import { randomUUID } from 'node:crypto';
import {
    instrucoesFuncionario,
    type Aprovacao,
    type Ferramenta,
    type Funcionario,
    type Mensagem,
    type Projeto,
    type StatusFuncionario,
} from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import type { Acontecimento } from '../../shared/necessidades';
import { criarSessao } from './harness/sessao';
import { mensagemInterrupcao, type OuvinteTurno, type SessaoAgente } from './harness/tipos';
import type { RespostaTrabalho } from '../../shared/trabalho';

import { contextoDaThread, threadPrincipal } from '../../shared/threads';

const intervaloPublicacaoMs = 80;

/** Acesso do expediente ao estado do escritório, sem conhecer persistência nem IPC. */
export type RegistroExpediente = {
    conversa: (funcionarioId: string) => Mensagem[];
    gravarConversa: (funcionarioId: string, mensagens: Mensagem[]) => void;
    emitirConversa: (funcionarioId: string) => void;
    emitirEstado: () => void;
    contextoTurno: (funcionarioId: string) => string;
    personalidade?: (funcionarioId: string) => string;
    ferramentasTrabalho?: (funcionarioId: string) => string[] | undefined;
    urlMcp: (funcionarioId: string, origem: 'trabalho' | 'chat') => Promise<string>;
    acontecer: (funcionarioId: string, acontecimento: Acontecimento) => void;
    conversaEncerrada?: (funcionarioId: string) => void;
    confirmarPercepcao?: (funcionarioId: string, canal: 'social' | 'trabalho' | 'chat') => void;
    pastaConversa: string;
};

type AprovacaoPendente =Aprovacao & { decidir: (aprovada: boolean) => void };

/**
 * Executa um turno por funcionário e separa o contexto por projeto, canal e thread. Ao mudar de conversa,
 * recria a sessão com o histórico salvo daquela conversa.
 */
export class Expediente {
    private sessoes = new Map<string, {
        sessao: SessaoAgente; projetoId?: string; threadId: string; canal: 'conversa' | 'work'; personalidade: string;
    }>();
    private execucoes = new Map<string, AbortController>();
    private canaisEmExecucao = new Map<string, 'conversa' | 'work'>();
    private aprovacoes = new Map<string, AprovacaoPendente>();
    private falhas = new Set<string>();
    private publicacoes = new Map<string, NodeJS.Timeout>();
    private conclusoes = new Map<string, (resposta: RespostaTrabalho) => void>();
    private observadores = new Map<string, (mensagem: Mensagem) => void>();

    constructor(private registro: RegistroExpediente, private abrirSessao: typeof criarSessao = criarSessao) {}

    /** Status vindo só da execução no harness, sem considerar pausas. */
    statusDe(funcionarioId: string): StatusFuncionario {
        for (const aprovacao of this.aprovacoes.values()) if (aprovacao.funcionarioId === funcionarioId) return 'bloqueado';
        if (this.execucoes.has(funcionarioId)) return 'trabalhando';
        return this.falhas.has(funcionarioId) ? 'erro' : 'ocioso';
    }

    /** Distingue uma conversa individual de uma tarefa real ao permitir deslocamentos sociais. */
    emConversa(funcionarioId: string): boolean {
        return this.canaisEmExecucao.get(funcionarioId) === 'conversa';
    }

    situacao(funcionarios: Funcionario[]): { status: Record<string, StatusFuncionario>; aprovacoes: Aprovacao[] } {
        const aprovacoes = [...this.aprovacoes.values()].map(({ decidir: _decidir, ...aprovacao }) => aprovacao);
        const status = Object.fromEntries(funcionarios.map((funcionario) => [funcionario.id, this.statusDe(funcionario.id)]));
        return { status, aprovacoes };
    }

    enviar(
        funcionario: Funcionario, projeto: Projeto | undefined, texto: string, threadId = threadPrincipal,
        canal: 'conversa' | 'work' = 'conversa',
    ): Resultado {
        if (this.execucoes.has(funcionario.id)) return { ok: false, erro: `${funcionario.nome} ainda está trabalhando.` };
        const agora = new Date().toISOString();
        const pedido: Mensagem = {
            id: randomUUID(),
            autor: 'usuario',
            texto,
            ferramentas: [],
            criadaEm: agora,
            projetoId: projeto?.id,
            threadId, canal,
        };
        const resposta: Mensagem = {
            id: randomUUID(), autor: 'funcionario', texto: '', ferramentas: [], criadaEm: agora,
            projetoId: projeto?.id, threadId, canal, partes: [],
        };
        this.registro.gravarConversa(funcionario.id, [...this.registro.conversa(funcionario.id), pedido, resposta]);
        const controle = new AbortController();
        this.execucoes.set(funcionario.id, controle);
        this.canaisEmExecucao.set(funcionario.id, canal);
        this.falhas.delete(funcionario.id);
        this.registro.emitirConversa(funcionario.id);
        this.registro.emitirEstado();
        void this.executar(funcionario, projeto, texto, resposta.id, controle.signal, threadId, canal).then(
            () => this.concluir(funcionario.id, resposta.id),
            (erro: unknown) => this.concluir(funcionario.id, resposta.id, erro),
        );
        return { ok: true };
    }

    /** Usa o mesmo harness das tarefas individuais e aguarda sua conclusão para devolver ao líder. */
    enviarEAguardar(
        funcionario: Funcionario, projeto: Projeto, texto: string, threadId = threadPrincipal,
        observar?: (mensagem: Mensagem) => void,
    ): Promise<RespostaTrabalho> {
        if (this.execucoes.has(funcionario.id)) {
            return Promise.resolve({ ok: false, texto: `${funcionario.nome} ainda está trabalhando.` });
        }
        return new Promise((resolver) => {
            this.conclusoes.set(funcionario.id, resolver);
            if (observar) this.observadores.set(funcionario.id, observar);
            const resultado = this.enviar(funcionario, projeto, texto, threadId, 'work');
            if (resultado.ok) return;
            this.conclusoes.delete(funcionario.id);
            this.observadores.delete(funcionario.id);
            resolver({ ok: false, texto: resultado.erro });
        });
    }

    private async executar(
        funcionario: Funcionario,
        projeto: Projeto | undefined,
        texto: string,
        respostaId: string,
        sinal: AbortSignal,
        threadId: string,
        canal: 'conversa' | 'work',
    ): Promise<void> {
        const sessao = await this.obterSessao(funcionario, projeto, sinal, threadId, canal);
        sinal.throwIfAborted();
        const ouvinte = this.criarOuvinte(funcionario.id, respostaId);
        const prompt = [
            'Contexto informativo do escritório, sem novos pedidos:',
            this.registro.contextoTurno(funcionario.id),
            'Mensagem atual:',
            texto,
        ].join('\n\n');
        const ferramentas = projeto ? this.registro.ferramentasTrabalho?.(funcionario.id) : undefined;
        await sessao.enviar(prompt, ouvinte, sinal, ferramentas ? {
            ferramentas,
            exigirFerramentaAteConclusao: ferramentas.includes('refinar'),
            encerrarFerramentasQuando: (_nome, _saida, estado) => estado?.terminal === true,
        } : undefined);

    }

    /**
     * Registra no chat individual principal uma mensagem que o funcionário enviou por iniciativa própria, vinda
     * de outro canal. A sessão ociosa da conversa é descartada para que o próximo turno leia a mensagem.
     */
    registrarIniciativa(funcionarioId: string, texto: string): void {
        const mensagem: Mensagem = { id: randomUUID(), autor: 'funcionario', texto, ferramentas: [],
            criadaEm: new Date().toISOString(), threadId: threadPrincipal, canal: 'conversa' };
        this.registro.gravarConversa(funcionarioId, [...this.registro.conversa(funcionarioId), mensagem]);
        const atual = this.sessoes.get(funcionarioId);
        if (atual?.canal === 'conversa' && !this.execucoes.has(funcionarioId)) {
            atual.sessao.encerrar();
            this.sessoes.delete(funcionarioId);
        }
        this.registro.emitirConversa(funcionarioId);
    }

    interromper(funcionarioId: string): void {
        this.execucoes.get(funcionarioId)?.abort();
        this.sessoes.get(funcionarioId)?.sessao.encerrar();
        this.sessoes.delete(funcionarioId);
    }

    responder(aprovacaoId: string, aprovada: boolean): void {
        this.aprovacoes.get(aprovacaoId)?.decidir(aprovada);
    }

    /** Apaga a conversa e o contexto de um funcionário quando não há trabalho em andamento. */
    limparConversa(funcionarioId: string, threadId?: string): Resultado {
        if (this.execucoes.has(funcionarioId)) {
            return { ok: false, erro: 'Interrompa ou aguarde a tarefa terminar antes de limpar a conversa.' };
        }
        this.dispensar(funcionarioId);
        this.registro.gravarConversa(funcionarioId, threadId === undefined ? []
            : this.registro.conversa(funcionarioId).filter((mensagem) =>
                (mensagem.threadId ?? threadPrincipal) !== threadId || mensagem.canal === 'work'));
        this.publicarConversa(funcionarioId, true);
        this.registro.emitirEstado();
        return { ok: true };
    }

    /** Descarta o contexto de pedidos apagados sem encerrar execuções de outras conversas. */
    limparContextoWork(threadId?: string, projetoId?: string): void {
        for (const [id, atual] of this.sessoes) {
            if (atual.canal !== 'work' || (threadId !== undefined && atual.threadId !== threadId)
                || (projetoId !== undefined && atual.projetoId !== projetoId)) continue;
            atual.sessao.encerrar();
            this.sessoes.delete(id);
        }
    }

    /** Encerra execução e sessão do funcionário. Usado na demissão e ao fechar o aplicativo. */
    dispensar(funcionarioId: string): void {
        this.interromper(funcionarioId);
        this.sessoes.delete(funcionarioId);
        this.falhas.delete(funcionarioId);
    }

    private async obterSessao(
        funcionario: Funcionario, projeto: Projeto | undefined, sinal: AbortSignal, threadId: string,
        canal: 'conversa' | 'work',
    ): Promise<SessaoAgente> {
        const atual = this.sessoes.get(funcionario.id);
        const personalidade = this.registro.personalidade?.(funcionario.id) ?? '';
        if (atual && atual.projetoId === projeto?.id && atual.threadId === threadId && atual.canal === canal
            && atual.personalidade === personalidade) return atual.sessao;
        atual?.sessao.encerrar();
        const mcpUrl = await this.registro.urlMcp(funcionario.id, projeto ? 'trabalho' : 'chat');
        sinal.throwIfAborted();
        const historico = contextoDaThread(
            this.registro.conversa(funcionario.id).slice(0, -2), threadId, projeto?.id, canal,
        );
        const sessao = this.abrirSessao(funcionario, {
            modelo: funcionario.modelo.id,
            pasta: projeto?.pasta ?? this.registro.pastaConversa,
            autonomia: false,
            instrucoes: [instrucoesFuncionario(funcionario, projeto, canal),
                personalidade,
                historico && funcionario.modelo.provedor !== 'local'
                    ? `Histórico salvo desta thread, apenas para contexto:\n${historico}` : '',
            ].filter(Boolean).join('\n\n'),
            ...(funcionario.modelo.provedor === 'local' ? { historico } : {}),
            modo: 'personagem',
            atividade: projeto ? 'refinamento' : 'social',
            mcpUrl,
        });
        this.sessoes.set(funcionario.id, { sessao, projetoId: projeto?.id, threadId, canal, personalidade });
        return sessao;
    }

    private criarOuvinte(funcionarioId: string, respostaId: string): OuvinteTurno {
        let separarTexto = false;
        const alterar = (mudar: (mensagem: Mensagem) => Mensagem) => this.alterarResposta(funcionarioId, respostaId, mudar);
        const marcar = (id: string, estado: Ferramenta['estado'], saida?: string) => {
            separarTexto = true;
            const atualizar = (ferramenta: Ferramenta): Ferramenta => ferramenta.id === id
                ? { ...ferramenta, estado, concluidaEm: new Date().toISOString(),
                    ...(saida !== undefined ? { saida } : {}) } : ferramenta;
            alterar((mensagem) => ({
                ...mensagem, ferramentas: mensagem.ferramentas.map(atualizar),
                partes: mensagem.partes?.map((parte) => parte.tipo === 'ferramenta'
                    ? { ...parte, ferramenta: atualizar(parte.ferramenta) } : parte),
            }));
        };
        return {
            texto: (completo) => alterar((mensagem) => {
                if (!completo.startsWith(mensagem.texto)) throw new Error('O harness deve enviar texto cumulativo.');
                const trecho = completo.slice(mensagem.texto.length);
                if (!trecho) return mensagem;
                const partes = [...mensagem.partes ?? []];
                const ultima = partes.at(-1);
                if (!separarTexto && ultima?.tipo === 'texto') {
                    partes[partes.length - 1] = { ...ultima, texto: ultima.texto + trecho };
                } else {
                    partes.push({ id: randomUUID(), tipo: 'texto', texto: trecho, criadaEm: new Date().toISOString() });
                }
                separarTexto = false;
                return { ...mensagem, texto: completo, partes };
            }),
            iniciarFerramenta: (id, resumo, entrada) => alterar((mensagem) => {
                if (mensagem.ferramentas.some((ferramenta) => ferramenta.id === id)) {
                    const atualizar = (ferramenta: Ferramenta) => ferramenta.id === id
                        ? { ...ferramenta, entrada: entrada ?? ferramenta.entrada } : ferramenta;
                    return { ...mensagem, ferramentas: mensagem.ferramentas.map(atualizar),
                        partes: mensagem.partes?.map((parte) => parte.tipo === 'ferramenta'
                            ? { ...parte, ferramenta: atualizar(parte.ferramenta) } : parte) };
                }
                separarTexto = true;
                const ferramenta: Ferramenta = {
                    id, resumo, estado: 'rodando', entrada, iniciadaEm: new Date().toISOString(),
                };
                return {
                    ...mensagem, ferramentas: [...mensagem.ferramentas, ferramenta],
                    partes: [...mensagem.partes ?? [], {
                        id, tipo: 'ferramenta', ferramenta, criadaEm: new Date().toISOString(),
                    }],
                };
            }),
            concluirFerramenta: (id, erro, saida) => {
                if (erro) this.registro.acontecer(funcionarioId, 'falha_ferramenta');
                marcar(id, erro ? 'falhou' : 'concluida', saida);
            },
            aprovar: (id, resumo, sinal) => this.pedirAprovacao(funcionarioId, id, resumo, sinal, marcar),
        };
    }

    private pedirAprovacao(
        funcionarioId: string,
        ferramentaId: string,
        resumo: string,
        sinal: AbortSignal,
        marcar: (id: string, estado: Ferramenta['estado']) => void,
    ): Promise<boolean> {
        if (sinal.aborted) return Promise.resolve(false);
        return new Promise((resolver) => {
            const id = randomUUID();
            const decidir = (aprovada: boolean) => {
                sinal.removeEventListener('abort', recusar);
                this.aprovacoes.delete(id);
                if (!aprovada) {
                    marcar(ferramentaId, 'recusada');
                    if (!sinal.aborted) this.registro.acontecer(funcionarioId, 'recusa');
                }
                this.registro.emitirEstado();
                resolver(aprovada);
            };
            const recusar = () => decidir(false);
            sinal.addEventListener('abort', recusar, { once: true });
            this.aprovacoes.set(id, { id, funcionarioId, resumo, decidir });
            this.registro.emitirEstado();
        });
    }

    private concluir(funcionarioId: string, respostaId: string, erro?: unknown): void {
        const interrompido = this.execucoes.get(funcionarioId)?.signal.aborted ?? true;
        const eraConversa = this.emConversa(funcionarioId);
        this.execucoes.delete(funcionarioId);
        this.canaisEmExecucao.delete(funcionarioId);
        if (eraConversa) this.registro.conversaEncerrada?.(funcionarioId);
        const mensagemErro = interrompido ? mensagemInterrupcao
            : erro ? erro instanceof Error ? erro.message : String(erro) : undefined;
        this.alterarResposta(funcionarioId, respostaId, (mensagem) => ({
            ...mensagem,
            erro: mensagemErro,
            ferramentas: mensagem.ferramentas.map((ferramenta) =>
                ferramenta.estado === 'rodando' ? { ...ferramenta,
                    estado: interrompido ? 'recusada' : erro ? 'falhou' : 'concluida' } : ferramenta,
            ),
            partes: mensagem.partes?.map((parte) => parte.tipo === 'ferramenta'
                && parte.ferramenta.estado === 'rodando' ? {
                    ...parte, ferramenta: { ...parte.ferramenta,
                        estado: interrompido ? 'recusada' : erro ? 'falhou' : 'concluida' },
                } : parte),
        }));
        this.publicarConversa(funcionarioId, true);
        if (erro && !interrompido) {
            this.falhas.add(funcionarioId);
            this.registro.acontecer(funcionarioId, 'turno_falhou');
        }
        if (!erro && !interrompido) {
            this.registro.confirmarPercepcao?.(funcionarioId, eraConversa ? 'chat' : 'trabalho');
            this.registro.acontecer(funcionarioId, 'turno_concluido');
        }
        this.registro.emitirEstado();
        const concluir = this.conclusoes.get(funcionarioId);
        this.conclusoes.delete(funcionarioId);
        this.observadores.delete(funcionarioId);
        const resposta = this.registro.conversa(funcionarioId).find((mensagem) => mensagem.id === respostaId);
        concluir?.({ ok: !mensagemErro, texto: mensagemErro ?? resposta?.texto ?? 'Turno concluído sem resposta.' });
    }

    private alterarResposta(funcionarioId: string, respostaId: string, mudar: (mensagem: Mensagem) => Mensagem): void {
        const conversa = this.registro.conversa(funcionarioId);
        const mensagens = conversa.map((mensagem) => mensagem.id === respostaId ? mudar(mensagem) : mensagem);
        this.registro.gravarConversa(funcionarioId, mensagens);
        const resposta = mensagens.find((mensagem) => mensagem.id === respostaId);
        if (resposta) this.observadores.get(funcionarioId)?.(resposta);
        this.publicarConversa(funcionarioId);
    }

    private publicarConversa(funcionarioId: string, imediato = false): void {
        const agendada = this.publicacoes.get(funcionarioId);
        if (imediato) {
            if (agendada) clearTimeout(agendada);
            this.publicacoes.delete(funcionarioId);
            return this.registro.emitirConversa(funcionarioId);
        }
        if (agendada) return;
        this.publicacoes.set(
            funcionarioId,
            setTimeout(() => {
                this.publicacoes.delete(funcionarioId);
                this.registro.emitirConversa(funcionarioId);
            }, intervaloPublicacaoMs),
        );
    }
}
