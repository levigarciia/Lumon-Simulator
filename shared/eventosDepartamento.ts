import { diaDoExpediente } from './departamento';
import type { ArquivoRefinamento } from './refinamento';

/**
 * Acontecimentos gerados por regra para manter a partida viva sem depender da Diretoria. Use `escolherEvento`
 * a cada verificação da agenda; as consequências ficam no serviço que a executa.
 */
export const tiposEventoDepartamento = ['visita_diretoria', 'auditoria', 'avaria_terminal', 'entrega_arquivo'] as const;

export type TipoEventoDepartamento = typeof tiposEventoDepartamento[number];

/** Intervalo mínimo entre eventos sorteados e chance por verificação. */
export const agendaEventos = { intervaloMinimoMs: 8 * 60000, verificacaoMs: 60000, chance: 0.15 };

export const duracaoAvariaMs = 3 * 60000;

export const estresseVisita = 6;
export const duracaoArquivoDiretoriaMinutos = 5;

const pesosEventos: Record<TipoEventoDepartamento, number> = {
    visita_diretoria: 1,
    auditoria: 1,
    avaria_terminal: 1,
    entrega_arquivo: 4,
};

export const textoVisita = 'Uma comitiva da Diretoria visita o departamento e observa cada mesa em silêncio. '
    + 'Kier nos ensina que a vigilância é uma forma de cuidado.';

/** Sorteia um evento entre os possíveis agora. `sorteio` deve estar entre zero e um, sem incluir um. */
export function escolherEvento(
    sorteio: number, possiveis: readonly TipoEventoDepartamento[],
): TipoEventoDepartamento | undefined {
    if (!(sorteio >= 0 && sorteio < 1)) throw new Error('O sorteio deve estar entre zero e um, sem incluir um.');
    if (!possiveis.length || sorteio >= agendaEventos.chance) return undefined;
    const pesoTotal = possiveis.reduce((total, tipo) => total + pesosEventos[tipo], 0);
    let pesoSorteado = sorteio / agendaEventos.chance * pesoTotal;
    for (const tipo of possiveis) {
        pesoSorteado -= pesosEventos[tipo];
        if (pesoSorteado < 0) return tipo;
    }
    return possiveis.at(-1);
}

/** Grupos aceitos por funcionário nos arquivos cujo prazo cai no dia indicado, do maior para o menor. */
export function rankingDoDia(arquivos: ArquivoRefinamento[], dia: string): [string, number][] {
    const contagem = new Map<string, number>();
    for (const arquivo of arquivos) {
        if (diaDoExpediente(new Date(arquivo.prazo)) !== dia) continue;
        for (const envio of arquivo.envios) {
            if (envio.resultado !== 'aceito') continue;
            contagem.set(envio.funcionarioId, (contagem.get(envio.funcionarioId) ?? 0) + 1);
        }
    }
    return [...contagem].sort((a, b) => b[1] - a[1]);
}

/** Semanas completas de casa quando hoje fecha uma semana exata; caso contrário, `undefined`. */
export function semanasDeCasa(contratadoEm: string, agora: Date): number | undefined {
    const inicio = new Date(contratadoEm);
    if (Number.isNaN(inicio.getTime())) return undefined;
    const dias = Math.round((Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())
        - Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())) / 86400000);
    return dias > 0 && dias % 7 === 0 ? dias / 7 : undefined;
}
