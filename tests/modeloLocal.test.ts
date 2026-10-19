import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baixarGguf } from '../electron/services/downloadModelos';
import { FilaMotor, type MotorLocal } from '../electron/services/motor';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { caminhoDoProjeto, executarFerramentaLocal } from '../electron/services/harness/ferramentasLocais';
import { lerRespostaLocal } from '../electron/services/harness/respostaLocal';
import type { OuvinteTurno } from '../electron/services/harness/tipos';
import { resolverModeloLocal, type ModeloCatalogo } from '../shared/modelos';
import { backendParaGpus, escolherDispositivo, interpretarDispositivos } from '../electron/services/dispositivosMotor';
import { ServidorMcp } from '../electron/services/mcp';
import { concluirAcao, recusarAcao } from '../electron/services/ferramentas/resultado';

const sinal = () => new AbortController().signal;
const temporaria = () => mkdtemp(join(tmpdir(), 'lumon-modelo-teste-'));

function sse(texto: string, chamadas?: unknown[]): Response {
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: texto, tool_calls: chamadas } }] })}`
        + '\n\ndata: [DONE]\n\n');
}

function ouvinte(): OuvinteTurno {
    return { texto: () => {}, iniciarFerramenta: () => {}, concluirFerramenta: () => {}, aprovar: async () => false };
}

describe('modelo local', () => {
    test('fala social transmite fragmentos antes da conclusão sem exigir saída JSON', async () => {
        const fala = 'Bom dia, equipe. Como vocês estão?';
        const publicadas: string[] = [];
        let inferencias = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo) => {
                inferencias++;
                expect(corpo.response_format).toBeUndefined();
                expect(corpo.grammar).toBeUndefined();
                expect(corpo.json_schema).toBeUndefined();
                expect(corpo.tools).toContainEqual(expect.objectContaining({
                    function: expect.objectContaining({ name: 'atualizar_pensamento' }),
                }));
                expect(corpo.tool_choice).toBe('auto');
                let parte = 0;
                const codificador = new TextEncoder();
                return new Response(new ReadableStream<Uint8Array>({
                    pull(controlador) {
                        if (parte === 0) {
                            controlador.enqueue(codificador.encode('data: '
                                + JSON.stringify({ choices: [{ delta: { content: 'Bom dia, equipe.' } }] })
                                + '\n\n'));
                        } else {
                            expect(publicadas).toEqual(['Bom dia, equipe.']);
                            controlador.enqueue(codificador.encode('data: '
                                + JSON.stringify({ choices: [{ delta: { content: ' Como vocês estão?' } }] })
                                + '\n\ndata: [DONE]\n\n'));
                            controlador.close();
                        }
                        parte++;
                    },
                }, { highWaterMark: 0 }));
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', atividade: 'social', instrucoes: 'Você é Gwen.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            await sessao.enviar('Bom dia.', { ...ouvinte(), texto: (texto) => publicadas.push(texto) }, sinal());
            expect(publicadas).toEqual(['Bom dia, equipe.', fala]);
            expect(inferencias).toBe(1);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('entrada no Work encerra o chat sem outra inferência nem executar chamadas posteriores', async () => {
        let inferencias = 0;
        let entradas = 0;
        let pensamentos = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '', delegar: async () => '',
            atualizarPensamento: () => { pensamentos++; return ''; },
            irParaWork: () => {
                entradas++;
                return concluirAcao('Entrada agendada.', 'entrada_work_agendada', { terminal: true });
            },
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                return sse('', [
                    { index: 0, id: 'entrar', function: { name: 'ir_para_work', arguments: '{}' } },
                    { index: 1, id: 'pensar', function: { name: 'atualizar_pensamento',
                        arguments: JSON.stringify({ pensamento: 'Não deve executar.' }) } },
                ]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', instrucoes: 'Decida se quer trabalhar.',
            mcpUrl: await servidor.urlDe('refinador', 'chat') }, motor);
        try {
            await sessao.enviar('Há um arquivo disponível.', ouvinte(), sinal());
            expect(inferencias).toBe(1);
            expect(entradas).toBe(1);
            expect(pensamentos).toBe(0);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('pausa passa a vez sem nova inferência nem anúncio automático de retorno', async () => {
        let pausas = 0;
        let inferencias = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => { pausas++; return `Pausa concluída ${pausas}.`; },
            falarNoGeral: () => '', atualizarPensamento: () => '', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                if (inferencias <= 2) return sse('Vou descansar.', [{ index: 0, id: `pausa${inferencias}`,
                    function: { name: 'fazer_pausa', arguments: JSON.stringify({ atividade: 'descansando', minutos: 5 }) },
                }]);
                return sse('Agora estou recuperado.');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', instrucoes: 'Avalie seu estado depois de cada pausa.',
            mcpUrl: await servidor.urlDe('jamal', 'chat') }, motor);
        try {
            await sessao.enviar('Descanse enquanto precisar.', ouvinte(), sinal());
            expect(pausas).toBe(1);
            expect(inferencias).toBe(1);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('reação social persistentemente truncada libera o motor sem executar ação parcial', async () => {
        const fila = new FilaMotor();
        let inferencias = 0;
        let pensamentos = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => { pensamentos++; return ''; }, delegar: async () => '',
        });
        const motor = { usar: async (_id: string, sinalTurno: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) =>
            fila.executar(sinalTurno, () => executar({
                estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
                completar: async () => {
                    inferencias++;
                    return new Response('data: '
                        + JSON.stringify({ choices: [{ delta: { content: '{"tipo":"acao"' },
                            finish_reason: 'length' }] }) + '\n\n');
                },
            })),
        } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', atividade: 'social', instrucoes: 'Você é Gwen.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            await expect(sessao.enviar('Turno de reação.', ouvinte(), sinal(),
                { exigirFerramenta: true, ferramentas: ['atualizar_pensamento'] }))
                .rejects.toThrow('truncada após o limite de tentativas');
            expect(inferencias).toBe(2);
            expect(pensamentos).toBe(0);
            expect(await fila.executar(sinal(), async () => 'Liberada')).toBe('Liberada');
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('reação social encaminha ferramentas nativas depois de recuperar truncamento', async () => {
        const limites: unknown[] = [];
        const publicadas: string[] = [];
        let pensamentos = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => { pensamentos++; return 'Pensamento salvo.'; }, delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo) => {
                limites.push(corpo.max_tokens);
                expect(corpo.response_format).toBeUndefined();
                expect(corpo.tools).toContainEqual(expect.objectContaining({
                    function: expect.objectContaining({ name: 'atualizar_pensamento' }),
                }));
                expect(corpo.tool_choice).toBe('required');
                if (limites.length === 1) return new Response('data: '
                    + JSON.stringify({ choices: [{ delta: { content: '{"tipo":"acao"' }, finish_reason: 'length' }] })
                    + '\n\n');
                return sse('Minha reação privada não deve aparecer.', [{ index: 0, id: 'pensamento',
                    function: { name: 'atualizar_pensamento',
                    arguments: JSON.stringify({ pensamento: 'Vou tratar o assunto com o líder.' }) } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', atividade: 'social', instrucoes: 'Você é Gwen.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            await sessao.enviar('Turno de reação.', { ...ouvinte(), texto: (texto) => publicadas.push(texto) },
                sinal(), { exigirFerramenta: true, ferramentas: ['atualizar_pensamento'] });
            expect(limites).toEqual([1024, 2048]);
            expect(pensamentos).toBe(1);
            expect(publicadas).toEqual([]);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    for (const comFerramenta of [false, true]) {
        test(`fala social espera o fim do streaming para validar promessa, com ferramenta ${comFerramenta}`,
            async () => {
                const textos: string[] = [];
                const fragmentos = ['Diretoria, agradeço a confiança. Vou', ' fazer uma pausa', ' para comer.'];
                const previas = fragmentos.map((_fragmento, indice) => fragmentos.slice(0, indice + 1).join(''));
                let inferencias = 0;
                let pausas = 0;
                const servidor = new ServidorMcp({
                    verEscritorio: () => '', fazerPausa: async () => {
                        expect(textos.slice(0, previas.length)).toEqual(previas);
                        expect(textos.at(-1)).toBe('');
                        pausas++;
                        return 'Pausa iniciada.';
                    },
                    falarNoGeral: () => '', atualizarPensamento: () => '', delegar: async () => '',
                });
                const motor = { usar: async (_id: string, _sinal: AbortSignal,
                    executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
                    estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
                    completar: async () => {
                        if (++inferencias > 1) {
                            expect(textos).toEqual([...previas, '']);
                            return sse('Obrigada pela confiança.');
                        }
                        let parte = 0;
                        const codificador = new TextEncoder();
                        return new Response(new ReadableStream<Uint8Array>({
                            pull(controlador) {
                                expect(textos).toEqual(previas.slice(0, parte));
                                if (parte < fragmentos.length) {
                                    controlador.enqueue(codificador.encode('data: ' + JSON.stringify({
                                        choices: [{ delta: { content: fragmentos[parte++] } }],
                                    }) + '\n\n'));
                                    return;
                                }
                                const chamadas = comFerramenta ? [{ index: 0, id: 'pausa', function: {
                                    name: 'fazer_pausa', arguments: '{"atividade":"comendo","minutos":5}',
                                } }] : undefined;
                                controlador.enqueue(codificador.encode('data: ' + JSON.stringify({
                                    choices: [{ delta: { tool_calls: chamadas }, finish_reason: 'stop' }],
                                }) + '\n\ndata: [DONE]\n\n'));
                                controlador.close();
                            },
                        }, { highWaterMark: 0 }));
                    },
                }) } as Pick<MotorLocal, 'usar'>;
                const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
                    modo: 'personagem', atividade: 'social', instrucoes: 'Você é Kim.',
                    mcpUrl: await servidor.urlDe('kim', 'chat') }, motor);
                try {
                    await sessao.enviar('Parabéns, Kim.', {
                        ...ouvinte(), texto: (texto) => textos.push(texto),
                    }, sinal());
                    expect(inferencias).toBe(comFerramenta ? 1 : 2);
                    expect(pausas).toBe(comFerramenta ? 1 : 0);
                    expect(textos).toEqual([...previas, '',
                        comFerramenta ? previas.at(-1)! : 'Obrigada pela confiança.']);
                } finally { sessao.encerrar(); servidor.encerrar(); }
            });
    }

    test('turno social retira a prévia após a geração e confirma a fala junto com o resultado', async () => {
        let inferencias = 0;
        let pausas = 0;
        const textos: string[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => {
                expect(textos.at(-1)).toBe('');
                pausas++;
                return 'Pausa concluída.';
            },
            falarNoGeral: () => '', atualizarPensamento: () => '', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo) => {
                inferencias++;
                expect(corpo.response_format).toBeUndefined();
                expect(corpo.tools).toContainEqual(expect.objectContaining({
                    function: expect.objectContaining({ name: 'fazer_pausa' }),
                }));
                expect(corpo.tool_choice).toBe('auto');
                return sse('Texto provisório.', [{ index: 0, id: 'pausa', function: { name: 'fazer_pausa',
                    arguments: JSON.stringify({ atividade: 'comendo', minutos: 5 }) } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', atividade: 'social', instrucoes: 'Você é Gwen.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            await sessao.enviar('Você está livre.', { ...ouvinte(), texto: (texto) => textos.push(texto) }, sinal());
            expect(pausas).toBe(1);
            expect(textos).toEqual(['Texto provisório.', '', 'Texto provisório.']);
            expect(inferencias).toBe(1);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('reação truncada usa saída curta e libera a fila sem ampliar a tentativa', async () => {
        const fila = new FilaMotor();
        const limites: unknown[] = [];
        const motor = { usar: async (_id: string, sinalTurno: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) =>
            fila.executar(sinalTurno, () => executar({
                estado: { fase: 'pronto', detalhe: 'Teste', contexto: 186880 },
                completar: async (corpo) => {
                    limites.push(corpo.max_tokens);
                    return new Response('data: {"choices":[{"delta":{"content":"Reação longa"},'
                        + '"finish_reason":"length"}]}\n\n');
                },
            })),
        } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', instrucoes: 'Registre a reação.' }, motor);
        try {
            await expect(sessao.enviar('Reaja.', ouvinte(), sinal(), { exigirFerramenta: true }))
                .rejects.toThrow('excedeu o limite da reação');
            expect(limites).toEqual([512]);
            expect(await fila.executar(sinal(), async () => 'Liberada')).toBe('Liberada');
        } finally { sessao.encerrar(); }
    });

    test('reação sem chamada real falha após três inferências curtas', async () => {
        const limites: unknown[] = [];
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
                estado: { fase: 'pronto', detalhe: 'Teste', contexto: 186880 },
                completar: async (corpo) => { limites.push(corpo.max_tokens); return sse('Vou reagir.'); },
            }),
        } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', instrucoes: 'Registre a reação.' }, motor);
        try {
            await expect(sessao.enviar('Reaja.', ouvinte(), sinal(), { exigirFerramenta: true }))
                .rejects.toThrow('não executou uma chamada real');
            expect(limites).toEqual([512, 512, 512]);
        } finally { sessao.encerrar(); }
    });

    for (const acaoSocial of ['elogiar', 'cobrar']) {
        test(`${acaoSocial} encerra a inferência e descarta chamadas adicionais do mesmo lote`, async () => {
            let inferencias = 0;
            let acoes = 0;
            let falas = 0;
            const servidor = new ServidorMcp({
                verEscritorio: () => '', fazerPausa: async () => '',
                falarNoGeral: () => { falas++; return 'Mensagem enviada.'; },
                atualizarPensamento: () => '', delegar: async () => '',
                interagir: async () => { acoes++; return 'Ação registrada [evento].'; },
            });
            const motor = { usar: async (_id: string, _sinal: AbortSignal,
                executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
                estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
                completar: async () => {
                    inferencias++;
                    if (inferencias > 1) throw new Error('A ação já concluiu a participação.');
                    const entrada = { funcionario: 'colega', mensagem: 'Mensagem social.',
                        alcance: 'publico', fontes: ['fonte'] };
                    return sse('', [
                        { index: 0, id: 'acao', function: { name: acaoSocial,
                            arguments: JSON.stringify(entrada) } },
                        { index: 1, id: 'repeticao', function: { name: acaoSocial,
                            arguments: JSON.stringify(entrada) } },
                        { index: 2, id: 'fala', function: { name: 'falar_no_geral',
                            arguments: JSON.stringify({ mensagem: 'Repetindo a ação.' }) } },
                    ]);
                },
            }) } as Pick<MotorLocal, 'usar'>;
            const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
                modo: 'conversa', instrucoes: 'Realize a ação.',
                mcpUrl: await servidor.urlDe('claudio', 'geral') }, motor);
            try {
                await sessao.enviar('Converse.', ouvinte(), sinal());
                expect(inferencias).toBe(1);
                expect(acoes).toBe(1);
                expect(falas).toBe(0);
            } finally { sessao.encerrar(); servidor.encerrar(); }
        });
    }

    test('ferramenta de silêncio no Geral encerra a inferência sem pedir resposta textual', async () => {
        let inferencias = 0;
        let silencios = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
            silenciar: () => { silencios++; return 'Silêncio registrado. Encerre o turno sem falar.'; },
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                if (inferencias > 1) throw new Error('Silêncio não deve pedir outra resposta.');
                return sse('', [{ index: 0, id: 'silencio', function: { name: 'silencio', arguments: '{}' } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Use silencio se não houver novidade.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            await sessao.enviar('Algo a acrescentar?', ouvinte(), sinal());
            expect(silencios).toBe(1);
            expect(inferencias).toBe(1);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('consulta do histórico no Geral lê o retorno antes de publicar a resposta', async () => {
        let inferencias = 0;
        let consultas = 0;
        const textos: string[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
            revisar: () => { consultas++; return 'Um grupo aceito em quatro envios.'; },
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                return inferencias === 1 ? sse('Vou consultar.', [{ index: 0, id: 'historico', function: {
                    name: 'revisar_trabalho', arguments: '{}',
                } }]) : sse('Consultei: um grupo aceito em quatro envios.');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Consulte o histórico.',
            mcpUrl: await servidor.urlDe('jamal', 'geral') }, motor);
        try {
            await sessao.enviar('Consegue ver o último trabalho?',
                { ...ouvinte(), texto: (texto) => textos.push(texto) }, sinal());
            expect(consultas).toBe(1);
            expect(inferencias).toBe(2);
            expect(textos.at(-1)).toBe('Consultei: um grupo aceito em quatro envios.');
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('promessa de ação sem ferramenta ganha uma nova inferência no mesmo turno', async () => {
        const pedidos: string[] = [];
        const textos: string[] = [];
        let consertos = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
            consertarItem: () => { consertos++; return 'Conserto concluído.'; },
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo) => {
                const mensagens = (corpo as { messages: { role: string; content: string }[] }).messages;
                pedidos.push(mensagens.at(-1)!.content);
                if (pedidos.length === 1) return sse('A máquina quebrou. Vou consertar agora mesmo.');
                if (pedidos.length === 2) return sse('', [{ index: 0, id: 'conserto', function: {
                    name: 'consertar_item', arguments: '{"item":"maquina"}' } }]);
                return sse('Consertada.');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Converse.', mcpUrl: await servidor.urlDe('jamal', 'geral') }, motor);
        try {
            await sessao.enviar('A máquina quebrou.', { ...ouvinte(), texto: (texto) => textos.push(texto) }, sinal());
            expect(pedidos[1]).toContain('Você anunciou uma ação');
            expect(consertos).toBe(1);
            expect(textos.at(-1)).toBe('Consertada.');
            expect(servidor.metricas.consultar().find((item) => item.nome === 'decisao_do_turno'))
                .toMatchObject({ promessasRetidas: 1 });
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('promessa sem ferramenta disponível recebe só uma cobrança', async () => {
        let inferencias = 0;
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => { inferencias++; return sse('Vou conversar com ela depois.'); },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Converse.' }, motor);
        try {
            await expect(sessao.enviar('E a Gwen?', ouvinte(), sinal())).rejects.toThrow('não executou a ferramenta');
            expect(inferencias).toBe(2);
        } finally { sessao.encerrar(); }
    });

    test('frase da Gwen exige fazer_pausa e só publica depois do retorno real', async () => {
        const promessa = '@Diretoria, recebi o aviso de que estou livre. Com energia e humor estáveis, mas '
            + 'com fome em 20, aproveito para fazer uma pausa rápida de 5 minutos na máquina de guloseimas '
            + 'para repor as forças antes de retomar o refinamento com a mesma precisão.';
        const corpos: { tool_choice?: string; tools?: { function: { name: string } }[] }[] = [];
        const textos: string[] = [];
        const liberarPausa = Promise.withResolvers<string>();
        const iniciouPausa = Promise.withResolvers<void>();
        let pausas = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => {
                pausas++;
                iniciouPausa.resolve();
                return liberarPausa.promise;
            }, falarNoGeral: () => '', atualizarPensamento: () => '', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo: unknown) => {
                corpos.push(corpo as (typeof corpos)[number]);
                if (corpos.length === 1) return sse(promessa);
                if (corpos.length === 2) return sse('', [{ index: 0, id: 'pausa', function: {
                    name: 'fazer_pausa', arguments: JSON.stringify({ atividade: 'comendo', minutos: 5 }),
                } }]);
                return sse('Terminei minha pausa de verdade.');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', instrucoes: 'Decida se quer pausar.',
            mcpUrl: await servidor.urlDe('gwen', 'geral') }, motor);
        try {
            const turno = sessao.enviar('Aviso periódico: você está livre.', {
                ...ouvinte(), texto: (texto) => textos.push(texto),
            }, sinal());
            await iniciouPausa.promise;
            expect(pausas).toBe(1);
            expect(corpos[1]?.tool_choice).toBe('required');
            expect(corpos[1]?.tools?.map((item) => item.function.name)).toEqual(['fazer_pausa']);
            expect(textos.at(-1)).toBe('');
            liberarPausa.resolve('Pausa concluída.');
            await turno;
            expect(textos.at(-1)).toBe('');
        } finally { liberarPausa.resolve('Encerrada.'); sessao.encerrar(); servidor.encerrar(); }
    });

    test('refinamento exige ações após a consulta e descarta resultados narrados até o resumo', async () => {
        const corpos: { tool_choice?: string; max_tokens?: number; tools?: unknown[]; temperature?: number }[] = [];
        const textos: string[] = [];
        let envios = 0;
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '', abrirArquivo: () => 'A1=3 A2=3 A3=3',
            refinar: () => { envios++; return 'Envio: aceito. Sua etapa terminou.'; },
            estadoEtapa: () => ({ codigo: envios ? 'etapa_encerrada' : 'etapa_ativa', terminal: envios > 0 }),
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo: unknown) => {
                corpos.push(corpo as (typeof corpos)[number]);
                if (corpos.length === 1) return sse('', [{ index: 0, id: 'abrir', function: {
                    name: 'abrir_arquivo', arguments: '{}',
                } }]);
                if (corpos.length === 2) return sse('Testei todas as caixas e todas foram rejeitadas.');
                if (corpos.length === 3) return sse('Resultado inventado antes do envio.', [{
                    index: 0, id: 'envio', function: { name: 'refinar',
                        arguments: JSON.stringify({ celulas: ['A1', 'A2', 'A3'], temperamento: 'malicia' }) },
                }]);
                return sse('Um grupo aceito.');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'personagem', atividade: 'refinamento', instrucoes: 'Refine uma etapa.',
            mcpUrl: await servidor.urlDe('jamal', 'trabalho') }, motor);
        try {
            await sessao.enviar('Refine o arquivo.', { ...ouvinte(), texto: (texto) => textos.push(texto) }, sinal(), {
                ferramentas: ['abrir_arquivo', 'refinar'], exigirFerramentaAteConclusao: true,
                encerrarFerramentasQuando: (_nome, _saida, estado) => estado?.terminal === true,
            });
            expect(envios).toBe(1);
            expect(corpos.map((corpo) => corpo.tool_choice)).toEqual(['required', 'required', 'required', undefined]);
            expect(corpos.every((corpo) => corpo.max_tokens! <= 512)).toBe(true);
            expect(corpos.every((corpo) => corpo.temperature === 0.2)).toBe(true);
            expect(textos).toEqual(['Um grupo aceito.']);
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('refinamento interrompe três respostas sem ação mesmo quando o modelo ignora chamadas obrigatórias', async () => {
        let inferencias = 0;
        const textos: string[] = [];
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => { inferencias++; return sse('Grupo testado e rejeitado.'); },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'trabalho', instrucoes: 'Teste' }, motor);
        try {
            await expect(sessao.enviar('Execute.', { ...ouvinte(), texto: (texto) => textos.push(texto) }, sinal(), {
                ferramentas: ['listar_arquivos'], exigirFerramentaAteConclusao: true,
            })).rejects.toThrow('nenhuma ferramenta está disponível');
            expect(inferencias).toBe(0);
            expect(textos).toEqual([]);
        } finally { sessao.encerrar(); }
    });

    test.each([false, true])('retorno terminal retira ferramentas antes do resumo, com recusa %s', async (recusada) => {
        const corpos: { tools?: unknown[] }[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
            refinar: () => recusada ? recusarAcao('Sua etapa terminou por seleções inválidas.')
                : concluirAcao('Envio: aceito. Sua etapa terminou. Resuma e devolva ao líder.'),
            estadoEtapa: () => ({ codigo: 'etapa_encerrada', terminal: true }),
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo: unknown) => {
                corpos.push(corpo as (typeof corpos)[number]);
                return corpos.length > 1 ? sse('Um grupo refinado. Devolvo a etapa ao líder.')
                    : sse('', [{ index: 0, id: 'refinar', function: { name: 'refinar',
                        arguments: JSON.stringify({ celulas: ['A1', 'A2', 'A3'], temperamento: 'alegria' }),
                    } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'trabalho', instrucoes: 'Refine uma etapa.',
            mcpUrl: await servidor.urlDe('gwen', 'trabalho') }, motor);
        try {
            await sessao.enviar('Refine o arquivo.', ouvinte(), sinal(), {
                ferramentas: ['refinar'], exigirFerramentaAteConclusao: true,
                encerrarFerramentasQuando: (_nome, _saida, estado) => estado?.terminal === true,
            });
            expect(corpos).toHaveLength(2);
            expect(corpos[0]?.tools).toHaveLength(1);
            expect(corpos[1]?.tools).toBeUndefined();
        } finally { sessao.encerrar(); servidor.encerrar(); }
    });

    test('fala levada ao Geral pelo chat individual não encerra a resposta a quem conversa', async () => {
        let inferencias = 0;
        let publicacoes = 0;
        const textos: string[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '',
            falarNoGeral: () => { publicacoes++; return 'Mensagem enviada.'; },
            atualizarPensamento: () => '', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                if (inferencias > 1) return sse('Avisei a equipe no Geral.');
                return sse('', [{ index: 0, id: 'fala', function: {
                    name: 'falar_no_geral', arguments: JSON.stringify({ mensagem: 'Pessoal, reunião às dez.' }),
                } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-4b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Responda somente à pergunta atual.',
            mcpUrl: await servidor.urlDe('claudio', 'chat') }, motor);
        try {
            await sessao.enviar('Avise a equipe da reunião.', { ...ouvinte(), texto: (texto) => textos.push(texto) },
                sinal());
            expect(publicacoes).toBe(1);
            expect(inferencias).toBe(2);
            expect(textos.at(-1)).toBe('Avisei a equipe no Geral.');
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });

    test('turno com ferramenta obrigatória restringe a lista e exige chamada só na primeira inferência', async () => {
        const corpos: { tool_choice?: string; tools?: { function: { name: string } }[] }[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => 'Mensagem enviada.',
            atualizarPensamento: () => 'Pensamento registrado.', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo: unknown) => {
                corpos.push(corpo as (typeof corpos)[number]);
                return corpos.length > 1 ? sse('(silêncio)') : sse('', [{ index: 0, id: 'pensar', function: {
                    name: 'atualizar_pensamento', arguments: JSON.stringify({ pensamento: 'O Gepeto passou do ponto.' }),
                } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Teste', mcpUrl: await servidor.urlDe('claudio', 'geral') }, motor);
        try {
            await sessao.enviar('Reaja.', ouvinte(), sinal(),
                { ferramentas: ['atualizar_pensamento'], exigirFerramenta: true });
            expect(corpos.map((corpo) => corpo.tool_choice)).toEqual(['required', 'auto']);
            expect(corpos[0]?.tools?.map((item) => item.function.name)).toEqual(['atualizar_pensamento']);
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });

    test('ferramenta obrigatória segue exigida após falha e respeita a ordem de prioridade', async () => {
        const corpos: { tool_choice?: string; tools?: { function: { name: string } }[] }[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => 'Pausa concluída.', falarNoGeral: () => 'Mensagem enviada.',
            atualizarPensamento: () => 'Salvo.', delegar: async () => '',
        });
        const chamada = (nome: string, argumentos: object) => sse('', [{ index: 0, id: nome, function: {
            name: nome, arguments: JSON.stringify(argumentos) } }]);
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async (corpo: unknown) => {
                corpos.push(corpo as (typeof corpos)[number]);
                if (corpos.length === 1) return chamada('fazer_pausa', { atividade: 'inventada', minutos: 5 });
                if (corpos.length === 2) return chamada('fazer_pausa', { atividade: 'comendo', minutos: 5 });
                return sse('(silêncio)');
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Teste', mcpUrl: await servidor.urlDe('claudio', 'geral') }, motor);
        try {
            await sessao.enviar('Pode ir comer.', ouvinte(), sinal(),
                { ferramentas: ['fazer_pausa', 'atualizar_pensamento'], exigirFerramenta: true });
            expect(corpos.map((corpo) => corpo.tool_choice)).toEqual(['required', 'required']);
            expect(corpos[0]?.tools?.map((item) => item.function.name)).toEqual(['fazer_pausa', 'atualizar_pensamento']);
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });

    test('conversa com texto e ferramenta de ação encerra sem repetir a resposta', async () => {
        let inferencias = 0;
        const textos: string[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => 'Mensagem enviada.',
            atualizarPensamento: () => 'Pensamento registrado.', delegar: async () => '',
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => acao({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
            completar: async () => {
                inferencias++;
                return sse('O Cláudio precisa ser substituído.', [{ index: 0, id: 'pensar', function: {
                    name: 'atualizar_pensamento', arguments: JSON.stringify({ pensamento: 'Cláudio é fraco.' }),
                } }]);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            modo: 'conversa', instrucoes: 'Teste', mcpUrl: await servidor.urlDe('gepeto', 'chat') }, motor);
        try {
            await sessao.enviar('E o Cláudio?', { ...ouvinte(), texto: (texto) => { textos.push(texto); } }, sinal());
            expect(inferencias).toBe(1);
            expect(textos.at(-1)).toBe('O Cláudio precisa ser substituído.');
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });

    test('catálogo resolve Qwen 3.5 9B e migra IDs antigos com edição fixa', () => {
        const modelo = resolverModeloLocal('qwen3.5-9b-q4');
        expect(modelo.tamanho).toBe(5680522464);
        expect(modelo.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(resolverModeloLocal('llama3.2:1b').id).toBe('llama-3.2-1b-q4');
        expect(() => resolverModeloLocal('inventado')).toThrow('Edite o funcionário');
    });

    test('prioriza ROCm na Radeon dedicada e usa o índice enumerado pelo backend', () => {
        expect(backendParaGpus(['AMD Radeon RX 7700 XT'])).toBe('rocm');
        const dispositivos = interpretarDispositivos('  ROCm0: AMD Radeon(TM) Graphics (512 MiB, 512 MiB free)\n'
            + '  ROCm1: AMD Radeon RX 7700 XT (12288 MiB, 11000 MiB free)\n');
        expect(escolherDispositivo(dispositivos, 'rocm').id).toBe('ROCm1');
    });

    test('SSE preserva UTF 8 fragmentado, texto e argumentos de ferramentas', async () => {
        const dados = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Olá"}}]}\n\n'
            + 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a",'
            + '"function":{"name":"ler_arquivo","arguments":"{\\"caminho\\":"}}]}}]}\n\n'
            + 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
            + '"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
            + 'data: [DONE]');
        const fluxo = new ReadableStream<Uint8Array>({ start(controle) {
            for (const byte of dados) controle.enqueue(new Uint8Array([byte]));
            controle.close();
        } });
        const resultado = await lerRespostaLocal(new Response(fluxo), sinal(), () => {});
        expect(resultado.texto).toBe('Olá');
        expect(JSON.parse(resultado.chamadas[0]!.function.arguments)).toEqual({ caminho: 'a.txt' });
    });

    test('conexão truncada e erro HTTP não viram sucesso vazio', async () => {
        await expect(lerRespostaLocal(new Response('data: {"choices":[{"delta":{"content":"a"}}]}\n'),
            sinal(), () => {})).rejects.toThrow('antes da conclusão');
        await expect(lerRespostaLocal(new Response('indisponível', { status: 503 }),
            sinal(), () => {})).rejects.toThrow('HTTP 503');
    });

    for (const terminal of ['data: [DONE]\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n']) {
        test(`SSE conclui sem esperar o fechamento da conexão: ${terminal.trim()}`, async () => {
            let cancelado = false;
            const fluxo = new ReadableStream<Uint8Array>({
                start(controle) {
                    controle.enqueue(new TextEncoder().encode(
                        'data: {"choices":[{"delta":{"content":"Pronto"}}]}\n\n' + terminal,
                    ));
                },
                cancel() { cancelado = true; },
            });
            const resposta = await lerRespostaLocal(new Response(fluxo), sinal(), () => {}, 100);
            expect(resposta.texto).toBe('Pronto');
            expect(cancelado).toBe(true);
        });
    }

    test('SSE sem progresso cancela a conexão e libera a próxima inferência', async () => {
        const fila = new FilaMotor();
        let cancelado = false;
        const fluxo = new ReadableStream<Uint8Array>({ cancel() { cancelado = true; } });
        const parada = fila.executar(sinal(), () => lerRespostaLocal(new Response(fluxo), sinal(), () => {}, 20));
        const proxima = fila.executar(sinal(), async () => 'Executou');
        await expect(parada).rejects.toThrow('parou de enviar dados');
        expect(cancelado).toBe(true);
        expect(await proxima).toBe('Executou');
    });

    test('SSE com progresso renova o prazo em vez de limitar a duração total', async () => {
        let partes = 0;
        const fluxo = new ReadableStream<Uint8Array>({
            async pull(controle) {
                await Bun.sleep(40);
                const dados = ++partes <= 4
                    ? 'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' : 'data: [DONE]\n\n';
                controle.enqueue(new TextEncoder().encode(dados));
            },
        });
        const resposta = await lerRespostaLocal(new Response(fluxo), sinal(), () => {}, 120);
        expect(resposta.texto).toBe('aaaa');
    });

    test('sessão local informa espera enquanto outra inferência ocupa o motor', async () => {
        const fila = new FilaMotor();
        let liberar!: () => void;
        const espera = new Promise<void>((resolver) => { liberar = resolver; });
        const ocupada = fila.executar(sinal(), () => espera);
        const etapas: string[] = [];
        const motor = { usar: async (_id: string, sinalTurno: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) =>
            fila.executar(sinalTurno, () => executar({
                estado: { fase: 'pronto', detalhe: 'Teste', contexto: 16384 },
                completar: async () => sse('Pronto'),
            })),
        } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
            instrucoes: 'Teste', modo: 'conversa' }, motor);
        const envio = sessao.enviar('Oi', { ...ouvinte(), etapa: (etapa) => etapas.push(etapa) }, sinal());
        try {
            await Bun.sleep(0);
            expect(etapas).toEqual(['aguardando_motor']);
            liberar();
            await Promise.all([ocupada, envio]);
            expect(etapas).toEqual(['aguardando_motor', 'processando']);
        } finally { liberar(); sessao.encerrar(); }
    });

    test('fila cancela espera sem liberar a execução que ainda está ocupando o motor', async () => {
        const fila = new FilaMotor();
        const ordem: string[] = [];
        let liberar!: () => void;
        const primeiro = fila.executar(sinal(), async () => {
            ordem.push('primeiro');
            await new Promise<void>((resolver) => { liberar = resolver; });
        });
        await Bun.sleep(0);
        const controle = new AbortController();
        const segundo = fila.executar(controle.signal, async () => ordem.push('segundo'));
        controle.abort(new Error('cancelado'));
        await expect(segundo).rejects.toThrow('cancelado');
        const terceiro = fila.executar(sinal(), async () => ordem.push('terceiro'));
        await Bun.sleep(0);
        expect(ordem).toEqual(['primeiro']);
        liberar();
        await Promise.all([primeiro, terceiro]);
        expect(ordem).toEqual(['primeiro', 'terceiro']);
    });

    test('download valida hash, reutiliza arquivo e rejeita conteúdo adulterado', async () => {
        const raiz = await temporaria();
        const conteudo = Buffer.from('GGUFconteudo de teste');
        const item: ModeloCatalogo = { id: 'teste', familia: 'qwen', nome: 'Teste', descricao: '',
            repositorio: 'org/modelo', arquivo: 'modelo.gguf', revisao: 'a'.repeat(40), tamanho: conteudo.length,
            sha256: createHash('sha256').update(conteudo).digest('hex'), capacidades: [] };
        let transferencias = 0;
        const transferir = async () => { transferencias++; return new Response(conteudo); };
        const caminho = await baixarGguf(raiz, item, sinal(), () => {}, transferir);
        expect(await readFile(caminho)).toEqual(conteudo);
        await baixarGguf(raiz, item, sinal(), () => {}, transferir);
        expect(transferencias).toBe(1);
        await expect(baixarGguf(raiz, { ...item, id: 'adulterado', sha256: '0'.repeat(64) },
            sinal(), () => {}, transferir)).rejects.toThrow('SHA 256');
        expect((await readdir(raiz)).some((arquivo) => arquivo.endsWith('.part'))).toBe(false);
    });

    test('cancelar download remove parcial e não publica arquivo incompleto', async () => {
        const raiz = await temporaria();
        const controle = new AbortController();
        const item = { ...resolverModeloLocal('qwen3.5-9b-q4'), tamanho: 100 };
        await expect(baixarGguf(raiz, item, controle.signal, (fase, recebido) => {
            if (fase === 'baixando' && recebido > 0) controle.abort(new Error('cancelado'));
        }, async () => new Response('GGUFparcial'))).rejects.toThrow('cancelado');
        expect(await readdir(raiz)).toEqual([]);
    });

    test('caminhos relativos, absolutos externos e links não escapam do projeto', async () => {
        const raiz = await temporaria();
        const fora = await temporaria();
        await symlink(fora, join(raiz, 'atalho'), 'junction');
        await expect(caminhoDoProjeto(raiz, '../segredo')).rejects.toThrow('pasta do projeto');
        await expect(caminhoDoProjeto(raiz, join(fora, 'segredo'))).rejects.toThrow('pasta do projeto');
        await expect(caminhoDoProjeto(raiz, 'atalho/novo.txt')).rejects.toThrow('pasta do projeto');
        expect(await caminhoDoProjeto(raiz, 'src/novo.txt')).toBe(join(raiz, 'src/novo.txt'));
    });

    test('comandos com saída de erro não são apresentados como execução bem sucedida', async () => {
        await expect(executarFerramentaLocal('executar_comando', { comando: 'Write-Output falhou; exit 7' }, {
            modelo: 'qwen3.5-9b-q4', pasta: await temporaria(), autonomia: false,
            instrucoes: 'Teste', modo: 'trabalho',
        }, sinal())).rejects.toThrow('Código: 7');
    });

    test('escrita externa não é autorizada mesmo no modo antigo', async () => {
        const pasta = await temporaria();
        await writeFile(join(pasta, 'arquivo.txt'), 'original');
        let rodada = 0;
        const corpos: Record<string, unknown>[] = [];
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => unknown) => {
            return acao({ estado: { contexto: 16384, fase: 'pronto', detalhe: 'Teste' },
                completar: async (corpo: Record<string, unknown>) => {
                corpos.push(structuredClone(corpo));
                return rodada++ === 0 ? sse('', [{ index: 0, id: 'escrita', function: {
                    name: 'escrever_arquivo',
                    arguments: JSON.stringify({ caminho: 'arquivo.txt', conteudo: 'alterado' }),
                } }]) : sse('Operação recusada.');
            } });
        } } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta, autonomia: false,
            instrucoes: 'Teste', modo: 'trabalho' }, motor);
        await sessao.enviar('Escreva', ouvinte(), sinal());
        expect(await readFile(join(pasta, 'arquivo.txt'), 'utf8')).toBe('original');
        expect(JSON.stringify(corpos[1])).toContain('Ferramenta não autorizada');
        sessao.encerrar();
    });

    test('interrompe tentativas idênticas inválidas e permite outro turno após a falha', async () => {
        let chamadas = 0;
        let recuperado = false;
        const falhas: boolean[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
            atualizarPensamento: () => '', delegar: async () => '',
            interagir: () => { chamadas++; return recusarAcao('Use um ID de acontecimento em fontes.'); },
        });
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => unknown) => acao({
            estado: { contexto: 32768, fase: 'pronto', detalhe: 'Teste' },
            completar: async () => recuperado ? sse('Olá!') : sse('', [{
                index: 0, id: `tentativa${chamadas}`, function: {
                    name: 'cobrar', arguments: JSON.stringify({
                        funcionario: 'colega', mensagem: 'Corrija.', alcance: 'publico',
                        fontes: ['colega'],
                    }),
                },
            }]),
        }) } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: await temporaria(), autonomia: false,
            instrucoes: 'Teste', modo: 'conversa', mcpUrl: await servidor.urlDe('lider', 'chat') }, motor);
        try {
            await expect(sessao.enviar('Revise', { ...ouvinte(),
                concluirFerramenta: (_id, erro) => { falhas.push(erro); },
            }, AbortSignal.timeout(3000))).rejects.toThrow('três vezes');
            expect(chamadas).toBe(3);
            expect(falhas).toEqual([true, true, true]);
            recuperado = true;
            await sessao.enviar('oi', ouvinte(), AbortSignal.timeout(3000));
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });

    test('MCP executa a delegação real e permite inferência do colega sem prender a fila', async () => {
        const fila = new FilaMotor();
        let rodada = 0;
        let delegou = false;
        let aprovou = false;
        let ferramentas: { function: { name: string } }[] = [];
        const servidor = new ServidorMcp({
            verEscritorio: () => 'Escritório', fazerPausa: async () => 'Pausa',
            falarNoGeral: () => 'Publicado', atualizarPensamento: () => 'Salvo',
            delegar: async () => {
                await fila.executar(sinal(), async () => { delegou = true; });
                return 'Colega concluiu';
            },
        });
        const motor = { usar: async (_id: string, sinalTurno: AbortSignal,
            acao: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => {
            return fila.executar(sinalTurno, () => acao({
                estado: { contexto: 16384, fase: 'pronto', detalhe: 'Teste' },
                completar: async (corpo: Record<string, unknown>) => {
                    ferramentas = corpo.tools as typeof ferramentas;
                    return rodada++ === 0 ? sse('', [{ index: 0, id: 'delegacao', function: {
                        name: 'delegar', arguments: JSON.stringify({ funcionario: 'Colega', tarefa: 'Teste' }),
                    } }]) : sse('Concluído');
                },
            }));
        } } as Pick<MotorLocal, 'usar'>;
        const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: await temporaria(), autonomia: false,
            instrucoes: 'Teste', modo: 'trabalho', mcpUrl: await servidor.urlDe('lider', 'trabalho') }, motor);
        try {
            await sessao.enviar('Delegue', { ...ouvinte(), aprovar: async () => { aprovou = true; return true; } },
                AbortSignal.timeout(3000));
            expect(delegou).toBe(true);
            expect(aprovou).toBe(false);
            expect(ferramentas.some((item) => item.function.name === 'delegar')).toBe(true);
        } finally {
            sessao.encerrar();
            servidor.encerrar();
        }
    });
});
