import { z } from 'zod';
import type { Agente } from './agentes';
import { esquemaItemPosicionado, salaVazia, type Sala } from './escritorio';
import {
    esquemaDemissao,
    esquemaFuncionario,
    esquemaMensagem,
    esquemaProjeto,
    type Aprovacao,
    type StatusFuncionario,
} from './funcionarios';
import { esquemaMensagemGeral, type EtapaResposta, type MensagemGeral } from './geral';
import { esquemaNecessidades, type Necessidades } from './necessidades';
import { esquemaAusencia } from './ausencias';
import { esquemaCarreira } from './carreira';
import { esquemaNecessidadesLiberadas } from './acolhimento';
import { esquemaPensamento, esquemaRegistroTrabalho } from './trabalho';

import { esquemaThread } from './threads';
import { esquemaSocial } from './social';
import type { ValidacaoEntrega } from './trabalho';
import { esquemaArquivoRefinamento } from './refinamento';
import { cotaAtual, esquemaCota, diaDoExpediente } from './departamento';

export const moedasIniciais = 600;

/** Recompensa base por pedido aprovado pela Diretoria. */
export const recompensaTarefa = 25;

/** Bônus fixos por categorias verificadas, sem multiplicar a recompensa por etapas ou delegações. */
export function recompensaEntrega(validacao: ValidacaoEntrega): number {
    const tipos = new Set(validacao.criterios.filter((item) => item.estado === 'verificado').map((item) => item.tipo));
    return recompensaTarefa + (tipos.has('funcional') ? 5 : 0) + (tipos.has('visual') ? 5 : 0);
}

/** Fração do preço devolvida ao vender um item. */
export const fracaoRevenda = 0.5;

/**
 * Estado salvo. A versão 1 não tinha relógio, necessidades nem canal Geral; esses campos recebem valores
 * padrão na leitura, então arquivos antigos continuam abrindo.
 */
export const esquemaEstado = z.object({
    versao: z.union([z.literal(1), z.literal(2)]).transform((): 2 => 2),
    moedas: z.number().int().min(0),
    leiturasGeral: z.record(z.string(), z.string()).default({}),
    sala: z.object({
        largura: z.number().int().positive(),
        profundidade: z.number().int().positive(),
        itens: z.array(esquemaItemPosicionado),
    }),
    funcionarios: z.array(esquemaFuncionario),
    projetos: z.array(esquemaProjeto),
    demissoes: z.array(esquemaDemissao),
    conversas: z.record(z.string(), z.array(esquemaMensagem)),
    relogio: z.number().min(0).default(0),
    diaNecessidades: z.string().default(() => diaDoExpediente()),
    necessidades: z.record(z.string(), esquemaNecessidades).default({}),
    ausencias: z.record(z.string(), esquemaAusencia).default({}),
    carreira: esquemaCarreira.default({}),
    necessidadesLiberadas: esquemaNecessidadesLiberadas.default([]),
    geral: z.array(esquemaMensagemGeral).default([]),
    pensamentos: z.record(z.string(), esquemaPensamento).default({}),
    historicoPensamentos: z.record(z.string(), z.array(esquemaPensamento)).default({}),
    trabalhos: z.array(esquemaRegistroTrabalho).default([]),
    threads: z.array(esquemaThread).default([]),
    social: esquemaSocial.default(() => esquemaSocial.parse({})),
    refinamentos: z.record(z.string(), esquemaArquivoRefinamento).default({}),
    cota: esquemaCota.default(() => cotaAtual()),
    /** Mensagens enviadas por iniciativa do funcionário que a Diretoria ainda não leu, por funcionário. */
    naoLidas: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

/** Tudo que é salvo em disco. As conversas incluem as de funcionários demitidos, para consulta no histórico. */
export type EstadoSalvo = z.infer<typeof esquemaEstado>;

export function estadoInicial(): EstadoSalvo {
    return {
        versao: 2,
        moedas: moedasIniciais,
        leiturasGeral: {},
        sala: { ...salaVazia, itens: [] },
        funcionarios: [],
        projetos: [],
        demissoes: [],
        conversas: {},
        relogio: 0,
        diaNecessidades: diaDoExpediente(),
        necessidades: {},
        ausencias: {},
        carreira: {},
        necessidadesLiberadas: [],
        geral: [],
        pensamentos: {},
        historicoPensamentos: {},
        trabalhos: [],
        threads: [],
        social: esquemaSocial.parse({}),
        refinamentos: {},
        cota: cotaAtual(),
        naoLidas: {},
    };
}

/** Situação do canal Geral: quem está escrevendo agora e se a conversa livre entre agentes está ligada. */
export type SituacaoGeral = {
    etapaResposta?: EtapaResposta;
    falasEmAndamento?: MensagemGeral[];
    falandoId: string | null;
    conversaLivre: boolean;
    conversaAtiva: boolean;
    encerrando: boolean;
    semLimite: boolean;
    falasRestantes: number;
    /** Pares com diálogo privado em andamento ou na fila, no formato `idA:idB` com IDs ordenados. */
    reservadosAtivos?: string[];
};

/** Estado enviado à interface. Conversas, canal Geral e posições seguem por eventos próprios. */
export type EstadoPublico = Pick<EstadoSalvo,
    'moedas' | 'funcionarios' | 'projetos' | 'demissoes' | 'pensamentos' | 'trabalhos' | 'threads' | 'social'
    | 'refinamentos' | 'cota' | 'naoLidas' | 'ausencias' | 'carreira'> & {
    sala: Sala;
    status: Record<string, StatusFuncionario>;
    conversandoIds?: string[];
    aprovacoes: Aprovacao[];
    necessidades: Record<string, Necessidades>;
    geral: SituacaoGeral;
};

/** Quadro da simulação publicado algumas vezes por segundo. A interface interpola entre quadros. */
export type QuadroSimulacao = { segundos: number; agentes: Agente[] };
