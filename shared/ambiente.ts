import { catalogo, centroCelula, type Ponto, type Sala } from './escritorio';

/** Distância, em células, até onde a decoração alivia o estresse. */
export const raioConforto = 3;

const confortoMaximo = 4;
const alivioPorPonto = 0.012;

/**
 * Redução do ganho de estresse por segundo para quem está em `posicao`. Cada item decorativo a até
 * `raioConforto` células soma seus pontos de conforto, com teto para evitar salas imunes ao estresse.
 */
export function alivioAmbiente(sala: Sala, posicao: Ponto): number {
    const pontos = sala.itens.reduce((soma, item) => {
        const conforto = catalogo[item.tipo].conforto ?? 0;
        if (!conforto || item.quebrado) return soma;
        const centro = centroCelula(item.celula);
        const perto = Math.hypot(centro.x - posicao.x, centro.z - posicao.z) <= raioConforto;
        return perto ? soma + conforto : soma;
    }, 0);
    return Math.min(confortoMaximo, pontos) * alivioPorPonto;
}
