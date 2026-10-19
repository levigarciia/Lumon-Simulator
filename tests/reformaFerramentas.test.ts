import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServidorMcp, type OrigemMcp } from '../electron/services/mcp';
import { concluirAcao, recusarAcao } from '../electron/services/ferramentas/resultado';
import { registrarPromessaRetida, registrarChamadaDescartada } from '../electron/services/ferramentas/metricas';
import type { ContextoFerramentas } from '../shared/ferramentas';

async function preparar(origem: OrigemMcp, contexto: ContextoFerramentas = { cargo: 'lider' }) {
    const executadas: string[] = [];
    const servidor = new ServidorMcp({
        contextoFerramentas: () => contexto,
        verEscritorio: () => concluirAcao('Escritório consultado.'),
        fazerPausa: async () => concluirAcao('Uso confirmado.', 'pausa_iniciada', { terminal: true }),
        falarNoGeral: () => concluirAcao('Entregue.', 'fala_publicada'),
        atualizarPensamento: () => { executadas.push('pensamento'); return concluirAcao('Salvo.'); },
        encerrarVez: () => { contexto.participacaoEncerrada = true; },
        delegar: async () => concluirAcao('Etapa coordenada.'),
        abrirArquivo: () => concluirAcao('Grade disponível.'),
        refinar: () => concluirAcao('Envio registrado.'),
        incentivar: () => concluirAcao('Incentivo entregue.'),
        sessaoBemEstar: async () => concluirAcao('Sessão concluída.'),
        planejar: () => concluirAcao('Intenção salva.'),
        cancelarIntencao: () => concluirAcao('Intenção cancelada.'),
        falarComResponsavel: () => concluirAcao('Mensagem enviada.'),
        interagir: (_autor, _destino, acao) => {
            executadas.push(acao);
            return concluirAcao('Interação registrada.');
        },
        consultarHistorico: () => concluirAcao('Página de resultados.'),
        consultar: (_id, fonte) => concluirAcao('Detalhes de ' + fonte),
        consertarItem: () => recusarAcao('Texto positivo: conserto concluído. Esta operação foi recusada.'),
        comprarItem: () => concluirAcao('Uma redação nova, sem prefixo de sucesso.'),
    });
    const url = await servidor.urlDe('autor', origem);
    const cliente = new Client({ name: 'reforma', version: '1' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
    return { servidor, cliente, contexto, executadas, url,
        nomes: async () => (await cliente.listTools()).tools.map((item) => item.name),
        encerrar: async () => { await cliente.close(); servidor.encerrar(); } };
}

test('catálogo e execução acompanham cargo e estado atuais, mesmo depois do anúncio', async () => {
    const caso = await preparar('geral', { cargo: 'supervisor' });
    try {
        expect(await caso.nomes()).toContain('conceder_incentivo');
        expect(await caso.nomes()).not.toContain('sessao_bem_estar');
        caso.contexto.cargo = 'conselheiro';
        expect(await caso.nomes()).not.toContain('conceder_incentivo');
        expect(await caso.nomes()).toContain('sessao_bem_estar');
        const obsoleta = await caso.cliente.callTool({ name: 'conceder_incentivo',
            arguments: { incentivo: 'lembrancinha', motivo: 'Um resultado.' } });
        expect(obsoleta.isError).toBe(true);
        caso.contexto.emPausa = true;
        expect(await caso.nomes()).toEqual([]);
    } finally { await caso.encerrar(); }
});

test('ações sociais próprias fixam a ação e recusam ferramentas removidas e argumentos antigos', async () => {
    const caso = await preparar('chat');
    try {
        const ferramentas = (await caso.cliente.listTools()).tools;
        const nomes = ferramentas.map((item) => item.name);
        for (const nome of ['planejar_acao', 'cancelar_intencao', 'falar_com_responsavel', 'interagir_socialmente']) {
            expect(nomes).not.toContain(nome);
            expect((await caso.cliente.callTool({ name: nome, arguments: {} })).isError).toBe(true);
        }
        const argumentos = { funcionario: 'colega', mensagem: 'Um acontecimento concreto.',
            alcance: 'reservado', fontes: ['fonte'] };
        const acoes = ['cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar'];
        for (const acao of acoes) {
            expect(nomes).toContain(acao);
            expect(ferramentas.find((item) => item.name === acao)!.inputSchema.properties).not.toHaveProperty('acao');
            const resultado = await caso.cliente.callTool({ name: acao, arguments: argumentos });
            expect(resultado.isError).toBe(false);
            expect(resultado.structuredContent).toMatchObject({ efeito: 'social', audiencia: 'destinatario' });
            const adulterada = await caso.cliente.callTool({ name: acao,
                arguments: { ...argumentos, acao: 'outra' } });
            expect(adulterada.isError).toBe(true);
        }
        expect(caso.executadas).toEqual(acoes);
        caso.contexto.refinando = true;
        const trabalho = await preparar('trabalho', caso.contexto);
        try {
            for (const acao of acoes) {
                expect(await trabalho.nomes()).not.toContain(acao);
                expect((await trabalho.cliente.callTool({ name: acao, arguments: argumentos })).isError).toBe(true);
            }
        } finally { await trabalho.encerrar(); }
    } finally { await caso.encerrar(); }
});

test('conversa reservada recebe a mesma descrição em todos os canais sociais', async () => {
    const descricoes: string[] = [];
    for (const origem of ['geral', 'chat', 'reservado'] as const) {
        const caso = await preparar(origem);
        try {
            const ferramentas = (await caso.cliente.listTools()).tools;
            descricoes.push(ferramentas.find((item) => item.name === 'conversar_reservado')!.description!);
        } finally { await caso.encerrar(); }
    }
    expect(new Set(descricoes).size).toBe(1);
});

test('Work anuncia somente trabalho e consultas, com delegação exclusiva da liderança', async () => {
    const caso = await preparar('trabalho', { cargo: 'lider', refinando: true });
    try {
        const nomes = await caso.nomes();
        expect(nomes).toEqual(expect.arrayContaining(['abrir_arquivo', 'refinar', 'delegar', 'consultar']));
        for (const nome of ['atualizar_pensamento', 'nenhuma_acao', 'planejar_acao', 'falar_no_geral']) {
            expect(nomes).not.toContain(nome);
            expect((await caso.cliente.callTool({ name: nome, arguments: {} })).isError).toBe(true);
        }
        caso.contexto.cargo = 'refinador';
        expect(await caso.nomes()).not.toContain('delegar');
        caso.contexto.refinando = false;
        expect(await caso.nomes()).not.toContain('refinar');
    } finally { await caso.encerrar(); }
});

test('reação e conversa na pausa recebem capacidades diferentes do mesmo catálogo', async () => {
    const caso = await preparar('reservado', { cargo: 'refinador', reacao: { diretoria: false, embate: false } });
    try {
        expect(await caso.nomes()).toContain('nenhuma_acao');
        expect(await caso.nomes()).not.toContain('fazer_pausa');
        caso.contexto.reacao = { diretoria: true, embate: false };
        expect(await caso.nomes()).toContain('fazer_pausa');
        caso.contexto.reacao = undefined;
        caso.contexto.emPausa = true;
        caso.contexto.parceiroDePausa = true;
        expect(await caso.nomes()).toContain('consultar');
        expect(await caso.nomes()).not.toContain('falar_no_geral');
        expect(await caso.nomes()).not.toContain('comprar_item');
    } finally { await caso.encerrar(); }
});

test('aliases ficam ocultos e nenhuma ação encerra também a chamada pelo nome antigo', async () => {
    const caso = await preparar('geral');
    try {
        const nomes = await caso.nomes();
        expect(nomes).toContain('nenhuma_acao');
        expect(nomes).toContain('consultar');
        expect(nomes).not.toContain('silencio');
        expect(nomes).not.toContain('consultar_acontecimento');
        const consulta = await caso.cliente.callTool({ name: 'consultar_acontecimento',
            arguments: { acontecimento: 'fonte' } });
        expect(consulta.content).toEqual([{ type: 'text', text: 'Detalhes de fonte' }]);
        const silencio = await caso.cliente.callTool({ name: 'silencio', arguments: {} });
        expect(silencio.structuredContent).toMatchObject({ codigo: 'vez_encerrada', terminal: true, erro: false });
        const atrasada = await caso.cliente.callTool({ name: 'atualizar_pensamento',
            arguments: { pensamento: 'Não deveria executar.' } });
        expect(atrasada.isError).toBe(true);
        expect(caso.executadas).toEqual([]);
        expect(await caso.nomes()).toEqual([]);
        expect(caso.servidor.metricas.consultar().find((item) => item.nome === 'atualizar_pensamento'))
            .toMatchObject({ chamadas: 1, recusas: 1, aposEncerramento: 1 });
    } finally { await caso.encerrar(); }
});

test('resultado estruturado prevalece sobre palavras positivas e redações novas', async () => {
    const caso = await preparar('chat');
    try {
        const recusa = await caso.cliente.callTool({ name: 'consertar_item', arguments: { item: 'movel' } });
        expect(recusa.isError).toBe(true);
        expect(recusa.structuredContent).toMatchObject({ erro: true, efeito: 'escritorio', audiencia: 'equipe' });
        const compra = await caso.cliente.callTool({ name: 'comprar_item', arguments: { item: 'mesa' } });
        expect(compra.isError).toBe(false);
        expect(compra.structuredContent).toMatchObject({ erro: false, codigo: 'acao_concluida' });
        for (const nome of ['constructor', '__proto__', 'toString']) {
            expect((await caso.cliente.callTool({ name: nome, arguments: {} })).isError).toBe(true);
        }
    } finally { await caso.encerrar(); }
});

test('métricas contam anúncios, recusas, repetição, promessas e descartes sem guardar o conteúdo', async () => {
    const caso = await preparar('chat');
    try {
        await caso.nomes();
        for (let tentativa = 0; tentativa < 2; tentativa++) {
            await caso.cliente.callTool({ name: 'consertar_item', arguments: { item: 'segredo privado' } });
        }
        registrarPromessaRetida(caso.url);
        registrarChamadaDescartada(caso.url, 'consultar');
        const medidas = caso.servidor.metricas.consultar();
        const conserto = medidas.find((item) => item.nome === 'consertar_item')!;
        expect(conserto).toMatchObject({ anunciada: 1, chamadas: 2, recusas: 2, repeticoes: 1 });
        expect(conserto.duracaoMs).toBeGreaterThanOrEqual(0);
        expect(medidas.find((item) => item.nome === 'decisao_do_turno')).toMatchObject({ promessasRetidas: 1 });
        expect(medidas.find((item) => item.nome === 'consultar')).toMatchObject({ aposEncerramento: 1 });
        expect(JSON.stringify(medidas)).not.toContain('segredo privado');
        medidas[0]!.chamadas = 500;
        expect(caso.servidor.metricas.consultar()[0]!.chamadas).not.toBe(500);
    } finally { await caso.encerrar(); }
});
