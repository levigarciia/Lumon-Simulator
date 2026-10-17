import { z } from 'zod';
import type { MensagemLocal } from './contextoLocal';
import type { ChamadaLocal } from './respostaLocal';

export type FerramentaDecisao = {
    function: { name: string; description?: string; parameters: unknown };
};

const esquemaDecisao = z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('fala'), texto: z.string().trim().min(1) }).strict(),
    z.object({ tipo: z.literal('silencio') }).strict(),
    z.object({ tipo: z.literal('acao'), ferramenta: z.string(), argumentos: z.record(z.string(), z.unknown()) }).strict(),
]);

export const instrucaoDecisaoSocial = 'Nos turnos de conversa, decida pelo JSON exigido: fala, acao ou silencio. '
    + 'Para pausar ou executar qualquer ação, escolha acao com a ferramenta e argumentos reais, sem fala. '
    + 'A execução devolve o resultado antes de você decidir novamente. Fala serve apenas para conversar ou '
    + 'relatar resultados confirmados; não anuncie ações nem deduza sucesso de falas anteriores. '
    + 'Sem algo útil a dizer ou fazer, escolha silencio.';

const instrucaoDecisaoReacao = 'Neste turno de reação, escolha somente acao pelo JSON exigido, com ferramenta '
    + 'e argumentos reais. Texto livre não é publicado; interagir_socialmente pode tornar sua reação pública. '
    + 'Fazer pausa passa a vez e encerra este turno após o uso do objeto.';

/** Restringe a decisão social às falas, ao silêncio e às ferramentas autorizadas no turno. */
export function formatoDecisaoSocial(ferramentas: readonly FerramentaDecisao[], somenteAcao = false) {
    return { type: 'json_schema', json_schema: { name: 'decisao_social', strict: true, schema: {
        anyOf: [
            ...(!somenteAcao ? [
                { type: 'object', properties: { tipo: { const: 'fala' }, texto: { type: 'string', minLength: 1 } },
                    required: ['tipo', 'texto'], additionalProperties: false },
                { type: 'object', properties: { tipo: { const: 'silencio' } },
                    required: ['tipo'], additionalProperties: false },
            ] : []),
            ...ferramentas.map(({ function: ferramenta }) => ({
                type: 'object', description: ferramenta.description,
                properties: { tipo: { const: 'acao' }, ferramenta: { const: ferramenta.name },
                    argumentos: ferramenta.parameters },
                required: ['tipo', 'ferramenta', 'argumentos'], additionalProperties: false,
            })),
        ],
    } } };
}

/** Executa decisões estruturadas sem converter promessas em ações nem publicar JSON como fala. */
export async function executarDecisoesSociais(opcoes: {
    mensagens: MensagemLocal[];
    ferramentas: readonly FerramentaDecisao[];
    inferir: (formato: ReturnType<typeof formatoDecisaoSocial>) => Promise<string>;
    executar: (chamada: ChamadaLocal) => Promise<{ saida: string; erro: boolean; terminal?: boolean }>;
    publicar: (texto: string) => void;
    somenteAcao?: boolean;
}): Promise<void> {
    if (opcoes.somenteAcao && !opcoes.ferramentas.length) {
        throw new Error('O turno de reação exige uma ferramenta disponível.');
    }
    const formato = formatoDecisaoSocial(opcoes.ferramentas, opcoes.somenteAcao);
    const instrucao = opcoes.somenteAcao ? instrucaoDecisaoReacao : instrucaoDecisaoSocial;
    opcoes.mensagens.push({ role: 'user', content: instrucao + '\nFerramentas autorizadas:\n'
        + JSON.stringify(opcoes.ferramentas.map((item) => item.function)) });
    const falhas = new Map<string, number>();
    const limiteRodadas = 12;
    for (let rodada = 0; rodada < limiteRodadas; rodada++) {
        const bruto = await opcoes.inferir(formato);
        let decisao: z.infer<typeof esquemaDecisao>;
        try { decisao = esquemaDecisao.parse(JSON.parse(bruto)); }
        catch { throw new Error('O agente não retornou uma decisão social válida. Nenhuma fala foi publicada.'); }
        if (opcoes.somenteAcao && decisao.tipo !== 'acao') {
            throw new Error('O turno de reação exige uma ação real. Nenhuma fala foi publicada.');
        }
        opcoes.mensagens.push({ role: 'assistant', content: JSON.stringify(decisao) });
        if (decisao.tipo === 'silencio') return;
        if (decisao.tipo === 'fala') {
            opcoes.publicar(decisao.texto);
            return;
        }
        if (!opcoes.ferramentas.some((item) => item.function.name === decisao.ferramenta)) {
            throw new Error('A decisão social escolheu uma ferramenta não autorizada.');
        }
        const resultado = await opcoes.executar({ id: `decisao_${rodada}`, type: 'function', function: {
            name: decisao.ferramenta, arguments: JSON.stringify(decisao.argumentos),
        } });
        opcoes.mensagens.push({ role: 'user', content: JSON.stringify({
            resultado_da_acao: decisao.ferramenta, erro: resultado.erro, retorno: resultado.saida,
        }) });
        if (!resultado.erro && decisao.ferramenta === 'fazer_pausa') return;
        if (!resultado.erro && (resultado.terminal || decisao.ferramenta === 'silencio')) return;
        if (!resultado.erro && opcoes.somenteAcao
            && !['ver_escritorio', 'consultar_acontecimento', 'consultar', 'revisar_trabalho', 'fazer_pausa',
                'reagir_ao_acontecimento'].includes(decisao.ferramenta)) return;
        if (!resultado.erro && opcoes.somenteAcao && decisao.ferramenta === 'reagir_ao_acontecimento') {
            opcoes.mensagens.push({ role: 'user', content: 'Sua interpretação foi salva. Se isso merece uma resposta '
                + 'ao colega, use interagir_socialmente com alcance publico e a fonte conhecida. '
                + 'Se preferir não comunicar, use nenhuma_acao. Não repita a interpretação.' });
        }
        const chave = JSON.stringify(decisao);
        const quantidade = resultado.erro ? (falhas.get(chave) ?? 0) + 1 : 0;
        falhas.set(chave, quantidade);
        if (quantidade >= 3) throw new Error('O agente repetiu a mesma ação inválida três vezes.');
    }
    throw new Error('O agente atingiu o limite de decisões sociais deste turno.');
}
