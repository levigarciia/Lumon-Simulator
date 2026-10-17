import { expect, test } from 'bun:test';
import { executarDecisoesSociais } from '../electron/services/harness/decisaoSocial';
import type { MensagemLocal } from '../electron/services/harness/contextoLocal';

const ferramentas = [{ function: { name: 'fazer_pausa', description: 'Faz uma pausa real.', parameters: {
    type: 'object', properties: { atividade: { const: 'comendo' }, minutos: { type: 'integer' } },
    required: ['atividade', 'minutos'], additionalProperties: false,
} } }];

test('pesquisa mantém a vez em turnos comuns e de reação até o agente concluir depois das consultas', async () => {
    for (const somenteAcao of [false, true]) {
        const executadas: string[] = [];
        const publicadas: string[] = [];
        let inferencias = 0;
        await executarDecisoesSociais({
            mensagens: [], somenteAcao,
            ferramentas: ['consultar', 'nenhuma_acao'].map((name) => ({ function: {
                name, parameters: { type: 'object', properties: {} },
            } })),
            inferir: async () => {
                inferencias++;
                if (inferencias <= 2) return JSON.stringify({ tipo: 'acao', ferramenta: 'consultar',
                    argumentos: { deslocamento: inferencias - 1 } });
                return somenteAcao ? JSON.stringify({ tipo: 'acao', ferramenta: 'nenhuma_acao', argumentos: {} })
                    : JSON.stringify({ tipo: 'fala', texto: 'Consultei os acontecimentos.' });
            },
            executar: async (chamada) => {
                executadas.push(chamada.function.name);
                return { saida: 'Resultado da pesquisa.', erro: false, terminal: false };
            },
            publicar: (texto) => { publicadas.push(texto); },
        });
        expect(inferencias).toBe(3);
        expect(executadas.slice(0, 2)).toEqual(['consultar', 'consultar']);
        expect(publicadas).toEqual(somenteAcao ? [] : ['Consultei os acontecimentos.']);
    }
});

test('pausa encerra a reação após o uso sem outra inferência para relatar seu estado', async () => {
    let inferencias = 0;
    let pausas = 0;
    const mensagens: MensagemLocal[] = [];
    await executarDecisoesSociais({
        mensagens, somenteAcao: true, ferramentas: [...ferramentas, { function: {
            name: 'nenhuma_acao', parameters: { type: 'object', properties: {} },
        } }],
        inferir: async () => {
            inferencias++;
            if (inferencias === 3) {
                expect(pausas).toBe(2);
                expect(mensagens.some((mensagem) => mensagem.content?.includes('energia 80'))).toBe(true);
                return JSON.stringify({ tipo: 'acao', ferramenta: 'nenhuma_acao', argumentos: {} });
            }
            return JSON.stringify({ tipo: 'acao', ferramenta: 'fazer_pausa',
                argumentos: { atividade: 'comendo', minutos: 5 } });
        },
        executar: async (chamada) => {
            if (chamada.function.name !== 'fazer_pausa') return { saida: 'Nenhuma ação.', erro: false };
            pausas++;
            return { saida: pausas === 1 ? 'energia 25, ainda precisa descansar' : 'energia 80', erro: false };
        },
        publicar: () => { throw new Error('A reação não deve publicar texto livre.'); },
    });
    expect(inferencias).toBe(1);
    expect(pausas).toBe(1);
});

test('interpretação privada pode ser seguida de uma interação pública no mesmo turno', async () => {
    const executadas: string[] = [];
    const ferramentas = ['reagir_ao_acontecimento', 'interagir_socialmente'].map((name) => ({ function: {
        name, parameters: { type: 'object', properties: {} },
    } }));
    await executarDecisoesSociais({
        mensagens: [], ferramentas, somenteAcao: true,
        inferir: async () => JSON.stringify({ tipo: 'acao', ferramenta: ferramentas[executadas.length]!.function.name,
            argumentos: {} }),
        executar: async (chamada) => {
            executadas.push(chamada.function.name);
            return { saida: 'Confirmado.', erro: false, terminal: chamada.function.name === 'interagir_socialmente' };
        },
        publicar: () => { throw new Error('A fala pública pertence à ação real.'); },
    });
    expect(executadas).toEqual(['reagir_ao_acontecimento', 'interagir_socialmente']);
});

test('reação só aceita ações mesmo se o modelo ignorar o schema', async () => {
    for (const decisao of [{ tipo: 'fala', texto: 'Vou agir.' }, { tipo: 'silencio' }]) {
        let chamadas = 0;
        const publicadas: string[] = [];
        await expect(executarDecisoesSociais({
            mensagens: [], ferramentas, somenteAcao: true,
            inferir: async (formato) => {
                expect(formato.json_schema.schema.oneOf).toHaveLength(1);
                return JSON.stringify(decisao);
            },
            executar: async () => { chamadas++; return { saida: '', erro: false }; },
            publicar: (texto) => publicadas.push(texto),
        })).rejects.toThrow('exige uma ação real');
        expect(chamadas).toBe(0);
        expect(publicadas).toEqual([]);
    }
});

test('decisão de pausar aguarda o retorno e encerra a vez sem fala extra', async () => {
    const liberar = Promise.withResolvers<void>();
    const iniciou = Promise.withResolvers<void>();
    const mensagens: MensagemLocal[] = [];
    const publicadas: string[] = [];
    let chamadas = 0;
    let inferencias = 0;
    const turno = executarDecisoesSociais({
        mensagens, ferramentas, publicar: (texto) => publicadas.push(texto),
        inferir: async (formato) => {
            expect(formato.type).toBe('json_schema');
            inferencias++;
            if (inferencias === 1) return JSON.stringify({ tipo: 'acao', ferramenta: 'fazer_pausa',
                argumentos: { atividade: 'comendo', minutos: 5 } });
            expect(mensagens.some((mensagem) => mensagem.content?.includes('Pausa concluída'))).toBe(true);
            return JSON.stringify({ tipo: 'fala', texto: 'Terminei a pausa.' });
        },
        executar: async (chamada) => {
            chamadas++;
            expect(chamada.function.name).toBe('fazer_pausa');
            expect(JSON.parse(chamada.function.arguments)).toEqual({ atividade: 'comendo', minutos: 5 });
            iniciou.resolve();
            await liberar.promise;
            return { saida: 'Pausa concluída.', erro: false };
        },
    });
    await iniciou.promise;
    expect(publicadas).toEqual([]);
    liberar.resolve();
    await turno;
    expect(chamadas).toBe(1);
    expect(publicadas).toEqual([]);
});

test('texto livre e decisão com fala junto à ação são recusados sem publicar promessa', async () => {
    for (const bruto of [
        'Aproveito para fazer uma pausa rápida de 5 minutos.',
        JSON.stringify({ tipo: 'acao', ferramenta: 'fazer_pausa', argumentos: {}, texto: 'Vou comer.' }),
        JSON.stringify({ tipo: 'acao', ferramenta: 'inventada', argumentos: {} }),
    ]) {
        let chamadas = 0;
        const publicadas: string[] = [];
        await expect(executarDecisoesSociais({
            mensagens: [], ferramentas, inferir: async () => bruto, publicar: (texto) => publicadas.push(texto),
            executar: async () => { chamadas++; return { saida: '', erro: false }; },
        })).rejects.toThrow();
        expect(chamadas).toBe(0);
        expect(publicadas).toEqual([]);
    }
});

test('silêncio não executa ações nem publica JSON e falhas não são apresentadas como sucesso', async () => {
    const publicadas: string[] = [];
    let chamadas = 0;
    let inferencias = 0;
    await executarDecisoesSociais({
        mensagens: [], ferramentas, publicar: (texto) => publicadas.push(texto),
        inferir: async () => {
            inferencias++;
            return inferencias === 1 ? JSON.stringify({ tipo: 'acao', ferramenta: 'fazer_pausa',
                argumentos: { atividade: 'comendo', minutos: 5 } }) : '{"tipo":"silencio"}';
        },
        executar: async () => { chamadas++; return { saida: 'Item indisponível.', erro: true }; },
    });
    expect(chamadas).toBe(1);
    expect(publicadas).toEqual([]);
});
