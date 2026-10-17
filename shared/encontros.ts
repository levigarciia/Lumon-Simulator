import { encontrarRota } from './caminhos';
import {
    celulaDeUso, celulaDoPonto, celulaEntrada, criarVerificadorLivre, type Celula, type Ponto, type Sala,
} from './escritorio';

const chave = (celula: Celula) => `${celula.x}:${celula.z}`;
const distancia = (a: Celula, b: Celula) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

/** Escolhe dois lugares vizinhos e alcançáveis num canto livre, longe dos assentos e pontos de uso. */
export function escolherLugarEncontro(
    sala: Sala, autor: Ponto, colega: Ponto, indisponiveis: Celula[],
): { autor: Celula; colega: Celula } | undefined {
    const livre = criarVerificadorLivre(sala);
    const reservadas = new Set([
        ...indisponiveis, celulaEntrada,
        ...sala.itens.map((item) => celulaDeUso(item)).filter((celula) => celula !== null),
    ].map(chave));
    const origemAutor = celulaDoPonto(autor);
    const origemColega = celulaDoPonto(colega);
    const cantos = [{ x: 1, z: 1 }, { x: sala.largura - 2, z: 1 },
        { x: 1, z: sala.profundidade - 2 }, { x: sala.largura - 2, z: sala.profundidade - 2 }];
    const candidatos: { autor: Celula; colega: Celula; custo: number }[] = [];
    const disponivel = (celula: Celula) => livre(celula) && !reservadas.has(chave(celula));
    for (let x = 1; x < sala.largura - 1; x++) {
        for (let z = 1; z < sala.profundidade - 1; z++) {
            const destinoAutor = { x, z };
            if (!disponivel(destinoAutor)) continue;
            for (const destinoColega of [{ x: x + 1, z }, { x, z: z + 1 }]) {
                if (!disponivel(destinoColega)) continue;
                for (const [a, b] of [[destinoAutor, destinoColega], [destinoColega, destinoAutor]]) {
                    candidatos.push({ autor: a, colega: b, custo: distancia(origemAutor, a)
                        + distancia(origemColega, b) + Math.min(...cantos.map((canto) => distancia(a, canto))) * 3 });
                }
            }
        }
    }
    return candidatos.sort((a, b) => a.custo - b.custo).find((destino) =>
        encontrarRota(origemAutor, destino.autor, livre) !== null
            && encontrarRota(origemColega, destino.colega, livre) !== null);
}
