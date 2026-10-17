/**
 * Incentivos da Lumon. Festas e lembrancinhas custam moedas do saldo compartilhado. Use `efeitoIncentivo`
 * para aplicar o alívio no homenageado e `invejaDoColega` para o ressentimento de quem ficou de fora.
 */
export const incentivos = {
    armadilha_dedo: { nome: 'Armadilha de dedo', preco: 5, coletivo: false, estresse: -4, esgotamento: -1 },
    borracha: { nome: 'Borracha', preco: 5, coletivo: false, estresse: -4, esgotamento: -1 },
    caricatura: { nome: 'Caricatura', preco: 15, coletivo: false, estresse: -8, esgotamento: -2 },
    festa_waffles: { nome: 'Festa dos waffles', preco: 150, coletivo: false, estresse: -35, esgotamento: -20 },
    festa_melancia: { nome: 'Festa da melancia', preco: 120, coletivo: true, estresse: -15, esgotamento: -6 },
    musica_danca: { nome: 'Experiência de Música e Dança', preco: 60, coletivo: true, estresse: -10, esgotamento: -3 },
} as const;

export type TipoIncentivo = keyof typeof incentivos;

export const tiposIncentivo = Object.keys(incentivos) as [TipoIncentivo, ...TipoIncentivo[]];

/** Ressentimento de um colega com ambição alta ao ver outra pessoa ser homenageada. */
export function invejaDoColega(tipo: TipoIncentivo, ambicao: number): number {
    if (incentivos[tipo].coletivo) return 0;
    const peso = tipo === 'festa_waffles' ? 12 : tipo === 'caricatura' ? 5 : 2;
    return ambicao >= 60 ? Math.round(peso * ambicao / 100) : 0;
}
