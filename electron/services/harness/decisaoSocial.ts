import { z } from 'zod';
import { anunciaAcao, simulaChamadaFerramenta } from '../../../shared/geral';
import { nomeCanonicoFerramenta, ehConsultaFerramenta } from '../../../shared/ferramentas';
import type { MensagemLocal } from './contextoLocal';
import type { ChamadaLocal, RespostaLocal } from './respostaLocal';

export type FerramentaDecisao = {
    function: { name: string; description?: string; parameters: unknown };
};

export const instrucaoDecisaoSocial = 'Em cada turno, responda ao que foi dito ou use uma ferramenta disponível '
    + 'quando precisar consultar ou agir. Use as ferramentas pelo protocolo de chamadas, com argumentos que '
    + 'correspondam ao schema fornecido. Escreva falas em texto livre, sem formato JSON. '
    + 'Responda diretamente, sem repetir ou copiar as perguntas e falas anteriores. '
    + 'Não anuncie uma ação antes de executá-la. Depois de consultar, use o resultado recebido para decidir o próximo '
    + 'passo ou responder. Se não houver nada útil a fazer ou dizer, '
        + 'responda brevemente sem inventar ações ou resultados.';

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
    promessaRetida?: () => void;
    chamadaDescartada?: (nome: string) => void;
}): Promise<void> {
    if (opcoes.somenteAcao && !opcoes.ferramentas.length) {
        throw new Error('O turno de reação exige uma ferramenta disponível.');
    }
    anexarAoPedido(opcoes.mensagens, opcoes.somenteAcao ? instrucaoDecisaoReacao : instrucaoDecisaoTurno);
    const falhas = new Map<string, number>();
    let anunciosSemExecucao = 0;
    let textoPublicado = '';
    const publicar = (texto: string) => {
        textoPublicado = [textoPublicado, texto.trim()].filter(Boolean).join('\n\n');
        opcoes.publicar(textoPublicado);
    };
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
            if (anunciaAcao(resposta.texto) || simulaChamadaFerramenta(resposta.texto)) {
                opcoes.promessaRetida?.();
                anunciosSemExecucao++;
                if (anunciosSemExecucao >= 3) {
                    throw new Error('O agente anunciou uma ação sem executar a ferramenta. Nenhuma '
                        + 'fala foi publicada.');
                }
                opcoes.mensagens.push({ role: 'user', content: 'A fala anunciou uma ação e não foi publicada. '
                    + 'Execute a ferramenta correspondente pelo protocolo, sem escrever seu nome e JSON no texto, '
                    + 'ou conclua sem prometer uma ação. '
                    + 'Use nenhuma_acao para passar a vez.' });
                continue;
            }
            opcoes.mensagens.push({ role: 'assistant', content: resposta.texto.trim() });
            publicar(resposta.texto);
            return;
        }

        const argumentosPorChamada = new Map<ChamadaLocal, Record<string, unknown>>();
        for (const chamada of resposta.chamadas) {
            if (!opcoes.ferramentas.some((item) => item.function.name
                === nomeCanonicoFerramenta(chamada.function.name))) {
                throw new Error('A decisão social escolheu uma ferramenta não autorizada.');
            }
            const argumentos = z.record(z.string(), z.unknown()).parse(JSON.parse(chamada.function.arguments || '{}'));
            chamada.function.arguments = JSON.stringify(argumentos);
            argumentosPorChamada.set(chamada, argumentos);
        }
        opcoes.mensagens.push({ role: 'assistant', content: resposta.texto || null, tool_calls: resposta.chamadas });

        let encerrouVez = false;
        let houveErro = false;
        let agiu = false;
        let passouVez = false;
        for (const chamada of resposta.chamadas) {
            const nome = chamada.function.name;
            if (encerrouVez) {
                opcoes.chamadaDescartada?.(nomeCanonicoFerramenta(nome));
                opcoes.mensagens.push({ role: 'tool', tool_call_id: chamada.id,
                    content: 'Chamada não executada: a ação anterior já encerrou sua vez.' });
                continue;
            }
            const resultado = await opcoes.executar(chamada);
            houveErro ||= resultado.erro;
            passouVez ||= !resultado.erro && nomeCanonicoFerramenta(nome) === 'nenhuma_acao';
            agiu ||= !resultado.erro && !ehConsultaFerramenta(nome);
            opcoes.mensagens.push({ role: 'tool', tool_call_id: chamada.id,
                content: `${resultado.erro ? 'Erro' : 'Resultado'} da ferramenta ${nome}:\n${resultado.saida}` });
            if (!resultado.erro && (nome === 'fazer_pausa' || resultado.terminal
                || nome === 'silencio' || nome === 'nenhuma_acao')) {
                encerrouVez = true;
                continue;
            }
            if (!resultado.erro && opcoes.somenteAcao
                && !ehConsultaFerramenta(nome)) {
                encerrouVez = true;
                continue;
            }
            const chave = JSON.stringify({ nome, argumentos: argumentosPorChamada.get(chamada) });
            const quantidade = resultado.erro ? (falhas.get(chave) ?? 0) + 1 : 0;
            falhas.set(chave, quantidade);
            if (quantidade >= 3) throw new Error('O agente repetiu a mesma ação inválida três vezes.');
        }
        if (!opcoes.somenteAcao && !passouVez && !houveErro && resposta.texto.trim()
            && !simulaChamadaFerramenta(resposta.texto)) {
            publicar(resposta.texto);
            if (agiu) return;
        }
        if (encerrouVez) return;
    }
    throw new Error('O agente atingiu o limite de decisões sociais deste turno.');
}
