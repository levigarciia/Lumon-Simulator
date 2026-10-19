import { impedimentoFerramenta } from '../../shared/ferramentas';
import { Server as ServidorProtocolo } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { criarCatalogo, nomeServidorMcp, type AcoesEscritorio, type OrigemMcp } from './catalogoFerramentas';
import { MetricasFerramentas, observarPromessas, observarDescartes } from './ferramentas/metricas';
export { nomeServidorMcp, origemSocial, type AcoesEscritorio, type OrigemMcp } from './catalogoFerramentas';

type Credencial = { funcionarioId: string; origem: OrigemMcp };
const limiteCorpo = 256 * 1024;

function lerCorpo(requisicao: IncomingMessage): Promise<unknown> {
    return new Promise((resolver, rejeitar) => {
        let corpo = '';
        requisicao.on('data', (parte: Buffer) => {
            corpo += parte.toString('utf8');
            if (corpo.length > limiteCorpo) rejeitar(new Error('Corpo grande demais.'));
        });
        requisicao.on('end', () => {
            try {
                resolver(corpo ? JSON.parse(corpo) : undefined);
            } catch (erro) {
                rejeitar(erro);
            }
        });
        requisicao.on('error', rejeitar);
    });
}

/**
 * Servidor MCP local, ouvindo só em 127.0.0.1. Cada funcionário recebe uma URL com token próprio, então uma
 * sessão não consegue agir em nome de outra. Funciona igual para o Claude Code e para o Codex.
 */
export class ServidorMcp {
    private servidor: Server;
    private tokens = new Map<string, Credencial>();
    private porta: Promise<number>;
    private urls = new Map<string, string>();
    readonly metricas = new MetricasFerramentas();

    constructor(private acoes: AcoesEscritorio) {
        this.servidor = createServer((requisicao, resposta) => void this.atender(requisicao, resposta));
        this.porta = new Promise((resolver) => {
            this.servidor.listen(0, '127.0.0.1', () => resolver((this.servidor.address() as AddressInfo).port));
        });
    }

    /**
     * URL exclusiva do funcionário para uma origem. O token é criado na primeira chamada e vale até a demissão
     * ou até o aplicativo fechar.
     */
    async urlDe(funcionarioId: string, origem: OrigemMcp): Promise<string> {
        const existente = [...this.tokens].find(
            ([, credencial]) => credencial.funcionarioId === funcionarioId && credencial.origem === origem,
        );
        const token = existente?.[0] ?? randomBytes(24).toString('hex');
        if (!existente) this.tokens.set(token, { funcionarioId, origem });
        const url = `http://127.0.0.1:${await this.porta}/mcp/${token}`;
        this.urls.set(token, url);
        observarPromessas(url, () => this.metricas.reterPromessa(origem));
        observarDescartes(url, (nome) => this.metricas.descartar(nome, origem));
        return url;
    }

    revogar(funcionarioId: string): void {
        this.metricas.revogar(funcionarioId);
        for (const [token, credencial] of this.tokens) {
            if (credencial.funcionarioId === funcionarioId) {
                this.tokens.delete(token);
                const url = this.urls.get(token);
                if (url) {
                    observarPromessas(url, undefined);
                    observarDescartes(url, undefined);
                }
                this.urls.delete(token);
            }
        }
    }

    encerrar(): void {
        for (const url of this.urls.values()) {
            observarPromessas(url, undefined);
            observarDescartes(url, undefined);
        }
        this.urls.clear();
        this.tokens.clear();
        this.servidor.close();
    }

    private async atender(requisicao: IncomingMessage, resposta: ServerResponse): Promise<void> {
        const token = /^\/mcp\/([a-f0-9]{48})$/.exec(requisicao.url ?? '')?.[1];
        const credencial = token && this.tokens.get(token);
        if (!credencial) {
            resposta.writeHead(404).end();
            return;
        }
        if (requisicao.method !== 'POST') {
            resposta.writeHead(405).end();
            return;
        }
        try {
            const corpo = await lerCorpo(requisicao) as {
                id?: string | number; method?: string; params?: { name?: string };
            };
            const catalogo = criarCatalogo(credencial, this.acoes);
            const impedimento = (nome: string) => impedimentoFerramenta(nome, credencial.origem,
                this.acoes.contextoFerramentas?.(credencial.funcionarioId, credencial.origem)
                    ?? { cargo: this.acoes.cargo?.(credencial.funcionarioId) })
                ?? this.acoes.autorizarFerramenta?.(credencial.funcionarioId, credencial.origem, nome);
            const servidor = new ServidorProtocolo({ name: nomeServidorMcp, version: '0.1.0' },
                { capabilities: { tools: { listChanged: true } } });
            servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalogo.listar(
                impedimento,
                (nome) => this.metricas.anunciar(nome, credencial.origem),
            ) }));
            servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => catalogo.executar(
                pedido.params.name, pedido.params.arguments ?? {},
                impedimento,
                this.metricas, credencial.origem, credencial.funcionarioId,
                this.acoes.contextoFerramentas?.(credencial.funcionarioId, credencial.origem)
                    .participacaoEncerrada === true,
            ));
            const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            resposta.on('close', () => {
                void transporte.close();
                void servidor.close();
            });
            await servidor.connect(transporte);
            await transporte.handleRequest(requisicao, resposta, corpo);
        } catch {
            if (!resposta.headersSent) resposta.writeHead(400).end();
        }
    }
}
