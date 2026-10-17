import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MotorLocal } from '../electron/services/motor';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { estimarContextoLocal, prepararContextoLocal,
    type MensagemLocal } from '../electron/services/harness/contextoLocal';
import { ServidorMcp } from '../electron/services/mcp';
import type { OuvinteTurno } from '../electron/services/harness/tipos';

const raiz = join(process.env.APPDATA ?? homedir(), 'Lumon');
const modelo = 'qwen3.5-9b-q4';
const eventos: unknown[] = [];
let ultimaFase = '';
const motor = new MotorLocal(raiz, (estado) => {
    if (estado.detalhe.startsWith('ROCm indisponível')) console.log(estado.detalhe);
    if (estado.fase !== ultimaFase) {
        ultimaFase = estado.fase;
        console.log(`${estado.fase}: ${estado.detalhe}`);
        eventos.push({ ...estado });
    }
});
let consultas = 0;
const marcador = `LUMON_${randomUUID().slice(0, 8)}`;
const mcp = new ServidorMcp({
    verEscritorio: () => { consultas++; return `Código de validação do escritório: ${marcador}`; },
    fazerPausa: async () => 'Pausa concluída.', falarNoGeral: () => 'Publicado.',
    atualizarPensamento: () => 'Pensamento salvo.', delegar: async () => 'Delegação concluída.',
});
const ouvinte: OuvinteTurno = {
    texto: () => {}, iniciarFerramenta: (_id, resumo) => console.log(`Ferramenta: ${resumo}`),
    concluirFerramenta: () => {}, aprovar: async () => false,
};

try {
    const configuracao = {
        modelo, pasta: process.cwd(), autonomia: false, modo: 'conversa' as const,
        instrucoes: 'Você é um funcionário da Lumon. Use as ferramentas solicitadas e responda em português.',
        mcpUrl: await mcp.urlDe(randomUUID(), 'geral'),
    };
    const sessao = criarSessaoLocal(configuracao, motor);
    let resposta = '';
    await sessao.enviar('Consulte o escritório usando ver_escritorio. Qual foi a informação retornada?',
        { ...ouvinte, texto: (texto) => { resposta = texto; } }, AbortSignal.timeout(300000));
    if (!consultas || !resposta.includes(marcador)) {
        throw new Error(`A chamada real do MCP não foi confirmada. Consultas: ${consultas}. Resposta: ${resposta}`);
    }
    const estado = { ...motor.estado };
    if (estado.backend !== 'rocm') throw new Error(`Backend inesperado: ${estado.backend}.`);
    const contexto: MensagemLocal[] = [
        { role: 'system', content: 'Responda em português. Use apenas informações do histórico.' },
        { role: 'user', content: 'Guarde o código de validação do escritório.' },
        { role: 'assistant', content: `O código do escritório é ${marcador}. `.repeat(800) },
        { role: 'user', content: 'Qual é o código do escritório? Responda somente com o código.' },
    ];
    const tokensAntes = estimarContextoLocal(contexto);
    let blocosResumo = 0;
    let respostaCompactada = '';
    await motor.usar(modelo, AbortSignal.timeout(300000), async (ativo) => {
        const sinal = AbortSignal.timeout(300000);
        await prepararContextoLocal(contexto, [], ativo.estado.contexto!, async (corpo, sinalResumo) => {
            blocosResumo++;
            return ativo.completar(corpo, sinalResumo);
        }, sinal);
        const { lerRespostaLocal } = await import('../electron/services/harness/respostaLocal');
        const resultado = await lerRespostaLocal(await ativo.completar({
            messages: contexto, stream: true, max_tokens: 512,
            chat_template_kwargs: { enable_thinking: false },
        }, sinal), sinal, () => {});
        respostaCompactada = resultado.texto;
        if (resultado.motivo !== 'stop' || !respostaCompactada.includes(marcador)) {
            throw new Error('A resposta após compactação não preservou o código de validação.');
        }
    });
    const compactacao = { tokensAntes, tokensDepois: estimarContextoLocal(contexto),
        blocosResumo, resposta: respostaCompactada };
    if (!blocosResumo || compactacao.tokensDepois >= tokensAntes) {
        throw new Error('A compactação real não reduziu o histórico.');
    }
    const controle = new AbortController();
    let iniciou = false;
    let cancelou = false;
    try {
        await sessao.enviar('Escreva uma lista muito longa de números, de 1 até 10000.', {
            ...ouvinte, texto: () => { iniciou = true; controle.abort(new Error('Cancelamento de validação.')); },
        }, controle.signal);
    } catch {
        cancelou = controle.signal.aborted;
    }
    if (!iniciou || !cancelou) throw new Error('O cancelamento real da geração não foi confirmado.');
    let retomada = '';
    await sessao.enviar('Responda somente: retomado', {
        ...ouvinte, texto: (texto) => { retomada = texto; },
    }, AbortSignal.timeout(120000));
    if (!retomada.toLowerCase().includes('retomado')) throw new Error('O motor não retomou após o cancelamento.');
    sessao.encerrar();
    motor.parar();
    const relatorio = { modelo, estado, consultas, resposta, compactacao, cancelou, retomada,
        encerrado: motor.estado.fase === 'desligado', eventos };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/modelo-local-validacao.json', JSON.stringify(relatorio, null, 4));
    console.log(JSON.stringify(relatorio, null, 2));
} finally {
    motor.parar();
    mcp.encerrar();
}
