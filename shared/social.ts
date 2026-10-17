import { z } from 'zod';
import type { Agente } from './agentes';
import { esquemaPersonalidade, type Personalidade } from './personalidade';
import { esquemaIntencao } from './intencoes';
export { esquemaPersonalidade, descreverPersonalidade, type Personalidade } from './personalidade';

const intensidade = z.number().int().min(0).max(100);

export const esquemaMarcadorRelacao = z.object({
    rotulo: z.string(), tipo: z.enum(['positivo', 'negativo']), eventoId: z.string(),
});
export const esquemaImpactoRelacao = esquemaMarcadorRelacao.extend({
    autorId: z.string(), colegaId: z.string(),
    mudancas: z.array(z.object({
        eixo: z.enum(['confianca', 'afinidade', 'respeito', 'ressentimento']),
        anterior: intensidade, atual: intensidade,
    })),
});
export type ImpactoRelacao = z.infer<typeof esquemaImpactoRelacao>;

export const esquemaRelacao = z.object({
    autorId: z.string(),
    colegaId: z.string(),
    confianca: intensidade,
    afinidade: intensidade,
    respeito: intensidade,
    ressentimento: intensidade,
    ultimoEventoId: z.string(),
    marcadores: z.array(esquemaMarcadorRelacao).optional(),
});

export const acoesSociais = ['cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar'] as const;
export const reacoesSociais = ['concordar', 'discordar', 'perdoar', 'desconfiar'] as const;
export const tiposProposta = ['demissao', 'troca_lideranca', 'transferencia', 'sala_descanso', 'promocao'] as const;
export const nomesProposta = {
    demissao: 'Demissão', troca_lideranca: 'Troca de cargo', transferencia: 'Transferência',
    sala_descanso: 'Sala de Descanso', promocao: 'Promoção',
};

export const esquemaEventoSocial = z.object({
    id: z.string(),
    sequencia: z.number().int().positive(),
    tipo: z.enum([
        ...acoesSociais, 'reservado', 'reacao', 'proposta', 'apoio', 'decisao',
        'contratacao', 'demissao', 'sala', 'delegacao', 'entrega', 'falha', 'fala', 'pausa', 'quebra', 'conserto',
        'folga', 'punicao', 'incentivo', 'comunicado', 'promocao',
    ]),
    autorId: z.string(),
    alvoId: z.string().optional(),
    sobreId: z.string().optional(),
    autorNome: z.string().optional(),
    alvoNome: z.string().optional(),
    texto: z.string().min(1).max(2000),
    alcance: z.enum(['publico', 'local', 'reservado']),
    ouvintes: z.array(z.string()),
    fontes: z.array(z.string()).default([]),
    trabalhoId: z.string().optional(),
    criadoEm: z.string(),
    impactosRelacao: z.array(esquemaImpactoRelacao).optional(),
});

export const esquemaProposta = z.object({
    id: z.string(),
    tipo: z.enum(tiposProposta),
    autorId: z.string(),
    alvoId: z.string(),
    candidatoId: z.string().optional(),
    cargo: z.enum(['refinador', 'lider', 'supervisor', 'conselheiro']).optional(),
    motivo: z.string().min(1).max(600),
    evidencias: z.array(z.string()).min(1).max(5),
    registros: z.array(esquemaEventoSocial).default([]),
    apoiadores: z.array(z.string()),
    estado: z.enum(['pendente', 'aprovada', 'recusada', 'cancelada']),
    criadaEm: z.string(),
});

export const esquemaSocial = z.object({
    personalidades: z.record(z.string(), esquemaPersonalidade).default({}),
    relacoes: z.array(esquemaRelacao).default([]),
    eventos: z.array(esquemaEventoSocial).default([]),
    historico: z.array(esquemaEventoSocial).default([]),
    propostas: z.array(esquemaProposta).default([]),
    leituras: z.record(z.string(), z.number().int().nonnegative()).default({}),
    sequencia: z.number().int().nonnegative().default(0),
    afastamentos: z.record(z.string(), z.array(z.string())).default({}),
    lembrancas: z.array(esquemaEventoSocial).default([]),
    reacoesAplicadas: z.array(z.string()).default([]),
    interacoesAplicadas: z.array(z.string()).default([]),
    intencoes: z.array(esquemaIntencao).default([]),
});

export type Relacao = z.infer<typeof esquemaRelacao>;
export type EventoSocial = z.infer<typeof esquemaEventoSocial>;
export const esquemaFiltroHistorico = z.object({
    categoria: z.enum(['acontecimentos', 'pensamentos']).default('acontecimentos'),
    detalhar: z.boolean().default(false),
    funcionario: z.string().trim().min(1).max(80).optional(),
    desde: z.iso.datetime({ offset: true }).optional(),
    ate: z.iso.datetime({ offset: true }).optional(),
    deslocamento: z.number().int().nonnegative().default(0),
});
export type FiltroHistorico = z.infer<typeof esquemaFiltroHistorico>;
export type PropostaPolitica = z.infer<typeof esquemaProposta>;
export type EstadoSocial = z.infer<typeof esquemaSocial>;
export type AcaoSocial = typeof acoesSociais[number];
export type ReacaoSocial = typeof reacoesSociais[number];
export type TipoProposta = typeof tiposProposta[number];

export const ferramentasConversaNaPausa: readonly string[] = [
    'ver_escritorio', 'conversar_reservado', 'interagir_socialmente', 'atualizar_pensamento',
    'reagir_ao_acontecimento', 'consultar_acontecimento', 'consultar', 'silencio', 'nenhuma_acao',
];

/** Alinha decisões e reações sobre pausas em todos os canais do escritório. */
export const instrucoesPausas = 'Pausas livres sem tarefa, em minutos reais. Em pausa: só conversar_reservado, '
    + 'nunca Geral, mesmo sem @. Necessidades: só se perguntarem ou afetar alguém. '
    + 'Cobre prejuízo no Work, nunca ócio ou contestação justa.';

/**
 * Política social das sessões do Geral. O funcionamento de cada ferramenta fica na descrição do MCP; aqui só
 * entra quando agir e quais limites respeitar.
 */
export const instrucoesSociais = [
    'Suas relações mudam seu tom com cada colega: afeto, frieza ou rispidez conforme a visão atual. '
        + 'Não force brigas nem invente erros, testemunhas, falas ou apoios.',
    'Ações sociais exigem ferramentas e IDs de ver_escritorio. Para agir sobre um colega, use interagir_socialmente. '
        + 'Só relate ações após sucesso. Cumprimentar não exige ação disciplinar.',
    'Relatos e fofocas são versões do autor. Somente a Diretoria executa propostas.',
    'Elogie fatos novos, nunca elogios ou concordância. Sem novidade, silencie; não repita prontidão ou protocolo. '
        + 'Use @Nome só para perguntas ou pedidos de resposta.',
    'Trate divergências e reparações com o colega no Geral. Reserve intimidades e confidências.',
    'Mantenha compromissos privados com planejar_acao. Cumpra por ações reais.',
    'Em quebras, suspeite, acuse ou defenda conforme sua personalidade e relações.',    instrucoesPausas,
    'Reagir a pausas é opcional; para acompanhar, use fazer_pausa.',
].join('\n');

/** Produz traços estáveis para atribuir uma personalidade a funcionários novos e a estados antigos. */
export function criarPersonalidade(id: string): Personalidade {
    let semente = 2166136261;
    for (const letra of id) semente = Math.imul(semente ^ letra.charCodeAt(0), 16777619) >>> 0;
    const sortear = () => {
        semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
        return semente % 101;
    };
    return {
        orgulho: sortear(), ambicao: sortear(), empatia: sortear(),
        autoritarismo: sortear(), tolerancia: sortear(),
        interesse: (['qualidade', 'reconhecimento', 'lideranca', 'estabilidade', 'amizades'] as const)[sortear() % 5]!,
        lealdade: sortear(),
    };
}

/** Alcance de conversa em células da sala. Reservados não têm ouvintes incidentais. */
export function colegasProximos(id: string, agentes: Agente[], raio = 3): string[] {
    const origem = agentes.find((agente) => agente.id === id);
    if (!origem) return [];
    return agentes.filter((agente) => agente.id !== id && Math.hypot(
        agente.posicao.x - origem.posicao.x, agente.posicao.z - origem.posicao.z,
    ) <= raio).map((agente) => agente.id);
}

/** Restringe o conhecimento ao público e ao que foi entregue ao funcionário, inclusive após demissões. */
export function podeConhecer(evento: EventoSocial, id: string): boolean {
    return evento.alcance === 'publico' || evento.autorId === id || evento.ouvintes.includes(id);
}

/** Fornece o ponto neutro antes da primeira interação entre duas pessoas. */
export function relacaoInicial(autorId: string, colegaId: string): Relacao {
    return { autorId, colegaId, confianca: 50, afinidade: 50, respeito: 50, ressentimento: 0, ultimoEventoId: '' };
}

/** Calcula efeitos pessoais sem transformar a interpretação do autor em verdade compartilhada. */
export function aplicarInteracao(
    atual: Relacao, personalidade: Personalidade, tipo: EventoSocial['tipo'], eventoId: string,
): Relacao {
    const proxima = { ...atual, ultimoEventoId: eventoId };
    const mudar = (chave: 'confianca' | 'afinidade' | 'respeito' | 'ressentimento', delta: number) => {
        proxima[chave] = Math.round(Math.min(100, Math.max(0, proxima[chave] + delta)));
    };
    if (tipo === 'cobrar') {
        mudar('ressentimento', 3 + personalidade.orgulho / 10 - personalidade.tolerancia / 20);
        mudar('afinidade', -3 - personalidade.orgulho / 25);
    }
    if (tipo === 'elogiar' || tipo === 'defender' || tipo === 'apoio') {
        mudar('afinidade', 6 + personalidade.empatia / 25);
        mudar('confianca', 4);
    }
    if (tipo === 'desculpar') {
        mudar('ressentimento', -3 - personalidade.tolerancia / 10);
        mudar('confianca', 3);
    }
    if (tipo === 'contestar') {
        mudar('ressentimento', personalidade.autoritarismo / 10);
        mudar('respeito', 3 - personalidade.autoritarismo / 15);
    }
    if (tipo === 'falha') mudar('confianca', -5);
    if (tipo === 'entrega') { mudar('confianca', 3); mudar('respeito', 2); }
    return proxima;
}
