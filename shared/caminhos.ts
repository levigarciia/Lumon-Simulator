import type { Celula } from './escritorio';

const vizinhos: Celula[] = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
];

function chave(celula: Celula): string {
    return `${celula.x},${celula.z}`;
}

function distancia(a: Celula, b: Celula): number {
    return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/**
 * Menor rota em quatro direções entre duas células, por A*. Devolve as células a percorrer, sem a origem,
 * ou `null` quando o destino é inalcançável. A origem pode estar ocupada, pois o agente pode estar num assento.
 */
export function encontrarRota(origem: Celula, destino: Celula, livre: (celula: Celula) => boolean): Celula[] | null {
    if (!livre(destino)) return null;
    const anterior = new Map<string, Celula>();
    const custo = new Map<string, number>([[chave(origem), 0]]);
    const abertas: { celula: Celula; prioridade: number }[] = [{ celula: origem, prioridade: distancia(origem, destino) }];
    while (abertas.length > 0) {
        abertas.sort((a, b) => a.prioridade - b.prioridade);
        const { celula: atual } = abertas.shift()!;
        if (atual.x === destino.x && atual.z === destino.z) return reconstruir(anterior, atual, origem);
        const custoAtual = custo.get(chave(atual))!;
        for (const passo of vizinhos) {
            const proxima = { x: atual.x + passo.x, z: atual.z + passo.z };
            if (!livre(proxima)) continue;
            const novoCusto = custoAtual + 1;
            if (novoCusto >= (custo.get(chave(proxima)) ?? Infinity)) continue;
            custo.set(chave(proxima), novoCusto);
            anterior.set(chave(proxima), atual);
            abertas.push({ celula: proxima, prioridade: novoCusto + distancia(proxima, destino) });
        }
    }
    return null;
}

function reconstruir(anterior: Map<string, Celula>, fim: Celula, origem: Celula): Celula[] {
    const rota: Celula[] = [];
    let atual: Celula | undefined = fim;
    while (atual && chave(atual) !== chave(origem)) {
        rota.unshift(atual);
        atual = anterior.get(chave(atual));
    }
    return rota;
}
