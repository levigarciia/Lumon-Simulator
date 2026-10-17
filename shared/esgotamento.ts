/**
 * Esgotamento acumulado de um funcionário, de 0 a 100. Cresce devagar com estresse prolongado e trabalho seguido
 * e só cai com descanso real, folga ou sessões de bem estar. Use `estagioEsgotamento` para decidir efeitos
 * mecânicos e `orientacaoEsgotamento` para o texto entregue aos agentes.
 */
export type EstagioEsgotamento = 'estavel' | 'cansado' | 'desgastado' | 'esgotado';

export const nomesEstagio: Record<EstagioEsgotamento, string> = {
    estavel: 'Estável', cansado: 'Cansado', desgastado: 'Desgastado', esgotado: 'Esgotado',
};

const limitesEstagio: [EstagioEsgotamento, number][] = [['esgotado', 85], ['desgastado', 65], ['cansado', 40]];

/** Recuperação por segundo durante a folga, fora da sala. */
export const recuperacaoFolga = { esgotamento: -0.25, estresse: -0.5, energia: 0.4, fome: 0.02 };

export function estagioEsgotamento(valor: number): EstagioEsgotamento {
    return limitesEstagio.find(([, limite]) => valor >= limite)?.[0] ?? 'estavel';
}

/** Variação por segundo conforme a situação. O trabalho sob estresse alto acumula mais rápido. */
export function variacaoEsgotamento(situacao: 'trabalhando' | 'ocioso' | 'pausa', estresse: number): number {
    if (situacao === 'pausa') return -0.03;
    if (situacao === 'trabalhando') return 0.004 + Math.max(0, estresse - 50) * 0.0004;
    if (estresse >= 70) return 0.004;
    return estresse < 40 ? -0.006 : 0;
}

/** Multiplica o ganho de estresse no trabalho: quem está desgastado se irrita mais rápido. */
export function fatorEstresseTrabalho(valor: number): number {
    const estagio = estagioEsgotamento(valor);
    return estagio === 'esgotado' ? 1.6 : estagio === 'desgastado' ? 1.3 : 1;
}

/** Ritmo da caminhada na sala, visível para a Diretoria. */
export function ritmoCaminhada(valor: number): number {
    const estagio = estagioEsgotamento(valor);
    return estagio === 'esgotado' ? 0.6 : estagio === 'desgastado' ? 0.75 : estagio === 'cansado' ? 0.9 : 1;
}

/** Quem está esgotado não recebe arquivos nem delegações até se recuperar. */
export function recusaTrabalho(valor: number): boolean {
    return estagioEsgotamento(valor) === 'esgotado';
}

/** Impacto de acontecimentos sociais e profissionais no esgotamento. */
export const impactosEsgotamento = {
    cobrancaPublica: 3, cobrancaReservada: 1.5, rejeicao: 4, apoio: -1.5,
} as const;

/** Orientação de comportamento por estágio, combinada com a personalidade em todos os canais. */
export function orientacaoEsgotamento(valor: number): string {
    const estagio = estagioEsgotamento(valor);
    if (estagio === 'cansado') {
        return 'Você sente um cansaço acumulado que uma pausa curta não resolve. Sua paciência e iniciativa '
            + 'estão menores.';
    }
    if (estagio === 'desgastado') {
        return 'Você está desgastado: erra com mais facilidade, se irrita rápido e duvida do próprio trabalho. '
            + 'Pode pedir ajuda, desabafar ou pedir folga à Diretoria.';
    }
    if (estagio === 'esgotado') {
        return 'Você está esgotado e não consegue mais assumir trabalho. Pode chorar, explodir, se isolar, pedir '
            + 'folga ou até pedir demissão com propor_mudanca sobre si mesmo, conforme sua personalidade.';
    }
    return '';
}
