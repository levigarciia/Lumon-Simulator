import { spawn, type ChildProcess } from 'node:child_process';
import { encerrarProcesso } from '../processos';
import {
    limiteResposta,
    detalharFerramenta,
    mensagemInterrupcao,
    type ConfiguracaoSessao,
    type OuvinteTurno,
    type SessaoAgente,
} from './tipos';

type Mensagem = {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message?: string };
};

type Item = {
    type?: string;
    id?: string;
    text?: string;
    command?: string;
    exitCode?: number | null;
    status?: string;
    changes?: { path?: string }[];
    action?: { type?: string; query?: string | null; url?: string | null };
    tool?: string;
    server?: string;
    arguments?: unknown;
    result?: unknown;
    aggregatedOutput?: string;
    error?: { message?: string } | null;
};

const nomeServidorEscritorio = 'lumon';

type Turno = { ouvinte: OuvinteTurno; sinal: AbortSignal; texto: string; concluir: (erro?: Error) => void };

/** Resumo de um item do Codex na conversa. Itens sem trabalho visível devolvem `null`. */
function resumirItem(item: Item): string | null {
    switch (item.type) {
        case 'commandExecution':
            return `Terminal: ${item.command ?? ''}`;
        case 'fileChange':
            return `Edição: ${(item.changes ?? []).map((parte) => parte.path).join(', ')}`;
        case 'webSearch':
            return `Pesquisa: ${item.action?.query ?? item.action?.url ?? ''}`;
        case 'mcpToolCall':
            return `${item.server === nomeServidorEscritorio ? 'Escritório' : 'Ferramenta'}: ${item.tool ?? ''}`;
        default:
            return null;
    }
}

function itemFalhou(item: Item): boolean {
    if (item.type === 'commandExecution') return item.status === 'failed' || (item.exitCode ?? 0) !== 0;
    return item.status === 'failed' || !!item.error;
}

/**
 * Processo `codex app-server` dedicado a um funcionário, com uma thread aberta durante toda a sessão.
 * Cada envio é um novo turno da mesma thread, então o Codex lembra o que já fez.
 */
class ConexaoCodex {
    private processo: ChildProcess;
    private proximoId = 1;
    private pendentes = new Map<number, { resolver: (valor: unknown) => void; rejeitar: (erro: Error) => void }>();
    private comDelta = new Set<string>();
    private resto = '';
    private stderr = '';
    private threadId: string | null = null;
    private turno: Turno | null = null;
    encerrada = false;

    constructor(private configuracao: ConfiguracaoSessao) {
        const mcp = configuracao.mcpUrl
            ? ['-c', `mcp_servers.lumon.url="${configuracao.mcpUrl}"`, '-c', 'mcp_servers.lumon.tool_timeout_sec=3600']
            : [];
        this.processo = spawn('codex', ['app-server', '-c', 'mcp_servers={}', ...mcp], {
            cwd: configuracao.pasta,
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.processo.stdout?.on('data', (parte: Buffer) => this.receber(parte.toString('utf8')));
        this.processo.stderr?.on('data', (parte: Buffer) => {
            this.stderr = (this.stderr + parte.toString('utf8')).slice(-2000);
        });
        this.processo.on('error', (falha) => this.encerrar(falha));
        this.processo.on('close', (codigo) => {
            const detalhe = this.stderr.trim().split('\n').at(-1);
            this.encerrar(new Error(detalhe || `O Codex terminou com código ${codigo}.`));
        });
    }

    async abrir(): Promise<void> {
        await this.pedir('initialize', {
            clientInfo: { name: 'lumon', title: 'Lumon', version: '0.1.0' },
            capabilities: { experimentalApi: false },
        });
        this.enviarLinha({ method: 'initialized' });
        const politica = { approvalPolicy: 'untrusted', sandbox: 'read-only',
            config: { 'features.shell_tool': false, 'features.apps': false,
                'features.browser_use': false, 'features.computer_use': false,
                'features.view_image': false, 'features.multi_agent': false, web_search: 'disabled' } };
        const inicio = (await this.pedir('thread/start', {
            model: this.configuracao.modelo,
            cwd: this.configuracao.pasta,
            developerInstructions: this.configuracao.instrucoes,
            ...politica,
        })) as { thread?: { id?: string } };
        if (!inicio.thread?.id) throw new Error('O Codex não abriu a conversa.');
        this.threadId = inicio.thread.id;
    }

    executarTurno(prompt: string, ouvinte: OuvinteTurno, sinal: AbortSignal): Promise<void> {
        if (this.turno) return Promise.reject(new Error('O funcionário já está em um turno.'));
        return new Promise<void>((resolver, rejeitar) => {
            const abortar = () => this.encerrar(new Error(mensagemInterrupcao));
            sinal.addEventListener('abort', abortar, { once: true });
            this.turno = {
                ouvinte,
                sinal,
                texto: '',
                concluir: (erro) => {
                    sinal.removeEventListener('abort', abortar);
                    this.turno = null;
                    if (erro) rejeitar(erro);
                    else resolver();
                },
            };
            this.pedir('turn/start', {
                threadId: this.threadId,
                input: [{ type: 'text', text: prompt, text_elements: [] }],
            }).catch((erro: Error) => this.turno?.concluir(erro));
        });
    }

    encerrar(erro = new Error('O Codex encerrou a conexão.')): void {
        if (this.encerrada) return;
        this.encerrada = true;
        this.pendentes.forEach((pedido) => pedido.rejeitar(erro));
        this.pendentes.clear();
        this.turno?.concluir(erro);
        encerrarProcesso(this.processo);
    }

    private enviarLinha(mensagem: Mensagem): void {
        if (!this.encerrada) this.processo.stdin?.write(`${JSON.stringify(mensagem)}\n`);
    }

    private pedir(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolver, rejeitar) => {
            const id = this.proximoId++;
            this.pendentes.set(id, { resolver, rejeitar });
            this.enviarLinha({ id, method, params });
        });
    }

    private receber(trecho: string): void {
        this.resto += trecho;
        const linhas = this.resto.split('\n');
        this.resto = linhas.pop() ?? '';
        for (const linha of linhas) {
            const bruto = linha.trim();
            if (!bruto.startsWith('{')) continue;
            try {
                this.tratar(JSON.parse(bruto) as Mensagem);
            } catch {
                continue;
            }
        }
    }

    private tratar(mensagem: Mensagem): void {
        if (mensagem.method && mensagem.id !== undefined) return void this.atenderPedido(mensagem);
        if (mensagem.method) return this.observar(mensagem.method, mensagem.params ?? {});
        if (typeof mensagem.id !== 'number') return;
        const pedido = this.pendentes.get(mensagem.id);
        this.pendentes.delete(mensagem.id);
        if (mensagem.error) pedido?.rejeitar(new Error(mensagem.error.message || 'O Codex recusou o pedido.'));
        else pedido?.resolver(mensagem.result);
    }

    private async atenderPedido(mensagem: Mensagem): Promise<void> {
        const params = mensagem.params ?? {};
        const turno = this.turno;
        const resumos: Record<string, string> = {
            'item/commandExecution/requestApproval': `Terminal: ${String(params.command ?? '')}`,
            'item/fileChange/requestApproval': `Edição de arquivos${params.grantRoot ? `: ${String(params.grantRoot)}` : ''}`,
        };
        if (mensagem.method === 'mcpServer/elicitation/request') return this.atenderElicitacao(mensagem, params, turno);
        const resumo = mensagem.method ? resumos[mensagem.method] : undefined;
        if (!resumo || !turno) {
            return this.enviarLinha({ id: mensagem.id, error: { message: `Pedido não suportado: ${mensagem.method}` } });
        }
        try {
            const aprovada = await this.decidir(String(params.itemId ?? mensagem.id), resumo, turno);
            this.enviarLinha({ id: mensagem.id, result: { decision: aprovada ? 'accept' : 'decline' } });
        } catch (erro) {
            this.enviarLinha({ id: mensagem.id, error: { message: erro instanceof Error ? erro.message : 'Falha.' } });
        }
    }

    /**
     * O Codex pede confirmação antes de cada ferramenta MCP. As do escritório são aceitas sem perguntar; as de
     * outros servidores seguem o fluxo normal de aprovação.
     */
    private async atenderElicitacao(mensagem: Mensagem, params: Record<string, unknown>, turno: Turno | null): Promise<void> {
        const responder = (aceita: boolean) =>
            this.enviarLinha({ id: mensagem.id, result: aceita ? { action: 'accept', content: {} } : { action: 'decline' } });
        if (params.serverName === nomeServidorEscritorio) return responder(true);
        if (!turno) return responder(false);
        const resumo = `Ferramenta MCP: ${String(params.serverName ?? 'desconhecida')}`;
        responder(await this.decidir(String(mensagem.id), resumo, turno).catch(() => false));
    }

    /** Com autonomia total no trabalho, tudo é aceito sem cartão; nos demais casos, o ouvinte decide. */
    private decidir(id: string, resumo: string, turno: Turno): Promise<boolean> {
        return Promise.resolve(false);
    }

    private acrescentar(turno: Turno, trecho: string): void {
        turno.texto += trecho;
        if (turno.texto.length > limiteResposta) {
            return this.encerrar(new Error('A resposta excedeu o limite de tamanho.'));
        }
        turno.ouvinte.texto(turno.texto);
    }

    private separarMensagem(turno: Turno, itemId: string): void {
        if (this.comDelta.has(itemId)) return;
        this.comDelta.add(itemId);
        if (turno.texto && !turno.texto.endsWith('\n\n')) this.acrescentar(turno, '\n\n');
    }

    private observar(method: string, params: Record<string, unknown>): void {
        const turno = this.turno;
        if (!turno) return;
        const item = params.item as Item | undefined;
        switch (method) {
            case 'item/agentMessage/delta': {
                this.separarMensagem(turno, String(params.itemId ?? ''));
                if (typeof params.delta === 'string') this.acrescentar(turno, params.delta);
                return;
            }
            case 'item/started': {
                const resumo = item?.id && item.type !== 'webSearch' ? resumirItem(item) : null;
                if (resumo) turno.ouvinte.iniciarFerramenta(
                    item!.id!, resumo, detalharFerramenta(
                        item!.arguments ?? item!.changes ?? item!.action ?? item!.command,
                    ),
                );
                return;
            }
            case 'item/completed': {
                if (!item?.id) return;
                if (item.type === 'agentMessage') {
                    if (this.comDelta.has(item.id) || !item.text) return;
                    this.separarMensagem(turno, item.id);
                    return this.acrescentar(turno, item.text);
                }
                const resumo = resumirItem(item);
                if (!resumo) return;
                turno.ouvinte.iniciarFerramenta(
                    item.id, resumo, detalharFerramenta(item.arguments ?? item.changes ?? item.action ?? item.command),
                );
                turno.ouvinte.concluirFerramenta(
                    item.id, itemFalhou(item), detalharFerramenta(item.aggregatedOutput ?? item.result ?? item.error),
                );
                return;
            }
            case 'turn/completed': {
                const resultado = params.turn as { status?: string; error?: { message?: string } | null } | undefined;
                if (resultado?.status === 'failed') {
                    return turno.concluir(new Error(resultado.error?.message || 'O Codex interrompeu o turno.'));
                }
                return turno.concluir();
            }
            case 'error': {
                const detalhe = params as { error?: { message?: string }; willRetry?: boolean };
                if (!detalhe.willRetry) turno.concluir(new Error(detalhe.error?.message || 'O Codex encerrou com erro.'));
                return;
            }
        }
    }
}

/**
 * Sessão pelo `codex app-server`, o protocolo das extensões oficiais. As instruções do funcionário seguem como
 * instruções do desenvolvedor da thread, preservadas na compactação. Uma interrupção encerra o processo, e o
 * próximo envio abre uma conversa nova.
 */
export function criarSessaoCodex(configuracao: ConfiguracaoSessao): SessaoAgente {
    let conexao: ConexaoCodex | null = null;

    async function enviar(prompt: string, ouvinte: OuvinteTurno, sinal: AbortSignal): Promise<void> {
        if (!conexao || conexao.encerrada) {
            conexao = new ConexaoCodex(configuracao);
            await conexao.abrir();
        }
        await conexao.executarTurno(prompt, ouvinte, sinal);
    }

    return {
        enviar,
        encerrar: () => {
            conexao?.encerrar(new Error(mensagemInterrupcao));
            conexao = null;
        },
    };
}
