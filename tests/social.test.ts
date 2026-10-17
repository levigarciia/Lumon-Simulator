import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Escritorio } from '../electron/services/escritorio';
import { DinamicaSocial } from '../electron/services/social';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { CanalGeral } from '../electron/services/geral';
import { Orquestracao } from '../electron/services/orquestracao';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import { salaVazia } from '../shared/escritorio';
import type { Agente } from '../shared/agentes';
import type { Funcionario, StatusFuncionario } from '../shared/funcionarios';
import { criarPersonalidade, esquemaSocial, podeConhecer, type PropostaPolitica } from '../shared/social';
import type { MensagemGeral } from '../shared/geral';
import type { RegistroTrabalho, RespostaTrabalho } from '../shared/trabalho';
import { falasDoChat, limiteFalasSeguidas } from '../shared/geral';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'];
const equipe: Funcionario[] = ids.map((id, indice) => ({
    id, nome: ['Helena', 'Pedro', 'Lia'][indice]!, cargo: indice === 0 ? 'lider' : 'desenvolvedor',
    mesaId: `mesa${indice}`, contratadoEm: new Date().toISOString(), autonomia: false,
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
}));
const [helena, pedro, lia] = equipe as [Funcionario, Funcionario, Funcionario];

function preparar() {
    let estado = esquemaSocial.parse({});
    let agentes = equipe.map((pessoa, indice): Agente => ({
        id: pessoa.id, mesaId: pessoa.mesaId, posicao: { x: indice, z: 4 }, direcao: 0,
        rota: [], atividade: 'trabalhando', destinoId: pessoa.mesaId, ateSegundo: 0,
    }));
    const avisos: string[][] = [];
    const estresse: [string, number][] = [];
    const decisoes: PropostaPolitica[] = [];
    const social = new DinamicaSocial({
        estado: () => estado, funcionarios: () => equipe, agentes: () => agentes,
        gravar: (novo) => { estado = novo; }, notificar: (ouvintes) => { avisos.push(ouvintes); },
        estressar: (id, delta) => { estresse.push([id, delta]); },
        decidir: (proposta) => { decisoes.push(proposta); return { ok: true }; },
    });
    const fonte = social.registrar({ tipo: 'falha', autorId: pedro.id, alvoId: helena.id,
        texto: 'A execução da tarefa falhou.', trabalhoId: 'trabalho1',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    return { social, estado: () => estado, fonte, avisos, estresse, decisoes,
        mover: (id: string, x: number) => { agentes = agentes.map((item) => item.id === id
            ? { ...item, posicao: { x, z: 4 } } : item); } };
}

function escritorio() {
    const estado = estadoInicial();
    estado.funcionarios = equipe.map((pessoa) => ({ ...pessoa }));
    estado.sala = { ...salaVazia, itens: equipe.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 2 + indice * 3, z: 4 }, rotacao: 0,
    })) };
    const instancia = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    instancia['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    return instancia;
}

async function estabilizar() {
    for (let indice = 0; indice < 30; indice++) await Promise.resolve();
}

test('elogio recíproco e reação a elogio não criam novos efeitos nem notificações', () => {
    const caso = preparar();
    caso.social.interagir(helena.id, pedro.id, 'elogiar', 'Bom resultado.', 'publico', [caso.fonte.id]);
    const elogio = caso.estado().eventos.at(-1)!;
    const antes = structuredClone(caso.estado());
    const avisos = caso.avisos.length;
    expect(caso.social.interagir(pedro.id, helena.id, 'elogiar', 'Seu reconhecimento foi excelente.',
        'publico', [elogio.id])).toContain('Não retribua');
    expect(caso.estado()).toEqual(antes);
    expect(caso.avisos).toHaveLength(avisos);
    const reacao = caso.social.registrar({ tipo: 'reacao', autorId: pedro.id, alvoId: helena.id,
        texto: 'Concordo com o elogio.', alcance: 'reservado', ouvintes: [pedro.id], fontes: [elogio.id] }, false);
    expect(caso.social.interagir(pedro.id, helena.id, 'elogiar', 'Concordo com seu reconhecimento.',
        'publico', [reacao.id])).toContain('Não retribua');
    const fato = caso.social.registrar({ tipo: 'conserto', autorId: helena.id,
        texto: 'A cafeteira foi consertada.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    expect(caso.social.interagir(pedro.id, helena.id, 'elogiar', 'Obrigado pelo conserto.',
        'publico', [fato.id])).toContain('Ação registrada');
});

test('promoção própria exige mérito e aprovação, preservando o contexto da carreira', () => {
    const instancia = escritorio();
    const id = pedro.id;
    try {
        instancia['estado'].funcionarios.find((pessoa) => pessoa.id === id)!.cargo = 'estagiario';
        const fonte = instancia['social'].registrar({ tipo: 'elogiar', autorId: helena.id, alvoId: id,
            texto: 'Bom trabalho.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
        expect(instancia['social'].propor(id, id, 'promocao', 'Quero crescer.', [fonte.id])).toContain('Faltam');
        instancia['estado'].carreira[id] = { merito: 20 };
        expect(instancia['social'].propor(id, id, 'promocao', 'Quero crescer.', [fonte.id])).toContain('Proposta [');
        expect(instancia.publico().funcionarios.find((pessoa) => pessoa.id === id)?.cargo).toBe('estagiario');
        const proposta = instancia.publico().social.propostas.at(-1)!;
        expect(instancia.decidirProposta(proposta.id, true).ok).toBe(true);
        expect(instancia.publico().funcionarios.find((pessoa) => pessoa.id === id)?.cargo).toBe('refinador');
        expect(instancia.publico().carreira[id]?.merito).toBe(6);
        expect(instancia['contextoTurno'](id)).toContain('busque crescer');
    } finally {
        instancia.encerrar();
    }
});

test('avaliações e falas antigas passam à Diretoria preservando suas fontes', () => {
    const caso = preparar();
    const aprovacao = caso.social.registrar({ tipo: 'decisao', autorId: 'diretoria', autorNome: 'Levi',
        trabalhoId: 'trabalho', texto: 'Entrega aprovada: Arquivo Halcyon.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const rejeicao = caso.social.registrar({ tipo: 'falha', autorId: 'diretoria', autorNome: 'Levi',
        trabalhoId: 'trabalho', texto: 'A entrega da equipe foi rejeitada. Motivo: dados incompletos.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const fala = caso.social.registrar({ tipo: 'fala', autorId: 'diretoria', texto: 'Vamos conversar.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const proposta = caso.social.propor(helena.id, pedro.id, 'demissao', 'Falhas recorrentes', [rejeicao.id]);
    expect(proposta).toContain('Proposta [');
    let estado = caso.estado();
    const social = new DinamicaSocial({
        estado: () => estado, funcionarios: () => equipe, agentes: () => [],
        gravar: (novo) => { estado = novo; }, notificar: () => {}, estressar: () => {},
        decidir: () => ({ ok: true }), nomeResponsavel: () => 'Levi',
    });
    for (const original of [aprovacao, rejeicao]) {
        expect(estado.eventos.find((evento) => evento.id === original.id)).toEqual({
            ...original, autorId: 'diretoria', autorNome: 'Diretoria',
        });
    }
    expect(estado.eventos.find((evento) => evento.id === fala.id)).toEqual({
        ...fala, autorId: 'diretoria', autorNome: 'Diretoria',
    });
    expect(estado.propostas[0]?.registros[0]).toMatchObject({
        id: rejeicao.id, autorId: 'diretoria', autorNome: 'Diretoria',
    });
    const contexto = social.contexto(helena.id, 'trabalho', false);
    expect(contexto).toContain('autor Diretoria: Entrega aprovada:');
    expect(contexto).not.toContain('autor Levi: Entrega aprovada:');
});

describe('conversa reservada iniciada no chat individual', () => {
    test('só retorna quando a conversa termina, com a transcrição completa', async () => {
        const caso = preparar();
        caso.social['registro'].notificarReservado = () => {};
        caso.mover(pedro.id, 1);
        let concluida = false;
        const conversa = caso.social.conversarAguardando(helena.id, pedro.id, 'Tudo certo por aí?', [])
            .then((retorno) => { concluida = true; return retorno; });
        await estabilizar();
        expect(caso.social.aguardandoConversa(helena.id, pedro.id)).toBe(true);
        caso.social.interagir(pedro.id, helena.id, 'reservado', 'Tudo certo.', 'reservado', []);
        caso.social.interagir(helena.id, pedro.id, 'reservado', 'Que bom.', 'reservado', []);
        await estabilizar();
        expect(concluida).toBe(false);
        caso.social.respostaAusente(pedro.id, helena.id);
        const retorno = await conversa;
        expect(retorno).toContain('Pedro: Tudo certo.');
        expect(retorno).toContain('Helena: Que bom.');
        expect(caso.social.aguardandoConversa(helena.id, pedro.id)).toBe(false);
    });

    test('o próprio ID orienta a responder em texto normal', () => {
        const caso = preparar();
        expect(caso.social.interagir(helena.id, helena.id, 'reservado', 'Oi.', 'reservado', []))
            .toContain('responda em texto normal');
    });

    test('trocas reservadas não têm limite de turnos', () => {
        const caso = preparar();
        let notificacoes = 0;
        caso.social['registro'].notificarReservado = () => { notificacoes++; };
        for (let indice = 0; indice < 12; indice++) {
            const [autor, alvo] = indice % 2 ? [pedro, helena] : [helena, pedro];
            caso.social.registrar({ tipo: 'reservado', autorId: autor.id, alvoId: alvo.id, texto: 'Está bem.',
                alcance: 'reservado', ouvintes: [autor.id, alvo.id], fontes: [] });
        }
        expect(notificacoes).toBe(12);
    });

    test('fonte inválida sugere IDs de acontecimentos conhecidos', () => {
        const caso = preparar();
        const fala = caso.social.registrar({ tipo: 'fala', autorId: pedro.id, texto: 'A máquina quebrou.',
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        const retorno = caso.social.reagir(helena.id, 'Pedro falando da máquina', 'discordar', 'Exagero.');
        expect(retorno).toContain(`[${fala.id}]`);
    });
});

describe('histórico apagado', () => {
    test('limpar Work e chat remove acontecimentos órfãos da memória social', () => {
        const instancia = escritorio();
        const social = instancia['social'];
        social.registrar({ tipo: 'entrega', autorId: pedro.id, alvoId: helena.id, texto: 'Entrega.',
            trabalhoId: 'apagado', alcance: 'publico', ouvintes: [], fontes: [] }, false);
        social.registrar({ tipo: 'fala', autorId: 'diretoria', alvoId: pedro.id,
            texto: 'Relato da Diretoria no chat individual, não verificado: Oi',
            alcance: 'reservado', ouvintes: [pedro.id], fontes: [] }, false);
        instancia.limparTrabalhos();
        instancia.limparConversa(pedro.id);
        const eventos = instancia['estado'].social.eventos;
        expect(eventos.some((evento) => evento.trabalhoId === 'apagado')).toBe(false);
        expect(eventos.some((evento) => evento.autorId === 'diretoria')).toBe(false);
    });
});

describe('percepção e relações', () => {
    test('estados antigos migram e personalidade e memória sobrevivem à serialização', () => {
        const { social: _social, ...antigo } = estadoInicial();
        expect(esquemaEstado.parse(antigo).social).toEqual(esquemaSocial.parse({}));
        expect(criarPersonalidade(pedro.id)).toEqual(criarPersonalidade(pedro.id));
        const caso = preparar();
        const estado = { ...estadoInicial(), social: caso.estado() };
        expect(esquemaEstado.parse(JSON.parse(JSON.stringify(estado))).social).toEqual(caso.estado());
    });

    test('bronca local tem testemunhas próximas e a reservada só tem dois participantes', () => {
        const caso = preparar();
        caso.social.interagir(helena.id, pedro.id, 'cobrar', 'Corrija o erro verificado.', 'local', [caso.fonte.id]);
        const local = caso.estado().eventos.at(-1)!;
        expect(local.ouvintes).toContain(lia.id);
        expect(caso.estresse).toEqual([[pedro.id, 5]]);
        caso.social.interagir(pedro.id, lia.id, 'reservado', 'Não gostei da cobrança.', 'reservado', [local.id]);
        const reservado = caso.estado().eventos.at(-1)!;
        expect(reservado.ouvintes.sort()).toEqual([pedro.id, lia.id].sort());
        expect(podeConhecer(reservado, helena.id)).toBe(false);
        expect(caso.social.contexto(helena.id, 'social')).not.toContain('Não gostei da cobrança.');
        expect(caso.social.contexto(lia.id, 'social')).toContain('Não gostei da cobrança.');
        expect(caso.avisos.at(-1)).toEqual([lia.id]);
    });

    test('distância não bloqueia conversas, mas fontes e funcionários são validados e ações repetidas limitadas', () => {
        const caso = preparar();
        caso.mover(lia.id, 20);
        expect(caso.social.interagir(pedro.id, lia.id, 'reservado', 'Oi', 'reservado', []))
            .toContain('Ação registrada');
        expect(caso.estado().eventos.at(-1)?.ouvintes).toEqual([pedro.id, lia.id]);
        expect(caso.social.interagir(pedro.id, helena.id, 'cobrar', 'Erro', 'publico', ['inexistente']))
            .toContain('fontes inexistentes');
        expect(caso.social.interagir('inexistente', helena.id, 'reservado', 'Oi', 'publico', []))
            .toContain('não encontrado');
        for (let indice = 0; indice < 8; indice++) {
            caso.social.interagir(pedro.id, helena.id, 'reservado', 'Conversa', 'reservado', []);
        }
        expect(caso.social.interagir(pedro.id, helena.id, 'reservado', 'Conversa', 'reservado', []))
            .toContain('Aguarde um minuto');
    });

    test('crítica pode gerar ressentimento e depois respeito por interpretação própria', () => {
        const caso = preparar();
        caso.social.interagir(helena.id, pedro.id, 'cobrar', 'O teste falhou.', 'publico', [caso.fonte.id]);
        const cobranca = caso.estado().eventos.at(-1)!;
        const antes = caso.estado().relacoes.find((item) => item.autorId === pedro.id)!;
        expect(antes.ressentimento).toBeGreaterThan(0);
        caso.social.reagir(pedro.id, cobranca.id, 'concordar', 'Ela está certa, preciso corrigir.');
        const depois = caso.estado().relacoes.find((item) => item.autorId === pedro.id)!;
        expect(depois.respeito).toBeGreaterThan(antes.respeito);
        expect(depois.ressentimento).toBeLessThan(antes.ressentimento);
        expect(depois.marcadores?.at(-1)?.rotulo).toBe('Concordância');
        const impacto = caso.estado().eventos.at(-1)!.impactosRelacao![0]!;
        expect(impacto.tipo).toBe('positivo');
        expect(impacto.mudancas.some((mudanca) => mudanca.eixo === 'ressentimento'
            && mudanca.atual < mudanca.anterior)).toBe(true);
        const fala = falasDoChat([], caso.estado().eventos).find((item) => item.id === cobranca.id)!;
        expect(fala.impactosRelacao?.some((item) => item.rotulo === 'Concordância')).toBe(true);
        expect(caso.social.contexto(helena.id, 'social')).not.toContain('Ela está certa');
        expect(caso.social.reagir(pedro.id, cobranca.id, 'discordar', 'Mudei de ideia')).toContain('já registrou');
    });

    test('reação mostra valores persistidos e atualiza a postura no próximo turno de todos os canais', () => {
        const caso = preparar();
        caso.social.ajustarRelacao(pedro.id, helena.id, caso.fonte.id, { ressentimento: 100, afinidade: -50 });
        const fonte = caso.social.registrar({ tipo: 'fala', autorId: helena.id, texto: 'Cuide da sua energia.',
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        const retorno = caso.social.reagir(pedro.id, fonte.id, 'concordar', 'Ela tem razão neste ponto.');
        const atual = caso.estado().relacoes.find((item) => item.autorId === pedro.id
            && item.colegaId === helena.id)!;
        expect(atual.ressentimento).toBeLessThan(100);
        expect(retorno).toContain(`ressentimento de 100 para ${atual.ressentimento}`);
        for (const canal of ['social', 'chat', 'trabalho'] as const) {
            const contexto = caso.social.contexto(pedro.id, canal, false, undefined, canal === 'social');
            expect(contexto).toContain(`ressentimento ${atual.ressentimento}`);
            expect(contexto).toContain('Mágoa intensa');
            expect(contexto).toContain('Concordar num ponto não é perdoar');
        }
        expect(caso.social.contexto(lia.id, 'social', false)).not.toContain('Mágoa intensa');
        expect(caso.social.reagir(pedro.id, fonte.id, 'concordar', 'Repetindo.')).toContain('já registrou');
        expect(caso.estado().relacoes.find((item) => item.autorId === pedro.id
            && item.colegaId === helena.id)?.ressentimento).toBe(atual.ressentimento);
    });

    test('fofoca mantém a cadeia de autoria sem liberar o relato reservado original', () => {
        const caso = preparar();
        caso.social.interagir(helena.id, pedro.id, 'reservado', 'Estou preocupada com a entrega.', 'reservado', []);
        const segredo = caso.estado().eventos.at(-1)!;
        caso.social.interagir(pedro.id, lia.id, 'fofocar',
            'Ela acha nossa entrega horrível.', 'reservado', [segredo.id]);
        const fofoca = caso.estado().eventos.at(-1)!;
        expect(podeConhecer(fofoca, lia.id)).toBe(true);
        expect(podeConhecer(segredo, lia.id)).toBe(false);
        expect(fofoca.fontes).toEqual([segredo.id]);
        expect(caso.social.interagir(lia.id, pedro.id, 'contestar', 'Discordo', 'publico', [segredo.id]))
            .toContain('fontes inexistentes');
        expect(caso.social.contexto(lia.id, 'trabalho')).not.toContain('Estou preocupada');
    });

    test('um relato pode mudar a opinião sobre a pessoa citada sem virar fato compartilhado', () => {
        const caso = preparar();
        caso.social.interagir(pedro.id, lia.id, 'reservado', 'Helena me expôs na frente de todos.',
            'reservado', [caso.fonte.id], undefined, helena.id);
        const relato = caso.estado().eventos.at(-1)!;
        caso.social.reagir(lia.id, relato.id, 'desconfiar', 'Vou observar como ela trata a equipe.', helena.id);
        const relacao = caso.estado().relacoes.find((item) => item.autorId === lia.id && item.colegaId === helena.id);
        expect(relacao?.confianca).toBeLessThan(50);
        expect(caso.social.contexto(helena.id, 'social')).not.toContain('Vou observar');
    });

    test('leituras de trabalho e convivência são independentes e a consulta não consome novidades', () => {
        const caso = preparar();
        caso.social.contexto(helena.id, 'social', false);
        expect(caso.estado().leituras).toEqual({});
        caso.social.contexto(helena.id, 'social');
        caso.social.confirmarLeitura(helena.id, 'social');
        expect(caso.estado().leituras[`social:${helena.id}`]).toBe(1);
        expect(caso.estado().leituras[`trabalho:${helena.id}`]).toBeUndefined();
        expect(caso.social.contexto(helena.id, 'trabalho')).toContain(caso.fonte.id);
        expect(caso.social.contexto(helena.id, 'social', false)).not.toContain(caso.fonte.id);
        expect(caso.estado().eventos.some((evento) => evento.id === caso.fonte.id)).toBe(true);
    });
});

describe('política do escritório', () => {
    test('apoio exige comunicação real, não executa a proposta e preserva as evidências', () => {
        const caso = preparar();
        caso.social.propor(pedro.id, helena.id, 'demissao', 'Cobranças injustas.', [caso.fonte.id]);
        const proposta = caso.estado().propostas[0]!;
        expect(caso.decisoes).toEqual([]);
        expect(proposta.registros[0]?.id).toBe(caso.fonte.id);
        expect(caso.social.apoiar(lia.id, proposta.id, caso.fonte.id)).toContain('precisa receber');
        caso.social.interagir(pedro.id, lia.id, 'reservado', `Apoia a proposta ${proposta.id}?`, 'reservado', []);
        const convite = caso.estado().eventos.at(-1)!;
        expect(caso.social.apoiar(lia.id, proposta.id, convite.id)).toContain('Apoio registrado');
        expect(caso.estado().propostas[0]?.apoiadores).toEqual([pedro.id, lia.id]);
        expect(caso.social.apoiar(lia.id, proposta.id, convite.id)).toContain('não está disponível');
        expect(caso.social.decidir(proposta.id, false).ok).toBe(true);
        expect(caso.decisoes).toEqual([]);
        expect(caso.social.decidir(proposta.id, true).ok).toBe(false);
    });

    test('demissão aprovada encerra o agente e salva autoria e acontecimentos no histórico', () => {
        const instancia = escritorio();
        try {
            const social = instancia['social'];
            const fonte = social.registrar({ tipo: 'fala', autorId: helena.id, texto: 'Refaça tudo.',
                alcance: 'publico', ouvintes: [], fontes: [] }, false);
            social.propor(pedro.id, helena.id, 'demissao', 'Abuso nas cobranças.', [fonte.id]);
            const proposta = instancia.publico().social.propostas[0]!;
            expect(instancia.publico().funcionarios).toHaveLength(3);
            expect(instancia.decidirProposta(proposta.id, true).ok).toBe(true);
            expect(instancia.publico().funcionarios).toHaveLength(2);
            const demissao = instancia.publico().demissoes[0]!;
            expect(demissao.demitidoPor).toContain('Pedro');
            expect(demissao.historicoSocial[0]?.texto).toBe('Refaça tudo.');
            expect(instancia.publico().social.propostas[0]?.estado).toBe('aprovada');
        } finally { instancia.encerrar(); }
    });

    test('troca de liderança valida ocupação antes de mudar os dois cargos', () => {
        const instancia = escritorio();
        try {
            const social = instancia['social'];
            const fonte = social.registrar({ tipo: 'fala', autorId: helena.id, texto: 'Vamos rever a coordenação.',
                alcance: 'publico', ouvintes: [], fontes: [] }, false);
            instancia['estado'].carreira[pedro.id] = { merito: 45 };
            social.propor(pedro.id, helena.id, 'troca_lideranca', 'Quero liderar.', [fonte.id], pedro.id);
            const proposta = instancia.publico().social.propostas[0]!;
            const original = instancia['expediente'].statusDe;
            instancia['expediente'].statusDe = () => 'trabalhando';
            expect(instancia.decidirProposta(proposta.id, true).ok).toBe(false);
            expect(instancia.publico().funcionarios[0]?.cargo).toBe('lider');
            instancia['expediente'].statusDe = original;
            expect(instancia.decidirProposta(proposta.id, true).ok).toBe(true);
            expect(instancia.publico().funcionarios.find((item) => item.id === pedro.id)?.cargo).toBe('lider');
            expect(instancia.publico().funcionarios.find((item) => item.id === helena.id)?.cargo).toBe('refinador');
        } finally { instancia.encerrar(); }
    });

    test('transferência aprovada persiste o afastamento e bloqueia delegações daquele líder', async () => {
        const instancia = escritorio();
        try {
            const social = instancia['social'];
            const fonte = social.registrar({ tipo: 'fala', autorId: helena.id, texto: 'Preciso mudar a equipe.',
                alcance: 'publico', ouvintes: [], fontes: [] }, false);
            social.propor(pedro.id, helena.id, 'transferencia', 'Prefiro outro líder.', [fonte.id]);
            const proposta = instancia.publico().social.propostas[0]!;
            expect(instancia.decidirProposta(proposta.id, true).ok).toBe(true);
            expect(instancia.publico().social.afastamentos[pedro.id]).toEqual([helena.id]);
            let trabalhos: RegistroTrabalho[] = [];
            const orquestracao = new Orquestracao({
                funcionarios: () => equipe, projetos: () => [{ id: 'p', nome: 'P', pasta: 'C:/temporario' }],
                trabalhos: () => trabalhos, gravar: (novos) => { trabalhos = novos; }, status: () => 'ocioso',
                executar: () => new Promise(() => {}), interromper: () => {},
                afastado: (id, liderId) => instancia.publico().social.afastamentos[id]?.includes(liderId) ?? false,
            });
            orquestracao.enviar('p', 'Trabalho');
            expect(await orquestracao.delegar(helena.id, pedro.id, 'Tarefa')).toContain('transferência');
            orquestracao.interromper();
        } finally { instancia.encerrar(); }
    });
});

test('encontro caminha, aguarda chegada e devolve o funcionário à mesa depois da conversa', async () => {
    const sala = { ...salaVazia, itens: equipe.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa' as const, celula: { x: 2 + indice * 3, z: 4 }, rotacao: 0 as const,
    })) };
    const simulacao = new SimulacaoEscritorio({
        sala: () => sala, funcionarios: () => equipe, statusTrabalho: () => 'ocioso',
        relogioInicial: 0, necessidadesIniciais: {}, gravar: () => {},
        emitirQuadro: () => {}, emitirEstado: () => {}, automatica: false,
    });
    try {
        let chegou = false;
        const encontro = simulacao.encontrarColega(helena.id, lia.id).then((texto) => { chegou = true; return texto; });
        expect(chegou).toBe(false);
        for (let indice = 0; indice < 150; indice++) simulacao.avancar(0.1);
        expect(await encontro).toContain('Você chegou');
        expect(simulacao.agentes().find((item) => item.id === helena.id)?.atividade).toBe('conversando');
        for (let indice = 0; indice < 600; indice++) simulacao.avancar(0.1);
        expect(simulacao.emPausa(helena.id)).toBe(false);
        expect(simulacao.agentes().find((item) => item.id === helena.id)?.atividade).toBe('trabalhando');
    } finally { simulacao.encerrar(); }
});

test('chat individual responde no mesmo turno sem exigir uma ação artificial', async () => {
    const instancia = escritorio();
    instancia['estado'].funcionarios = instancia['estado'].funcionarios.map((pessoa) => pessoa.id === helena.id
        ? { ...pessoa, modelo: { ...pessoa.modelo, provedor: 'local' as const } } : pessoa);
    const turnos: { prompt: string; opcoes?: { ferramentas?: string[]; exigirFerramenta?: boolean } }[] = [];
    instancia['expediente']['abrirSessao'] = () => ({
        enviar: async (prompt, ouvinte, _sinal, opcoes) => {
            turnos.push({ prompt, opcoes });
            ouvinte.texto(opcoes?.exigirFerramenta ? 'Texto descartado.' : 'Vou cuidar disso.');
        },
        encerrar: () => {},
    });
    try {
        expect(instancia.enviar(helena.id, 'Pode fazer a pausa.').ok).toBe(true);
        for (let tentativa = 0; tentativa < 100 && instancia['expediente']['execucoes'].has(helena.id); tentativa++) {
            await Bun.sleep(5);
        }
        expect(instancia['estado'].conversas[helena.id]?.at(-1)?.erro).toBeUndefined();
        expect(turnos).toHaveLength(1);
        expect(turnos[0]?.prompt).not.toStartWith('Turno de ação.');
        expect(turnos[0]?.opcoes?.exigirFerramenta).toBeUndefined();
        expect(instancia['estado'].conversas[helena.id]?.at(-1)?.texto).toBe('Vou cuidar disso.');
    } finally { instancia.encerrar(); }
});

test('chat individual que termina com encontro sem conversa libera o encontro e o chat do jogador', async () => {
    const instancia = escritorio();
    instancia['expediente']['abrirSessao'] = () => ({
        enviar: async () => { void instancia['simulacao'].encontrarColega(helena.id, lia.id); },
        encerrar: () => {},
    });
    try {
        expect(instancia.enviar(helena.id, 'Vá falar com a Lia.').ok).toBe(true);
        for (let tentativa = 0; tentativa < 100 && instancia['expediente']['execucoes'].has(helena.id); tentativa++) {
            await Bun.sleep(5);
        }
        expect(instancia['expediente'].emConversa(helena.id)).toBe(false);
        expect(instancia['simulacao'].emPausa(helena.id)).toBe(false);
        expect(instancia['simulacao'].emPausa(lia.id)).toBe(false);
    } finally { instancia.encerrar(); }
});

test('reação social espera o trabalho e respeita o limite de falas seguidas', async () => {
    let disponivel = false;
    let turnos = 0;
    let mensagens: MensagemGeral[] = [];
    const canal = new CanalGeral({
        funcionarios: () => [pedro], mensagens: () => mensagens, gravar: (novas) => { mensagens = novas; },
        contexto: () => 'Contexto',
        urlMcp: async () => 'http://127.0.0.1', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
        disponivel: () => disponivel,
    }, () => ({ enviar: async () => { turnos++; }, encerrar: () => {} }));
    try {
        canal.notificar([pedro.id]);
        await estabilizar();
        expect(turnos).toBe(0);
        disponivel = true;
        await Bun.sleep(1100);
        expect(turnos).toBe(1);
        canal['falasSeguidas'] = limiteFalasSeguidas;
        canal.notificar([pedro.id]);
        await estabilizar();
        expect(turnos).toBe(1);
        expect(canal.enviarDoUsuario('Podem continuar.').ok).toBe(true);
        await estabilizar();
        expect(turnos).toBe(2);
        expect(canal.situacao().falasRestantes).toBe(limiteFalasSeguidas);
    } finally { canal.encerrar(); }
});

test('líder escreve por iniciativa no chat individual, com intervalo contra insistência', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-iniciativa', version: '1' });
    try {
        const url = await instancia['mcp'].urlDe(helena.id, 'geral');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        const chamar = () => cliente.callTool({ name: 'falar_com_responsavel',
            arguments: { mensagem: 'Preciso de ajuda.' } });
        expect((await chamar()).isError).toBe(false);
        expect(instancia.conversa(helena.id).at(-1))
            .toMatchObject({ autor: 'funcionario', texto: 'Preciso de ajuda.' });
        expect((await chamar()).isError).toBe(true);
        expect(instancia.conversa(helena.id)).toHaveLength(1);
        expect(instancia.publico().naoLidas[helena.id]).toBe(1);
        instancia.marcarConversaLida(helena.id);
        expect(instancia.publico().naoLidas[helena.id]).toBeUndefined();
    } finally {
        await cliente.close();
        instancia.encerrar();
    }
});

test('somente o líder recebe a ferramenta de contato e o serviço revalida o cargo', async () => {
    const instancia = escritorio();
    try {
        for (const cargo of ['refinador', 'estagiario', 'supervisor', 'conselheiro'] as const) {
            instancia['estado'].funcionarios[1]!.cargo = cargo;
            for (const origem of ['geral', 'reservado', 'trabalho'] as const) {
                const cliente = new Client({ name: 'teste-hierarquia', version: '1' });
                try {
                    await cliente.connect(new StreamableHTTPClientTransport(
                        new URL(await instancia['mcp'].urlDe(pedro.id, origem))));
                    expect((await cliente.listTools()).tools.map((item) => item.name))
                        .not.toContain('falar_com_responsavel');
                    expect((await cliente.callTool({ name: 'falar_com_responsavel',
                        arguments: { mensagem: 'Preciso de ajuda.' } })).isError).toBe(true);
                } finally { await cliente.close(); }
            }
            expect(instancia['falarComResponsavel'](pedro.id, 'Preciso de ajuda.')).toContain('Somente o líder');
        }
        expect(instancia.conversa(pedro.id)).toEqual([]);
        expect(instancia.publico().naoLidas[pedro.id]).toBeUndefined();
        instancia['estado'].funcionarios[0]!.cargo = 'refinador';
        expect(instancia['falarComResponsavel'](helena.id, 'Fui rebaixada.')).toContain('Somente o líder');
    } finally { instancia.encerrar(); }
});

test('MCP distingue reação inválida e publica os valores atualizados na ficha', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-relacao', version: '1' });
    try {
        const fonte = instancia['social'].registrar({ tipo: 'fala', autorId: helena.id,
            texto: 'Cuide da sua energia.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
        instancia['social'].ajustarRelacao(pedro.id, helena.id, fonte.id, { ressentimento: 100 });
        const url = await instancia['mcp'].urlDe(pedro.id, 'chat');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        const reagir = (acontecimento: string) => cliente.callTool({ name: 'reagir_ao_acontecimento', arguments: {
            acontecimento, reacao: 'concordar', motivo: 'Ela tem razão neste ponto.', funcionario: helena.id,
        } });
        const invalida = await reagir('inexistente');
        expect(invalida.isError).toBe(true);
        expect(invalida.structuredContent).toMatchObject({ codigo: 'reacao_invalida', terminal: false });
        const aplicada = await reagir(fonte.id);
        expect(aplicada.isError).toBe(false);
        expect(aplicada.structuredContent).toMatchObject({ codigo: 'reacao_aplicada', terminal: false });
        const relacao = instancia.publico().social.relacoes.find((item) => item.autorId === pedro.id
            && item.colegaId === helena.id)!;
        expect(relacao.ressentimento).toBeLessThan(100);
        expect(JSON.stringify(aplicada.content)).toContain(`ressentimento de 100 para ${relacao.ressentimento}`);
        const repetida = await reagir(fonte.id);
        expect(repetida.structuredContent).toMatchObject({ codigo: 'reacao_ja_aplicada', terminal: false });
        expect(instancia.publico().social.relacoes.find((item) => item.autorId === pedro.id
            && item.colegaId === helena.id)?.ressentimento).toBe(relacao.ressentimento);
    } finally { await cliente.close(); instancia.encerrar(); }
});

test('refinador inimigo pode propor demissão na reação sem executar a decisão', async () => {
    const instancia = escritorio();
    instancia['estado'].funcionarios[1]!.cargo = 'refinador';
    const cliente = new Client({ name: 'teste-inimizade', version: '1' });
    let propostaFeita = false;
    const fonte = instancia['social'].registrar({ tipo: 'contestar', autorId: helena.id, alvoId: pedro.id,
        texto: 'Discordo da sua posição.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    instancia['social'].ajustarRelacao(pedro.id, helena.id, fonte.id, { ressentimento: 100 });
    instancia['geral']['abrirSessao'] = (pessoa) => ({
        enviar: async (prompt, _ouvinte, _sinal, opcoes) => {
            if (pessoa.id !== pedro.id || !opcoes?.exigirFerramenta) return;
            expect(prompt).toContain('Relação: Inimizade');
            expect(opcoes.ferramentas).toContain('propor_mudanca');
            await cliente.connect(new StreamableHTTPClientTransport(
                new URL(await instancia['mcp'].urlDe(pedro.id, 'geral'))));
            const resultado = await cliente.callTool({ name: 'propor_mudanca', arguments: {
                funcionario: helena.id, tipo: 'demissao', motivo: 'Quero seu afastamento por nosso conflito pessoal.',
                evidencias: [fonte.id],
            } });
            expect(JSON.stringify(resultado.content)).toContain('enviada à Diretoria');
            propostaFeita = true;
        }, encerrar: () => {},
    });
    try {
        instancia['geral'].falarDoAgente(helena.id, '@Pedro, qual sua posição sobre o conflito?');
        for (let tentativa = 0; tentativa < 100 && !propostaFeita; tentativa++) await Bun.sleep(10);
        expect(propostaFeita).toBe(true);
        expect(instancia.publico().social.propostas.at(-1)).toMatchObject({
            autorId: pedro.id, alvoId: helena.id, tipo: 'demissao', estado: 'pendente',
        });
        expect(instancia.publico().funcionarios.some((pessoa) => pessoa.id === helena.id)).toBe(true);
    } finally { await cliente.close(); instancia.encerrar(); }
});

test('colega citado no Geral responde mesmo durante uma tarefa do Work', async () => {
    let mensagens: MensagemGeral[] = [];
    const turnos: string[] = [];
    const canal = new CanalGeral({
        funcionarios: () => [pedro, helena], mensagens: () => mensagens, gravar: (novas) => { mensagens = novas; },
        contexto: () => 'Contexto',
        urlMcp: async () => 'http://127.0.0.1', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
        disponivel: (id, _reservado, citado) => id !== helena.id || !!citado,
    }, (pessoa) => ({ enviar: async () => { turnos.push(pessoa.id); }, encerrar: () => {} }));
    try {
        canal.notificar([helena.id]);
        await estabilizar();
        expect(turnos).toEqual([]);
        canal.falarDoAgente(pedro.id, `@${helena.nome}, pode conferir?`);
        await estabilizar();
        expect(turnos.filter((id) => id === helena.id).length).toBeGreaterThanOrEqual(2);
    } finally { canal.encerrar(); }
});

test('conversa reservada não consome o limite do Geral e pode ser encerrada pelo jogador', async () => {
    let mensagens: MensagemGeral[] = [];
    let interrompidos = 0;
    const canal = new CanalGeral({
        funcionarios: () => [pedro, helena], mensagens: () => mensagens, gravar: (novas) => { mensagens = novas; },
        contexto: () => 'Contexto',
        urlMcp: async () => 'http://127.0.0.1', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
    }, () => ({
        enviar: (_prompt, _ouvinte, sinal) => new Promise<void>((_resolver, rejeitar) => {
            sinal.addEventListener('abort', () => { interrompidos++; rejeitar(sinal.reason); });
        }),
        encerrar: () => {},
    }));
    try {
        canal.notificarReservado(pedro.id, helena.id, 'Oi');
        canal.notificarReservado(helena.id, pedro.id, 'Oi');
        await estabilizar();
        const par = [pedro.id, helena.id].sort().join(':');
        expect(canal.situacao().reservadosAtivos).toEqual([par]);
        expect(canal['falasSeguidas']).toBe(0);
        canal.encerrarReservado(helena.id, pedro.id);
        await estabilizar();
        expect(interrompidos).toBe(1);
        expect(canal.situacao().reservadosAtivos).toEqual([]);
    } finally { canal.encerrar(); }
});

test('chat individual caminha pelo MCP antes de entregar o convite privado no assunto atual', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-convite-privado', version: '1' });
    const iniciou = Promise.withResolvers<void>();
    const terminou = Promise.withResolvers<void>();
    const projeto = { id: 'atual', nome: 'Projeto atual', pasta: 'C:/temporario' };
    instancia['estado'].projetos = [projeto];
    const texto = 'Lia, podemos conversar em particular sobre os testes que faltaram?';
    let resultado: unknown;
    let promptRecebido = '';
    instancia['estado'].pensamentos[helena.id] = {
        texto: 'Finalize a auditoria do projeto antigo.', atualizadoEm: new Date().toISOString(),
    };
    instancia['expediente']['abrirSessao'] = (_pessoa, configuracao) => ({
        enviar: async (prompt) => {
            try {
                promptRecebido = `${configuracao.instrucoes}\n${prompt}`;
                await cliente.connect(new StreamableHTTPClientTransport(new URL(configuracao.mcpUrl!)));
                expect((await cliente.listTools()).tools.some((item) => item.name === 'encontrar_colega')).toBe(false);
                const chamada = cliente.callTool({ name: 'conversar_reservado',
                    arguments: { funcionario: lia.id, mensagem: texto } });
                for (let tentativa = 0; tentativa < 100 && !instancia['simulacao'].emPausa(helena.id); tentativa++) {
                    await Bun.sleep(5);
                }
                iniciou.resolve();
                resultado = await chamada;
                terminou.resolve();
            } catch (erro) { iniciou.reject(erro); terminou.reject(erro); }
        },
        encerrar: () => {},
    });
    try {
        expect(instancia.enviar(helena.id, 'Converse com Lia sobre os testes que faltaram.').ok).toBe(true);
        await iniciou.promise;
        expect(instancia['simulacao'].emPausa(helena.id)).toBe(true);
        expect(instancia.publico().social.eventos.some((item) => item.texto === texto)).toBe(false);
        expect(promptRecebido).toContain('preserve o assunto do pedido atual');
        expect(promptRecebido).not.toContain('Finalize a auditoria do projeto antigo.');
        const relato = instancia.publico().social.eventos.find((item) => item.autorId === 'diretoria')!;
        expect(podeConhecer(relato, helena.id)).toBe(true);
        expect(podeConhecer(relato, lia.id)).toBe(false);
        for (let indice = 0; indice < 180; indice++) instancia['simulacao'].avancar(0.1);
        await terminou.promise;
        expect(JSON.stringify(resultado)).toContain('Ação registrada');
        const convite = instancia.publico().social.eventos.find((item) => item.texto === texto)!;
        expect(convite.ouvintes).toEqual([helena.id, lia.id]);
        expect(podeConhecer(convite, pedro.id)).toBe(false);
        expect(instancia['simulacao'].agentes().find((item) => item.id === helena.id)?.atividade)
            .toBe('conversando');
    } finally {
        await cliente.close();
        instancia.encerrar();
    }
});

test('convite interrompido não entrega a mensagem e tarefa real conversa da mesa', async () => {
    const instancia = escritorio();
    try {
        const social = instancia['social'];
        const simulacao = instancia['simulacao'];
        const convite = social.interagirComEncontro(helena.id, lia.id, 'reservado', 'Conversa privada',
            'reservado', []);
        instancia.interromper(helena.id);
        expect(await convite).toContain('encerrado');
        expect(instancia.publico().social.eventos.some((item) => item.texto === 'Conversa privada')).toBe(false);
        instancia['expediente'].statusDe = () => 'trabalhando';
        expect(await social.interagirComEncontro(helena.id, lia.id, 'reservado', 'Outra conversa',
            'reservado', [])).toContain('Ação registrada');
        expect(simulacao.emPausa(helena.id)).toBe(false);
    } finally { instancia.encerrar(); }
});

test('parceiros permanecem juntos durante respostas lentas e a troca nunca entra no Geral', async () => {
    const instancia = escritorio();
    const iniciouResposta = Promise.withResolvers<void>();
    const liberarResposta = Promise.withResolvers<void>();
    const promptsPublicos: string[] = [];
    const instrucoesPrivadas: string[] = [];
    let respostasLia = 0;
    instancia['geral']['abrirSessao'] = (pessoa, configuracao) => ({
        enviar: async (prompt, ouvinte) => {
            if (!configuracao.instrucoes.includes('Somente vocês dois recebem')) {
                promptsPublicos.push(prompt);
                ouvinte.texto(prompt.includes('Aviso periódico:') ? '(silêncio)' : 'Recebido.');
                return;
            }
            instrucoesPrivadas.push(configuracao.instrucoes);
            if (pessoa.id === lia.id) {
                respostasLia++;
                if (respostasLia > 1) { ouvinte.texto('(silêncio)'); return; }
                iniciouResposta.resolve();
                await liberarResposta.promise;
                ouvinte.texto('Vou corrigir os testes em particular.');
            } else ouvinte.texto('Combinado, obrigado pela conversa.');
        }, encerrar: () => {},
    });
    try {
        const simulacao = instancia['simulacao'];
        const convite = instancia['social'].interagirComEncontro(helena.id, lia.id, 'reservado',
            'Vamos alinhar os testes em particular.', 'reservado', []);
        for (let indice = 0; indice < 180; indice++) simulacao.avancar(0.1);
        expect(await convite).toContain('Ação registrada');
        await iniciouResposta.promise;
        const posicoes = simulacao.agentes().filter((agente) => [helena.id, lia.id].includes(agente.id))
            .map((agente) => agente.posicao);
        expect(posicoes[0]).not.toEqual({ x: 2.5, z: 5.5 });
        expect(posicoes[1]).not.toEqual({ x: 8.5, z: 5.5 });
        for (let indice = 0; indice < 1200; indice++) simulacao.avancar(0.1);
        expect(simulacao.agentes().filter((agente) => [helena.id, lia.id].includes(agente.id))
            .map((agente) => agente.posicao)).toEqual(posicoes);
        expect(simulacao.emPausa(helena.id)).toBe(true);
        expect(simulacao.emPausa(lia.id)).toBe(true);
        liberarResposta.resolve();
        await estabilizar();
        await estabilizar();
        const falas = falasDoChat(instancia.mensagensGeral(), instancia.publico().social.eventos);
        expect(falas.filter((fala) => fala.participantes)).toHaveLength(3);
        expect(instancia.mensagensGeral()).toHaveLength(0);
        expect(instrucoesPrivadas.every((texto) => !texto.includes('diretoria'))).toBe(true);
        expect(instancia['contextoGeral'](pedro.id)).not.toContain('corrigir os testes em particular');
        instancia['geral'].notificar([pedro.id], 'Responda ao cumprimento público.');
        await estabilizar();
        expect(promptsPublicos.join('\n')).not.toContain('corrigir os testes em particular');
        for (let indice = 0; indice < 900; indice++) simulacao.avancar(0.1);
        expect(simulacao.emPausa(helena.id)).toBe(false);
        expect(simulacao.emPausa(lia.id)).toBe(false);
    } finally {
        liberarResposta.resolve();
        instancia.encerrar();
    }
});

test('limpar o Chat remove falas reservadas, cancela encontros e descarta notificações antigas', async () => {
    const instancia = escritorio();
    let turnos = 0;
    instancia['geral']['abrirSessao'] = () => ({
        enviar: async () => { turnos++; }, encerrar: () => {},
    });
    try {
        const convite = instancia['social'].interagirComEncontro(helena.id, lia.id, 'reservado',
            'Não retome este assunto após a limpeza.', 'reservado', []);
        for (let indice = 0; indice < 180; indice++) instancia['simulacao'].avancar(0.1);
        await convite;
        instancia.limparGeral();
        await estabilizar();
        expect(turnos).toBe(0);
        expect(falasDoChat(instancia.mensagensGeral(), instancia.publico().social.eventos)).toEqual([]);
        expect(instancia['simulacao'].emPausa(helena.id)).toBe(false);
        expect(instancia['simulacao'].emPausa(lia.id)).toBe(false);
        expect(instancia['contextoGeral'](helena.id)).not.toContain('Não retome este assunto');
    } finally { instancia.encerrar(); }
});

test('MCP identifica a autoria social e não expõe ações do jogador aos agentes', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-social', version: '1' });
    try {
        const url = await instancia['mcp'].urlDe(pedro.id, 'geral');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        const nomes = (await cliente.listTools()).tools.map((item) => item.name);
        expect(nomes).toContain('conversar_reservado');
        expect(nomes).not.toContain('encontrar_colega');
        expect(nomes).toContain('propor_mudanca');
        expect(nomes).not.toContain('decidirProposta');
        expect(nomes).not.toContain('pedir_refazer');
        const argumentos = {
            funcionario: helena.id, acao: 'cobrar', mensagem: 'Revise a entrega.',
            alcance: 'publico', fontes: [pedro.id],
        };
        const sobreInvalido = await cliente.callTool({ name: 'interagir_socialmente',
            arguments: { ...argumentos, sobre: 'Revisão do trabalho antigo' } });
        expect(sobreInvalido.isError).toBe(true);
        expect(JSON.stringify(sobreInvalido)).toContain('Omita esse campo');
        const fonteInvalida = await cliente.callTool({ name: 'interagir_socialmente', arguments: argumentos });
        expect(fonteInvalida.isError).toBe(true);
        expect(JSON.stringify(fonteInvalida)).toContain('nunca IDs de funcionários');
        const nomeInvalido = await cliente.callTool({ name: 'interagir_socialmente',
            arguments: { ...argumentos, funcionario: helena.nome } });
        expect(nomeInvalido.isError).toBe(true);
        expect(JSON.stringify(nomeInvalido)).toContain('não o nome');
        expect(instancia.publico().social.eventos.some((item) => item.tipo === 'cobrar')).toBe(false);
        const fonte = instancia['social'].registrar({ tipo: 'fala', autorId: helena.id, texto: 'Vamos melhorar.',
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        await cliente.callTool({ name: 'interagir_socialmente', arguments: {
            funcionario: helena.id, acao: 'contestar', mensagem: 'Discordo da abordagem.',
            alcance: 'publico', fontes: [fonte.id], autorId: lia.id,
        } });
        expect(instancia.publico().social.eventos.find((item) => item.tipo === 'contestar')?.autorId).toBe(pedro.id);
        const contestacao = instancia.publico().social.eventos.find((item) => item.tipo === 'contestar')!;
        expect(contestacao.impactosRelacao?.length).toBeGreaterThan(0);
        const consulta = await cliente.callTool({ name: 'consultar_acontecimento',
            arguments: { acontecimento: contestacao.id } });
        expect(JSON.stringify(consulta)).not.toContain('impactosRelacao');
        const privado = instancia['social'].registrar({ tipo: 'reservado', autorId: helena.id, alvoId: lia.id,
            texto: 'Segredo de Helena.', alcance: 'reservado', ouvintes: [helena.id, lia.id], fontes: [] }, false);
        const resultado = await cliente.callTool({
            name: 'consultar_acontecimento', arguments: { acontecimento: privado.id },
        });
        expect(JSON.stringify(resultado)).not.toContain('Segredo de Helena.');
        expect(JSON.stringify(resultado)).toContain('não disponível');
    } finally {
        await cliente.close();
        instancia.encerrar();
    }
});

test('líder no Geral executa repreensão pública no turno de reação com fonte e efeitos sociais', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-repreensao-geral', version: '1' });
    const conclusao = Promise.withResolvers<void>();
    const fonte = instancia['social'].registrar({ tipo: 'fala', autorId: pedro.id,
        texto: 'Vou chamar o responsável de jogador.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const mensagem = 'Pedro, respeite a preferência de tratamento do responsável.';
    let instrucoes = '';
    let contexto = '';
    let resultado: unknown;
    let executou = false;
    let turnosLider = 0;
    instancia['geral']['abrirSessao'] = (pessoa, configuracao) => ({
        enviar: async (prompt, ouvinte, _sinal, opcoes) => {
            if (pessoa.id === helena.id) turnosLider++;
            if (pessoa.id !== helena.id || executou) return;
            executou = true;
            try {
                expect(opcoes?.exigirFerramenta).toBe(true);
                expect(opcoes?.ferramentas).toContain('interagir_socialmente');
                instrucoes = configuracao.instrucoes;
                contexto = prompt;
                await cliente.connect(new StreamableHTTPClientTransport(new URL(configuracao.mcpUrl!)));
                const nomes = (await cliente.listTools()).tools.map((item) => item.name);
                expect(nomes).toEqual(expect.arrayContaining([
                    'interagir_socialmente', 'conversar_reservado', 'reagir_ao_acontecimento',
                    'consultar_acontecimento', 'propor_mudanca', 'apoiar_proposta',
                ]));
                resultado = await cliente.callTool({ name: 'interagir_socialmente', arguments: {
                    funcionario: pedro.id, acao: 'cobrar', mensagem, alcance: 'publico', fontes: [fonte.id],
                } });
                const repetida = await cliente.callTool({ name: 'interagir_socialmente', arguments: {
                    funcionario: pedro.id, acao: 'cobrar', mensagem, alcance: 'publico', fontes: [fonte.id],
                } });
                expect(repetida.isError).toBe(true);
                expect(JSON.stringify(repetida)).toContain('encerrou a participação');
                ouvinte.texto('Cobrança registrada.');
                conclusao.resolve();
            } catch (erro) {
                conclusao.reject(erro);
            }
        },
        encerrar: () => {},
    });
    try {
        expect(instancia.enviarGeral('@Helena, repreenda Pedro por ignorar minha preferência.').ok).toBe(true);
        await conclusao.promise;
        await estabilizar();
        expect(turnosLider).toBe(1);
        expect(instancia.publico().social.eventos.filter((item) => item.tipo === 'cobrar')).toHaveLength(1);
        expect(instrucoes).toContain('Para agir sobre um colega, use interagir_socialmente');
        expect(instrucoes).not.toContain('suas outras ferramentas são privados');
        expect(contexto).toStartWith('Turno de');
        expect(contexto).toContain(fonte.id);
        expect(JSON.stringify(resultado)).toContain('Ação registrada');
        const evento = instancia.publico().social.eventos.findLast((item) => item.tipo === 'cobrar');
        expect(evento).toMatchObject({ autorId: helena.id, alvoId: pedro.id,
            texto: mensagem, alcance: 'publico', fontes: [fonte.id] });
        expect(evento?.ouvintes).toEqual(expect.arrayContaining(ids));
        expect(instancia.publico().social.relacoes.some((item) =>
            item.autorId === pedro.id && item.colegaId === helena.id)).toBe(true);
        expect(instancia.mensagensGeral().some((item) => item.tipo === 'pensamento')).toBe(false);
    } finally {
        await cliente.close();
        instancia.encerrar();
    }
});

test('refinador pode contestar publicamente na reação e o colega recebe o acontecimento', async () => {
    const instancia = escritorio();
    const cliente = new Client({ name: 'teste-reacao-publica', version: '1' });
    const conclusao = Promise.withResolvers<void>();
    const fonte = instancia['social'].registrar({ tipo: 'fala', autorId: helena.id,
        texto: 'Vocês precisam melhorar a comunicação.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    let reagiu = false;
    let respondeu = false;
    let turnosPedro = 0;
    instancia['geral']['abrirSessao'] = (pessoa, configuracao) => ({
        enviar: async (prompt, ouvinte, _sinal, opcoes) => {
            if (pessoa.id === helena.id && !respondeu && prompt.includes('não concordo com essa generalização')) {
                respondeu = true;
                ouvinte.texto('Pedro, vou ser mais específica na próxima cobrança.');
                return;
            }
            if (pessoa.id !== pedro.id) return;
            turnosPedro++;
            if (reagiu) return;
            reagiu = true;
            try {
                expect(opcoes?.exigirFerramenta).toBe(true);
                expect(opcoes?.ferramentas).toContain('interagir_socialmente');
                await cliente.connect(new StreamableHTTPClientTransport(new URL(configuracao.mcpUrl!)));
                const retorno = await cliente.callTool({ name: 'interagir_socialmente', arguments: {
                    funcionario: helena.id, acao: 'contestar', alcance: 'publico', fontes: [fonte.id],
                    mensagem: 'Helena, não concordo com essa generalização.',
                } });
                expect(retorno.isError).toBe(false);
                expect(retorno.structuredContent).toMatchObject({ terminal: true, codigo: 'interacao_aplicada' });
                ouvinte.texto('Não repita minha contestação.');
                conclusao.resolve();
            } catch (erro) { conclusao.reject(erro); }
        }, encerrar: () => {},
    });
    try {
        instancia['geral'].falarDoAgente(helena.id, '@Pedro, como podemos melhorar a comunicação?');
        await conclusao.promise;
        await estabilizar();
        const evento = instancia.publico().social.eventos.find((item) => item.tipo === 'contestar')!;
        expect(evento.autorId).toBe(pedro.id);
        expect(evento.alcance).toBe('publico');
        expect(evento.alvoId).toBe(helena.id);
        expect(podeConhecer(evento, helena.id)).toBe(true);
        expect(falasDoChat(instancia.mensagensGeral(), [evento]).filter((fala) => fala.texto === evento.texto))
            .toHaveLength(1);
        expect(instancia.mensagensGeral().some((fala) => fala.texto === 'Não repita minha contestação.')).toBe(false);
        expect(respondeu).toBe(true);
        expect(instancia.mensagensGeral().some((fala) => fala.autorId === helena.id
            && fala.texto === 'Pedro, vou ser mais específica na próxima cobrança.')).toBe(true);
        expect(turnosPedro).toBe(1);
    } finally { await cliente.close(); instancia.encerrar(); }
});

test('pedido para refazer fica no pedido original e aguarda a correção verdadeira', async () => {
    let trabalhos: RegistroTrabalho[] = [];
    let concluirLider: (resposta: RespostaTrabalho) => void = () => {};
    let correcoes = 0;
    let cobrancas = 0;
    const projeto = { id: 'p', nome: 'Projeto', pasta: 'C:/temporario' };
    const orquestracao = new Orquestracao({
        funcionarios: () => equipe, projetos: () => [projeto], trabalhos: () => trabalhos,
        gravar: (novos) => { trabalhos = novos; }, status: (): StatusFuncionario => 'ocioso',
        executar: (pessoa, _projeto, texto) => pessoa.id === helena.id
            ? new Promise((resolver) => { concluirLider = resolver; })
            : Promise.resolve({ ok: true,
                texto: texto.includes('Correção') ? `Corrigido ${++correcoes}` : 'Entrega inicial' }),
        interromper: () => {}, cobrar: () => { cobrancas++; return 'Cobrança registrada.'; },
    });
    orquestracao.enviar('p', 'Implemente o login', 'thread1');
    await orquestracao.delegar(helena.id, pedro.id, 'Implemente');
    const entrega = trabalhos.find((item) => item.funcionarioId === pedro.id)!;
    expect(await orquestracao.pedirRefazer(lia.id, entrega.id, 'Corrigir teste')).toContain('pedido ativo');
    expect(await orquestracao.pedirRefazer(helena.id, entrega.id, 'Corrigir teste')).toContain('Corrigido 1');
    expect(cobrancas).toBe(1);
    expect(trabalhos.at(-1)?.threadId).toBe('thread1');
    expect(trabalhos.at(-1)?.pedidoId).toBe(entrega.pedidoId);
    concluirLider({ ok: true, texto: 'Aprovado' });
    await estabilizar();
    expect(await orquestracao.pedirRefazer(helena.id, entrega.id, 'Outra')).toContain('pedido ativo');
});
