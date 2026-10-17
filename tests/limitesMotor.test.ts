import { expect, test } from 'bun:test';
import { argumentosContextoAutomatico, contextoAposFalha, contextoDoServidor } from '../electron/services/limitesMotor';
import { MotorLocal } from '../electron/services/motor';
import { resolverModeloLocal } from '../shared/modelos';
import { contextoMinimoLocal, prepararContextoLocal, type MensagemLocal } from '../electron/services/harness/contextoLocal';
import { criarSessaoLocal } from '../electron/services/harness/local';

test('carga automática não fixa a janela e consulta o limite efetivo do servidor', () => {
    const argumentos = argumentosContextoAutomatico('rocm');
    expect(argumentos).not.toContain('-c');
    expect(argumentos.join(' ')).toContain('-ngl auto --fit on');
    expect(argumentosContextoAutomatico('cpu', 32768, 16384).join(' ')).toContain('-c 32768 -ngl 0');
    expect(contextoDoServidor({ default_generation_settings: { n_ctx: 262144 } })).toBe(262144);
    expect(() => contextoDoServidor({ default_generation_settings: { n_ctx: '16384' } })).toThrow();
    expect(() => contextoDoServidor(null)).toThrow();
});

test('falha de memória reduz a tentativa sem diminuir o espaço necessário ao pedido', () => {
    expect(contextoAposFalha('n_ctx_train = 262144\nErrorOutOfDeviceMemory', 0, 16384)).toBe(131072);
    expect(contextoAposFalha('failed to allocate', 32768, 24576)).toBe(24576);
    expect(contextoAposFalha('out of memory', 24576, 24576)).toBeNull();
    expect(contextoAposFalha('modelo não encontrado', 32768)).toBeNull();
    expect(contextoAposFalha('out of memory', 0)).toBeNull();
});

test('inicialização ajusta a memória, interrompe erros definitivos e respeita cancelamento', async () => {
    const motor = new MotorLocal('C:/temporario');
    const tentativas: number[] = [];
    const modelo = resolverModeloLocal('qwen3.5-9b-q4');
    motor['iniciar'] = async (_exe, _caminho, _item, _backend, _dispositivo, _sinal, contexto) => {
        tentativas.push(contexto);
        if (tentativas.length < 3) throw new Error('n_ctx_train = 262144\nfailed to allocate');
        motor.estado = { fase: 'pronto', detalhe: 'Teste', contexto };
    };
    await motor['iniciarAjustando']('teste', 'modelo', modelo, 'cpu', undefined,
        new AbortController().signal, 16384);
    expect(tentativas).toEqual([0, 131072, 65536]);
    const controle = new AbortController();
    motor['iniciar'] = async () => { controle.abort(new Error('Cancelado')); throw new Error('out of memory'); };
    await expect(motor['iniciarAjustando']('teste', 'modelo', modelo, 'cpu', undefined, controle.signal, 16384))
        .rejects.toThrow('Cancelado');
    let chamadas = 0;
    motor['iniciar'] = async () => { chamadas++; throw new Error('GGUF inválido'); };
    await expect(motor['iniciarAjustando']('teste', 'modelo', modelo, 'cpu', undefined,
        new AbortController().signal, 16384)).rejects.toThrow('GGUF inválido');
    expect(chamadas).toBe(1);
    motor.parar();
    expect(motor.estado.fase).toBe('desligado');
});

test('harness pede expansão antes de compactar quando instruções e ferramentas não cabem', async () => {
    const mensagens: MensagemLocal[] = [
        { role: 'system', content: 'Orientações necessárias. '.repeat(1000) },
        { role: 'user', content: 'Oi' },
    ];
    const minimo = contextoMinimoLocal(mensagens, [{ function: { description: 'Ferramenta. '.repeat(500) } }]);
    expect(minimo).toBeGreaterThan(16384);
    const original = structuredClone(mensagens);
    await prepararContextoLocal(mensagens, [], minimo, async () => {
        throw new Error('Não deve resumir o pedido atual.');
    }, new AbortController().signal);
    expect(mensagens).toEqual(original);
    let solicitado = 0;
    const sessao = criarSessaoLocal({ modelo: 'qwen3.5-9b-q4', pasta: '.', autonomia: false,
        modo: 'conversa', instrucoes: mensagens[0]!.content! }, {
        usar: async (_id, _sinal, acao, contextoMinimo) => {
            solicitado = contextoMinimo!;
            return acao({ estado: { fase: 'pronto', detalhe: 'Teste', contexto: solicitado },
                completar: async () => new Response('data: {"choices":[{"delta":{"content":"Oi."},'
                    + '"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') });
        },
    });
    let resposta = '';
    try {
        await sessao.enviar('Oi', { texto: (texto) => { resposta = texto; }, iniciarFerramenta: () => {},
            concluirFerramenta: () => {}, aprovar: async () => false }, new AbortController().signal);
        expect(solicitado).toBeGreaterThan(16384);
        expect(resposta).toBe('Oi.');
    } finally { sessao.encerrar(); }
});

test('motor amplia uma janela automática menor que as instruções sem cortar o pedido', async () => {
    const motor = new MotorLocal('C:/temporario');
    const tentativas: number[] = [];
    motor['iniciar'] = async (_exe, _caminho, _item, _backend, _dispositivo, _sinal, contexto) => {
        tentativas.push(contexto);
        motor.estado = { fase: 'pronto', detalhe: 'Teste', contexto: contexto || 4096 };
    };
    await motor['iniciarAjustando']('teste', 'modelo', resolverModeloLocal('qwen3.5-9b-q4'), 'cpu', undefined,
        new AbortController().signal, 32768);
    expect(tentativas).toEqual([0, 32768]);
    expect(motor.estado.contexto).toBe(32768);
    motor.parar();
});
