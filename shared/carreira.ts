import { z } from 'zod';
import { cargoAtual, nomeCargo, type Cargo, type CargoAtual } from './cargos';

/**
 * Plano de carreira do departamento. O mérito sobe com resultados e reconhecimento e cai com punições.
 * Use `situacaoCarreira` para decidir se alguém pode pedir promoção e `orientacaoCarreira` no contexto do turno.
 * Bem estar é uma ramificação terminal a partir de Refinador.
 */
export const escadaCargos = ['estagiario', 'refinador', 'lider', 'supervisor'] as const satisfies readonly CargoAtual[];

/** Mérito mínimo para pedir o cargo indicado. */
export const meritoParaCargo: Record<Exclude<CargoAtual, 'estagiario'>, number> = {
    refinador: 20, lider: 45, supervisor: 80, conselheiro: 45,
};

export const ganhosMerito = {
    grupoAceito: 3, entregaAprovada: 5, elogio: 2, incentivo: 4,
    cobrancaPublica: -2, entregaRejeitada: -4, salaDescanso: -8,
} as const;

/** Mérito mantido depois de uma promoção, para que o próximo degrau exija novos resultados. */
export const fracaoMeritoAposPromocao = 0.3;

export const esquemaCarreira = z.record(z.string(), z.object({
    merito: z.number().min(0).max(200),
    promovidoEm: z.string().optional(),
    objetivo: z.enum(['refinador', 'lider', 'supervisor', 'conselheiro']).optional(),
}));

export type Carreira = z.infer<typeof esquemaCarreira>;
export type CargoDestino = Exclude<CargoAtual, 'estagiario'>;

export function degrau(cargo: Cargo): number {
    return (escadaCargos as readonly string[]).indexOf(cargoAtual(cargo));
}

/** Opções imediatas de crescimento, usadas para escolher uma carreira sem saltar etapas. */
export function caminhosCarreira(cargo: Cargo): readonly CargoAtual[] {
    const caminhos: Record<CargoAtual, readonly CargoDestino[]> = {
        estagiario: ['refinador'], refinador: ['lider', 'conselheiro'],
        lider: ['supervisor'], supervisor: [], conselheiro: [],
    };
    return caminhos[cargoAtual(cargo)];
}

export function proximoCargo(cargo: Cargo, objetivo?: CargoDestino): CargoDestino | undefined {
    const caminhos = caminhosCarreira(cargo);
    return (objetivo && caminhos.includes(objetivo) ? objetivo : caminhos[0]) as CargoDestino | undefined;
}

/** Limita as vagas de coordenação e de Bem estar conforme o tamanho do departamento. */
export function vagas(cargo: CargoAtual, tamanhoEquipe: number): number {
    if (cargo === 'lider') return Math.max(1, Math.floor(tamanhoEquipe / 4));
    if (cargo === 'supervisor') return 1;
    if (cargo === 'conselheiro') return 1;
    return Infinity;
}

export function aplicarMerito(atual: number, delta: number): number {
    return Math.round(Math.min(200, Math.max(0, atual + delta)) * 10) / 10;
}

type Pessoa = { id: string; nome: string; cargo: Cargo };

type EventoMerito = { tipo: string; autorId: string; alvoId?: string; alcance: string };

/** Variações de mérito causadas por um acontecimento social, como pares de funcionário e delta. */
export function meritoDoEvento(evento: EventoMerito): [string, number][] {
    if (!evento.alvoId || evento.alvoId === evento.autorId) return [];
    if (evento.tipo === 'elogiar') return [[evento.alvoId, ganhosMerito.elogio]];
    if (evento.tipo === 'incentivo') return [[evento.alvoId, ganhosMerito.incentivo]];
    if (evento.tipo === 'cobrar' && evento.alcance === 'publico') return [[evento.alvoId, ganhosMerito.cobrancaPublica]];
    if (evento.tipo === 'punicao' && evento.autorId !== 'sistema') return [[evento.alvoId, ganhosMerito.salaDescanso]];
    return [];
}

export type SituacaoCarreira =
    | { tipo: 'fora_da_escada' }
    | { tipo: 'topo' }
    | { tipo: 'insuficiente'; proximo: CargoAtual; falta: number }
    | { tipo: 'sem_vaga'; proximo: CargoAtual; ocupantes: Pessoa[] }
    | { tipo: 'elegivel'; proximo: CargoAtual };

/** Avalia o próximo passo de `id` considerando mérito, vagas e quem ocupa o cargo desejado. */
export function situacaoCarreira(id: string, equipe: Pessoa[], carreira: Carreira): SituacaoCarreira {
    const pessoa = equipe.find((item) => item.id === id);
    if (!pessoa || degrau(pessoa.cargo) < 0) return { tipo: 'fora_da_escada' };
    const proximo = proximoCargo(pessoa.cargo, carreira[id]?.objetivo);
    if (!proximo) return { tipo: 'topo' };
    const merito = carreira[id]?.merito ?? 0;
    const exigido = meritoParaCargo[proximo];
    if (merito < exigido) return { tipo: 'insuficiente', proximo, falta: Math.ceil(exigido - merito) };
    const ocupantes = equipe.filter((item) => cargoAtual(item.cargo) === proximo);
    if (ocupantes.length >= vagas(proximo, equipe.length)) return { tipo: 'sem_vaga', proximo, ocupantes };
    return { tipo: 'elegivel', proximo };
}

/** Rivais do mesmo degrau ou do degrau abaixo cujo mérito ameaça o cargo de `id`. */
export function rivais(id: string, equipe: Pessoa[], carreira: Carreira): Pessoa[] {
    const pessoa = equipe.find((item) => item.id === id);
    if (!pessoa || degrau(pessoa.cargo) <= 0) return [];
    const exigido = meritoParaCargo[cargoAtual(pessoa.cargo) as keyof typeof meritoParaCargo] ?? 0;
    return equipe.filter((item) => item.id !== id && proximoCargo(item.cargo, carreira[item.id]?.objetivo)
        === cargoAtual(pessoa.cargo)
        && (carreira[item.id]?.merito ?? 0) >= exigido * 0.75);
}

/** Linha curta para o contexto do turno: incentiva subir de cargo e, no topo alcançado, protegê-lo. */
export function orientacaoCarreira(id: string, equipe: Pessoa[], carreira: Carreira): string {
    const pessoa = equipe.find((item) => item.id === id);
    const situacao = situacaoCarreira(id, equipe, carreira);
    if (!pessoa || situacao.tipo === 'fora_da_escada') return '';
    const merito = Math.round(carreira[id]?.merito ?? 0);
    const ameacas = rivais(id, equipe, carreira).map((item) => `${item.nome} (${Math.round(carreira[item.id]?.merito ?? 0)})`);
    const defesa = ameacas.length
        ? ` Ameaçam seu cargo: ${ameacas.join(', ')}. Proteja sua posição com resultados e alianças, sem inventar falhas.`
        : '';
    const opcoes = caminhosCarreira(pessoa.cargo);
    const escolha = opcoes.length > 1
        ? ` Pode escolher ${opcoes.map(nomeCargo).join(' ou ')} com escolher_carreira, conforme seus interesses.` : '';
    const prefixo = `Carreira: ${nomeCargo(pessoa.cargo)}, mérito ${merito}.${escolha}`;
    if (situacao.tipo === 'topo') return `${prefixo} Você está no topo; preserve o cargo.${defesa}`;
    const alvo = nomeCargo(situacao.proximo);
    if (situacao.tipo === 'insuficiente') {
        return `${prefixo} Faltam ${situacao.falta} para pedir ${alvo}; busque crescer.${defesa}`;
    }
    if (situacao.tipo === 'sem_vaga') {
        const orientacao = situacao.proximo === 'conselheiro'
            ? 'Aguarde uma vaga ou escolha outra ramificação.' : 'Pode disputar com troca_lideranca, sem saltar etapas.';
        return `${prefixo} Já pode ser ${alvo}, sem vaga: ocupada por `
            + `${situacao.ocupantes.map((item) => item.nome).join(', ')}. ${orientacao}${defesa}`;
    }
    return `${prefixo} Você já pode pedir ${alvo}: use propor_mudanca tipo promocao com seu ID.${defesa}`;
}
