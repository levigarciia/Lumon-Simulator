import { catalogo, type ItemPosicionado } from './escritorio';

/** Custo para recuperar um móvel, cobrado uma vez do saldo compartilhado. */
export function custoConserto(item: ItemPosicionado): number {
    return Math.max(5, Math.ceil(catalogo[item.tipo].preco * 0.25));
}

/** Registra um uso completo de móvel de pausa. Os primeiros oito usos após a compra ou reparo são protegidos. */
export function registrarUso(item: ItemPosicionado, funcionarioId: string, sorteio: number): ItemPosicionado {
    if (!Number.isFinite(sorteio) || sorteio < 0 || sorteio >= 1) {
        throw new Error('O sorteio de desgaste deve estar entre zero e um, sem incluir um.');
    }
    if (!funcionarioId) throw new Error('O uso exige um funcionário identificado.');
    const atividade = catalogo[item.tipo].uso?.atividade;
    if (item.quebrado || !atividade || atividade === 'trabalhando') return item;
    const usos = (item.usos ?? 0) + 1;
    const chance = Math.min(0.2, Math.max(0, usos - 8) * 0.01);
    return { ...item, usos, ultimoUsuarioId: funcionarioId, quebrado: sorteio < chance };
}

/** Restaura o móvel e reinicia o desgaste, preservando a identidade e a posição. */
export function repararItem(item: ItemPosicionado): ItemPosicionado {
    return { ...item, quebrado: false, usos: 0 };
}
