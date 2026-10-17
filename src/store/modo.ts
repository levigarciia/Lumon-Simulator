import type { Rotacao, TipoItem } from '../../shared/escritorio';

/**
 * Modo de interação com a sala. Em `editar` os móveis podem ser escolhidos; em `posicionar` um item comprado
 * ou movido segue o cursor até ser confirmado. Sem `itemId`, o posicionamento é uma compra.
 */
export type Modo =
    | { tipo: 'normal' }
    | { tipo: 'editar' }
    | { tipo: 'posicionar'; item: TipoItem; itemId?: string; rotacao: Rotacao };

export function girar(rotacao: Rotacao): Rotacao {
    return ((rotacao + 1) % 4) as Rotacao;
}
