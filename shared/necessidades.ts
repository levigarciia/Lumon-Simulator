import { z } from 'zod';
import type { Atividade } from './escritorio';
import {
    estagioEsgotamento, fatorEstresseTrabalho, impactosEsgotamento, nomesEstagio, orientacaoEsgotamento,
    recuperacaoFolga, variacaoEsgotamento,
} from './esgotamento';

export const esquemaNecessidades = z.object({
    energia: z.number().min(0).max(100),
    estresse: z.number().min(0).max(100),
    fome: z.number().min(0).max(100),
    segundosSeguidos: z.number().min(0),
    falhasHoje: z.number().int().min(0),
    esgotamento: z.number().min(0).max(100).default(0),
});

/**
 * Estado interno de um funcionário. `segundosSeguidos` conta o tempo de trabalho sem pausa e `falhasHoje`
 * as falhas e recusas do dia, ambos usados no resumo que o agente recebe a cada turno. `esgotamento` acumula
 * devagar e segue as regras de `esgotamento.ts`.
 */
export type Necessidades = z.infer<typeof esquemaNecessidades>;

export const necessidadesIniciais: Necessidades = {
    energia: 90, estresse: 10, fome: 20, segundosSeguidos: 0, falhasHoje: 0, esgotamento: 0,
};

/**
 * Situação usada para manter o bem estar contínuo. O trabalho desgasta mais; o ócio reduz o estresse,
 * mas ainda aumenta a fome e consome energia. Itens permitem recuperar necessidades específicas.
 * `folga` vale enquanto o funcionário está fora da sala; `sala_descanso`, durante a punição.
 */
export type Situacao = 'trabalhando' | 'ocioso' | 'folga' | 'sala_descanso' | 'bem_estar'
    | Exclude<Atividade, 'trabalhando' | 'andando' | 'conversando' | 'ausente' | 'observando'>;

type Taxas = { energia: number; estresse: number; fome: number };

const taxasPorSegundo: Record<Situacao, Taxas> = {
    trabalhando: { energia: -0.25, estresse: 0.09, fome: 0.06 },
    ocioso: { energia: -0.025, estresse: -0.025, fome: 0.04 },
    cafe: { energia: 0.2, estresse: -0.04, fome: 0 },
    comendo: { energia: 0.04, estresse: -0.06, fome: -0.4 },
    descansando: { energia: 0.3, estresse: -0.16, fome: 0 },
    ouvindo_musica: { energia: 0.04, estresse: -0.3, fome: 0 },
    folga: recuperacaoFolga,
    sala_descanso: { energia: -0.1, estresse: 0.25, fome: 0.04 },
    bem_estar: { energia: 0.1, estresse: -0.3, fome: 0.03 },
};

const variacaoEsgotamentoSituacao: Record<Situacao, (estresse: number) => number> = {
    trabalhando: (estresse) => variacaoEsgotamento('trabalhando', estresse),
    ocioso: (estresse) => variacaoEsgotamento('ocioso', estresse),
    folga: () => recuperacaoFolga.esgotamento,
    sala_descanso: () => 0.03,
    bem_estar: () => -0.05,
    cafe: (estresse) => variacaoEsgotamento('pausa', estresse),
    comendo: (estresse) => variacaoEsgotamento('pausa', estresse),
    descansando: (estresse) => variacaoEsgotamento('pausa', estresse),
    ouvindo_musica: (estresse) => variacaoEsgotamento('pausa', estresse),
};

/** Acontecimentos reais do harness que afetam o funcionário. */
export type Acontecimento = 'falha_ferramenta' | 'recusa' | 'turno_concluido' | 'turno_falhou' | 'entrega_rejeitada';

const efeitosAcontecimento: Record<Acontecimento, { estresse: number; falha: boolean }> = {
    falha_ferramenta: { estresse: 0, falha: false },
    recusa: { estresse: 0, falha: false },
    turno_concluido: { estresse: 0, falha: false },
    turno_falhou: { estresse: 0, falha: false },
    entrega_rejeitada: { estresse: 12, falha: true },
};

function limitar(valor: number): number {
    return Math.min(100, Math.max(0, valor));
}

/**
 * Avança as necessidades em `segundos` na situação indicada. Pausas zeram o tempo seguido de trabalho.
 * `alivioAmbiente` reduz o ganho de estresse por segundo, conforme a decoração próxima.
 */
export function aplicarTempo(
    atual: Necessidades, situacao: Situacao, segundos: number, alivioAmbiente = 0,
): Necessidades {
    const taxas = taxasPorSegundo[situacao];
    const pausa = situacao !== 'trabalhando' && situacao !== 'ocioso';
    const esgotamento = atual.esgotamento ?? 0;
    const fator = situacao === 'trabalhando' ? fatorEstresseTrabalho(esgotamento) : 1;
    return {
        energia: limitar(atual.energia + taxas.energia * segundos),
        estresse: limitar(atual.estresse + (taxas.estresse * fator - alivioAmbiente) * segundos),
        fome: limitar(atual.fome + taxas.fome * segundos),
        segundosSeguidos: pausa ? 0 : situacao === 'trabalhando' ? atual.segundosSeguidos + segundos : atual.segundosSeguidos,
        falhasHoje: atual.falhasHoje,
        esgotamento: limitar(esgotamento + variacaoEsgotamentoSituacao[situacao](atual.estresse) * segundos),
    };
}

/** Aplica um impacto direto no esgotamento, como cobranças, rejeições, apoio ou sessões de bem estar. */
export function ajustarEsgotamento(atual: Necessidades, delta: number): Necessidades {
    return { ...atual, esgotamento: limitar((atual.esgotamento ?? 0) + delta) };
}

export function aplicarAcontecimento(atual: Necessidades, acontecimento: Acontecimento): Necessidades {
    const efeito = efeitosAcontecimento[acontecimento];
    const proximo = {
        ...atual,
        estresse: limitar(atual.estresse + efeito.estresse),
        falhasHoje: atual.falhasHoje + (efeito.falha ? 1 : 0),
    };
    return acontecimento === 'entrega_rejeitada' ? ajustarEsgotamento(proximo, impactosEsgotamento.rejeicao) : proximo;
}

/** Humor de 0 a 100, derivado das demais necessidades. */
export function humor(necessidades: Necessidades): number {
    return Math.round(limitar(100 - necessidades.estresse * 0.6 - necessidades.fome * 0.25 + (necessidades.energia - 50) * 0.3));
}

/** Linha que o agente recebe antes de cada turno para saber como está. */
export function resumirNecessidades(necessidades: Necessidades): string {
    const minutos = Math.round(necessidades.segundosSeguidos);
    return [
        `energia ${Math.round(necessidades.energia)}`,
        `estresse ${Math.round(necessidades.estresse)}`,
        `fome ${Math.round(necessidades.fome)}`,
        `humor ${humor(necessidades)}`,
        `${minutos} minutos seguidos de trabalho`,
        `${necessidades.falhasHoje} falhas ou recusas hoje`,
        `esgotamento ${Math.round(necessidades.esgotamento ?? 0)} (${
            nomesEstagio[estagioEsgotamento(necessidades.esgotamento ?? 0)].toLowerCase()})`,
    ].join(', ');
}

/** Necessidades que já justificam uma pausa, com a atividade de `fazer_pausa` que atende cada uma. */
export function pedidosDoCorpo(necessidades: Necessidades): string[] {
    return [
        ...(necessidades.estresse >= 50 ? ['estresse alto (descansando ou ouvindo_musica)'] : []),
        ...(necessidades.energia <= 35 ? ['energia baixa (cafe ou descansando)'] : []),
        ...(necessidades.fome >= 60 ? ['fome (comendo)'] : []),
    ];
}

/** Orienta reações conforme o estado atual, preservando a personalidade. */
export function disposicaoAtual(atual: Necessidades): string {
    const efeitos = [
        ...(atual.estresse >= 50 ? ['Você está mais sensível a cobranças e tem menos paciência.'] : []),
        ...(atual.fome >= 60 ? ['A fome incomoda e reduz sua concentração e disposição para conversar.'] : []),
        ...(atual.energia <= 35 ? ['O cansaço torna suas respostas mais breves e sua iniciativa menor.'] : []),
        ...(orientacaoEsgotamento(atual.esgotamento ?? 0) ? [orientacaoEsgotamento(atual.esgotamento ?? 0)] : []),
    ];
    return efeitos.length ? efeitos.join(' ') + ' Reaja conforme sua personalidade, sem hostilidade gratuita. '
        + 'Você decide se quer cuidar dessas necessidades com fazer_pausa, considerando as urgências atuais.' : '';
}
