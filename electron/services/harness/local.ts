import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { anunciaAcao, anunciaPausa } from '../../../shared/geral';
import { obterMotorLocal, type MotorLocal } from '../motor';
import { lerRespostaLocal, type ChamadaLocal } from './respostaLocal';
import { executarDecisoesSociais, instrucaoDecisaoSocial } from './decisaoSocial';
import { contextoMinimoLocal, estimarContextoLocal, prepararContextoLocal, reservarSaidaLocal,
    type MensagemLocal } from './contextoLocal';
import { detalharFerramenta, mensagemInterrupcao, type ConfiguracaoSessao, type OpcoesTurno,
    type OuvinteTurno, type SessaoAgente } from './tipos';

type FerramentaLocal = { type: string; function: { name: string; description?: string; parameters: unknown } };
type MotorSessao = Pick<MotorLocal, 'usar'>;

const esquemaEntrada = z.record(z.string(), z.unknown());

/** Ferramentas cujo retorno o agente precisa ler antes de responder; as demais encerram uma resposta já escrita. */
const ferramentasDeConsulta = new Set([
    'ver_escritorio', 'consultar_acontecimento', 'consultar', 'revisar_trabalho',
]);

function juntarTextos(anterior: string, novo: string): string {
    return anterior.trim() && novo.trim() ? `${anterior}\n\n${novo}` : anterior + novo;
}

/** Abre uma sessão com histórico próprio e usa o motor compartilhado somente durante cada inferência. */
export function criarSessaoLocal(
    configuracao: ConfiguracaoSessao, motor: MotorSessao = obterMotorLocal(),
): SessaoAgente {
    const conversa = configuracao.modo !== 'trabalho' && configuracao.atividade !== 'refinamento';
    const encerramento = new AbortController();
    const mensagens: MensagemLocal[] = [{ role: 'system', content: configuracao.instrucoes
        + (configuracao.atividade === 'social' ? `\n${instrucaoDecisaoSocial}` : '')
        + '\nUse as ferramentas disponíveis pelo protocolo de chamadas. Não simule chamadas ou resultados em texto.' }];
    if (configuracao.historico) mensagens.push({ role: 'assistant',
        content: `Histórico salvo desta thread, apenas para contexto:\n${configuracao.historico}` });
    let cliente: Client | undefined;
    const nomesMcp = new Set<string>();
    let ferramentas: FerramentaLocal[] | undefined;
    let enviando = false;

    async function conectar(sinal: AbortSignal): Promise<FerramentaLocal[]> {
        if (ferramentas) return ferramentas;
        const lista: FerramentaLocal[] = [];
        if (configuracao.mcpUrl) {
            const conexao = new Client({ name: 'lumon-local', version: '0.1.0' });
            cliente = conexao;
            await conexao.connect(new StreamableHTTPClientTransport(new URL(configuracao.mcpUrl)), { signal: sinal });
            let cursor: string | undefined;
            do {
                const pagina = await conexao.listTools({ cursor }, { signal: sinal });
                for (const item of pagina.tools) {
                    nomesMcp.add(item.name);
                    lista.push({ type: 'function', function: { name: item.name,
                        description: item.description, parameters: item.inputSchema } });
                }
                cursor = pagina.nextCursor;
            } while (cursor);
        }
        ferramentas = lista;
        return lista;
    }

    async function chamar(chamada: ChamadaLocal, lista: FerramentaLocal[], ouvinte: OuvinteTurno,
        sinal: AbortSignal): Promise<{ saida: string; erro: boolean; terminal?: boolean; codigo?: string }> {
        const { name: nome, arguments: argumentos } = chamada.function;
        const resumo = nomesMcp.has(nome) ? `Escritório: ${nome}` : nome;
        ouvinte.iniciarFerramenta(chamada.id, resumo, argumentos);
        try {
            if (!lista.some((item) => item.function.name === nome)) throw new Error('Ferramenta não autorizada.');
            const entrada = esquemaEntrada.parse(JSON.parse(argumentos || '{}'));
            let saida: string;
            let erro = false;
            let terminal = false;
            let codigo: string | undefined;
            if (nomesMcp.has(nome) && cliente) {
                const resultado = await cliente.callTool({ name: nome,
                    arguments: entrada }, undefined, { signal: sinal, timeout: 3600000 });
                saida = detalharFerramenta(resultado) ?? '';
                erro = resultado.isError === true;
                const estado = z.object({ terminal: z.boolean().optional(), codigo: z.string().optional() })
                    .safeParse(resultado.structuredContent);
                terminal = estado.success && estado.data.terminal === true;
                codigo = estado.success ? estado.data.codigo : undefined;
            } else {
                throw new Error('Ferramenta externa indisponível para personagens.');
            }
            ouvinte.concluirFerramenta(chamada.id, erro, saida);
            return { saida, erro, terminal, codigo };
        } catch (erro) {
            const mensagem = erro instanceof Error ? erro.message : String(erro);
            ouvinte.concluirFerramenta(chamada.id, true, mensagem);
            sinal.throwIfAborted();
            return { saida: `Erro: ${mensagem}`, erro: true };
        }
    }

    async function enviar(
        prompt: string, ouvinte: OuvinteTurno, sinal: AbortSignal, opcoes: OpcoesTurno = {},
    ): Promise<void> {
        if (enviando) throw new Error('Esta sessão local já está executando um turno.');
        const combinado = AbortSignal.any([sinal, encerramento.signal]);
        combinado.throwIfAborted();
        enviando = true;
        const historicoAnterior = mensagens.slice();
        mensagens.push({ role: 'user', content: prompt });
        let textoPublicado = '';
        const falhasRepetidas = new Map<string, number>();
        try {
            const permitidas = opcoes.ferramentas;
            const prioridade = (nome: string) => permitidas?.indexOf(nome) ?? 0;
            const lista = (await conectar(combinado))
                .filter((item) => !permitidas || permitidas.includes(item.function.name))
                .sort((a, b) => prioridade(a.function.name) - prioridade(b.function.name));
            if (configuracao.atividade === 'social') {
                await executarDecisoesSociais({
                    somenteAcao: opcoes.exigirFerramenta,
                    mensagens, ferramentas: lista, publicar: (texto) => ouvinte.texto(texto),
                    executar: (chamada) => chamar(chamada, lista, ouvinte, combinado),
                    inferir: (somenteAcao) => motor.usar(configuracao.modelo, combinado, async (ativo) => {
                        combinado.throwIfAborted();
                        ouvinte.etapa?.('processando');
                        const contexto = ativo.estado.contexto ?? 4096;
                        await prepararContextoLocal(mensagens, lista, contexto,
                            (corpo, sinalResumo) => ativo.completar(corpo, sinalResumo), combinado);
                        const disponivel = contexto - estimarContextoLocal(mensagens, lista) - 256;
                        const limites = opcoes.exigirFerramenta ? [1024, 2048] : [2048];
                        for (const limite of limites) {
                            const resposta = await lerRespostaLocal(await ativo.completar({
                                messages: mensagens, stream: true, cache_prompt: true, temperature: 0.3,
                                max_tokens: Math.min(limite, disponivel),
                                chat_template_kwargs: { enable_thinking: false },
                                ...(lista.length ? { tools: lista, tool_choice: somenteAcao ? 'required' : 'auto' } : {}),
                            }, combinado), combinado, () => {});
                            if (resposta.motivo !== 'length') return resposta;
                        }
                        throw new Error('A decisão social foi truncada após o limite de tentativas.');
                    }, contextoMinimoLocal(mensagens, lista)),
                });
                return;
            }
            let acaoConcluida = false;
            let resumindo = false;
            let respostasSemAcao = 0;
            let agiu = false;
            let aguardandoAcao = false;
            let pausaPendente = false;
            for (let rodada = 0; rodada < 48; rodada++) {
                const reacao = !!opcoes.exigirFerramenta;
                const disponiveis = resumindo ? [] : pausaPendente
                    ? lista.filter((item) => item.function.name === 'fazer_pausa') : lista;
                const acaoObrigatoria = !resumindo && !!opcoes.exigirFerramentaAteConclusao;
                const escolha = aguardandoAcao || acaoObrigatoria
                    || opcoes.exigirFerramenta && !acaoConcluida && rodada < 3
                    ? 'required' : 'auto';
                if (acaoObrigatoria && !disponiveis.length) {
                    throw new Error('O turno exige ações reais, mas nenhuma ferramenta está disponível.');
                }
                combinado.throwIfAborted();
                ouvinte.etapa?.('aguardando_motor');
                const resposta = await motor.usar(configuracao.modelo, combinado, async (ativo) => {
                    ouvinte.etapa?.('processando');
                    const contexto = ativo.estado.contexto ?? 4096;
                    await prepararContextoLocal(mensagens, disponiveis, contexto,
                        (corpo, sinalResumo) => ativo.completar(corpo, sinalResumo), combinado);
                    const disponivel = contexto - estimarContextoLocal(mensagens, disponiveis) - 256;
                    for (let tentativa = 0; tentativa < 2; tentativa++) {
                        combinado.throwIfAborted();
                        const respostaHttp = await ativo.completar({
                            messages: mensagens, stream: true, cache_prompt: true,
                            temperature: conversa ? 0.7 : 0.2,
                            top_p: 0.8, top_k: 20, min_p: 0,
                            max_tokens: resumindo || acaoObrigatoria || reacao ? Math.min(512, disponivel)
                                : tentativa ? disponivel : Math.min(reservarSaidaLocal(contexto), disponivel),
                            chat_template_kwargs: { enable_thinking: false },
                            ...(disponiveis.length ? { tools: disponiveis, tool_choice: escolha } : {}),
                        }, combinado);
                        const resultado = await lerRespostaLocal(respostaHttp, combinado,
                            (texto) => { if (!acaoObrigatoria) ouvinte.texto(juntarTextos(textoPublicado, texto)); });
                        if (reacao && resultado.motivo === 'length') {
                            throw new Error('O modelo excedeu o limite da reação. '
                                + 'A resposta foi interrompida para liberar a conversa.');
                        }
                        if (resultado.motivo !== 'length' || resumindo || acaoObrigatoria) return resultado;
                        ouvinte.texto(textoPublicado);
                    }
                    throw new Error('O modelo atingiu o limite de saída mesmo após a tentativa automática. '
                        + 'Solicite uma resposta menor.');
                }, contextoMinimoLocal(mensagens, disponiveis));
                if ((acaoObrigatoria || reacao && !acaoConcluida) && !resposta.chamadas.length) {
                    respostasSemAcao++;
                    if (respostasSemAcao >= 3) {
                        throw new Error('O agente não executou uma chamada real após três solicitações. '
                            + 'Nenhum resultado narrado foi considerado uma tentativa.');
                    }
                    mensagens.push({ role: 'user', content: acaoObrigatoria
                        ? 'A etapa ainda está ativa. Faça uma chamada real de ferramenta agora. '
                            + 'Relatos em texto não enviam grupos nem comprovam resultados.'
                        : 'A reação ainda não foi registrada. Faça uma chamada real de ferramenta agora.' });
                    continue;
                }
                respostasSemAcao = 0;
                mensagens.push({ role: 'assistant', content: acaoObrigatoria ? null : resposta.texto || null,
                    ...(resposta.chamadas.length ? { tool_calls: resposta.chamadas } : {}) });
                const textoAnterior = textoPublicado;
                if (!acaoObrigatoria) textoPublicado = juntarTextos(textoPublicado, resposta.texto);
                if (!resposta.chamadas.length) {
                    if (aguardandoAcao) {
                        throw new Error('O funcionário anunciou uma ação, mas não executou a ferramenta. '
                            + 'A fala foi descartada para não registrar uma ação que não aconteceu.');
                    }
                    if (!conversa || reacao || agiu || !anunciaAcao(resposta.texto)) return;
                    pausaPendente = anunciaPausa(resposta.texto);
                    if (pausaPendente && !lista.some((item) => item.function.name === 'fazer_pausa')) {
                        throw new Error('A pausa anunciada não está disponível neste turno. A fala foi descartada.');
                    }
                    aguardandoAcao = true;
                    textoPublicado = textoAnterior;
                    ouvinte.texto(textoPublicado);
                    mensagens.push({ role: 'user', content: 'Você anunciou uma ação. Execute agora a ferramenta '
                        + 'correspondente, sem repetir a fala. Se não houver ferramenta para isso, encerre sem texto.' });
                    continue;
                }
                let publicouNoGeral = false;
                let silenciou = false;
                let encerrouParticipacao = false;
                let agiuNaRodada = false;
                for (const chamada of resposta.chamadas) {
                    if (encerrouParticipacao) {
                        mensagens.push({ role: 'tool', tool_call_id: chamada.id,
                            content: 'Chamada não executada: a ação anterior já encerrou sua participação neste turno.' });
                        continue;
                    }
                    const { saida, erro, terminal, codigo } = await chamar(chamada, disponiveis, ouvinte, combinado);
                    mensagens.push({ role: 'tool', tool_call_id: chamada.id, content: saida });
                    if (!erro && opcoes.encerrarFerramentasQuando?.(chamada.function.name, saida,
                        { terminal, codigo })) resumindo = true;
                    if (!erro) acaoConcluida = true;
                    if (!erro && !ferramentasDeConsulta.has(chamada.function.name)) agiuNaRodada = true;
                    if (!erro && chamada.function.name === 'silencio') silenciou = true;
                    if (!erro && terminal && codigo === 'interacao_aplicada') encerrouParticipacao = true;
                    if (!erro && chamada.function.name === 'fazer_pausa' && conversa) {
                        encerrouParticipacao = true;
                        textoPublicado = '';
                        ouvinte.texto('');
                    }
                    if (!erro && terminal && codigo === 'fala_publicada') {
                        publicouNoGeral = true;
                    }
                    const chave = `${chamada.function.name}:${chamada.function.arguments}`;
                    const falhas = erro ? (falhasRepetidas.get(chave) ?? 0) + 1 : 0;
                    falhasRepetidas.set(chave, falhas);
                    if (falhas >= 3) {
                        throw new Error('O agente repetiu a mesma ferramenta com os mesmos argumentos inválidos '
                            + 'três vezes. O turno foi interrompido. Último erro: ' + saida);
                    }
                }
                if (agiuNaRodada) agiu = true;
                if (aguardandoAcao && !agiuNaRodada) {
                    throw new Error('A ação anunciada não foi executada. A fala foi descartada.');
                }
                aguardandoAcao = false;
                pausaPendente = false;
                if (resumindo) mensagens.push({ role: 'user', content:
                    'A etapa terminou. Resuma agora os resultados e as pendências, sem novas ações.' });
                if (conversa && (publicouNoGeral || silenciou || encerrouParticipacao)) return;
                if (conversa && !agiuNaRodada) {
                    textoPublicado = textoAnterior;
                    ouvinte.texto(textoPublicado);
                    continue;
                }
                const respondeuAntes = conversa && resposta.texto.trim()
                    && resposta.chamadas.every((chamada) => !ferramentasDeConsulta.has(chamada.function.name)
                        && chamada.function.name !== 'fazer_pausa');
                if (respondeuAntes) return;
            }
            throw new Error('O agente atingiu o limite de ferramentas deste turno.');
        } catch (erro) {
            if (conversa) ouvinte.texto('');
            mensagens.splice(0, mensagens.length, ...historicoAnterior);
            throw erro;
        } finally {
            enviando = false;
        }
    }

    return {
        enviar,
        encerrar: () => {
            encerramento.abort(new Error(mensagemInterrupcao));
            void cliente?.close().catch(() => {});
        },
    };
}
