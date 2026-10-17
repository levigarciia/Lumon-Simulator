import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServidorMcp } from '../electron/services/mcp';
import { Escritorio } from '../electron/services/escritorio';
import { CanalGeral } from '../electron/services/geral';
import type { Funcionario } from '../shared/funcionarios';
import type { MensagemGeral } from '../shared/geral';
import { Persistencia } from '../electron/services/persistencia';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function conectar(url: string) {
    const cliente = new Client({ name: 'validacao-lumon', version: '1.0' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
    return cliente;
}

test('MCP identifica o autor do pensamento e restringe delegação à origem de trabalho', async () => {
    const pensamentos: string[] = [];
    const falas: string[] = [];
    const delegacoes: string[] = [];
    const servidor = new ServidorMcp({
        verEscritorio: () => 'Equipe', fazerPausa: async () => 'Voltou',
        falarNoGeral: (id, mensagem) => { falas.push(`${id}: ${mensagem}`); return 'Enviado'; },
        atualizarPensamento: (id, texto) => { pensamentos.push(`${id}: ${texto}`); return 'Salvo'; },
        delegar: async (id, destino, tarefa) => { delegacoes.push(`${id}: ${destino}: ${tarefa}`); return 'Concluído'; },
    });
    const geral = await conectar(await servidor.urlDe('pessoa', 'geral'));
    const social = await conectar(await servidor.urlDe('pessoa', 'chat'));
    const trabalho = await conectar(await servidor.urlDe('lider', 'trabalho'));
    try {
        expect((await geral.listTools()).tools.some((item) => item.name === 'falar_no_geral')).toBe(false);
        const ferramentas = await social.listTools();
        expect(ferramentas.tools.some((item) => item.name === 'atualizar_pensamento')).toBe(true);
        expect(ferramentas.tools.some((item) => item.name === 'falar_no_geral')).toBe(true);
        expect(ferramentas.tools.some((item) => item.name === 'delegar')).toBe(false);
        await social.callTool({ name: 'atualizar_pensamento', arguments: { pensamento: 'Estou gostando do projeto.' } });
        expect(pensamentos).toEqual(['pessoa: Estou gostando do projeto.']);
        expect(falas).toEqual([]);
        await social.callTool({ name: 'falar_no_geral', arguments: { mensagem: 'Bom dia, equipe.' } });
        expect(falas).toEqual(['pessoa: Bom dia, equipe.']);
        const invalido = await social.callTool({ name: 'atualizar_pensamento', arguments: { pensamento: '' } });
        expect(invalido.isError).toBe(true);
        expect(pensamentos).toHaveLength(1);
        await trabalho.callTool({ name: 'delegar', arguments: { funcionario: 'pessoa', tarefa: 'Revisar arquivo' } });
        expect(delegacoes).toEqual(['lider: pessoa: Revisar arquivo']);
    } finally {
        await geral.close();
        await social.close();
        await trabalho.close();
        servidor.encerrar();
    }
});

test('pensamento sobrevive à persistência e estados antigos recebem os campos novos', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-pensamento-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    const { pensamentos: _pensamentos, trabalhos: _trabalhos, ...antigo } = estado;
    expect(esquemaEstado.parse(antigo).pensamentos).toEqual({});
    expect(esquemaEstado.parse(antigo).trabalhos).toEqual([]);
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 }];
    estado.funcionarios = [{
        id: '11111111-1111-4111-8111-111111111111', nome: 'Mark', cargo: 'lider', mesaId: 'mesa',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' }, autonomia: false,
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        contratadoEm: new Date().toISOString(),
    }];
    estado.sala.itens.push({ id: 'mesa_colega', tipo: 'mesa', celula: { x: 3, z: 5 }, rotacao: 0 });
    const colegaId = '22222222-2222-4222-8222-222222222222';
    estado.funcionarios.push({ ...estado.funcionarios[0]!, id: colegaId, nome: 'Roberto', mesaId: 'mesa_colega' });
    const escritorio = new Escritorio(estado, (novo) => persistencia.salvar(novo), () => {}, pasta);
    try {
        const id = estado.funcionarios[0]!.id;
        escritorio.atualizarPensamento(id, 'Estou animado com a equipe.');
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        expect(salvo.pensamentos[id]?.texto).toBe('Estou animado com a equipe.');
        expect(escritorio.publico().pensamentos[id]?.atualizadoEm).toBeTruthy();
        expect(escritorio.mensagensGeral()).toEqual([]);
        for (const contexto of ['contextoGeral', 'contextoTurno', 'descreverEscritorio'] as const) {
            expect(escritorio[contexto](colegaId)).not.toContain('Estou animado com a equipe.');
        }
        expect(escritorio['contextoGeral'](id)).toContain('Estou animado com a equipe.');
        expect(escritorio['contextoTurno'](id)).toContain('Estou animado com a equipe.');
        expect(escritorio.atualizarPensamento('inexistente', 'Olá')).toBe('Funcionário não encontrado.');
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
    }
});

test('resposta normal do Geral é pública, persiste como fala e não vira pensamento', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-resposta-privada-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    const id = '11111111-1111-4111-8111-111111111111';
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 }];
    estado.funcionarios = [{
        id, nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' }, autonomia: false,
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        contratadoEm: new Date().toISOString(),
    }];
    estado.trabalhos = [{ id: 'antigo', pedidoId: 'pedido', funcionarioId: id, nome: 'Cláudio',
        projetoId: 'selene', tarefa: 'Auditar a Selene e seu roadmap.', resultado: 'Roadmap da Selene concluído.',
        estado: 'concluido', criadoEm: '' }];
    estado.conversas[id] = [{ id: 'respostaAntiga', autor: 'funcionario',
        texto: 'Auditoria da Selene finalizada.', ferramentas: [], criadaEm: '', projetoId: 'selene' }];
    estado.pensamentos[id] = { texto: 'Ainda devo cobrar o roadmap da Selene.', atualizadoEm: '' };
    const escritorio = new Escritorio(estado, (novo) => persistencia.salvar(novo), () => {}, pasta);
    escritorio['social'].registrar({ tipo: 'entrega', autorId: id, trabalhoId: 'antigo',
        texto: 'Roadmap da Selene concluído.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    escritorio['social'].registrar({ tipo: 'fala', autorId: id,
        texto: 'A auditoria da Selene segue em andamento.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    escritorio['social'].contexto(id, 'social');
    escritorio['social'].confirmarLeitura(id, 'social');
    expect(escritorio['contextoGeral'](id)).toContain(
        'Seu último pensamento privado, só contexto: Ainda devo cobrar o roadmap da Selene.',
    );
    expect(escritorio['contextoGeral'](id)).not.toContain('Roadmap da Selene concluído.');
    expect(escritorio['contextoGeral'](id)).not.toContain('A auditoria da Selene segue em andamento.');
    expect(escritorio['descreverEscritorio'](id)).not.toContain('Selene');
    expect(escritorio['contextoTurno'](id)).toContain('Selene');
    const pensamentoAnterior = structuredClone(estado.pensamentos[id]);
    const cliente = await conectar(await escritorio['mcp'].urlDe(id, 'geral'));
    try {
        const consulta = JSON.stringify(await cliente.callTool({ name: 'ver_escritorio', arguments: {} }));
        expect(consulta).not.toContain('Selene');
        expect(consulta).not.toContain('Memória recente');
        expect(consulta).not.toContain('Pode cobrar, contestar');
        expect(consulta).toContain('sentado à mesa');
        expect(consulta).toContain(`Cláudio [ID ${id}], livre`);
        expect(consulta).toContain('exclusivamente refinamento de Macrodados');
        expect(consulta).not.toContain('Projetos cadastrados:');
    } finally { await cliente.close(); }
    const texto = 'Estou aqui, relaxa. Vou sentir falta da máquina, mas está tudo bem.';
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => { ouvinte.texto(texto); }, encerrar: () => {},
    });
    try {
        expect(escritorio.enviarGeral('@claudio ta ai?').ok).toBe(true);
        for (let passo = 0; passo < 100 && escritorio.mensagensGeral().length < 2; passo++) await Bun.sleep(5);
        expect(escritorio.publico().pensamentos[id]).toEqual(pensamentoAnterior);
        expect(escritorio.mensagensGeral().at(-1)).toMatchObject({
            autorId: id, texto,
        });
        await persistencia.descarregar();
        expect((await persistencia.carregar()).pensamentos[id]).toEqual(pensamentoAnterior);
        expect((await persistencia.carregar()).geral.at(-1)?.tipo).toBeUndefined();
        expect((await persistencia.carregar()).social.eventos.filter(evento =>
            evento.tipo === 'fala' && evento.autorId === id && evento.texto === texto)).toHaveLength(1);
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
    }
});

test('turnos que só registram pensamentos não publicam falas e encerram a conversa livre', async () => {
    const pessoa: Funcionario = {
        id: 'claudio', nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' }, autonomia: false,
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        contratadoEm: new Date().toISOString(),
    };
    const equipe = [pessoa, { ...pessoa, id: 'roberto', nome: 'Roberto' }];
    let mensagens: MensagemGeral[] = [];
    const recebidos: { id: string; prompt: string }[] = [];
    let canal: CanalGeral;
    canal = new CanalGeral({
        funcionarios: () => equipe,
        mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; },
        contexto: () => '',
        urlMcp: async () => 'http://127.0.0.1',
        pasta: '.',
        emitirMensagens: () => {},
        emitirEstado: () => {},
    }, (funcionario) => ({
        enviar: async (prompt, ouvinte) => {
            recebidos.push({ id: funcionario.id, prompt });
            ouvinte.texto('Minha primeira impressão do Roberto foi ruim.');
            ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio');
            ouvinte.concluirFerramenta('consulta', false);
            ouvinte.iniciarFerramenta('pensamento', 'Escritório: atualizar_pensamento');
            ouvinte.concluirFerramenta('pensamento', false);
            ouvinte.texto('(silêncio)');
            if (recebidos.length === 1) canal.falarDoAgente(funcionario.id, 'Bom dia, equipe.');
        },
        encerrar: () => {},
    }));
    try {
        canal.alternarConversaLivre(true);
        await Bun.sleep(10);
        expect(canal.situacao().conversaLivre).toBe(false);
        expect(recebidos.length).toBe(4);
        expect(mensagens.filter((mensagem) => mensagem.autorId !== 'sistema'
            && !mensagem.tipo)).toEqual([
            expect.objectContaining({ autorId: 'claudio', texto: 'Bom dia, equipe.', ferramentas: [] }),
        ]);
        const roberto = recebidos.find((item) => item.id === 'roberto')!.prompt;
        expect(roberto).toContain('Cláudio: Bom dia, equipe.');
        expect(mensagens.filter((mensagem) => mensagem.tipo === 'pensamento')).toHaveLength(0);
        expect(mensagens.filter((mensagem) => mensagem.tipo === 'acao')).toHaveLength(8);
        expect(JSON.stringify(recebidos)).not.toContain('impressão');
    } finally {
        canal.encerrar();
    }
});
