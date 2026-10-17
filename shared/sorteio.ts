/**
 * Gerador pseudoaleatório estável a partir de um texto. Use quando o mesmo funcionário precisa receber sempre
 * os mesmos traços, como personalidade e perfil, sem salvar o resultado.
 */
export function criarSorteador(texto: string): () => number {
    let semente = 2166136261;
    for (const letra of texto) semente = Math.imul(semente ^ letra.charCodeAt(0), 16777619) >>> 0;
    return () => {
        semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
        return semente;
    };
}

/** Escolhe um item de forma estável com o sorteador recebido. */
export function escolherCom<T>(sortear: () => number, itens: readonly T[]): T {
    if (!itens.length) throw new Error('Não há itens para escolher.');
    return itens[sortear() % itens.length]!;
}
