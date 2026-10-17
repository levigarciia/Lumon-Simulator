import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Escritorio } from '../electron/services/escritorio';
import { Persistencia } from '../electron/services/persistencia';
import { estadoInicial } from '../shared/estado';
import type { Funcionario } from '../shared/funcionarios';
import { falasDoChat } from '../shared/geral';
import { formatarPrazo, gerarArquivo } from '../shared/refinamento';

test('limpeza arquiva recados e propostas, preserva manutenção ativa e permite consultar o passado pelo MCP', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-historico-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    const ana = randomUUID();
    const bia = randomUUID();
    const gepeto = randomUUID();
    estado.funcionarios = ['Ana', 'Bia', 'Gepeto'].map((nome, indice): Funcionario => ({
        id: [ana, bia, gepeto][indice]!, nome, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
    }));
    estado.social.eventos = [{
        id: 'avaria', sequencia: 1, tipo: 'comunicado', autorId: 'diretoria', alvoId: bia,
        texto: 'O terminal de Bia apresentou avaria. Aguarde a manutenção.',
        alcance: 'publico', ouvintes: [], fontes: [], criadoEm: new Date().toISOString(),
    }];
    estado.social.sequencia = 1;
    const escritorio = new Escritorio(estado, (novo) => persistencia.salvar(novo), () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    const cliente = new Client({ name: 'historico', version: '1' });
    let reaberto: Escritorio | undefined;
    try {
        const social = escritorio['social'];
        const visita = social.registrar({ tipo: 'comunicado', autorId: 'diretoria', alcance: 'publico',
            ouvintes: [], fontes: [], texto: 'Uma comitiva da Diretoria visitou o departamento.' }, false);
        const proposta = social.registrar({ tipo: 'proposta', autorId: ana, alvoId: gepeto,
            alcance: 'reservado', ouvintes: [ana], fontes: [], texto: 'Sugiro a demissão de Gepeto.' }, false);
        social.registrar({ tipo: 'reservado', autorId: ana, alvoId: gepeto, alcance: 'reservado',
            ouvintes: [ana, gepeto], fontes: [], texto: 'Meu segredo reservado.' }, false);
        expect(escritorio.demitir(gepeto, 'Desrespeito à liderança.').ok).toBe(true);
        escritorio.atualizarPensamento(bia, 'Primeiro pensei em descansar.');
        escritorio.atualizarPensamento(bia, 'Depois quis conversar com Ana.');
        escritorio.atualizarPensamento(bia, 'Agora prefiro observar a sala.');
        escritorio.atualizarPensamento(ana, 'Segredo íntimo de Ana.');
        expect(escritorio.limparGeral().ok).toBe(true);
        const atual = escritorio.publico();
        expect(falasDoChat(escritorio.mensagensGeral(), atual.social.eventos).map((fala) => fala.id))
            .toEqual(['avaria']);
        expect(atual.social.historico.map((evento) => evento.id)).toContain(visita.id);
        expect(atual.social.historico.map((evento) => evento.id)).toContain(proposta.id);
        expect(escritorio['contextoGeral'](bia)).not.toContain(visita.texto);
        expect(escritorio['contextoGeral'](bia)).not.toContain(proposta.texto);
        await persistencia.descarregar();
        escritorio.encerrar();
        const salvo = await persistencia.carregar();
        expect(salvo.social.historico.map((evento) => evento.id)).toContain(visita.id);
        reaberto = new Escritorio(salvo, () => {}, () => {}, pasta);
        await cliente.connect(new StreamableHTTPClientTransport(new URL(await reaberto['mcp'].urlDe(bia, 'geral'))));
        const ferramentas = await cliente.listTools();
        expect(ferramentas.tools.some((ferramenta) => ferramenta.name === 'consultar')).toBe(true);
        expect(ferramentas.tools.some((ferramenta) => ferramenta.name === 'consultar_historico')).toBe(false);
        const consultar = async (argumentos: Record<string, unknown>) => JSON.stringify(await cliente.callTool({
            name: 'consultar', arguments: argumentos,
        }));
        const passado = await consultar({});
        expect(passado).toContain('Gepeto foi demitido');
        expect(passado).toContain('Desrespeito à liderança');
        expect(passado).not.toContain('Sugiro a demissão');
        expect(passado).not.toContain('Meu segredo');
        expect(passado).not.toContain('impactosRelacao');
        const pensamentos = JSON.parse(reaberto['social'].consultarHistorico(bia, '', undefined, 1,
            { categoria: 'pensamentos' }));
        expect(pensamentos.total).toBe(3);
        expect(pensamentos.proximoDeslocamento).toBe(1);
        expect(pensamentos.registros[0].resumo).toBe('Agora prefiro observar a sala.');
        const paginaAnterior = JSON.parse(reaberto['social'].consultarHistorico(bia, '', undefined, 1,
            { categoria: 'pensamentos', deslocamento: 1 }));
        expect(paginaAnterior.registros[0].resumo).toBe('Depois quis conversar com Ana.');
        expect(await consultar({ categoria: 'pensamentos', busca: 'descansar' }))
            .toContain('Primeiro pensei em descansar.');
        expect(await consultar({ categoria: 'pensamentos', funcionario: 'Ana' }))
            .toContain('Você só pode consultar seus próprios pensamentos privados');
        expect(await consultar({ categoria: 'pensamentos' })).not.toContain('Segredo íntimo');
        const pesquisado = await cliente.callTool({ name: 'consultar', arguments: { busca: 'comitiva' } });
        expect(pesquisado.structuredContent).toMatchObject({ terminal: false });
        const paginada = JSON.parse(reaberto['social'].consultarHistorico(bia, '', undefined, 1));
        expect(paginada.registros).toHaveLength(1);
        expect(paginada.proximoDeslocamento).toBe(1);
        const demissoes = JSON.parse(reaberto['social'].consultarHistorico(bia, '', 'demissao', 1,
            { funcionario: 'Gepeto', desde: '2020-01-01T00:00:00Z', ate: '2099-01-01T00:00:00Z' }));
        expect(demissoes.total).toBe(1);
        expect(demissoes.registros[0].resumo).toContain('Gepeto foi demitido');
        const recados = await consultar({ busca: 'comitiva', tipo: 'comunicado', limite: 1 });
        expect(recados).toContain(visita.texto);
        expect(recados).not.toContain('Gepeto foi demitido');
        expect(await consultar({ limite: 31 })).toContain('isError');
        expect(reaberto['social'].consultarHistorico(ana, '', 'proposta')).toContain(proposta.texto);
        expect(reaberto['agenda'].avariado(bia)).toBe(true);
        reaberto['agenda']['avarias'].set(bia, Date.now() - 1);
        const arquivo = gerarArquivo(42, new Date(Date.now() + 60000));
        reaberto['estado'].refinamentos[arquivo.id] = arquivo;
        reaberto['estado'].trabalhos.push({ id: 'trabalho', pedidoId: 'pedido', funcionarioId: ana,
            nome: arquivo.nome, projetoId: 'macrodados', tarefa: 'Refinar.', resultado: '', estado: 'trabalhando',
            criadoEm: new Date().toISOString(), arquivoId: arquivo.id });
        const avisoArquivo = reaberto['social'].registrar({ tipo: 'comunicado', autorId: 'diretoria',
            texto: `A Diretoria entregou o arquivo ${arquivo.nome} para refinamento no Work. Prazo: ${formatarPrazo(arquivo)}.`,
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        expect(reaberto.limparGeral().ok).toBe(true);
        expect(falasDoChat([], reaberto.publico().social.eventos).map((fala) => fala.id)).toEqual([avisoArquivo.id]);
        reaberto['estado'].trabalhos[0]!.estado = 'concluido';
        expect(reaberto.limparGeral().ok).toBe(true);
        expect(falasDoChat([], reaberto.publico().social.eventos)).toEqual([]);
        expect(reaberto['social'].consultarHistorico(bia, 'terminal')).toContain('apresentou avaria');
    } finally {
        await cliente.close();
        reaberto?.encerrar();
        escritorio.encerrar();
        await persistencia.descarregar();
        await rm(pasta, { recursive: true, force: true });
    }
});

