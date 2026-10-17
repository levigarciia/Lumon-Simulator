import { z } from 'zod';
import type { MensagemLocal } from './contextoLocal';
import type { ChamadaLocal, RespostaLocal } from './respostaLocal';

export type FerramentaDecisao = {
    function: { name: string; description?: string; parameters: unknown };
};

export const instrucaoDecisaoSocial = 'Em cada turno, responda ao que foi dito ou use uma ferramenta disponível '
    + 'quando precisar consultar ou agir. Use as ferramentas pelo protocolo de chamadas, com argumentos que '
    + 'correspondam ao schema fornecido. Responda diretamente, sem repetir ou copiar as perguntas e falas anteriores. '
    + 'Não anuncie uma ação antes de executá-la. Depois de consultar, use o resultado recebido para decidir o próximo '
    + 'passo ou responder. Se não houver nada útil a fazer ou dizer, responda brevemente sem inventar ações ou resultados.';

const instrucaoDecisaoTurno = 'As falas transcritas acima pertencem a outras pessoas. Responda com suas próprias '
    + 'palavras, sem reproduzir frases delas nem as suas anteriores, ou aja por uma ferramenta quando um ato, '
    + 'como cobrar, elogiar, contestar, propor uma demissão ou fazer uma pausa, disser mais do que uma fala. '
    + 'Ameaçar ou prometer uma ação em texto não a executa.';

function anexarAoPedido(mensagens: MensagemLocal[], instrucao: string): void {
    const ultima = mensagens.at(-1);
    if (ultima?.role === 'user' && typeof ultima.content === 'string') {
        ultima.content = `${ultima.content}\n\n${instrucao}`;
        return;
    }
    mensagens.push({ role: 'user', content: instrucao });
}

const instrucaoDecisaoReacao ='Neste turno, use uma ferramenta disponível para registrar uma reação real. '
    + 'Não responda com texto: selecione uma chamada de ferramenta com argumentos válidos.';

/** Executa chamadas nativas do modelo sem converter as definições das ferramentas em gramática JSON. */
export async function executarDecisoesSociais(opcoes: {
    mensagens: MensagemLocal[];
    ferramentas: readonly FerramentaDecisao[];
    inferir: (somenteAcao: boolean) => Promise<RespostaLocal>;
    executar: (chamada: ChamadaLocal) => Promise<{ saida: string; erro: boolean; terminal?: boolean }>;
    publicar: (texto: string) => void;
    somenteAcao?: boolean;
}): Promise<void> {
    if (opcoes.somenteAcao && !opcoes.ferramentas.length) {
        throw new Error('O turno de reação exige uma ferramenta disponível.');
    }
    anexarAoPedido(opcoes.mensagens, opcoes.somenteAcao ? instrucaoDecisaoReacao : instrucaoDecisaoTurno);
    const falhas = new Map<string, number>();
    const limiteRodadas = 12;
    for (let rodada = 0; rodada < limiteRodadas; rodada++) {
        const resposta = await opcoes.inferir(!!opcoes.somenteAcao);
        if (!resposta.chamadas.length) {
            if (opcoes.somenteAcao) {
                throw new Error('O turno de reação exige uma ação real. Nenhuma fala foi publicada.');
            }
            if (!resposta.texto.trim()) {
                throw new Error('O agente não retornou texto nem chamada de ferramenta.');
            }
            opcoes.mensagens.push({ role: 'assistant', content: resposta.texto.trim() });
            opcoes.publicar(resposta.texto.trim());
            return;
        }

        const argumentosPorChamada = new Map<ChamadaLocal, Record<string, unknown>>();
        for (const chamada of resposta.chamadas) {
            if (!opcoes.ferramentas.some((item) => item.function.name === chamada.function.name)) {
                throw new Error('A decisão social escolheu uma ferramenta não autorizada.');
            }
            const argumentos = z.record(z.string(), z.unknown()).parse(JSON.parse(chamada.function.arguments || '{}'));
            chamada.function.arguments = JSON.stringify(argumentos);
            argumentosPorChamada.set(chamada, argumentos);
        }
        opcoes.mensagens.push({ role: 'assistant', content: resposta.texto || null, tool_calls: resposta.chamadas });

        for (const chamada of resposta.chamadas) {
            const nome = chamada.function.name;
            const resultado = await opcoes.executar(chamada);
            opcoes.mensagens.push({ role: 'tool', tool_call_id: chamada.id,
                content: `${resultado.erro ? 'Erro' : 'Resultado'} da ferramenta ${nome}:\n${resultado.saida}` });
            if (!resultado.erro && (nome === 'fazer_pausa' || resultado.terminal || nome === 'silencio')) return;
            if (!resultado.erro && opcoes.somenteAcao
                && !['ver_escritorio', 'consultar_acontecimento', 'consultar', 'revisar_trabalho',
                    'reagir_ao_acontecimento'].includes(nome)) return;
            if (!resultado.erro && opcoes.somenteAcao && nome === 'reagir_ao_acontecimento') {
                const podeOmitir = opcoes.ferramentas.some((item) => item.function.name === 'nenhuma_acao');
                opcoes.mensagens.push({ role: 'user', content: 'Sua interpretação foi salva. Se isso merece uma resposta '
                    + 'ao colega, use interagir_socialmente com alcance publico e a fonte conhecida. '
                    + (podeOmitir ? 'Se preferir não comunicar, use nenhuma_acao. '
                        : 'Se preferir não comunicar em público, use atualizar_pensamento. ')
                    + 'Não repita a interpretação.' });
            }
            const chave = JSON.stringify({ nome, argumentos: argumentosPorChamada.get(chamada) });
            const quantidade = resultado.erro ? (falhas.get(chave) ?? 0) + 1 : 0;
            falhas.set(chave, quantidade);
            if (quantidade >= 3) throw new Error('O agente repetiu a mesma ação inválida três vezes.');
        }
    }
    throw new Error('O agente atingiu o limite de decisões sociais deste turno.');
}
