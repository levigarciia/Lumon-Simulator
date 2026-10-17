import { spawn } from 'node:child_process';
import {
    limiteResposta,
    detalharFerramenta,
    mensagemInterrupcao,
    prefixoFerramentasEscritorio,
    resumirFerramenta,
    type ConfiguracaoSessao,
    type OuvinteTurno,
    type SessaoAgente,
} from './tipos';

const ferramentasOcultas = new Set(['ToolSearch', 'TodoWrite', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);

let caminhoClaude: Promise<string> | null = null;

/** Localiza o Claude Code instalado, que guarda o login da assinatura. */
function localizarClaude(): Promise<string> {
    caminhoClaude ??= new Promise<string>((resolver, rejeitar) => {
        const busca = spawn(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { windowsHide: true });
        let saida = '';
        busca.stdout.on('data', (parte: Buffer) => (saida += parte.toString('utf8')));
        busca.on('error', rejeitar);
        busca.on('close', (codigo) => {
            const caminho = saida.split('\n').map((linha) => linha.trim()).find(Boolean);
            if (codigo === 0 && caminho) resolver(caminho);
            else rejeitar(new Error('O comando claude não foi encontrado. Instale e autentique o Claude Code.'));
        });
    }).catch((erro: unknown) => {
        caminhoClaude = null;
        throw erro;
    });
    return caminhoClaude;
}

/**
 * Sessão pelo Claude Agent SDK. O contexto continua entre turnos pelo identificador de sessão do próprio
 * Claude Code. Sem autonomia, cada pedido de permissão vira um cartão de aprovação no escritório.
 */
export function criarSessaoClaude(configuracao: ConfiguracaoSessao): SessaoAgente {
    let sessaoId: string | undefined;
    let ativo: AbortController | null = null;

    async function enviar(prompt: string, ouvinte: OuvinteTurno, sinal: AbortSignal): Promise<void> {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        const controle = new AbortController();
        ativo = controle;
        const abortar = () => controle.abort();
        sinal.addEventListener('abort', abortar, { once: true });
        let texto = '';
        try {
            const respostas = query({
                prompt,
                options: {
                    model: configuracao.modelo,
                    cwd: configuracao.pasta,
                    resume: sessaoId,
                    abortController: controle,
                    includePartialMessages: true,
                    pathToClaudeCodeExecutable: await localizarClaude(),
                    systemPrompt: configuracao.instrucoes,
                    tools: [],
                    permissionMode: 'default',
                    settingSources: [],
                    ...(configuracao.mcpUrl ? { mcpServers: {
                        lumon: { type: 'http' as const, url: configuracao.mcpUrl, alwaysLoad: true },
                    } } : {}),
                    canUseTool: async (nome, entrada) => nome.startsWith(prefixoFerramentasEscritorio)
                        ? { behavior: 'allow', updatedInput: entrada }
                        : { behavior: 'deny', message: 'Use somente as ferramentas da partida.' },
                },
            });
            for await (const mensagem of respostas) {
                sessaoId = mensagem.session_id ?? sessaoId;
                if (mensagem.type === 'stream_event') {
                    const evento = mensagem.event;
                    if (evento.type === 'message_start' && texto && !texto.endsWith('\n\n')) texto += '\n\n';
                    if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
                        texto += evento.delta.text;
                        if (texto.length > limiteResposta) throw new Error('A resposta excedeu o limite de tamanho.');
                        ouvinte.texto(texto);
                    }
                } else if (mensagem.type === 'assistant') {
                    for (const parte of mensagem.message.content) {
                        if (parte.type !== 'tool_use' || ferramentasOcultas.has(parte.name)) continue;
                        const entrada = (parte.input ?? {}) as Record<string, unknown>;
                        ouvinte.iniciarFerramenta(
                            parte.id, resumirFerramenta(parte.name, entrada), detalharFerramenta(entrada),
                        );
                    }
                } else if (mensagem.type === 'user' && Array.isArray(mensagem.message.content)) {
                    for (const parte of mensagem.message.content) {
                        if (typeof parte !== 'object' || parte.type !== 'tool_result') continue;
                        const saida = detalharFerramenta(parte.content);
                        ouvinte.concluirFerramenta(parte.tool_use_id, !!parte.is_error, saida);
                    }
                } else if (mensagem.type === 'result') {
                    if (mensagem.subtype !== 'success' || mensagem.is_error) {
                        const detalhe = 'errors' in mensagem ? mensagem.errors?.join('\n') : undefined;
                        throw new Error(detalhe || 'O Claude encerrou a resposta com erro.');
                    }
                    if (!texto.trim() && mensagem.result) ouvinte.texto(mensagem.result);
                }
            }
        } catch (erro) {
            if (sinal.aborted) throw new Error(mensagemInterrupcao);
            throw erro;
        } finally {
            sinal.removeEventListener('abort', abortar);
            if (ativo === controle) ativo = null;
        }
    }

    return { enviar, encerrar: () => ativo?.abort() };
}