import { anexosDaSala, obstaculosDoAnexo, portaDoAnexo } from './anexos';
import { celulaAcessoAnexos, criarVerificadorLivre, type Celula, type Sala } from './escritorio';

const chave = (celula: Celula) => `${celula.x}:${celula.z}`;

/** Percurso do escritório, corredor e anexos, respeitando portas, paredes e móveis fixos. */
export function criarVerificadorCirculacao(sala: Sala): (celula: Celula) => boolean {
    const livreNaSala = criarVerificadorLivre(sala);
    const anexos = anexosDaSala(sala);
    const fimCorredor = Math.max(sala.profundidade, ...anexos.map((anexo) => anexo.z + anexo.profundidade));
    const acesso = celulaAcessoAnexos(sala);
    const obstaculos = new Set(anexos.flatMap(obstaculosDoAnexo).map(chave));
    return (celula) => {
        const { x, z } = celula;
        if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
        if (x < sala.largura) return livreNaSala(celula);
        if (x === sala.largura) return z === acesso.z;
        if (x === sala.largura + 1) return z >= 0 && z < fimCorredor;
        return anexos.some((anexo) => x >= anexo.x && x < anexo.x + anexo.largura
            && z >= anexo.z && z < anexo.z + anexo.profundidade
            && (x !== anexo.x || z === portaDoAnexo(anexo).z) && !obstaculos.has(chave(celula)));
    };
}
