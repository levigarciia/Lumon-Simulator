import { expect, test } from 'bun:test';
import { executarDecisoesSociais } from '../electron/services/harness/decisaoSocial';
import type { MensagemLocal } from '../electron/services/harness/contextoLocal';
import type { ChamadaLocal, RespostaLocal } from '../electron/services/harness/respostaLocal';

const ferramentas = [{ function: { name: 'fazer_pausa', description: 'Faz uma pausa real.', parameters: {
    type: 'object', properties: { atividade: { const: 'comendo' }, minutos: { type: 'integer' } },
    required: ['atividade', 'minutos'], additionalProperties: false,
} } }];

function chamada(nome: string, argumentos: object, id = nome): ChamadaLocal {
    return { id, type: 'function', function: { name: nome, arguments: JSON.stringify(argumentos) } };
}

function resposta(texto = '', chamadas: ChamadaLocal[] = []): RespostaLocal {
    return { texto, chamadas, motivo: 'stop' };
}

test('decisão social encaminha chamadas nativas e os argumentos originais ao MCP', async () => {
    let argumentosRecebidos: unknown;
    let exigiuAcao = false;
    await executarDecisoesSociais({
        mensagens: [], ferramentas, somenteAcao: true,
        inferir: async (somenteAcao) => {
            exigiuAcao = somenteAcao;
            return resposta('', [chamada('fazer_pausa', { atividade: 'comendo', minutos: 5 })]);
        },
        executar: async (item) => {
            argumentosRecebidos = JSON.parse(item.function.arguments);
            return { saida: 'Pausa iniciada.', erro: false };
        },
        publicar: () => { throw new Error('Uma ação não deve ser publicada como fala.'); },
    });
    expect(exigiuAcao).toBe(true);
    expect(argumentosRecebidos).toEqual({ atividade: 'comendo', minutos: 5 });
});

test('consulta permite uma nova inferência e resposta baseada no resultado', async () => {
    const executadas: string[] = [];
    const publicadas: string[] = [];
    const mensagens: MensagemLocal[] = [];
    let inferencias = 0;
    await executarDecisoesSociais({
        mensagens,
        ferramentas: ['consultar', 'nenhuma_acao'].map((name) => ({ function: {
            name, parameters: { type: 'object', properties: {} },
        } })),
        inferir: async () => {
            inferencias++;
            if (inferencias === 1) return resposta('', [chamada('consultar', { topico: 'entregas' })]);
            expect(mensagens).toContainEqual({
                role: 'tool', tool_call_id: 'consultar',
                content: 'Resultado da ferramenta consultar:\nResultado da pesquisa.',
            });
            return resposta('Encontrei o resultado.');
        },
        executar: async (item) => {
            executadas.push(item.function.name);
            return { saida: 'Resultado da pesquisa.', erro: false };
        },
        publicar: (texto) => { publicadas.push(texto); },
    });
    expect(inferencias).toBe(2);
    expect(executadas).toEqual(['consultar']);
    expect(publicadas).toEqual(['Encontrei o resultado.']);
    expect(mensagens.at(-1)).toEqual({ role: 'assistant', content: 'Encontrei o resultado.' });
});

test('instrução do turno acompanha o pedido em vez de virar outra mensagem', async () => {
    const mensagens: MensagemLocal[] = [{ role: 'user', content: 'Claudio: Bom trabalho.' }];
    await executarDecisoesSociais({
        mensagens, ferramentas: [], executar: async () => ({ saida: '', erro: false }), publicar: () => {},
        inferir: async () => resposta('Obrigado.'),
    });
    expect(mensagens).toHaveLength(2);
    expect(mensagens[0]!.content).toStartWith('Claudio: Bom trabalho.\n\n');
});

test('reação exige chamada e ignora texto livre junto com uma chamada', async () => {
    const publicadas: string[] = [];
    let chamadas = 0;
    await executarDecisoesSociais({
        mensagens: [],
        ferramentas: [...ferramentas, { function: {
            name: 'nenhuma_acao', parameters: { type: 'object', properties: {} },
        } }],
        somenteAcao: true,
        inferir: async () => resposta('Vou tratar disso.', [chamada('nenhuma_acao', {})]),
        executar: async () => { chamadas++; return { saida: '', erro: false }; },
        publicar: (texto) => publicadas.push(texto),
    });
    expect(chamadas).toBe(1);
    expect(publicadas).toEqual([]);
});

test('ferramenta não autorizada e argumentos inválidos nunca são executados', async () => {
    for (const chamadaInvalida of [
        chamada('inventada', {}),
        { ...chamada('fazer_pausa', {}), function: { name: 'fazer_pausa', arguments: '[' } },
    ]) {
        let chamadas = 0;
        await expect(executarDecisoesSociais({
            mensagens: [], ferramentas, inferir: async () => resposta('', [chamadaInvalida]),
            publicar: () => {},
            executar: async () => { chamadas++; return { saida: '', erro: false }; },
        })).rejects.toThrow();
        expect(chamadas).toBe(0);
    }
});

test('pausa encerra a reação após o uso sem outra inferência', async () => {
    let inferencias = 0;
    let pausas = 0;
    const mensagens: MensagemLocal[] = [];
    await executarDecisoesSociais({
        mensagens, somenteAcao: true, ferramentas,
        inferir: async () => {
            inferencias++;
            return resposta('', [chamada('fazer_pausa', { atividade: 'comendo', minutos: 5 })]);
        },
        executar: async () => {
            pausas++;
            return { saida: 'Pausa concluída.', erro: false };
        },
        publicar: () => { throw new Error('A reação não deve publicar texto livre.'); },
    });
    expect(inferencias).toBe(1);
    expect(pausas).toBe(1);
    expect(mensagens.some((item) => item.content?.includes('Pausa concluída'))).toBe(true);
});

test('consultas permitem reação privada seguida de interação pública', async () => {
    const executadas: string[] = [];
    const ferramentasReacao = ['reagir_ao_acontecimento', 'interagir_socialmente'].map((name) => ({ function: {
        name, parameters: { type: 'object', properties: {} },
    } }));
    await executarDecisoesSociais({
        mensagens: [], ferramentas: ferramentasReacao, somenteAcao: true,
        inferir: async () => resposta('', [chamada(ferramentasReacao[executadas.length]!.function.name, {})]),
        executar: async (item) => {
            executadas.push(item.function.name);
            return { saida: 'Confirmado.', erro: false, terminal: item.function.name === 'interagir_socialmente' };
        },
        publicar: () => { throw new Error('A fala pública pertence à ação real.'); },
    });
    expect(executadas).toEqual(['reagir_ao_acontecimento', 'interagir_socialmente']);
});

test('falha repetida de ferramenta interrompe sem apresentá-la como sucesso', async () => {
    let chamadas = 0;
    await expect(executarDecisoesSociais({
        mensagens: [], ferramentas, inferir: async () => resposta('', [chamada('fazer_pausa', {})]),
        executar: async () => { chamadas++; return { saida: 'Inválido.', erro: true }; },
        publicar: () => {},
    })).rejects.toThrow('repetiu a mesma ação inválida três vezes');
    expect(chamadas).toBe(3);
});
