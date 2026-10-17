import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Escritorio } from '../electron/services/escritorio';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { estadoInicial, esquemaEstado } from '../shared/estado';
import { instrucoesFuncionario, nomeCargo, type Funcionario } from '../shared/funcionarios';
import { gerarArquivo, refinar } from '../shared/refinamento';
import { necessidadesIniciais } from '../shared/necessidades';
import { atividadeDepartamento } from '../shared/atividadeDepartamento';
import { ServidorMcp } from '../electron/services/mcp';

async function preparar() {
    const estado = estadoInicial();
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-transicao-'));
    estado.funcionarios = ['Helena', 'Pedro', 'Lia'].map((nome, indice): Funcionario => ({
        id: randomUUID(), nome, cargo: indice === 0 ? 'lider' : 'desenvolvedor', mesaId: `mesa${indice}`,
        modelo: { provedor: 'local', id: 'modelo', nome: 'Modelo' }, autonomia: true,
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        contratadoEm: new Date().toISOString(),
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 2 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    const [lider, colega, terceiro] = escritorio.publico().funcionarios;
    const social = escritorio['social'];
    const fonte = social.registrar({ tipo: 'fala', autorId: lider!.id, texto: 'Vamos cuidar da convivência.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    return { estado, escritorio, social, lider: lider!, colega: colega!, terceiro: terceiro!, fonte };
}

async function aguardar(condicao: () => boolean) {
    for (let passo = 0; passo < 100 && !condicao(); passo++) await Bun.sleep(5);
    expect(condicao()).toBe(true);
}

test('equipe ativa migra para refinadores e mantém nomes dos cargos históricos', async () => {
    const caso = await preparar();
    try {
        expect(caso.colega.cargo).toBe('refinador');
        expect(caso.colega.autonomia).toBe(false);
        expect(nomeCargo('desenvolvedor')).toBe('Desenvolvedor');
        expect(esquemaEstado.parse(caso.escritorio['estado']).funcionarios[1]?.cargo).toBe('refinador');
        for (const canal of ['conversa', 'work'] as const) {
            const instrucoes = instrucoesFuncionario(caso.colega, undefined, canal);
            expect(instrucoes).toContain('refinador');
            expect(instrucoes).not.toContain('escreve código limpo');
            expect(instrucoes).not.toContain('validação visual');
        }
    } finally { caso.escritorio.encerrar(); }
});

test('pedidos livres e projetos externos são recusados sem alterar o histórico', async () => {
    const caso = await preparar();
    try {
        const antes = structuredClone(caso.escritorio.publico());
        expect(caso.escritorio.adicionarProjeto(caso.escritorio['pastaGeral']).ok).toBe(false);
        expect(caso.escritorio.enviarTrabalho('externo', 'Edite o código').ok).toBe(false);
        expect(caso.escritorio.publico().projetos).toEqual(antes.projetos);
        expect(caso.escritorio.publico().trabalhos).toEqual(antes.trabalhos);
    } finally { caso.escritorio.encerrar(); }
});

test('catálogo MCP de cada provedor oferece ações da partida e mantém a avaliação fora do agente', async () => {
    const caso = await preparar();
    try {
        for (const provedor of ['local', 'claude', 'codex'] as const) {
            caso.escritorio['estado'].funcionarios[0]!.modelo.provedor = provedor;
            for (const origem of ['chat', 'geral', 'trabalho'] as const) {
                const cliente = new Client({ name: provedor, version: '1' });
                try {
                    const url = await caso.escritorio['mcp'].urlDe(caso.lider.id, origem);
                    await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
                    const nomes = (await cliente.listTools()).tools.map((item) => item.name);
                    expect(nomes).toContain('ver_escritorio');
                    expect(nomes).toContain('planejar_acao');
                    const externas = ['executar_comando', 'escrever_arquivo', 'registrar_validacao', 'aprovarEntrega'];
                    for (const nome of externas) {
                        expect(nomes).not.toContain(nome);
                    }
                    const indevida = await cliente.callTool({ name: 'executar_comando', arguments: {} });
                    expect(indevida.isError).toBe(true);
                } finally { await cliente.close(); }
            }
        }
    } finally { caso.escritorio.encerrar(); }
});

test('correção de arquivo vencido recebe prazo próprio e mantém a identidade de recompensa', async () => {
    const caso = await preparar();
    const liberar: (() => void)[] = [];
    caso.escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte, sinal) => {
            await new Promise<void>((resolver) => {
                liberar.push(resolver);
                sinal.addEventListener('abort', () => resolver(), { once: true });
            });
            ouvinte.texto('Etapa encerrada.');
        }, encerrar: () => {},
    });
    try {
        expect(caso.escritorio.iniciarRefinamento(1).ok).toBe(true);
        await aguardar(() => liberar.length === 1);
        const arquivo = Object.values(caso.escritorio['estado'].refinamentos)[0]!;
        const grupo = arquivo.grupos[0]!;
        caso.escritorio['refinarArquivo'](caso.lider.id, grupo.celulas, grupo.temperamento);
        arquivo.prazo = new Date(0).toISOString();
        caso.escritorio['estado'].refinamentos[arquivo.id]!.prazo = arquivo.prazo;
        liberar[0]!();
        await aguardar(() => caso.escritorio['orquestracao']['ativos'].size === 0);
        const principal = caso.escritorio.publico().trabalhos[0]!;
        expect(caso.escritorio.corrigirEntrega(principal.id, 'Complete o arquivo').ok).toBe(true);
        await aguardar(() => liberar.length === 2);
        const corrigido = caso.escritorio['estado'].refinamentos[arquivo.id]!;
        expect(Date.parse(corrigido.prazo)).toBeGreaterThan(Date.now());
        expect(corrigido.rodadas).toHaveLength(1);
        const pendente = corrigido.grupos.find((item) => !item.refinadoPor)!;
        expect(caso.escritorio['refinarArquivo'](caso.lider.id, pendente.celulas, pendente.temperamento))
            .toContain('aceito');
        liberar[1]!();
        await aguardar(() => caso.escritorio['orquestracao']['ativos'].size === 0);
        const entrega = caso.escritorio.publico().trabalhos.at(-1)!;
        expect(entrega.arquivoId).toBe(arquivo.id);
        expect(entrega.origemCorrecaoId).toBe(principal.id);
        expect(caso.escritorio.aprovarEntrega(entrega.id).ok).toBe(true);
        const moedas = caso.escritorio.publico().moedas;
        expect(caso.escritorio.aprovarEntrega(entrega.id).ok).toBe(true);
        expect(caso.escritorio.publico().moedas).toBe(moedas);
        expect(caso.escritorio.publico().cota.grupos).toBe(2);
    } finally { caso.escritorio.encerrar(); }
});

test('necessidades não reiniciam a cada nove minutos e mudam no dia civil', async () => {
    const caso = await preparar();
    let agora = new Date(2026, 9, 17, 10);
    let diaSalvo = '';
    const simulacao = new SimulacaoEscritorio({
        sala: () => caso.escritorio.publico().sala, funcionarios: () => [caso.lider],
        statusTrabalho: () => 'ocioso', relogioInicial: 0, automatica: false,
        necessidadesIniciais: { [caso.lider.id]: { ...necessidadesIniciais, falhasHoje: 3 } },
        diaInicial: '2026/10/17', agora: () => agora,
        gravar: (_relogio, _necessidades, dia) => { if (dia) diaSalvo = dia; },
        emitirQuadro: () => {}, emitirEstado: () => {},
    });
    try {
        simulacao.avancar(541);
        expect(simulacao.necessidadesDe(caso.lider.id).energia).toBeLessThan(90);
        expect(simulacao.necessidadesDe(caso.lider.id).falhasHoje).toBe(3);
        agora = new Date(2026, 9, 18, 10);
        simulacao.avancar(0);
        expect(simulacao.necessidadesDe(caso.lider.id).energia).toBe(90);
        expect(simulacao.necessidadesDe(caso.lider.id).falhasHoje).toBe(0);
        expect(diaSalvo).toBe('2026/10/18');
    } finally { simulacao.encerrar(); caso.escritorio.encerrar(); }
});

test('grupos variam entre todas as linhas e exigem exatamente três células', () => {
    const linhas = new Set<string>();
    for (let semente = 0; semente < 100; semente++) {
        const arquivo = gerarArquivo(semente, new Date());
        for (const grupo of arquivo.grupos) {
            linhas.add(grupo.celulas[0]![0]!);
            expect(refinar(arquivo, 'autor', grupo.celulas, grupo.temperamento).resultado).toBe('aceito');
            const extra = ['H1', 'H2', 'H3', 'H4'].find((celula) => !grupo.celulas.includes(celula))!;
            expect(refinar(arquivo, 'autor', [...grupo.celulas, extra], grupo.temperamento).resultado)
                .toBe('rejeitado');
            expect(refinar(arquivo, 'autor', [...grupo.celulas, grupo.celulas[0]!], grupo.temperamento).resultado)
                .toBe('rejeitado');
        }
    }
    expect(linhas.size).toBe(8);
});

test('montar contexto não confirma leitura e falha preserva as novidades', async () => {
    const caso = await preparar();
    try {
        expect(caso.social.contexto(caso.colega.id, 'social')).toContain(caso.fonte.id);
        expect(caso.escritorio['estado'].social.leituras[`social:${caso.colega.id}`]).toBeUndefined();
        expect(caso.social.contexto(caso.colega.id, 'social')).toContain(caso.fonte.id);
        caso.social.confirmarLeitura(caso.colega.id, 'social');
        expect(caso.social.contexto(caso.colega.id, 'social')).not.toContain(caso.fonte.id);
        expect(caso.social.contexto(caso.colega.id, 'trabalho')).toContain(caso.fonte.id);
    } finally { caso.escritorio.encerrar(); }
});

test('episódios privados sobrevivem à poda sem chegar a quem não participou', async () => {
    const caso = await preparar();
    try {
        const episodio = caso.social.registrar({ tipo: 'cobrar', autorId: caso.lider.id, alvoId: caso.colega.id,
            texto: 'Episódio reservado importante.', alcance: 'reservado', ouvintes: [caso.lider.id, caso.colega.id],
            fontes: [caso.fonte.id] }, false);
        for (let i = 0; i < 805; i++) caso.social.registrar({ tipo: 'fala', autorId: caso.lider.id,
            texto: `Conversa trivial ${i}.`, alcance: 'publico', ouvintes: [], fontes: [] }, false);
        expect(caso.escritorio['estado'].social.eventos.some((item) => item.id === episodio.id)).toBe(false);
        expect(caso.escritorio['estado'].social.lembrancas.some((item) => item.id === episodio.id)).toBe(true);
        expect(caso.social.contexto(caso.colega.id, 'social')).not.toContain('Episódio reservado importante');
        caso.social.registrar({ tipo: 'fala', autorId: caso.lider.id, texto: 'Vamos retomar aquele episódio importante?',
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        caso.escritorio['estado'].social.leituras[`social:${caso.colega.id}`]
            = caso.escritorio['estado'].social.sequencia - 1;
        expect(caso.social.contexto(caso.colega.id, 'social')).toContain('Episódio reservado importante');
        expect(caso.social.contexto(caso.terceiro.id, 'social')).not.toContain('Episódio reservado importante');
    } finally { caso.escritorio.encerrar(); }
});

test('compromisso privado só se cumpre pelo ato correto com o destinatário', async () => {
    const caso = await preparar();
    try {
        expect(caso.social.planejar(caso.colega.id, caso.lider.id, 'reconciliar', 'Reparar a relação', caso.fonte.id))
            .toContain('registrada');
        const intencao = caso.escritorio['estado'].social.intencoes[0]!;
        caso.escritorio.atualizarPensamento(caso.colega.id, 'Vou pedir desculpas.');
        expect(caso.escritorio['estado'].social.intencoes[0]?.estado).toBe('pendente');
        caso.social.interagir(caso.colega.id, caso.lider.id, 'desculpar', 'Quero reparar minha atitude.',
            'publico', [caso.fonte.id]);
        const cumprida = caso.escritorio['estado'].social.intencoes.find((item) => item.id === intencao.id)!;
        expect(cumprida.estado).toBe('cumprida');
        expect(cumprida.resultadoId).toBeTruthy();
        expect(caso.escritorio['contextoGeral'](caso.terceiro.id)).not.toContain('Reparar a relação');
    } finally { caso.escritorio.encerrar(); }
});

test('limpeza visual preserva origem das relações e não reaplica a mesma reação', async () => {
    const caso = await preparar();
    try {
        caso.social.interagir(caso.lider.id, caso.colega.id, 'cobrar', 'Confira seus envios.',
            'publico', [caso.fonte.id]);
        const cobranca = caso.escritorio['estado'].social.eventos.findLast((item) => item.tipo === 'cobrar')!;
        caso.social.reagir(caso.colega.id, cobranca.id, 'discordar', 'Quero conferir os fatos.');
        caso.escritorio.limparGeral();
        const antes = structuredClone(caso.escritorio['estado'].social.relacoes);
        expect(caso.social.acontecimentos().some((item) => item.id === cobranca.id)).toBe(true);
        expect(caso.social.reagir(caso.colega.id, cobranca.id, 'discordar', 'Quero conferir os fatos.'))
            .toContain('já registrou');
        expect(caso.escritorio['estado'].social.relacoes).toEqual(antes);
        caso.social.interagir(caso.lider.id, caso.colega.id, 'cobrar', 'Confira seus envios.',
            'publico', [caso.fonte.id]);
        expect(caso.escritorio['estado'].social.relacoes).toEqual(antes);
    } finally { caso.escritorio.encerrar(); }
});

test('atividade da sala distingue coordenação, correção e avaliação', () => {
    const base = { id: 'principal', pedidoId: 'pedido', funcionarioId: 'lider', nome: 'Helena',
        projetoId: 'macrodados', arquivoId: 'arquivo', tarefa: 'Refinar', resultado: '', criadoEm: '',
        estado: 'trabalhando' as const, origemCorrecaoId: 'anterior' };
    const delegado = { ...base, id: 'etapa', funcionarioId: 'colega', nome: 'Pedro',
        solicitante: { id: 'lider', nome: 'Helena' } };
    expect(atividadeDepartamento('lider', [base, delegado])).toBe('Coordena Pedro');
    expect(atividadeDepartamento('lider', [base])).toBe('Corrigindo Macrodados');
    expect(atividadeDepartamento('lider', [{ ...base, estado: 'concluido',
        avaliacao: { estado: 'aguardando_aprovacao', recompensa: 0 } }])).toBe('Aguarda a Diretoria');
});

test('cumprimento com menção usa uma resposta direta sem turno obrigatório de ação', async () => {
    const caso = await preparar();
    const prompts: string[] = [];
    caso.escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (prompt, ouvinte, _sinal, opcoes) => {
            prompts.push(prompt);
            expect(opcoes?.exigirFerramenta).not.toBe(true);
            ouvinte.texto('Bom dia.');
        }, encerrar: () => {},
    });
    try {
        expect(caso.escritorio.enviarGeral('@Helena bom dia').ok).toBe(true);
        await aguardar(() => !caso.escritorio.publico().geral.conversaAtiva);
        expect(prompts).toHaveLength(1);
    } finally { caso.escritorio.encerrar(); }
});

test('compromissos têm limite e cancelamento exclusivo do autor', async () => {
    const caso = await preparar();
    try {
        for (const objetivo of ['conversar', 'defender', 'elogiar'] as const) {
            caso.social.planejar(caso.colega.id, caso.lider.id, objetivo, 'Cuidar da relação', caso.fonte.id);
        }
        expect(caso.social.planejar(caso.colega.id, caso.lider.id, 'reconciliar', 'Reparar', caso.fonte.id))
            .toContain('três intenções');
        const intencao = caso.escritorio['estado'].social.intencoes[0]!;
        caso.social.cancelarIntencao(caso.terceiro.id, intencao.id, 'Não sou o autor');
        expect(caso.escritorio['estado'].social.intencoes[0]?.estado).toBe('pendente');
        caso.social.cancelarIntencao(caso.colega.id, intencao.id, 'O assunto foi resolvido');
        expect(caso.escritorio['estado'].social.intencoes[0]?.estado).toBe('cancelada');
    } finally { caso.escritorio.encerrar(); }
});

test('elogios repetidos sobre novas fontes têm efeito decrescente', async () => {
    const caso = await preparar();
    try {
        caso.social.interagir(caso.lider.id, caso.colega.id, 'elogiar', 'Bom resultado.', 'publico', [caso.fonte.id]);
        const primeira = caso.escritorio['estado'].social.relacoes.find((item) => item.autorId === caso.colega.id)!;
        const novaFonte = caso.social.registrar({ tipo: 'fala', autorId: caso.colega.id,
            texto: 'Outro resultado registrado.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
        caso.social.interagir(caso.lider.id, caso.colega.id, 'elogiar', 'Outro bom resultado.',
            'publico', [novaFonte.id]);
        const segunda = caso.escritorio['estado'].social.relacoes.find((item) => item.autorId === caso.colega.id)!;
        expect(segunda.confianca).toBeGreaterThan(primeira.confianca);
        expect(segunda.confianca - primeira.confianca).toBeLessThan(primeira.confianca - 50);
    } finally { caso.escritorio.encerrar(); }
});

test('estado terminal do MCP independe das palavras da resposta', async () => {
    const servidor = new ServidorMcp({
        verEscritorio: () => '', fazerPausa: async () => '', falarNoGeral: () => '',
        atualizarPensamento: () => '', delegar: async () => '',
        abrirArquivo: () => 'Uma redação nova sem nenhum marcador de encerramento.',
        estadoEtapa: () => ({ codigo: 'prazo_encerrado', terminal: true }),
    });
    const cliente = new Client({ name: 'metadados', version: '1' });
    try {
        await cliente.connect(new StreamableHTTPClientTransport(new URL(await servidor.urlDe('autor', 'trabalho'))));
        const resultado = await cliente.callTool({ name: 'abrir_arquivo', arguments: {} });
        expect(resultado.structuredContent).toEqual({ codigo: 'prazo_encerrado', terminal: true });
        expect(JSON.stringify(resultado.content)).not.toContain('Prazo encerrado');
    } finally { await cliente.close(); servidor.encerrar(); }
});

test('indisponibilidade do modelo é técnica e não gera falha profissional ou acusação pública', async () => {
    const caso = await preparar();
    caso.escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async () => { throw new Error('Provedor temporariamente indisponível.'); }, encerrar: () => {},
    });
    try {
        expect(caso.escritorio.iniciarRefinamento(1).ok).toBe(true);
        await aguardar(() => caso.escritorio['orquestracao']['ativos'].size === 0);
        const trabalho = caso.escritorio.publico().trabalhos.at(-1)!;
        expect(trabalho.falhaTecnica).toBe(true);
        expect(caso.escritorio.publico().necessidades[caso.lider.id]?.falhasHoje).toBe(0);
        expect(caso.escritorio.publico().social.eventos.some((evento) => evento.tipo === 'falha')).toBe(false);
        expect(caso.escritorio.publico().social.relacoes).toEqual([]);
    } finally { caso.escritorio.encerrar(); }
});
