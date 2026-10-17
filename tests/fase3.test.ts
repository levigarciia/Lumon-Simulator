import { describe, expect, test } from 'bun:test';
import { SimulacaoEscritorio, type RegistroPausa } from '../electron/services/simulacao';
import { CanalGeral } from '../electron/services/geral';
import { salaVazia, type ItemPosicionado, type Sala } from '../shared/escritorio';
import type { Funcionario, StatusFuncionario } from '../shared/funcionarios';
import { encontrarMencoes, type MensagemGeral } from '../shared/geral';
import { aplicarAcontecimento, aplicarTempo, necessidadesIniciais } from '../shared/necessidades';

const mesa: ItemPosicionado = { id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 };
const maquina: ItemPosicionado = { id: 'maquina', tipo: 'maquina_guloseimas', celula: { x: 10, z: 0 }, rotacao: 0 };
const sala: Sala = { ...salaVazia, itens: [mesa, maquina] };

function funcionario(id: string): Funcionario {
    return {
        id,
        nome: id,
        mesaId: mesa.id,
        cargo: 'desenvolvedor',
        modelo: { provedor: 'claude', id: 'haiku', nome: 'Haiku' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        autonomia: false,
        contratadoEm: '2026-10-16T00:00:00.000Z',
    };
}

function simulacao(
    status: StatusFuncionario | (() => StatusFuncionario), fome = necessidadesIniciais.fome, conversando = false,
    registrarPausa?: (evento: RegistroPausa) => void, agoraPausaMs?: () => number,
) {
    return new SimulacaoEscritorio({
        sala: () => sala,
        funcionarios: () => [funcionario('Mark')],
        statusTrabalho: () => typeof status === 'function' ? status() : status,
        emConversa: () => conversando,
        emTurnoSocial: () => conversando,
        relogioInicial: 0,
        necessidadesIniciais: { Mark: { ...necessidadesIniciais, fome } },
        gravar: () => {},
        emitirQuadro: () => {},
        emitirEstado: () => {},
        automatica: false,
        registrarPausa,
        agoraPausaMs,
    });
}

describe('necessidades', () => {
    test('todas as pausas recuperam ou mantêm necessidades, sem desgaste nem aumento de fome', () => {
        const antes = { ...necessidadesIniciais, energia: 20, estresse: 80, fome: 59, esgotamento: 40 };
        for (const atividade of ['cafe', 'comendo', 'descansando', 'ouvindo_musica'] as const) {
            const depois = aplicarTempo(antes, atividade, 300);
            expect(depois.energia).toBeGreaterThanOrEqual(antes.energia);
            expect(depois.estresse).toBeLessThanOrEqual(antes.estresse);
            expect(depois.fome).toBeLessThanOrEqual(antes.fome);
            expect(depois.esgotamento).toBeLessThanOrEqual(antes.esgotamento!);
        }
        expect(aplicarTempo(antes, 'descansando', 300).fome).toBe(59);
        expect(aplicarTempo(antes, 'ocioso', 300).fome).toBeGreaterThan(59);
    });
    test('trabalhar cansa e estressa; comer alivia a fome e zera o tempo seguido', () => {
        const trabalhou = aplicarTempo(necessidadesIniciais, 'trabalhando', 120);
        expect(trabalhou.energia).toBeLessThan(necessidadesIniciais.energia);
        expect(trabalhou.estresse).toBeGreaterThan(necessidadesIniciais.estresse);
        expect(trabalhou.segundosSeguidos).toBe(120);
        const comeu = aplicarTempo({ ...trabalhou, fome: 80 }, 'comendo', 10);
        expect(comeu.fome).toBeLessThan(80);
        expect(comeu.segundosSeguidos).toBe(0);
    });

    test('falhas técnicas e recusas não afetam o bem estar da partida', () => {
        const depois = aplicarAcontecimento(aplicarAcontecimento(necessidadesIniciais, 'recusa'), 'turno_falhou');
        expect(depois.estresse).toBe(necessidadesIniciais.estresse);
        expect(depois.falhasHoje).toBe(0);
    });

    test('necessidades continuam fora do trabalho', () => {
        const depois = aplicarTempo(necessidadesIniciais, 'ocioso', 60);
        expect(depois.fome).toBeGreaterThan(necessidadesIniciais.fome);
        expect(depois.energia).toBeLessThan(necessidadesIniciais.energia);
        expect(depois.estresse).toBeLessThan(necessidadesIniciais.estresse);
    });
});

test('menções ignoram maiúsculas e acentos', () => {
    const equipe = [{ id: '1', nome: 'Hélly' }, { id: '2', nome: 'Mark' }];
    expect(encontrarMencoes('oi @helly, tudo bem?', equipe).map((pessoa) => pessoa.id)).toEqual(['1']);
    expect(encontrarMencoes('oi pessoal', equipe)).toEqual([]);
});

describe('pausa pedida pelo agente', () => {
    test('cinco minutos usam relógio real após a chegada e recuperam gradualmente sem liberar antes', async () => {
        let agora = 1000;
        const escritorio = simulacao('ocioso', 95, false, undefined, () => agora);
        try {
            const retorno = escritorio.pedirPausa('Mark', 'comendo', 5);
            const fomeAntesDoTrajeto = escritorio.necessidadesDe('Mark').fome;
            for (let passo = 0; passo < 400 && escritorio.agentes()[0].atividade !== 'comendo'; passo++) {
                escritorio.avancar(0.1);
            }
            expect(escritorio.agentes()[0].atividade).toBe('comendo');
            const fomeAoChegar = escritorio.necessidadesDe('Mark').fome;
            expect(fomeAoChegar).toBe(fomeAntesDoTrajeto);
            escritorio.avancar(1000);
            expect(escritorio.emPausa('Mark')).toBe(true);
            expect(escritorio.necessidadesDe('Mark').fome).toBe(fomeAoChegar);
            agora += 60000;
            escritorio.avancar(0.1);
            expect(escritorio.necessidadesDe('Mark').fome).toBeCloseTo(fomeAoChegar - 24);
            expect(escritorio.emPausa('Mark')).toBe(true);
            agora += 239999;
            escritorio.avancar(0.1);
            expect(escritorio.emPausa('Mark')).toBe(true);
            agora++;
            escritorio.avancar(0.1);
            expect(await retorno).toContain('5 minutos reais');
            expect(escritorio.emPausa('Mark')).toBe(false);
        } finally { escritorio.encerrar(); }
    });

    test('trabalho ativo ou bloqueado não inicia pausas automáticas', () => {
        for (const status of ['trabalhando', 'bloqueado'] as const) {
            const eventos: RegistroPausa[] = [];
            const escritorio = simulacao(status, 95, false, (evento) => eventos.push(evento));
            try {
                for (let passo = 0; passo < 400; passo++) escritorio.avancar(0.1);
                expect(escritorio.emPausa('Mark')).toBe(false);
                expect(eventos).toHaveLength(0);
                expect(escritorio.necessidadesDe('Mark').segundosSeguidos).toBeGreaterThan(30);
            } finally { escritorio.encerrar(); }
        }
    });

    test('pausa por ferramenta registra início e conclusão uma única vez', async () => {
        const eventos: RegistroPausa[] = [];
        const escritorio = simulacao('ocioso', 95, false, (evento) => eventos.push(evento));
        try {
            const retorno = escritorio.pedirPausa('Mark', 'comendo', 5);
            for (let passo = 0; passo < 3500; passo++) escritorio.avancar(0.1);
            expect(await retorno).toContain('Pausa concluída');
            expect(eventos.map((evento) => [evento.origem, evento.fase])).toEqual([
                ['ferramenta', 'inicio'], ['ferramenta', 'conclusao'],
            ]);
            expect(eventos.every((evento) => evento.itemId === maquina.id)).toBe(true);
        } finally { escritorio.encerrar(); }
    });

    test('conversa não inicia pausa automática nem desgasta como trabalho', () => {
        const escritorio = simulacao('trabalhando', 95, true);
        try {
            for (let passo = 0; passo < 1200; passo++) escritorio.avancar(0.1);
            expect(escritorio.emPausa('Mark')).toBe(false);
            expect(escritorio.necessidadesDe('Mark').segundosSeguidos).toBe(0);
            expect(escritorio.necessidadesDe('Mark').fome).toBeGreaterThanOrEqual(95);
        } finally { escritorio.encerrar(); }
    });

    test('o Geral mostra a ferramenta, passa a vez e descarta anúncios de retorno após a pausa', async () => {
        const escritorio = simulacao('ocioso', 80);
        let mensagens: MensagemGeral[] = [];
        let turnos = 0;
        const canal = new CanalGeral({
            funcionarios: () => [funcionario('Mark')],
            mensagens: () => mensagens,
            gravar: (novas) => { mensagens = novas; },
            contexto: () => '',
            urlMcp: async () => 'http://127.0.0.1',
            pasta: '.',
            emitirMensagens: () => {},
            emitirEstado: () => {},
        }, () => ({
            enviar: async (_prompt, ouvinte) => {
                turnos++;
                ouvinte.texto('Vou comer.');
                canal.falarDoAgente('Mark', 'Vou comer.');
                ouvinte.iniciarFerramenta('pausa', 'fazer_pausa');
                const retorno = escritorio.pedirPausa('Mark', 'comendo', 5);
                canal.pausaIniciada('Mark');
                await retorno;
                ouvinte.concluirFerramenta('pausa', false);
                ouvinte.texto('Vou comer. Gostei do lanche.');
                expect(() => canal.falarDoAgente('Mark', 'Gostei do lanche.')).toThrow('encerrou a participação');
            },
            encerrar: () => {},
        }));
        canal.enviarDoUsuario('Vá comer.');
        await Bun.sleep(0);
        expect(mensagens.at(-1)?.ferramentas[0]?.estado).toBe('rodando');
        expect(mensagens.some((mensagem) => mensagem.texto.includes('Gostei'))).toBe(false);
        const quadroInicial = mensagens.at(-1);
        for (let passo = 0; passo < 3600 && escritorio.emPausa('Mark'); passo++) {
            escritorio.avancar(0.1);
            await Promise.resolve();
            if (escritorio.emPausa('Mark')) {
                expect(mensagens.some((mensagem) => mensagem.texto.includes('Gostei'))).toBe(false);
            }
        }
        await Bun.sleep(0);
        expect(mensagens.find((mensagem) => mensagem.ferramentas.length)?.ferramentas[0].estado).toBe('concluida');
        expect(quadroInicial?.ferramentas[0]?.estado).toBe('rodando');
        expect(mensagens.some((mensagem) => mensagem.texto.includes('Gostei'))).toBe(false);
        expect(turnos).toBe(1);
        canal.encerrar();
        escritorio.encerrar();
    });

    test('o corpo vai até a máquina, fica lá e a ferramenta só responde na volta', async () => {
        const escritorio = simulacao('trabalhando', 80);
        const resposta = { texto: '' };
        void escritorio.pedirPausa('Mark', 'comendo', 5).then((texto) => (resposta.texto = texto));
        expect(escritorio.emPausa('Mark')).toBe(true);
        let chegou = false;
        for (let passo = 0; passo < 3600 && !resposta.texto; passo++) {
            escritorio.avancar(0.1);
            chegou ||= escritorio.agentes()[0].atividade === 'comendo';
            await Promise.resolve();
        }
        expect(chegou).toBe(true);
        expect(resposta.texto).toContain('Pausa concluída');
        expect(escritorio.necessidadesDe('Mark').fome).toBeLessThan(80);
        expect(escritorio.emPausa('Mark')).toBe(false);
    });

    test('sem o item pedido, a ferramenta explica em vez de travar', async () => {
        const escritorio = simulacao('trabalhando');
        expect(await escritorio.pedirPausa('Mark', 'descansando', 5)).toContain('Não há nenhum item');
    });

    test('ocioso com fome aguarda a própria decisão', () => {
        const escritorio = simulacao('ocioso', 95);
        try {
            for (let passo = 0; passo < 1200; passo++) escritorio.avancar(0.1);
            expect(escritorio.emPausa('Mark')).toBe(false);
            expect(escritorio.necessidadesDe('Mark').fome).toBeGreaterThanOrEqual(95);
        } finally { escritorio.encerrar(); }
    });
});
