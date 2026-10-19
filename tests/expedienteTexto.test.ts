import { expect, test } from 'bun:test';
import { Expediente } from '../electron/services/expediente';
import type { Funcionario, Mensagem } from '../shared/funcionarios';
import type { OuvinteTurno } from '../electron/services/harness/tipos';

const kim: Funcionario = {
    id: 'kim', nome: 'Kim', cargo: 'estagiario', mesaId: 'mesa', autonomia: false,
    modelo: { provedor: 'local', id: 'qwen3.5-9b-q4', nome: 'Qwen3.5 9B' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    contratadoEm: new Date().toISOString(),
};

test.each([
    { nome: 'descarta a promessa provisória da Kim', previas: ['Diretoria, agradeço a confiança. Vou', ''],
        final: '' },
    { nome: 'substitui uma prévia e continua a resposta', previas: ['Vou refinar.', 'Agradeço.', 'Agradeço. Estou pronta.'],
        final: 'Agradeço. Estou pronta.' },
    { nome: 'retira espaços da confirmação', previas: ['Obrigada.  ', 'Obrigada.'], final: 'Obrigada.' },
    { nome: 'encurta a resposta antes de continuar', previas: ['Obrigada. Vou', 'Obrigada.', 'Obrigada. Estou pronta.'],
        final: 'Obrigada. Estou pronta.' },
])('$nome', async ({ previas, final }) => {
    const mensagens = await executarConversa((ouvinte) => {
        for (const previa of previas) ouvinte.texto(previa);
    });
    const resposta = mensagens.at(-1)!;
    expect(resposta.erro).toBeUndefined();
    expect(resposta.texto).toBe(final);
    expect(resposta.partes?.flatMap((parte) => parte.tipo === 'texto' ? [parte.texto] : []).join('')).toBe(final);
    expect(resposta.partes?.some((parte) => parte.tipo === 'texto' && !parte.texto)).toBe(false);
});

test('revisões preservam ferramentas e a ordem dos trechos confirmados', async () => {
    const mensagens = await executarConversa((ouvinte) => {
        ouvinte.texto('Obrigada.');
        ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio', '{}');
        ouvinte.concluirFerramenta('consulta', false, 'Consulta concluída.');
        ouvinte.texto('Obrigada. Vou refinar.');
        ouvinte.texto('Obrigada.');
        ouvinte.texto('Obrigada. Estou pronta.');
    });
    expect(mensagens.at(-1)).toMatchObject({
        texto: 'Obrigada. Estou pronta.',
        partes: [
            { tipo: 'texto', texto: 'Obrigada.' },
            { tipo: 'ferramenta', ferramenta: { id: 'consulta', estado: 'concluida', saida: 'Consulta concluída.' } },
            { tipo: 'texto', texto: ' Estou pronta.' },
        ],
    });
});

test('descarte completo preserva ferramentas e publica a nova fala depois delas', async () => {
    const mensagens = await executarConversa((ouvinte) => {
        ouvinte.texto('Vou consultar.');
        ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio');
        ouvinte.concluirFerramenta('consulta', false);
        ouvinte.texto('Vou consultar. Consulta pronta.');
        ouvinte.texto('');
        ouvinte.texto('Estou pronta.');
    });
    expect(mensagens.at(-1)?.partes).toMatchObject([
        { tipo: 'ferramenta', ferramenta: { id: 'consulta', estado: 'concluida' } },
        { tipo: 'texto', texto: 'Estou pronta.' },
    ]);
});

async function executarConversa(responder: (ouvinte: OuvinteTurno) => void): Promise<Mensagem[]> {
    let mensagens: Mensagem[] = [];
    const expediente = new Expediente({
        conversa: () => mensagens, gravarConversa: (_id, novas) => { mensagens = novas; },
        emitirConversa: () => {}, emitirEstado: () => {}, acontecer: () => {}, pastaConversa: '.',
        contextoTurno: () => '', urlMcp: async () => 'http://127.0.0.1',
    }, () => ({ enviar: async (_prompt, ouvinte) => responder(ouvinte), encerrar: () => {} }));
    try {
        expect(expediente.enviar(kim, undefined, 'Parabéns, Kim.').ok).toBe(true);
        for (let passo = 0; passo < 100 && expediente.emConversa(kim.id); passo++) await Promise.resolve();
        expect(expediente.statusDe(kim.id)).toBe('ocioso');
        return mensagens;
    } finally {
        expediente.dispensar(kim.id);
    }
}
