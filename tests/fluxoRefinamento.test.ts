import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Escritorio } from '../electron/services/escritorio';
import { criarSessaoLocal } from '../electron/services/harness/local';
import type { MotorLocal } from '../electron/services/motor';
import { estadoInicial, esquemaEstado } from '../shared/estado';
import { progressoRefinamento } from '../shared/refinamento';
import type { Funcionario } from '../shared/funcionarios';
import { recuperarPeriodosRefinamento, encontrarArquivoDisponivel } from '../shared/fluxoRefinamento';
import { gerarArquivo } from '../shared/refinamento';
import type { RegistroTrabalho } from '../shared/trabalho';

const ana = '11111111-1111-4111-8111-111111111111';
const bia = '22222222-2222-4222-8222-222222222222';

async function preparar(nomes = ['Ana', 'Bia']) {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-fluxo-work-'));
    const estado = estadoInicial();
    estado.funcionarios = nomes.map((nome, indice): Funcionario => ({
        id: indice === 0 ? ana : indice === 1 ? bia : randomUUID(),
        nome, cargo: indice === 0 ? 'lider' : 'refinador', mesaId: `mesa${indice}`,
        contratadoEm: new Date().toISOString(), autonomia: false,
        modelo: { provedor: 'local', id: 'teste', nome: 'Teste' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    escritorio['agenda']['registro'].sortear = () => 0;
    escritorio['orquestracao']['prazos'] = { ...escritorio['orquestracao']['prazos'], toleranciaMs: 5 };
    return { escritorio, pasta };
}

async function aguardar(condicao: () => boolean) {
    for (let tentativa = 0; tentativa < 200 && !condicao(); tentativa++) await Bun.sleep(5);
    expect(condicao()).toBe(true);
}

async function conectar(escritorio: Escritorio, id: string, origem: 'geral' | 'trabalho') {
    const cliente = new Client({ name: 'fluxo-work', version: '1' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(await escritorio['mcp'].urlDe(id, origem))));
    return cliente;
}

test('participantes refinam pelo MCP sem consumir tentativas em conflitos com envios dos colegas', async () => {
    const { escritorio } = await preparar();
    const liberar = Promise.withResolvers<void>();
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
            await liberar.promise;
        }, encerrar: () => {},
    });
    const clientes = await Promise.all([conectar(escritorio, ana, 'trabalho'), conectar(escritorio, bia, 'trabalho')]);
    try {
        escritorio['agenda'].verificar();
        for (const id of [ana, bia]) {
            expect(escritorio['irParaWork'](id, 'geral').erro).toBe(false);
            escritorio['geral']['registro'].aoEncerrarTurno?.(id, false);
        }
        await aguardar(() => !!escritorio['arquivoAtivo'](ana) && !!escritorio['arquivoAtivo'](bia));
        const arquivo = escritorio['arquivoAtivo'](ana)!;
        const primeiro = arquivo.grupos[0]!;
        const respostas = await Promise.all(clientes.map((cliente) => cliente.callTool({ name: 'refinar',
            arguments: { celulas: primeiro.celulas, temperamento: primeiro.temperamento } })));
        expect(respostas.every((resposta) => !resposta.isError)).toBe(true);
        expect(respostas.filter((resposta) => JSON.stringify(resposta.content).includes('Outro colega já refinou')))
            .toHaveLength(1);
        const vencedor = escritorio['arquivoAtivo'](ana)!.grupos[0]!.refinadoPor!;
        const outro = vencedor === ana ? bia : ana;
        const clienteOutro = clientes[outro === ana ? 0 : 1]!;
        for (let repeticao = 0; repeticao < 8; repeticao++) {
            const resposta = await clienteOutro.callTool({ name: 'refinar',
                arguments: { celulas: primeiro.celulas, temperamento: primeiro.temperamento } });
            expect(resposta.isError).toBe(false);
            expect(JSON.stringify(resposta.content)).toContain('Participantes ativos agora: Ana, Bia');
            expect(resposta.structuredContent).toMatchObject({ terminal: false });
        }
        expect(escritorio['arquivoAtivo'](outro)!.envios).toHaveLength(1);
        expect(escritorio['estadoEtapa'](outro).terminal).toBe(false);
        const segundo = arquivo.grupos[1]!;
        const resposta = await clienteOutro.callTool({ name: 'refinar',
            arguments: { celulas: segundo.celulas, temperamento: segundo.temperamento } });
        expect(resposta.isError).toBe(false);
        expect(JSON.stringify(resposta.content)).toContain('Progresso: 33%');
        expect(escritorio['arquivoAtivo'](outro)!.envios.map((envio) => envio.funcionarioId))
            .toEqual([vencedor, outro]);
        expect(escritorio.publico().trabalhos.every((item) => item.estado === 'trabalhando')).toBe(true);
        await clientes[0]!.callTool({ name: 'sair_do_work', arguments: { motivo: 'Vou conversar.' } });
        const consulta = await clientes[1]!.callTool({ name: 'abrir_arquivo', arguments: {} });
        expect(JSON.stringify(consulta.content)).toContain('Participantes ativos agora: Bia');
    } finally {
        liberar.resolve();
        await Promise.all(clientes.map((cliente) => cliente.close()));
        escritorio.encerrar();
    }
});

test('líder convoca todos os colegas livres pelo MCP sem duplicar períodos nem interromper seu trabalho', async () => {
    const { escritorio } = await preparar(['Ana', 'Bia', 'Caio']);
    const liberar = Promise.withResolvers<void>();
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
            await liberar.promise;
        }, encerrar: () => {},
    });
    const cliente = await conectar(escritorio, ana, 'trabalho');
    try {
        expect((await cliente.callTool({ name: 'invocar_pro_work', arguments: {} })).isError).toBe(true);
        expect(escritorio.iniciarRefinamento(5).ok).toBe(true);
        await aguardar(() => !!escritorio['arquivoAtivo'](ana));
        const resposta = await cliente.callTool({ name: 'invocar_pro_work', arguments: {} });
        expect(resposta.isError).toBe(false);
        expect(JSON.stringify(resposta.content)).toContain('Bia, Caio');
        await aguardar(() => escritorio.publico().trabalhos.length === 3);
        const trabalhos = escritorio.publico().trabalhos;
        expect(trabalhos.every((item) => item.estado === 'trabalhando')).toBe(true);
        expect(new Set(trabalhos.map((item) => item.arquivoId)).size).toBe(1);
        expect(new Set(trabalhos.map((item) => item.funcionarioId)).size).toBe(3);
        const repetida = await cliente.callTool({ name: 'invocar_pro_work', arguments: {} });
        expect(JSON.stringify(repetida.content)).toContain('Nenhum colega livre');
        expect(escritorio.publico().trabalhos).toHaveLength(3);
    } finally {
        liberar.resolve();
        await cliente.close();
        escritorio.encerrar();
    }
});

test('convocação respeita pausas e transferências e fica exclusiva ao líder no Work', async () => {
    const { escritorio } = await preparar(['Ana', 'Bia', 'Caio']);
    const liberar = Promise.withResolvers<void>();
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
            await liberar.promise;
        }, encerrar: () => {},
    });
    const lider = await conectar(escritorio, ana, 'trabalho');
    const colega = await conectar(escritorio, bia, 'trabalho');
    const social = await conectar(escritorio, ana, 'geral');
    try {
        expect((await colega.listTools()).tools.map((item) => item.name)).not.toContain('invocar_pro_work');
        expect((await social.listTools()).tools.map((item) => item.name)).not.toContain('invocar_pro_work');
        expect(escritorio['invocarProWork'](bia).erro).toBe(true);
        expect(escritorio.iniciarRefinamento(5).ok).toBe(true);
        await aguardar(() => !!escritorio['arquivoAtivo'](ana));
        const caio = escritorio.publico().funcionarios[2]!;
        escritorio['estado'].social.afastamentos[caio.id] = [ana];
        const emPausa = escritorio['simulacao'].emPausa.bind(escritorio['simulacao']);
        escritorio['simulacao'].emPausa = (id) => id === bia || emPausa(id);
        const resposta = await lider.callTool({ name: 'invocar_pro_work', arguments: {} });
        expect(JSON.stringify(resposta.content)).toContain('Nenhum colega livre');
        expect(escritorio.publico().trabalhos).toHaveLength(1);
        expect((await colega.callTool({ name: 'invocar_pro_work', arguments: {} })).isError).toBe(true);
    } finally {
        liberar.resolve();
        await Promise.all([lider.close(), colega.close(), social.close()]);
        escritorio.encerrar();
    }
});

test('decisão pelo MCP começa o Work somente depois de concluir o turno do Geral', async () => {
    const { escritorio } = await preparar();
    const cliente = await conectar(escritorio, bia, 'geral');
    const liberar = Promise.withResolvers<void>();
    let decidiu = false;
    let ferramentaConcluida = false;
    let iniciou = false;
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            expect(ferramentaConcluida).toBe(true);
            iniciou = true;
            sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
            await liberar.promise;
        }, encerrar: () => {},
    });
    try {
        expect(escritorio['agenda'].verificar()).toBe('entrega_arquivo');
        await Bun.sleep(30);
        expect(escritorio.publico().trabalhos).toHaveLength(0);
        escritorio['geral'].dispensar(bia);
        escritorio['geral']['abrirSessao'] = (pessoa) => ({
            enviar: async (_prompt, ouvinte) => {
                if (pessoa.id !== bia || decidiu) return;
                decidiu = true;
                ouvinte.iniciarFerramenta('entrada', 'ir_para_work');
                const resposta = await cliente.callTool({ name: 'ir_para_work', arguments: {} });
                expect(resposta.isError).toBe(false);
                expect(resposta.structuredContent).toMatchObject({ terminal: true });
                expect(iniciou).toBe(false);
                ouvinte.concluirFerramenta('entrada', false, JSON.stringify(resposta.structuredContent));
                ferramentaConcluida = true;
            }, encerrar: () => {},
        });
        escritorio.enviarGeral('@Bia escolha o que quer fazer agora.');
        await aguardar(() => iniciou);
        expect(escritorio.publico().trabalhos).toHaveLength(1);
        expect(escritorio.publico().trabalhos[0]).toMatchObject({ funcionarioId: bia, estado: 'trabalhando' });
        expect(escritorio.mensagensGeral().some((mensagem) => mensagem.autorId === 'sistema')).toBe(false);
        const repetida = await cliente.callTool({ name: 'ir_para_work', arguments: {} });
        expect(repetida.isError).toBe(true);
    } finally {
        liberar.resolve();
        await cliente.close();
        escritorio.encerrar();
    }
});

for (const simularChamada of [false, true]) {
    test(`Geral executa entrada e preserva fala com simulação textual inicial ${simularChamada}`, async () => {
        const { escritorio } = await preparar();
        let inferencias = 0;
        const liberar = Promise.withResolvers<void>();
        const texto = 'Entrarei no Work para continuar o refinamento.';
        const motor = { usar: async (_id: string, _sinal: AbortSignal,
            executar: (ativo: Pick<MotorLocal, 'estado' | 'completar'>) => Promise<unknown>) => executar({
            estado: { fase: 'pronto', detalhe: 'Teste', contexto: 32768 },
            completar: async () => {
                inferencias++;
                const simulada = simularChamada && inferencias === 1;
                const delta = simulada ? { content: `${texto}\n\nir_para_work\n{"arquivo":"Tumwater"}` }
                    : { content: texto, tool_calls: [{ index: 0, id: 'entrada', function: {
                        name: 'ir_para_work', arguments: '{}',
                    } }] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
            },
        }) } as Pick<MotorLocal, 'usar'>;
        escritorio['geral']['abrirSessao'] = (pessoa, configuracao) => pessoa.id === bia
            ? criarSessaoLocal(configuracao, motor) : { enviar: async () => {}, encerrar: () => {} };
        escritorio['expediente']['abrirSessao'] = () => ({
            enviar: async (_prompt, _ouvinte, sinal) => {
                sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
                await liberar.promise;
            }, encerrar: () => {},
        });
        try {
            escritorio['agenda'].verificar();
            escritorio.enviarGeral('@Bia oi');
            await aguardar(() => escritorio.publico().trabalhos.some((item) => item.funcionarioId === bia));
            const mensagens = escritorio.mensagensGeral().filter((item) => item.autorId === bia);
            expect(mensagens.filter((item) => !item.tipo).map((item) => item.texto)).toEqual([texto]);
            expect(mensagens.filter((item) => item.tipo === 'acao')).toHaveLength(1);
            expect(mensagens.find((item) => item.tipo === 'acao')?.ferramentas[0])
                .toMatchObject({ resumo: 'Escritório: ir_para_work', estado: 'concluida' });
            expect(escritorio.publico().trabalhos.find((item) => item.funcionarioId === bia)?.estado)
                .toBe('trabalhando');
            expect(inferencias).toBe(simularChamada ? 2 : 1);
        } finally {
            liberar.resolve();
            escritorio.encerrar();
        }
    });
}

test('fim do período preserva o arquivo e a retomada renova somente o contador da nova participação', async () => {
    const { escritorio, pasta } = await preparar();
    let reaberto: Escritorio | undefined;
    let periodos = 0;
    escritorio['orquestracao']['registro'].duracaoRefinamento = () => 0.001;
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            periodos++;
            const arquivo = escritorio['arquivoAtivo'](pessoa.id)!;
            const grupo = arquivo.grupos.find((item) => !item.refinadoPor)!;
            expect(escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento)).toContain('aceito');
            await new Promise<void>((resolver) => sinal.addEventListener('abort', () => resolver(), { once: true }));
        }, encerrar: () => {},
    });
    try {
        expect(escritorio.iniciarRefinamento(1).ok).toBe(true);
        await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'pausado');
        const primeiro = escritorio.publico().trabalhos[0]!;
        const arquivo = escritorio.publico().refinamentos[primeiro.arquivoId!]!;
        expect(progressoRefinamento(arquivo)).toBe(17);
        expect(primeiro.falhaTecnica).toBe(false);
        expect(escritorio.aprovarEntrega(primeiro.id).ok).toBe(false);
        expect(escritorio['agenda']['registro'].podeReceberArquivo?.()).toBe(false);
        escritorio['orquestracao']['registro'].duracaoRefinamento = () => 5;
        expect(escritorio['irParaWork'](ana, 'geral').erro).toBe(false);
        escritorio['geral']['registro'].aoEncerrarTurno?.(ana, false);
        await aguardar(() => periodos === 2);
        const segundo = escritorio.publico().trabalhos.at(-1)!;
        expect(segundo.arquivoId).toBe(primeiro.arquivoId);
        expect(Date.parse(segundo.prazo!)).toBeGreaterThan(Date.parse(primeiro.prazo!) + 60000);
        expect(Object.values(escritorio.publico().refinamentos)).toHaveLength(1);
        expect(escritorio.publico().refinamentos[arquivo.id]!.envios).toHaveLength(2);
        escritorio.interromperTrabalho();
        await aguardar(() => escritorio.publico().trabalhos.at(-1)?.estado === 'pausado');
        const salvo = esquemaEstado.parse(structuredClone(escritorio['estado']));
        reaberto = new Escritorio(salvo, () => {}, () => {}, pasta);
        expect(reaberto['arquivoDisponivel']()?.id).toBe(arquivo.id);
        expect(progressoRefinamento(reaberto['arquivoDisponivel']()!)).toBe(33);
        expect(reaberto.publico().trabalhos.some((item) => item.estado === 'trabalhando')).toBe(false);
    } finally {
        reaberto?.encerrar();
        escritorio.encerrar();
    }
});

test('saída voluntária impede novos envios, mantém o colega trabalhando e libera novo arquivo só em 100%', async () => {
    const { escritorio } = await preparar();
    const clientes = await Promise.all([ana, bia].map((id) => conectar(escritorio, id, 'trabalho')));
    const liberar = new Map<string, () => void>();
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            await new Promise<void>((resolver) => {
                liberar.set(pessoa.id, resolver);
                sinal.addEventListener('abort', () => resolver(), { once: true });
            });
        }, encerrar: () => {},
    });
    try {
        escritorio['agenda'].verificar();
        for (const id of [ana, bia]) {
            expect(escritorio['irParaWork'](id, 'geral').erro).toBe(false);
            escritorio['geral']['registro'].aoEncerrarTurno?.(id, false);
        }
        await aguardar(() => liberar.size === 2);
        const arquivo = escritorio['arquivoDisponivel']()!;
        const trabalhoBia = escritorio.publico().trabalhos.find((item) => item.funcionarioId === bia)!;
        const pausaRecusada = await clientes[0]!.callTool({ name: 'fazer_pausa',
            arguments: { atividade: 'cafe', minutos: 1 } });
        expect(pausaRecusada.isError).toBe(true);
        expect(escritorio['estadoEtapa'](ana).terminal).toBe(false);
        const saida = await clientes[0]!.callTool({ name: 'sair_do_work', arguments: { motivo: 'Quero conversar.' } });
        expect(saida.structuredContent).toMatchObject({ erro: false, terminal: true, codigo: 'saida_work' });
        const grupo = arquivo.grupos[0]!;
        expect((await clientes[0]!.callTool({ name: 'refinar', arguments: {
            celulas: grupo.celulas, temperamento: grupo.temperamento,
        } })).isError).toBe(true);
        liberar.get(ana)!();
        await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'pausado');
        expect(escritorio['contextoGeral'](ana)).toContain('Quero conversar.');
        expect(escritorio['contextoGeral'](bia)).not.toContain('Quero conversar.');
        expect(escritorio.publico().trabalhos.find((item) => item.id === trabalhoBia.id)?.estado).toBe('trabalhando');
        expect(escritorio.publico().trabalhos.find((item) => item.id === trabalhoBia.id)?.prazo)
            .toBe(trabalhoBia.prazo);
        for (const item of arquivo.grupos) {
            expect(escritorio['refinarArquivo'](bia, item.celulas, item.temperamento)).toContain('aceito');
        }
        liberar.get(bia)!();
        await aguardar(() => escritorio['orquestracao']['ativos'].size === 0);
        expect(escritorio.publico().trabalhos.find((item) => item.id === trabalhoBia.id)?.avaliacao?.estado)
            .toBe('aguardando_aprovacao');
        expect(escritorio.aprovarEntrega(trabalhoBia.id).ok).toBe(true);
        escritorio['agenda']['ultimoEvento'] = 0;
        expect(escritorio['agenda'].verificar()).toBe('entrega_arquivo');
        expect(escritorio['arquivoDisponivel']()?.id).not.toBe(arquivo.id);
        expect(escritorio.publico().trabalhos.some((item) => item.estado === 'trabalhando')).toBe(false);
    } finally {
        for (const concluir of liberar.values()) concluir();
        await Promise.all(clientes.map((cliente) => cliente.close()));
        escritorio.encerrar();
    }
});

test('delegado conclui o arquivo depois do período do líder sem perder a entrega para avaliação', async () => {
    const { escritorio } = await preparar();
    const liberar = Promise.withResolvers<void>();
    let periodos = 0;
    escritorio['orquestracao']['registro'].duracaoRefinamento = () => ++periodos === 1 ? 0.001 : 5;
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            const arquivo = escritorio['arquivoAtivo'](pessoa.id)!;
            if (pessoa.id === ana) {
                for (const grupo of arquivo.grupos.slice(0, 5)) {
                    escritorio['refinarArquivo'](ana, grupo.celulas, grupo.temperamento);
                }
                const grupo = arquivo.grupos[5]!;
                await escritorio['orquestracao'].delegar(ana, bia, grupo.celulas.join(', '));
                return;
            }
            sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
            await liberar.promise;
            const grupo = arquivo.grupos[5]!;
            expect(escritorio['refinarArquivo'](bia, grupo.celulas, grupo.temperamento)).toContain('aceito');
        }, encerrar: () => {},
    });
    try {
        expect(escritorio.iniciarRefinamento(1).ok).toBe(true);
        await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'pausado');
        expect(escritorio.publico().trabalhos[1]?.estado).toBe('trabalhando');
        liberar.resolve();
        await aguardar(() => escritorio['orquestracao']['ativos'].size === 0);
        const principal = escritorio.publico().trabalhos[0]!;
        expect(principal.estado).toBe('concluido');
        expect(principal.avaliacao?.estado).toBe('aguardando_aprovacao');
        expect(escritorio.aprovarEntrega(principal.id).ok).toBe(true);
        expect(escritorio.publico().cota.grupos).toBe(6);
    } finally {
        liberar.resolve();
        escritorio.encerrar();
    }
});

test('pausa real iniciada no Work libera a execução e mantém o corpo descansando', async () => {
    const { escritorio } = await preparar();
    escritorio['estado'].sala.itens.push({ id: 'cafe', tipo: 'aparador_cafe',
        celula: { x: 12, z: 0 }, rotacao: 0 });
    const cliente = await conectar(escritorio, ana, 'trabalho');
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async () => {
            const resposta = await cliente.callTool({ name: 'fazer_pausa',
                arguments: { atividade: 'cafe', minutos: 1 } });
            expect(resposta.structuredContent).toMatchObject({ erro: false, terminal: true, codigo: 'pausa_iniciada' });
        }, encerrar: () => {},
    });
    try {
        expect(escritorio.iniciarRefinamento(1).ok).toBe(true);
        await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'pausado');
        expect(escritorio['simulacao'].emPausaNoItem(ana)).toBe(true);
        expect(escritorio.publico().status[ana]).toBe('em_pausa');
        expect(escritorio['irParaWork'](ana, 'geral').erro).toBe(true);
        expect(escritorio['arquivoDisponivel']()).toBeDefined();
    } finally {
        await cliente.close();
        escritorio.encerrar();
    }
});

for (const limite of ['prazo', 'selecoes'] as const) {
    for (const acao of ['sair_do_work', 'fazer_pausa'] as const) {
        test(`${acao} libera a participação após esgotar ${limite}`, async () => {
            const { escritorio } = await preparar();
            escritorio['estado'].sala.itens.push({ id: 'cafe', tipo: 'aparador_cafe',
                celula: { x: 12, z: 0 }, rotacao: 0 });
            const cliente = await conectar(escritorio, ana, 'trabalho');
            const liberar = Promise.withResolvers<void>();
            escritorio['expediente']['abrirSessao'] = () => ({
                enviar: async (_prompt, _ouvinte, sinal) => {
                    sinal.addEventListener('abort', () => liberar.resolve(), { once: true });
                    await liberar.promise;
                }, encerrar: () => {},
            });
            try {
                expect(escritorio.iniciarRefinamento(1).ok).toBe(true);
                await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'trabalhando');
                const trabalho = escritorio['estado'].trabalhos[0]!;
                const arquivoId = trabalho.arquivoId!;
                if (limite === 'prazo') trabalho.prazo = new Date(0).toISOString();
                else {
                    for (let tentativa = 0; tentativa < 20 && !escritorio['estadoEtapa'](ana).terminal; tentativa++) {
                        escritorio['refinarArquivo'](ana, ['A1', 'A2', 'A3'], 'alegria');
                    }
                }
                expect(escritorio['estadoEtapa'](ana)).toMatchObject({ terminal: true,
                    codigo: limite === 'prazo' ? 'periodo_encerrado' : 'tentativas_esgotadas' });
                const nomes = (await cliente.listTools()).tools.map((item) => item.name);
                expect(nomes).toContain(acao);
                expect(nomes).not.toContain('delegar');
                const grupo = escritorio['arquivoAtivo'](ana)!.grupos[0]!;
                const envio = await cliente.callTool({ name: 'refinar',
                    arguments: { celulas: grupo.celulas, temperamento: grupo.temperamento } });
                expect(envio.isError).toBe(true);
                const envios = escritorio['estado'].refinamentos[arquivoId]!.envios.length;
                const resposta = await cliente.callTool({ name: acao, arguments: acao === 'sair_do_work'
                    ? { motivo: 'Etapa esgotada. Vou conversar.' } : { atividade: 'cafe', minutos: 1 } });
                expect(resposta.structuredContent).toMatchObject({ erro: false, terminal: true,
                    codigo: acao === 'sair_do_work' ? 'saida_work' : 'pausa_iniciada' });
                liberar.resolve();
                await aguardar(() => escritorio.publico().trabalhos[0]?.estado === 'pausado');
                expect(escritorio['orquestracao'].saindo(ana)).toBe(false);
                expect(escritorio['arquivoDisponivel']()?.id).toBe(arquivoId);
                expect(escritorio['estado'].refinamentos[arquivoId]!.envios).toHaveLength(envios);
                expect(escritorio['simulacao'].emPausaNoItem(ana)).toBe(acao === 'fazer_pausa');
            } finally {
                liberar.resolve();
                await cliente.close();
                escritorio.encerrar();
            }
        });
    }
}

test('entregas parciais antigas voltam a pendentes sem reabrir arquivos já aprovados', () => {
    const arquivo = gerarArquivo(10, new Date(0));
    const trabalho: RegistroTrabalho = {
        id: 'antigo', pedidoId: 'pedido', funcionarioId: ana, nome: 'Ana', projetoId: 'projeto',
        tarefa: 'Arquivo antigo', resultado: '', estado: 'concluido', criadoEm: '', arquivoId: arquivo.id,
        avaliacao: { estado: 'aguardando_aprovacao', recompensa: 0 },
    };
    const arquivos = { [arquivo.id]: arquivo };
    const recuperados = recuperarPeriodosRefinamento([trabalho], arquivos);
    expect(recuperados[0]).toMatchObject({ estado: 'pausado', avaliacao: { estado: 'pendente' } });
    expect(encontrarArquivoDisponivel(arquivos, recuperados)?.id).toBe(arquivo.id);
    const aprovado = { ...trabalho, avaliacao: { estado: 'aprovada' as const, recompensa: 8 } };
    expect(recuperarPeriodosRefinamento([aprovado], arquivos)[0]).toEqual(aprovado);
    expect(encontrarArquivoDisponivel(arquivos, [aprovado])).toBeUndefined();
});
