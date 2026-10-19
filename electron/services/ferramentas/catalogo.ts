import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { nomeCanonicoFerramenta, politicasFerramentas, type NomeFerramenta,
    type OrigemFerramenta } from '../../../shared/ferramentas';
import type { MetricasFerramentas } from './metricas';

type Definicao = {
    nome: string; descricao: string; esquema: z.ZodObject; executar: (entrada: unknown) => Promise<CallToolResult>;
};

/** Reúne schema e execução; aliases antigos são resolvidos somente na chamada. */
export class CatalogoFerramentas {
    private definicoes = new Map<string, Definicao>();

    /** Registra a implementação e o schema de uma capacidade já definida na política compartilhada. */
    registrar<T extends z.ZodRawShape>(
        nome: NomeFerramenta, configuracao: { description: string; inputSchema?: T },
        executar: (entrada: z.infer<z.ZodObject<T>>) => Promise<CallToolResult>,
    ): void {
        if (this.definicoes.has(nome)) throw new Error('Ferramenta duplicada: ' + nome);
        const esquema = z.object(configuracao.inputSchema ?? {}).strict();
        this.definicoes.set(nome, { nome, descricao: configuracao.description, esquema,
            executar: async (entrada) => executar(esquema.parse(entrada) as z.infer<z.ZodObject<T>>) });
    }

    /** Oferece somente capacidades autorizadas pelo estado consultado nesta requisição. */
    listar(impedimento: (nome: string) => string | undefined, anunciar: (nome: string) => void): Tool[] {
        return [...this.definicoes.values()].filter((item) => !impedimento(item.nome)).map((item) => {
            anunciar(item.nome);
            return { name: item.nome, description: item.descricao,
                inputSchema: z.toJSONSchema(item.esquema, { unrepresentable: 'any' }) as Tool['inputSchema'] };
        });
    }

    /** Revalida chamadas, inclusive nomes antigos, antes de executar e medir seus efeitos. */
    async executar(
        nomeOriginal: string, argumentos: Record<string, unknown>, impedimento: (nome: string) => string | undefined,
        metricas: MetricasFerramentas, origem: OrigemFerramenta, ator = '', aposEncerramento = false,
    ): Promise<CallToolResult> {
        const nome = nomeCanonicoFerramenta(nomeOriginal);
        const terminar = metricas.iniciar(nome, origem, argumentos, ator);
        let resposta: CallToolResult;
        try {
            const definicao = this.definicoes.get(nome);
            const erro = impedimento(nome) ?? (!definicao ? 'Ferramenta indisponível neste canal.' : undefined);
            if (erro) {
                resposta = { content: [{ type: 'text', text: erro }], isError: true,
                    structuredContent: { codigo: 'acao_indisponivel', erro: true, terminal: false } };
            } else {
                resposta = await definicao!.executar(argumentos);
            }
        } catch (erro) {
            resposta = { content: [{ type: 'text', text: erro instanceof Error ? erro.message : String(erro) }],
                isError: true, structuredContent: { codigo: 'entrada_ou_execucao_invalida', erro: true, terminal: false } };
        } finally { terminar(); }
        const politica = politicasFerramentas[nome as NomeFerramenta];
        resposta.structuredContent = { audiencia: politica?.audiencia ?? 'autor',
            efeito: politica?.efeito ?? 'consulta', ...resposta.structuredContent, erro: resposta.isError === true };
        metricas.concluir(nome, origem, resposta.isError === true,
            resposta.structuredContent.terminal === true, aposEncerramento);
        return resposta;
    }
}
