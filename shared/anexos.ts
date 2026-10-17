import type { MotivoAusencia } from './ausencias';
import { centroCelula, type Celula, type Ponto, type Sala } from './escritorio';

/** Cômodos internos com lugares reserváveis, separados da grade editável do escritório. */
export type TipoAnexo = 'sala_descanso' | 'bem_estar';

export type Anexo = { tipo: TipoAnexo; nome: string; x: number; z: number; largura: number; profundidade: number };

export const recuoAnexos = 2;
export const capacidadeAnexo: Record<TipoAnexo, number> = { sala_descanso: 3, bem_estar: 2 };

/** Dimensões compartilhadas pela navegação e pelos modelos 3D dos cômodos. */
export function anexosDaSala(sala: Sala): Anexo[] {
    const x = sala.largura + recuoAnexos;
    const profundidade = Math.max(6, Math.floor(sala.profundidade / 2));
    return [
        { tipo: 'sala_descanso', nome: 'Sala de Descanso', x, z: 0, largura: 6, profundidade },
        { tipo: 'bem_estar', nome: 'Sala de Bem estar', x, z: profundidade + 1, largura: 6, profundidade },
    ];
}

/** A folga acontece fora do prédio e não reserva um cômodo interno. */
export function anexoDaAusencia(motivo: MotivoAusencia): TipoAnexo | undefined {
    return motivo === 'folga' ? undefined : motivo;
}

/** Célula de passagem pela parede oeste de um anexo. */
export function portaDoAnexo(anexo: Anexo): Celula {
    return { x: anexo.x, z: anexo.z + (anexo.tipo === 'sala_descanso' ? 1 : Math.floor(anexo.profundidade / 2)) };
}

export type LugarAnexo = { posicao: Ponto; direcao: number; sentado: boolean };

/** Consulta um lugar válido; índices excedentes nunca reutilizam o lugar de outro funcionário. */
export function lugarNoAnexo(sala: Sala, tipo: TipoAnexo, indice: number): LugarAnexo {
    if (!Number.isInteger(indice) || indice < 0 || indice >= capacidadeAnexo[tipo]) {
        throw new Error('Lugar inválido no anexo.');
    }
    const anexo = anexosDaSala(sala).find((item) => item.tipo === tipo)!;
    if (tipo === 'sala_descanso') {
        return { posicao: centroCelula({ x: anexo.x + 1 + indice * 2,
            z: anexo.z + anexo.profundidade - 2 }), direcao: Math.PI, sentado: false };
    }
    return { posicao: centroCelula({ x: anexo.x + 1 + indice * 3,
        z: portaDoAnexo(anexo).z }), direcao: indice ? -Math.PI / 2 : Math.PI / 2, sentado: true };
}

/** Células dos móveis fixos; os assentos são destinos acessíveis, como nas mesas do escritório. */
export function obstaculosDoAnexo(anexo: Anexo): Celula[] {
    if (anexo.tipo === 'sala_descanso') {
        return [1, 3, 5].map((x) => ({ x: anexo.x + x, z: anexo.z + anexo.profundidade - 3 }));
    }
    return [{ x: anexo.x + 3, z: portaDoAnexo(anexo).z }, { x: anexo.x + 5, z: anexo.z }];
}
