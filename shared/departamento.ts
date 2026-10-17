import { z } from 'zod';
import type { ArquivoRefinamento } from './refinamento';

export const metaDiaria = 18;
export const bonusCotaDiaria = 30;

/**
 * Situa o funcionário no andar separado da Lumon e define o único trabalho atual, inclusive quando o histórico
 * contém projetos antigos. Use em todas as sessões de todos os canais.
 */
export const instrucaoDepartamento = 'Você trabalha no andar separado da Lumon e não lembra de nada lá fora. '
    + 'Seu trabalho é importante e misterioso. Só Macrodados é atual. Projetos antigos são histórico. '
    + 'Consulte o Work com revisar_trabalho, sem pedir acesso a colegas. Falas não comprovam ações. '
    + 'Só a Diretoria inicia arquivos pelo Work. Sem arquivo ativo não há etapas a cobrar: conviva e cuide de si.';

/** Orientação comum aos turnos sociais para que promessas de ação não fiquem pendentes entre turnos. */
export const instrucaoAgirNoTurno = 'Não anuncie ações: execute a ferramenta no mesmo turno e relate depois.';

export const esquemaCota = z.object({
    dia: z.string(),
    grupos: z.number().int().nonnegative(),
    arquivos: z.array(z.string()),
    primeiraMetaEm: z.string().optional(),
});

export type CotaDepartamento = z.infer<typeof esquemaCota>;

/** Usa o calendário local do computador para separar os expedientes diários. */
export function diaDoExpediente(agora = new Date()): string {
    return [agora.getFullYear(), agora.getMonth() + 1, agora.getDate()].join('/');
}

/** Retorna a cota de hoje sem importar resultados do expediente anterior. */
export function cotaAtual(cota?: CotaDepartamento, agora = new Date()): CotaDepartamento {
    const dia = diaDoExpediente(agora);
    const primeiraMetaEm = cota?.primeiraMetaEm ?? (cota && cota.grupos >= metaDiaria ? cota.dia : undefined);
    if (cota?.dia === dia) return primeiraMetaEm ? { ...cota, primeiraMetaEm } : cota;
    return { dia, grupos: 0, arquivos: [], ...(primeiraMetaEm ? { primeiraMetaEm } : {}) };
}

/** Credita somente grupos de um arquivo aprovado, uma única vez no expediente. */
export function creditarArquivo(cota: CotaDepartamento, arquivo: ArquivoRefinamento,
    agora = new Date()): CotaDepartamento {
    const atual = cotaAtual(cota, agora);
    if (atual.arquivos.includes(arquivo.id)) return atual;
    const grupos = atual.grupos + arquivo.grupos.filter((grupo) => grupo.refinadoPor).length;
    const primeiraMetaEm = atual.primeiraMetaEm ?? (grupos >= metaDiaria ? agora.toISOString() : undefined);
    return { ...atual, grupos, arquivos: [...atual.arquivos, arquivo.id],
        ...(primeiraMetaEm ? { primeiraMetaEm } : {}) };
}

/** Comunicados da Diretoria, determinados pelos resultados reais do departamento. */
export function comunicadoDiretoria(cota: CotaDepartamento, trabalhando: boolean): string {
    if (cota.grupos >= metaDiaria) return 'A cota foi cumprida. A Diretoria reconhece sua devoção a Kier.';
    if (cota.grupos > 0) return 'A Diretoria reconhece seu progresso. A plenitude exige que a cota seja cumprida.';
    if (trabalhando) return 'Cada número tem seu lugar. Encontre o seu no propósito de Kier.';
    return 'Seu trabalho dá forma à ordem. A Diretoria aguarda os frutos de sua dedicação.';
}

/** Prepara a grade para observação, omitindo grupos secretos e classificações ainda não descobertas. */
export function prepararTerminal(arquivo: ArquivoRefinamento) {
    const aceitos = arquivo.grupos.filter((grupo) => grupo.refinadoPor);
    return {
        id: arquivo.id, nome: arquivo.nome, grade: arquivo.grade, prazo: arquivo.prazo,
        total: arquivo.grupos.length, refinados: aceitos.length,
        celulasRefinadas: aceitos.flatMap((grupo) => grupo.celulas),
        caixas: aceitos.map((grupo) => grupo.temperamento),
        ultimoEnvio: arquivo.envios.at(-1),
    };
}

export type TerminalRefinamento = ReturnType<typeof prepararTerminal>;
