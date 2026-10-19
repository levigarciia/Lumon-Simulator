import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Escritorio } from '../electron/services/escritorio';
import { Persistencia } from '../electron/services/persistencia';
import { esquemaEstado, estadoInicial, recompensaEntrega } from '../shared/estado';
import type { ValidacaoEntrega } from '../shared/trabalho';
import { descreverPersonalidade } from '../shared/social';
import { gerarArquivo, refinar } from '../shared/refinamento';

const projetoId = '33333333-3333-4333-8333-333333333333';

const validacao: ValidacaoEntrega = {
    resumo: 'Entrega conferida.',
    criterios: [{ criterio: 'Conteúdo salvo', tipo: 'estatica', estado: 'verificado',
        evidencia: 'Arquivo conferido.' }],
};

test('histórico do Work é consultável em todos os canais sem expor gabarito ou memória privada', async () => {
    const { escritorio, lider, colega } = preparar();
    const original = gerarArquivo(21, new Date('2030-01-01'));
    const grupo = original.grupos[0]!;
    const arquivo = refinar(original, colega.id, grupo.celulas, grupo.temperamento, 'etapa').arquivo;
    escritorio['estado'].refinamentos = { [arquivo.id]: arquivo };
    escritorio['estado'].pensamentos[lider.id] = { texto: 'Pensamento secreto', atualizadoEm: '' };
    const principal = { id: 'principal', pedidoId: 'pedido', funcionarioId: lider.id, nome: lider.nome,
        projetoId, tarefa: 'Refine o arquivo', resultado: 'Um grupo aceito.', estado: 'concluido' as const,
        criadoEm: '', arquivoId: arquivo.id };
    escritorio['estado'].trabalhos = [principal, { ...principal, id: 'etapa', funcionarioId: colega.id,
        nome: colega.nome, solicitante: { id: lider.id, nome: lider.nome } }];
    try {
        for (const origem of ['geral', 'chat', 'trabalho'] as const) {
            const cliente = new Client({ name: 'historico', version: '1' });
            try {
                const url = await escritorio['mcp'].urlDe(colega.id, origem);
                await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
                const nomes = (await cliente.listTools()).tools.map((item) => item.name);
                expect(nomes).toContain('revisar_trabalho');
                if (origem !== 'trabalho') {
                    expect(nomes).not.toContain('abrir_arquivo');
                    expect(nomes).not.toContain('refinar');
                }
                const resposta = await cliente.callTool({ name: 'revisar_trabalho', arguments: {} });
                const conteudo = resposta.content as { type: string; text: string }[];
                const historico = conteudo[0]!.text;
                expect(historico).toContain('Pedido [principal]');
                expect(historico).toContain(`${colega.nome} [etapa]`);
                expect(historico).toContain('progresso 17%');
                expect(historico).toContain('aceito');
                expect(historico).toContain('Nenhum arquivo em andamento');
                expect(historico).not.toContain(arquivo.grade[0]!.join(''));
                expect(JSON.stringify(resposta)).not.toContain('Pensamento secreto');
                const especifica = await cliente.callTool({ name: 'revisar_trabalho',
                    arguments: { trabalho: 'etapa' } });
                expect(JSON.stringify(especifica)).toContain(colega.nome);
                const nomeInvalido = await cliente.callTool({ name: 'revisar_trabalho',
                    arguments: { trabalho: 'Macrodados' } });
                expect(JSON.stringify(nomeInvalido)).toContain('não é um ID de trabalho');
                expect(JSON.stringify(nomeInvalido)).toContain('Pedido [principal]');
                escritorio['estado'].trabalhos = [];
                const vazio = await cliente.callTool({ name: 'revisar_trabalho', arguments: {} });
                expect(JSON.stringify(vazio)).toContain('Nenhum arquivo de Macrodados foi iniciado');
                escritorio['estado'].trabalhos = [principal, { ...principal, id: 'etapa',
                    funcionarioId: colega.id, nome: colega.nome, solicitante: { id: lider.id, nome: lider.nome } }];
            } finally { await cliente.close(); }
        }
    } finally { escritorio.encerrar(); }
});

test('reabertura encerra ferramentas pendentes das conversas individuais', () => {
    const { escritorio, lider } = preparar();
    const ferramenta = { id: 'pausa-pendente', resumo: 'Escritório: fazer_pausa', estado: 'rodando' as const };
    const mensagem = {
        id: 'resposta-pendente', autor: 'funcionario' as const, texto: '', criadaEm: new Date().toISOString(),
        ferramentas: [ferramenta],
        partes: [{ id: ferramenta.id, tipo: 'ferramenta' as const, ferramenta, criadaEm: new Date().toISOString() }],
    };
    const gravados: ReturnType<typeof estadoInicial>[] = [];
    let reaberto: Escritorio | undefined;
    try {
        escritorio['estado'].conversas[lider.id] = [mensagem];
        reaberto = new Escritorio(structuredClone(escritorio['estado']), (estado) => gravados.push(estado),
            () => {}, '.');
        const recuperada = reaberto['estado'].conversas[lider.id]![0]!;
        expect(recuperada).toMatchObject({ erro: 'Tarefa interrompida.',
            ferramentas: [{ id: ferramenta.id, estado: 'recusada',
                saida: 'O aplicativo foi encerrado durante esta ação.' }],
            partes: [{ tipo: 'ferramenta', ferramenta: { estado: 'recusada',
                saida: 'O aplicativo foi encerrado durante esta ação.' } }],
        });
        expect(gravados.at(-1)?.conversas[lider.id]?.[0]?.ferramentas[0]?.estado).toBe('recusada');
    } finally {
        reaberto?.encerrar();
        escritorio.encerrar();
    }
});

function preparar(pasta = '.') {
    const estado = estadoInicial();
    estado.projetos = [{ id: projetoId, nome: 'Projeto', pasta: '.' }];
    estado.funcionarios = ['Cláudio', 'Gepeto'].map((nome, indice) => ({
        id: `11111111-1111-4111-8111-11111111111${indice}`, nome,
        cargo: indice === 0 ? 'lider' : 'desenvolvedor', mesaId: `mesa${indice}`,
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' }, autonomia: false,
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        contratadoEm: new Date().toISOString(),
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    return { escritorio, lider: estado.funcionarios[0]!, colega: estado.funcionarios[1]! };
}

async function estabilizar() {
    for (let passo = 0; passo < 10; passo++) await Bun.sleep(5);
}

test('evento da Diretoria anuncia arquivo sem iniciar o Work nem duplicar o arquivo disponível', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-evento-work-'));
    const { escritorio, lider } = preparar(pasta);
    const liberar = Promise.withResolvers<void>();
    escritorio['expediente']['abrirSessao'] = () => ({ enviar: async () => liberar.promise, encerrar: () => {} });
    escritorio['agenda']['registro'].sortear = () => 0.14;
    try {
        expect(escritorio['agenda'].verificar()).toBe('entrega_arquivo');
        await estabilizar();
        const estado = escritorio.publico();
        expect(estado.trabalhos).toHaveLength(0);
        const arquivo = Object.values(estado.refinamentos)[0]!;
        expect(arquivo.duracaoMinutos).toBe(10);
        expect(estado.social.eventos.some((evento) => evento.autorId === 'diretoria'
            && evento.texto.includes(`entregou o arquivo ${arquivo.nome}`))).toBe(true);
        expect(escritorio['agenda']['registro'].podeReceberArquivo?.()).toBe(false);
        expect(Object.values(estado.refinamentos)).toHaveLength(1);
        expect(escritorio['contextoGeral'](lider.id)).toContain('ir_para_work');
        expect(escritorio['irParaWork'](lider.id, 'geral')).toMatchObject({ erro: false, terminal: true });
        expect(escritorio.publico().trabalhos).toHaveLength(0);
        escritorio['geral']['registro'].aoEncerrarTurno?.(lider.id, false);
        await estabilizar();
        expect(escritorio.publico().trabalhos[0]).toMatchObject({ estado: 'trabalhando', arquivoId: arquivo.id });
    } finally {
        liberar.resolve();
        await estabilizar();
        escritorio.encerrar();
        await rmdir(join(pasta, 'macrodados'));
        await rmdir(pasta);
    }
});

test('rejeição encerra a avaliação, afeta os participantes uma vez e persiste o motivo', async () => {
    const { escritorio, lider, colega } = preparar();
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-rejeicao-'));
    const persistencia = new Persistencia(pasta);
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, ouvinte) => {
            if (pessoa.id === lider.id) await escritorio['orquestracao'].delegar(lider.id, colega.id, 'Faça sua etapa');
            ouvinte.texto('Etapa encerrada sem relatório.');
        }, encerrar: () => {},
    });
    try {
        escritorio['orquestracao'].enviar(projetoId, 'Prepare os dados');
        await estabilizar();
        const [principal, delegada] = escritorio.publico().trabalhos;
        const antes = structuredClone(escritorio.publico());
        expect(escritorio.rejeitarEntrega(delegada!.id, 'Recusado').ok).toBe(false);
        expect(escritorio.rejeitarEntrega(principal!.id, ' ').ok).toBe(false);
        expect(escritorio.rejeitarEntrega(principal!.id, 'A Diretoria não estava satisfeita').ok).toBe(true);
        const depois = escritorio.publico();
        expect(depois.trabalhos[0]?.avaliacao).toMatchObject({ estado: 'reprovada', recompensa: 0,
            motivo: 'A Diretoria não estava satisfeita' });
        for (const pessoa of [lider, colega]) {
            expect(depois.necessidades[pessoa.id]!.falhasHoje).toBe(antes.necessidades[pessoa.id]!.falhasHoje + 1);
            expect(depois.necessidades[pessoa.id]!.estresse).toBeGreaterThan(antes.necessidades[pessoa.id]!.estresse);
        }
        expect(depois.moedas).toBe(antes.moedas);
        expect(depois.trabalhos).toHaveLength(2);
        const falhas = depois.social.eventos.filter((item) => item.tipo === 'falha');
        expect(falhas).toHaveLength(1);
        expect(falhas[0]).toMatchObject({ autorId: 'diretoria', autorNome: 'Diretoria' });
        expect(falhas[0]?.texto).toContain('A Diretoria não estava satisfeita');
        expect(escritorio.aprovarEntrega(principal!.id).ok).toBe(false);
        expect(escritorio.corrigirEntrega(principal!.id, 'Refaça').ok).toBe(false);
        expect(escritorio.rejeitarEntrega(principal!.id, 'Outro motivo').ok).toBe(true);
        expect(escritorio.publico().social.eventos.filter((item) => item.tipo === 'falha')).toHaveLength(1);
        persistencia.salvar(escritorio['estado']);
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        expect(salvo.trabalhos[0]?.avaliacao?.estado).toBe('reprovada');
        expect(salvo.necessidades[lider.id]?.falhasHoje).toBe(depois.necessidades[lider.id]!.falhasHoje);
    } finally { escritorio.encerrar(); }
});

test('início do Work fica no histórico sem agendar falas sociais; encerramento notifica', async () => {
    const { escritorio } = preparar();
    const notificacoes: string[] = [];
    escritorio['geral'].notificar = (_ids, motivo = '') => { notificacoes.push(motivo); };
    let concluir!: () => void;
    const espera = new Promise<void>((resolver) => { concluir = resolver; });
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async () => { await espera; }, encerrar: () => {},
    });
    try {
        expect(escritorio['orquestracao'].enviar(projetoId, 'Prepare os dados').ok).toBe(true);
        await estabilizar();
        expect(escritorio.publico().social.eventos.some((item) => item.tipo === 'delegacao')).toBe(true);
        expect(notificacoes).toHaveLength(0);
        const trabalho = escritorio.publico().trabalhos[0]!;
        expect(escritorio.rejeitarEntrega(trabalho.id, 'Ainda trabalhando').ok).toBe(false);
        concluir();
        await estabilizar();
        expect(notificacoes.some((texto) => texto.includes('Execução encerrada'))).toBe(true);
    } finally { concluir(); escritorio.encerrar(); }
});

test('trabalho interrompido pode ser rejeitado sem relatório de validação', async () => {
    const { escritorio } = preparar();
    let concluir!: () => void;
    const espera = new Promise<void>((resolver) => { concluir = resolver; });
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async () => { await espera; }, encerrar: () => {},
    });
    try {
        escritorio['orquestracao'].enviar(projetoId, 'Refine os dados');
        await estabilizar();
        escritorio.interromperTrabalho();
        concluir();
        await estabilizar();
        const trabalho = escritorio.publico().trabalhos[0]!;
        expect(trabalho.estado).toBe('interrompido');
        expect(trabalho.avaliacao?.validacao).toBeUndefined();
        expect(escritorio.rejeitarEntrega(trabalho.id, 'A Diretoria não estava satisfeita').ok).toBe(true);
        expect(escritorio.publico().trabalhos[0]?.avaliacao?.estado).toBe('reprovada');
    } finally { concluir(); escritorio.encerrar(); }
});

test('macrodados preserva gabarito interno, delegação e recompensa única após aprovação', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-macrodados-'));
    const { escritorio, lider, colega } = preparar(pasta);
    const moedas = escritorio.publico().moedas;
    const notificacoes: string[] = [];
    escritorio['geral'].notificar = (_ids, motivo = '') => { notificacoes.push(motivo); };
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (prompt, ouvinte) => {
            expect(prompt).not.toContain('simulado');
            expect(prompt).not.toContain('gabarito');
            const descricao = escritorio['abrirArquivo'](pessoa.id);
            expect(descricao).toContain('Progresso:');
            expect(descricao).not.toContain('"grupos"');
            expect(descricao).toContain('Cota do departamento:');
            if (pessoa.id === lider.id) {
                const grupoDelegado = Object.values(escritorio.publico().refinamentos)[0]!.grupos[0]!;
                await escritorio['orquestracao'].delegar(lider.id, colega.id, grupoDelegado.celulas.join(', '));
                const arquivo = Object.values(escritorio.publico().refinamentos)[0]!;
                for (const grupo of arquivo.grupos.filter((item) => !item.refinadoPor)) {
                    expect(escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento))
                        .toContain('aceito');
                }
            } else {
                const arquivo = Object.values(escritorio.publico().refinamentos)[0]!;
                const grupo = arquivo.grupos[0]!;
                expect(escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento)).toContain('aceito');
                expect(escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento))
                    .toContain('Sua etapa terminou');
            }
            ouvinte.texto('Arquivo refinado.');
        }, encerrar: () => {},
    });
    try {
        expect(escritorio.iniciarRefinamento(0).ok).toBe(false);
        expect(escritorio.iniciarRefinamento(5).ok).toBe(true);
        await estabilizar();
        const [principal, delegada] = escritorio.publico().trabalhos;
        expect(delegada?.arquivoId).toBe(principal?.arquivoId);
        expect(delegada?.estado).toBe('concluido');
        const arquivo = Object.values(escritorio.publico().refinamentos)[0]!;
        expect(arquivo.envios.filter((item) => item.funcionarioId === colega.id)).toHaveLength(1);
        expect(escritorio.aprovarEntrega(delegada!.id).ok).toBe(false);
        expect(escritorio.publico().moedas).toBe(moedas);
        expect(escritorio.publico().cota.grupos).toBe(0);
        expect(escritorio.aprovarEntrega(principal!.id).ok).toBe(true);
        expect(escritorio.aprovarEntrega(principal!.id).ok).toBe(true);
        expect(escritorio.publico().moedas).toBe(moedas + 60);
        expect(escritorio.publico().cota.grupos).toBe(6);
        expect(escritorio.publico().cota.arquivos).toEqual([arquivo.id]);
        const decisao = escritorio.publico().social.eventos.find((evento) => evento.tipo === 'decisao')!;
        expect(decisao).toMatchObject({ autorId: 'diretoria', autorNome: 'Diretoria' });
        expect(notificacoes.find((texto) => texto.includes(decisao.id))).toContain('Diretoria: Entrega aprovada:');
        expect(escritorio['social'].contexto(lider.id, 'trabalho', false)).toContain('autor Diretoria');
    } finally { escritorio.encerrar(); }
});

test('envio rejeitado repetido não consome o limite da etapa de Macrodados', () => {
    const { escritorio, lider, colega } = preparar();
    const arquivo = gerarArquivo(42, new Date('2030-01-01'));
    escritorio['estado'].refinamentos = { [arquivo.id]: arquivo };
    escritorio['estado'].trabalhos = [{
        id: 'etapa', pedidoId: 'pedido', funcionarioId: colega.id, nome: colega.nome,
        projetoId, tarefa: 'Refine um grupo', resultado: '', estado: 'trabalhando',
        criadoEm: new Date().toISOString(), arquivoId: arquivo.id,
        solicitante: { id: lider.id, nome: lider.nome },
    }];
    const celulasInvalidas = ['A1', 'A2', 'A3'];
    try {
        expect(escritorio['refinarArquivo'](colega.id, celulasInvalidas, 'pavor')).toContain('mesma linha');
        expect(escritorio['refinarArquivo'](colega.id, ['D10', 'E1', 'E2'], 'alegria')).toContain('células válidas');
        expect(escritorio.publico().refinamentos[arquivo.id]!.envios).toHaveLength(2);
        expect(escritorio['estadoEtapa'](colega.id)).toEqual({ codigo: 'etapa_ativa', terminal: false });
    } finally { escritorio.encerrar(); }
});

test('insistir em seleções inválidas encerra a etapa delegada', () => {
    const { escritorio, lider, colega } = preparar();
    const arquivo = gerarArquivo(42, new Date('2030-01-01'));
    escritorio['estado'].refinamentos = { [arquivo.id]: arquivo };
    escritorio['estado'].trabalhos = [{
        id: 'etapa', pedidoId: 'pedido', funcionarioId: colega.id, nome: colega.nome,
        projetoId, tarefa: 'Refine um grupo', resultado: '', estado: 'trabalhando',
        criadoEm: new Date().toISOString(), arquivoId: arquivo.id,
        solicitante: { id: lider.id, nome: lider.nome },
    }];
    try {
        for (let tentativa = 0; tentativa < 2; tentativa++) {
            escritorio['refinarArquivo'](colega.id, ['D10', 'E1', 'E2'], 'alegria');
        }
        expect(escritorio['estadoEtapa'](colega.id).terminal).toBe(false);
        expect(escritorio['refinarArquivo'](colega.id, ['D10', 'E1', 'E2'], 'alegria')).toContain('encerrada');
        expect(escritorio['estadoEtapa'](colega.id)).toEqual({ codigo: 'tentativas_esgotadas', terminal: true });
        expect(escritorio['refinarArquivo'](colega.id, arquivo.grupos[0]!.celulas, 'alegria')).toContain('encerrada');
    } finally { escritorio.encerrar(); }
});

test('líder sem delegação em andamento recebe aviso ao cancelar', () => {
    const { escritorio, lider } = preparar();
    try {
        expect(escritorio['orquestracao'].cancelarDelegacao(lider.id)).toContain('pedido ativo');
    } finally { escritorio.encerrar(); }
});

test('cota cumprida anuncia uma vez e sobrevive à limpeza do histórico e à reabertura', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-cota-'));
    const { escritorio } = preparar(pasta);
    const persistencia = new Persistencia(pasta);
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, ouvinte) => {
            const arquivo = escritorio['arquivoAtivo'](pessoa.id)!;
            for (const grupo of arquivo.grupos) {
                escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento);
            }
            ouvinte.texto('Refinamento concluído.');
        }, encerrar: () => {},
    });
    try {
        for (let indice = 0; indice < 4; indice++) {
            expect(escritorio.iniciarRefinamento(5).ok).toBe(true);
            await estabilizar();
            const trabalho = escritorio.publico().trabalhos.at(-1)!;
            expect(escritorio.publico().moedas).toBe(600 + indice * 60 + (indice >= 3 ? 30 : 0));
            expect(escritorio.aprovarEntrega(trabalho.id).ok).toBe(true);
            expect(escritorio.aprovarEntrega(trabalho.id).ok).toBe(true);
            expect(escritorio.publico().moedas).toBe(600 + (indice + 1) * 60 + (indice >= 2 ? 30 : 0));
            expect(escritorio.publico().trabalhos.at(-1)?.avaliacao?.recompensa).toBe(indice === 2 ? 90 : 60);
        }
        expect(escritorio.publico().cota.grupos).toBe(24);
        const anuncios = escritorio.publico().social.eventos.filter((evento) =>
            evento.tipo === 'decisao' && evento.texto.startsWith('A cota foi cumprida'));
        expect(anuncios).toHaveLength(1);
        expect(anuncios[0]?.autorId).toBe('diretoria');
        expect(anuncios[0]?.texto).toContain('Bônus pela cota diária: 30 moedas.');
        expect(escritorio.limparTrabalhos().ok).toBe(true);
        expect(escritorio.publico().trabalhos).toHaveLength(0);
        expect(escritorio.publico().cota.grupos).toBe(24);
        persistencia.salvar(escritorio['estado']);
        await persistencia.descarregar();
        const reaberto = new Escritorio(await persistencia.carregar(), () => {}, () => {}, pasta);
        try {
            expect(reaberto.publico().cota).toEqual(escritorio.publico().cota);
            expect(reaberto.publico().moedas).toBe(870);
            reaberto['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
            reaberto['expediente']['abrirSessao'] = (pessoa) => ({
                enviar: async (_prompt, ouvinte) => {
                    const arquivo = reaberto['arquivoAtivo'](pessoa.id)!;
                    for (const grupo of arquivo.grupos) {
                        reaberto['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento);
                    }
                    ouvinte.texto('Refinamento concluído.');
                }, encerrar: () => {},
            });
            expect(reaberto.iniciarRefinamento(5).ok).toBe(true);
            await estabilizar();
            expect(reaberto.aprovarEntrega(reaberto.publico().trabalhos.at(-1)!.id).ok).toBe(true);
            expect(reaberto.publico().moedas).toBe(930);
            reaberto['estado'].cota.dia = '2000/1/1';
            for (let indice = 0; indice < 3; indice++) {
                expect(reaberto.iniciarRefinamento(5).ok).toBe(true);
                await estabilizar();
                expect(reaberto.aprovarEntrega(reaberto.publico().trabalhos.at(-1)!.id).ok).toBe(true);
                expect(reaberto.publico().moedas).toBe(930 + (indice + 1) * 60 + (indice === 2 ? 30 : 0));
            }
            expect(reaberto.publico().cota.grupos).toBe(18);
        } finally { reaberto.encerrar(); }
    } finally { escritorio.encerrar(); }
});

test('recompensa somente o pedido aprovado e não duplica após delegação, repetição ou reabertura', async () => {
    const { escritorio, lider, colega } = preparar();
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-entrega-'));
    const persistencia = new Persistencia(pasta);
    const moedas = escritorio.publico().moedas;
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, ouvinte) => {
            if (pessoa.id === lider.id) {
                const resultado = await escritorio['orquestracao'].delegar(lider.id, colega.id, 'Crie o documento');
                expect(resultado).toContain('Trabalho ');
                expect(resultado).toContain('ainda exige revisão');
            }
            escritorio['orquestracao'].registrarValidacao(pessoa.id, validacao);
            ouvinte.texto('Documento conferido.');
        }, encerrar: () => {},
    });
    try {
        expect(escritorio['orquestracao'].enviar(projetoId, 'Crie um documento', 'principal').ok).toBe(true);
        await estabilizar();
        const [principal, delegada] = escritorio.publico().trabalhos;
        expect(principal?.avaliacao?.estado).toBe('aguardando_aprovacao');
        expect(escritorio.publico().moedas).toBe(moedas);
        expect(escritorio.aprovarEntrega(delegada!.id).ok).toBe(false);
        expect(escritorio.aprovarEntrega(principal!.id).ok).toBe(true);
        expect(escritorio.aprovarEntrega(principal!.id).ok).toBe(true);
        expect(escritorio.publico().moedas).toBe(moedas + 25);
        persistencia.salvar(escritorio['estado']);
        await persistencia.descarregar();
        const reaberto = new Escritorio(await persistencia.carregar(), () => {}, () => {}, pasta);
        try {
            expect(reaberto.aprovarEntrega(principal!.id).ok).toBe(true);
            expect(reaberto.publico().moedas).toBe(moedas + 25);
        } finally { reaberto.encerrar(); }
    } finally { escritorio.encerrar(); }
});

test('falta de navegador impede aprovação e correção volta ao mesmo projeto e thread', async () => {
    const { escritorio, lider } = preparar();
    let rodada = 0;
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => {
            rodada++;
            escritorio['orquestracao'].registrarValidacao(lider.id, rodada === 1 ? {
                ...validacao, criterios: [...validacao.criterios, {
                    criterio: 'Aparência em tela', tipo: 'visual', estado: 'pendente',
                    evidencia: 'Navegador indisponível.',
                }],
            } : rodada === 2 ? validacao : { ...validacao, criterios: [{
                criterio: 'Aparência em tela', tipo: 'visual', estado: 'verificado',
                evidencia: 'Página renderizada em 320 e 1280 pixels. Capturas salvas em artifacts.',
            }] });
            ouvinte.texto('Resultado da revisão.');
        }, encerrar: () => {},
    });
    try {
        escritorio['orquestracao'].enviar(projetoId, 'Corrija o visual', 'principal');
        await estabilizar();
        const principal = escritorio.publico().trabalhos[0]!;
        expect(principal.avaliacao?.estado).toBe('pendente');
        expect(escritorio.aprovarEntrega(principal.id)).toMatchObject({ ok: false });
        expect(escritorio.corrigirEntrega(principal.id, 'Renderize a página antes de entregar.').ok).toBe(true);
        await estabilizar();
        let corrigida = escritorio.publico().trabalhos.at(-1)!;
        expect(corrigida.threadId).toBe('principal');
        expect(corrigida.projetoId).toBe(projetoId);
        expect(corrigida.origemCorrecaoId).toBe(principal.id);
        expect(escritorio.aprovarEntrega(principal.id).ok).toBe(false);
        expect(corrigida.avaliacao?.estado).toBe('pendente');
        expect(escritorio.aprovarEntrega(corrigida.id).ok).toBe(false);
        expect(escritorio.corrigirEntrega(corrigida.id, 'Ainda falta a renderização.').ok).toBe(true);
        await estabilizar();
        const anterior = corrigida;
        corrigida = escritorio.publico().trabalhos.at(-1)!;
        expect(corrigida.origemCorrecaoId).toBe(anterior.id);
        expect(escritorio.aprovarEntrega(corrigida.id).ok).toBe(true);
        expect(escritorio.publico().moedas).toBe(estadoInicial().moedas + 30);
    } finally { escritorio.encerrar(); }
});

test('execução sem relatório não é aprovação e registros antigos não geram moedas retroativas', async () => {
    const { escritorio } = preparar();
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => { ouvinte.texto('Pronto.'); }, encerrar: () => {},
    });
    try {
        escritorio['orquestracao'].enviar(projetoId, 'Faça a tarefa');
        await estabilizar();
        const trabalho = escritorio.publico().trabalhos[0]!;
        expect(trabalho.estado).toBe('concluido');
        expect(trabalho.avaliacao?.estado).toBe('pendente');
        expect(escritorio.aprovarEntrega(trabalho.id).ok).toBe(false);
        escritorio['estado'].trabalhos[0] = { ...trabalho, avaliacao: undefined };
        expect(escritorio.aprovarEntrega(trabalho.id).ok).toBe(false);
        expect(escritorio.publico().moedas).toBe(estadoInicial().moedas);
    } finally { escritorio.encerrar(); }
});

test('MCP do simulador não oferece validação de código nem aprovação aos agentes', async () => {
    const { escritorio, lider } = preparar();
    const cliente = new Client({ name: 'entregas', version: '1' });
    try {
        await cliente.connect(new StreamableHTTPClientTransport(new URL(await escritorio['mcp'].urlDe(lider.id, 'chat'))));
        const nomes = (await cliente.listTools()).tools.map((item) => item.name);
        expect(nomes).not.toContain('registrar_validacao');
        expect(nomes).not.toContain('aprovarEntrega');
        expect(escritorio.enviarTrabalho(projetoId, 'Crie o documento').ok).toBe(false);
        expect(escritorio.adicionarProjeto('.').ok).toBe(false);
    } finally { await cliente.close(); escritorio.encerrar(); }
});

test('comunicados usam a Diretoria e descartam a identidade pessoal antiga', async () => {
    const { escritorio, lider } = preparar();
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-diretoria-'));
    const persistencia = new Persistencia(pasta);
    try {
        expect(escritorio['contextoGeral'](lider.id)).toContain('comunicado da Diretoria');
        expect(escritorio['contextoTurno'](lider.id)).toContain('comunicado da Diretoria');
        const estado = esquemaEstado.parse({ ...estadoInicial(), identidade: { nome: 'Levi', tratamento: 'chefe' } });
        expect(estado).not.toHaveProperty('identidade');
        persistencia.salvar(estado);
        await persistencia.descarregar();
        expect(await persistencia.carregar()).not.toHaveProperty('identidade');
    } finally { escritorio.encerrar(); }
});

test('bônus considera categorias verificadas e independe da quantidade de critérios', () => {
    const funcional = { ...validacao.criterios[0]!, tipo: 'funcional' as const };
    expect(recompensaEntrega({ ...validacao, criterios: [funcional] })).toBe(30);
    expect(recompensaEntrega({ ...validacao, criterios: Array(20).fill(funcional) })).toBe(30);
    expect(recompensaEntrega({ ...validacao, criterios: [funcional, { ...funcional, tipo: 'visual' }] })).toBe(35);
});

test('estados novos não compartilham móveis nem preferências', () => {
    const primeiro = estadoInicial();
    const segundo = estadoInicial();
    primeiro.sala.itens.push({ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 });
    expect(segundo.sala.itens).toEqual([]);
});

test('personalidade gera instruções distintas de liderança e convivência sem inventar falhas', () => {
    const direto = descreverPersonalidade({ orgulho: 94, ambicao: 98, empatia: 18,
        autoritarismo: 97, tolerancia: 20, interesse: 'qualidade' });
    const conciliador = descreverPersonalidade({ orgulho: 20, ambicao: 30, empatia: 90,
        autoritarismo: 20, tolerancia: 90, interesse: 'amizades' });
    expect(direto).toContain('discordar não comprova infração');
    expect(direto).toContain('nunca elogie por educação');
    expect(direto).toContain('pode xingar');
    expect(conciliador).toContain('prefere corrigir com respeito');
    expect(conciliador).not.toContain('pode xingar');
    expect(direto).toContain('não invente falhas');
});
