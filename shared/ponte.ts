import type { CatalogoEscritorios } from './partidas';
import type { Celula, Rotacao, TipoItem } from './escritorio';
import type { EstadoPublico, QuadroSimulacao } from './estado';
import type { Contratacao, Mensagem, Modelo } from './funcionarios';
import type { Thread } from './threads';
import type { MensagemGeral } from './geral';
import type { EstadoMotor } from './modelos';
import type { TipoIncentivo } from './incentivos';
import type { RegistroHistorico } from './historico';

/** Resultado de operações que a Diretoria pode tentar e que podem ser recusadas por regra do jogo. */
export type Resultado = { ok: true } | { ok: false; erro: string };

export type EventoLumon =
    | { tipo: 'motor'; estado: EstadoMotor }
    | { tipo: 'estado'; estado: EstadoPublico }
    | { tipo: 'conversa'; funcionarioId: string; mensagens: Mensagem[] }
    | { tipo: 'geral'; mensagens: MensagemGeral[] }
    | { tipo: 'simulacao'; quadro: QuadroSimulacao };

/** Métodos expostos pelo preload. Cada um corresponde a um canal IPC validado no processo principal. */
export type ApiLumon = {
    obterEstado: () => Promise<EstadoPublico>;
    reiniciar: () => Promise<Resultado>;
    listarEscritorios: () => Promise<CatalogoEscritorios>;
    criarEscritorio: (nome: string) => Promise<Resultado>;
    selecionarEscritorio: (id: string) => Promise<Resultado>;
    aprovarEntrega: (trabalhoId: string) => Promise<Resultado>;
    rejeitarEntrega: (trabalhoId: string, motivo: string) => Promise<Resultado>;
    corrigirEntrega: (trabalhoId: string, motivo: string) => Promise<Resultado>;
    obterConversa: (funcionarioId: string) => Promise<Mensagem[]>;
    obterGeral: () => Promise<MensagemGeral[]>;
    obterHistorico: () => Promise<RegistroHistorico[]>;
    excluirRegistroHistorico: (registroId: string) => Promise<Resultado>;
    limparGeral: () => Promise<Resultado>;
    limparConversa: (funcionarioId: string, threadId?: string) => Promise<Resultado>;
    criarThread: (thread: Thread) => Promise<Resultado>;
    renomearThread: (threadId: string, titulo: string) => Promise<Resultado>;
    excluirThread: (threadId: string) => Promise<Resultado>;
    listarModelos: () => Promise<Modelo[]>;
    obterMotor: () => Promise<EstadoMotor>;
    iniciarRefinamento: (minutos: number) => Promise<Resultado>;
    adicionarProjeto: () => Promise<Resultado>;
    contratar: (dados: Contratacao) => Promise<Resultado>;
    editar: (funcionarioId: string, dados: Contratacao) => Promise<Resultado>;
    demitir: (funcionarioId: string, motivo: string) => Promise<Resultado>;
    decidirProposta: (propostaId: string, aprovar: boolean) => Promise<Resultado>;
    concederFolga: (funcionarioId: string) => Promise<Resultado>;
    enviarSalaDescanso: (funcionarioId: string, motivo: string) => Promise<Resultado>;
    concederIncentivo: (tipo: TipoIncentivo, motivo: string, funcionarioId?: string) => Promise<Resultado>;
    enviar: (funcionarioId: string, texto: string, threadId?: string) => Promise<Resultado>;
    enviarGeral: (texto: string) => Promise<Resultado>;
    enviarTrabalho: (projetoId: string, texto: string, threadId?: string) => Promise<Resultado>;
    limparTrabalhos: (threadId?: string, projetoId?: string) => Promise<Resultado>;
    interromperTrabalho: (threadId?: string, projetoId?: string) => Promise<void>;
    alternarConversaLivre: (ativa: boolean) => Promise<Resultado>;
    alternarConversaSemLimite: (ativa: boolean) => Promise<Resultado>;
    encerrarReservado: (funcionarioId: string, colegaId: string) => Promise<Resultado>;
    marcarConversaLida: (funcionarioId: string) => Promise<Resultado>;
    interromper: (funcionarioId: string) => Promise<void>;
    responderAprovacao: (aprovacaoId: string, aprovada: boolean) => Promise<void>;
    comprar: (tipo: TipoItem, celula: Celula, rotacao: Rotacao) => Promise<Resultado>;
    mover: (itemId: string, celula: Celula, rotacao: Rotacao) => Promise<Resultado>;
    vender: (itemId: string) => Promise<Resultado>;
    aoEvento: (ouvinte: (evento: EventoLumon) => void) => () => void;
};

export const canaisLumon = [
    'obterEstado',
    'reiniciar',
    'listarEscritorios',
    'criarEscritorio',
    'selecionarEscritorio',
    'aprovarEntrega',
    'rejeitarEntrega',
    'corrigirEntrega',
    'obterConversa',
    'obterGeral',
    'obterHistorico',
    'excluirRegistroHistorico',
    'limparGeral',
    'limparConversa',
    'criarThread',
    'renomearThread',
    'excluirThread',
    'listarModelos',
    'obterMotor',
    'iniciarRefinamento',
    'adicionarProjeto',
    'contratar',
    'editar',
    'demitir',
    'decidirProposta',
    'concederFolga',
    'enviarSalaDescanso',
    'concederIncentivo',
    'enviar',
    'enviarGeral',
    'enviarTrabalho',
    'limparTrabalhos',
    'interromperTrabalho',
    'alternarConversaLivre',
    'alternarConversaSemLimite',
    'encerrarReservado',
    'marcarConversaLida',
    'interromper',
    'responderAprovacao',
    'comprar',
    'mover',
    'vender',
] as const satisfies readonly Exclude<keyof ApiLumon, 'aoEvento'>[];

export const canalEventos = 'lumon:evento';
