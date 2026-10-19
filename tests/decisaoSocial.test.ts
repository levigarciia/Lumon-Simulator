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

for (const terminal of [true, false]) {
    test(`fala com ação real é preservada após execução com terminal ${terminal}`, async () => {
        const ordem: string[] = [];
        await executarDecisoesSociais({
            mensagens: [], ferramentas: [{ function: { name: 'ir_para_work', parameters: {} } }],
            inferir: async () => resposta('Vou entrar no Work.', [chamada('ir_para_work', {})]),
            executar: async () => { ordem.push('ação'); return { saida: 'Agendada.', erro: false, terminal }; },
            publicar: (texto) => { ordem.push(texto); },
        });
        expect(ordem).toEqual(['ação', 'Vou entrar no Work.']);
    });
}

test('nome e JSON em texto exigem chamada real sem executar os argumentos escritos', async () => {
    let inferencias = 0;
    const publicadas: string[] = [];
    const executadas: ChamadaLocal[] = [];
    await executarDecisoesSociais({
        mensagens: [], ferramentas: [{ function: { name: 'ir_para_work', parameters: {} } }],
        inferir: async () => ++inferencias === 1
            ? resposta('Entrarei no Work para continuar.\n\nir_para_work\n{"trabalho":"inventado"}')
            : resposta('Entrarei no Work para continuar.', [chamada('ir_para_work', {})]),
        executar: async (item) => {
            executadas.push(item);
            return { saida: 'Agendada.', erro: false, terminal: true };
        },
        publicar: (texto) => { publicadas.push(texto); },
    });
    expect(inferencias).toBe(2);
    expect(executadas).toEqual([chamada('ir_para_work', {})]);
    expect(publicadas).toEqual(['Entrarei no Work para continuar.']);
});

test('consulta acompanhada de fala preserva o texto ao acrescentar a resposta final', async () => {
    let inferencias = 0;
    const publicadas: string[] = [];
    await executarDecisoesSociais({
        mensagens: [], ferramentas: [{ function: { name: 'consultar', parameters: {} } }],
        inferir: async () => ++inferencias === 1
            ? resposta('Quero entender o ocorrido.', [chamada('consultar', {})])
            : resposta('O arquivo ainda está pendente.'),
        executar: async () => ({ saida: 'Pendente.', erro: false }),
        publicar: (texto) => { publicadas.push(texto); },
    });
    expect(publicadas.at(-1)).toBe('Quero entender o ocorrido.\n\nO arquivo ainda está pendente.');
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

test('pensamento com interpretação encerra a reação sem exigir uma interação pública', async () => {
    const executadas: string[] = [];
    const ferramentasReacao = ['atualizar_pensamento', 'cobrar'].map((name) => ({ function: {
        name, parameters: { type: 'object', properties: {} },
    } }));
    await executarDecisoesSociais({
        mensagens: [], ferramentas: ferramentasReacao, somenteAcao: true,
        inferir: async () => resposta('', [chamada(ferramentasReacao[executadas.length]!.function.name, {})]),
        executar: async (item) => {
            executadas.push(item.function.name);
            return { saida: 'Confirmado.', erro: false, terminal: item.function.name === 'cobrar' };
        },
        publicar: () => { throw new Error('A fala pública pertence à ação real.'); },
    });
    expect(executadas).toEqual(['atualizar_pensamento']);
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

test('nenhuma ação encerra também o turno de fala sem outra inferência', async () => {
    let inferencias = 0;
    await executarDecisoesSociais({
        mensagens: [], ferramentas: [{ function: { name: 'nenhuma_acao', parameters: {} } }],
        inferir: async () => {
            inferencias++;
            return resposta('Vou ver o que houve.', [chamada('nenhuma_acao', {})]);
        },
        executar: async () => ({ saida: 'Vez encerrada.', erro: false }),
        publicar: () => { throw new Error('Não deve publicar depois de passar a vez.'); },
    });
    expect(inferencias).toBe(1);
});

test('promessa sem chamada é retida até executar consulta real', async () => {
    let inferencias = 0;
    const publicadas: string[] = [];
    const executadas: string[] = [];
    await executarDecisoesSociais({
        mensagens: [], ferramentas: [{ function: { name: 'consultar', parameters: {} } }],
        inferir: async () => {
            inferencias++;
            if (inferencias === 1) return resposta('Vou ver o que houve.');
            if (inferencias === 2) return resposta('', [chamada('consultar', {})]);
            return resposta('O registro informa que a entrega foi rejeitada.');
        },
        executar: async (item) => {
            executadas.push(item.function.name);
            return { saida: 'Entrega rejeitada.', erro: false };
        },
        publicar: (texto) => publicadas.push(texto),
    });
    expect(executadas).toEqual(['consultar']);
    expect(publicadas).toEqual(['O registro informa que a entrega foi rejeitada.']);
});

test('promessas repetidas falham sem publicar nem inventar ferramentas', async () => {
    let inferencias = 0;
    await expect(executarDecisoesSociais({
        mensagens: [], ferramentas: [],
        inferir: async () => { inferencias++; return resposta('Vou revisar o trabalho agora.'); },
        executar: async () => { throw new Error('Não existe chamada.'); },
        publicar: () => { throw new Error('Promessa não deve chegar ao chat.'); },
    })).rejects.toThrow('anunciou uma ação sem executar');
    expect(inferencias).toBe(3);
});

test('encerramento descarta chamadas restantes e mantém respostas do protocolo no histórico', async () => {
    const mensagens: MensagemLocal[] = [];
    const executadas: string[] = [];
    await executarDecisoesSociais({
        mensagens,
        ferramentas: ['nenhuma_acao', 'consultar'].map((name) => ({ function: { name, parameters: {} } })),
        inferir: async () => resposta('', [chamada('nenhuma_acao', {}), chamada('consultar', {})]),
        executar: async (item) => {
            executadas.push(item.function.name);
            return { saida: 'Vez encerrada.', erro: false, terminal: true };
        },
        publicar: () => { throw new Error('Não há fala neste turno.'); },
    });
    expect(executadas).toEqual(['nenhuma_acao']);
    expect(mensagens.filter((item) => item.role === 'tool')).toHaveLength(2);
    expect(mensagens.at(-1)?.content).toContain('Chamada não executada');
});
