import { expect, test } from 'bun:test';
import { prepararContextoLocal, type MensagemLocal } from '../electron/services/harness/contextoLocal';
import { criarSessaoLocal } from '../electron/services/harness/local';
import type { MotorLocal } from '../electron/services/motor';
import type { OuvinteTurno } from '../electron/services/harness/tipos';

function resposta(texto: string, motivo = 'stop', chamadas?: unknown[]): Response {
    return new Response(`data: ${JSON.stringify({ choices: [{
        delta: { content: texto, tool_calls: chamadas }, finish_reason: motivo,
    }] })}\n\ndata: [DONE]\n\n`);
}

function historico(): MensagemLocal[] {
    return [
        { role: 'system', content: 'Permissões originais.' },
        { role: 'user', content: 'Pedido anterior.' },
        { role: 'assistant', content: 'Informações antigas. '.repeat(1000) },
        { role: 'user', content: 'Pedido atual completo.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'consulta', type: 'function',
            function: { name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' } }] },
        { role: 'tool', tool_call_id: 'consulta', content: 'Resultado recente.' },
    ];
}

test('compacta em blocos, preserva sistema, pedido e pares recentes sem enviar ferramentas ao resumo', async () => {
    const mensagens = historico();
    let blocos = 0;
    await prepararContextoLocal(mensagens, [], 4096, async (corpo) => {
        blocos++;
        expect(corpo.tools).toBeUndefined();
        expect(corpo.chat_template_kwargs).toEqual({ enable_thinking: false });
        return resposta('Objetivo e decisões preservados.');
    }, new AbortController().signal);
    expect(blocos).toBeGreaterThan(1);
    expect(mensagens[0]!.content).toBe('Permissões originais.');
    expect(mensagens.at(-3)!.content).toBe('Pedido atual completo.');
    expect(mensagens.at(-2)!.tool_calls![0]!.id).toBe('consulta');
    expect(mensagens.at(-1)!.tool_call_id).toBe('consulta');
    expect(JSON.stringify(mensagens)).not.toContain('Informações antigas.');
});

test('resumo truncado e cancelamento preservam o histórico original', async () => {
    for (const cancelar of [false, true]) {
        const mensagens = historico();
        const original = structuredClone(mensagens);
        const controle = new AbortController();
        await expect(prepararContextoLocal(mensagens, [], 4096, async () => {
            if (cancelar) controle.abort(new Error('Cancelamento solicitado.'));
            return resposta('Parcial', 'length');
        }, controle.signal)).rejects.toThrow(cancelar ? 'Cancelamento solicitado' : 'histórico original');
        expect(mensagens).toEqual(original);
    }
});

test('pedido maior que a janela falha sem cortar o texto nem solicitar resumo', async () => {
    const mensagens: MensagemLocal[] = [{ role: 'user', content: 'Pedido extenso. '.repeat(1000) }];
    const original = structuredClone(mensagens);
    await expect(prepararContextoLocal(mensagens, [], 4096, async () => {
        throw new Error('Não deveria chamar o modelo.');
    }, new AbortController().signal)).rejects.toThrow('Reduza o envio');
    expect(mensagens).toEqual(original);
});

test('geração cortada repete com saída ampliada, sem raciocínio, e descarta ferramentas incompletas', async () => {
    const corpos: Record<string, unknown>[] = [];
    const textos: string[] = [];
    const motor = { usar: async (_id: string, _sinal: AbortSignal,
        acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
        estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
        completar: async (corpo) => {
            corpos.push(structuredClone(corpo));
            return corpos.length === 1 ? resposta('Parcial', 'length', [{ index: 0, id: 'incompleta',
                function: { name: 'escrever_arquivo', arguments: '{' } }]) : resposta('Concluído.');
        },
    }) } as Pick<MotorLocal, 'usar'>;
    const ouvinte: OuvinteTurno = { texto: (texto) => { textos.push(texto); },
        iniciarFerramenta: () => { throw new Error('Ferramenta truncada não pode executar.'); },
        concluirFerramenta: () => {}, aprovar: async () => false };
    const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: process.cwd(), autonomia: false,
        modo: 'conversa', instrucoes: 'Teste' }, motor);
    try {
        await sessao.enviar('Conclua o pedido.', ouvinte, new AbortController().signal);
        expect(corpos).toHaveLength(2);
        expect(corpos[1]!.messages).toEqual(corpos[0]!.messages);
        for (const corpo of corpos) expect(corpo.chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(Number(corpos[1]!.max_tokens)).toBeGreaterThan(Number(corpos[0]!.max_tokens));
        expect(textos.at(-1)).toBe('Concluído.');
    } finally {
        sessao.encerrar();
    }
});

test('thread restaurada compacta no primeiro envio e uma falha restaura o histórico anterior', async () => {
    let falhar = true;
    let resumos = 0;
    const motor = { usar: async (_id: string, _sinal: AbortSignal,
        acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
        estado: { fase: 'pronto', detalhe: 'Teste', contexto: 4096 },
        completar: async (corpo) => {
            if (corpo.temperature === 0.1) {
                resumos++;
                expect(JSON.stringify(corpo.messages)).toContain('Histórico restaurado');
                expect(JSON.stringify(corpo.messages)).not.toContain('Pedido que falhou');
                return resposta('Resumo restaurado.');
            }
            if (falhar) throw new Error('Falha de conexão.');
            expect(JSON.stringify(corpo.messages)).not.toContain('Pedido que falhou');
            return resposta('Retomado.');
        },
    }) } as Pick<MotorLocal, 'usar'>;
    const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: process.cwd(), autonomia: false,
        modo: 'conversa', instrucoes: 'Permissões originais.',
        historico: 'Histórico restaurado. '.repeat(1000) }, motor);
    const ouvinte: OuvinteTurno = { texto: () => {}, iniciarFerramenta: () => {},
        concluirFerramenta: () => {}, aprovar: async () => false };
    try {
        await expect(sessao.enviar('Pedido que falhou', ouvinte, new AbortController().signal))
            .rejects.toThrow('Falha de conexão');
        const anteriores = resumos;
        falhar = false;
        await sessao.enviar('Novo pedido', ouvinte, new AbortController().signal);
        expect(resumos).toBeGreaterThan(anteriores);
    } finally {
        sessao.encerrar();
    }
});
