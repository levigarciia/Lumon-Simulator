import { expect, test } from 'bun:test';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import { capacidadeItem, celulaDeUso, salaVazia, type TipoItem } from '../shared/escritorio';
import { necessidadesIniciais } from '../shared/necessidades';
import type { Funcionario } from '../shared/funcionarios';
import { falasDoChat } from '../shared/geral';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const equipe: Funcionario[] = ['Ana', 'Bia', 'Caio'].map((nome, indice) => ({
    id: nome, nome, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false, contratadoEm: '',
    modelo: { provedor: 'local', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
}));

function salaCom(tipo: TipoItem) {
    return { ...salaVazia, itens: [
        ...equipe.map((pessoa, indice) => ({ id: pessoa.mesaId, tipo: 'mesa' as const,
            celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0 as const })),
        { id: 'pausa', tipo, celula: { x: 12, z: 0 }, rotacao: 0 as const },
    ] };
}

for (const [tipo, atividade] of [['aparador_cafe', 'cafe'], ['maquina_guloseimas', 'comendo'],
    ['sofa', 'descansando']] as const) {
    test(`${tipo} comporta duas pessoas em posições distintas e mantém os prazos independentes`, async () => {
        const sala = salaCom(tipo);
        const encontros: string[][] = [];
        const encerrados: string[][] = [];
        let agora = 0;
        const simulacao = new SimulacaoEscritorio({
            sala: () => sala, funcionarios: () => equipe, statusTrabalho: () => 'ocioso',
            relogioInicial: 0, necessidadesIniciais: Object.fromEntries(equipe.map((pessoa) =>
                [pessoa.id, { ...necessidadesIniciais, fome: 95, energia: 10, estresse: 90 }])),
            gravar: () => {}, emitirQuadro: () => {}, emitirEstado: () => {}, automatica: false,
            agoraPausaMs: () => agora,
            aoCompartilharPausa: (id, colega) => encontros.push([id, colega]),
            aoEncerrarCompanhia: (id, colega) => encerrados.push([id, colega]),
        });
        try {
            const ana = simulacao.pedirPausa('Ana', atividade, 1);
            const bia = simulacao.pedirPausa('Bia', atividade, 5);
            expect(await simulacao.pedirPausa('Caio', atividade, 1)).toContain('ocupados');
            for (let passo = 0; passo < 300; passo++) simulacao.avancar(0.1);
            expect(simulacao.ocupantes().get('pausa')).toHaveLength(2);
            expect(encontros).toHaveLength(1);
            expect(simulacao.agentes()[0]!.posicao).not.toEqual(simulacao.agentes()[1]!.posicao);
            expect(simulacao.parceiroDePausa('Ana')).toBe('Bia');
            expect(simulacao.podeResponderSocialmente('Ana')).toBe(false);
            expect(simulacao.podeResponderSocialmente('Ana', 'Caio')).toBe(false);
            expect(simulacao.podeResponderSocialmente('Ana', 'Bia')).toBe(true);
            const posicoes = simulacao.agentes().slice(0, 2).map((agente) => agente.posicao);
            expect(await simulacao.encontrarColega('Ana', 'Bia')).toContain('sem sair');
            simulacao.avancar(0.1);
            expect(simulacao.agentes().slice(0, 2).map((agente) => agente.posicao)).toEqual(posicoes);
            agora = 60000;
            simulacao.avancar(0.1);
            expect(await ana).toContain('Pausa concluída');
            expect(simulacao.emPausa('Bia')).toBe(true);
            expect(encerrados).toHaveLength(1);
            expect(simulacao.parceiroDePausa('Bia')).toBeUndefined();
            agora = 300000;
            simulacao.avancar(0.1);
            expect(await bia).toContain('Pausa concluída');
        } finally { simulacao.encerrar(); }
    });
}

test('pontos adicionais giram junto do objeto e a vitrola mantém uma vaga', () => {
    for (const rotacao of [0, 1, 2, 3] as const) {
        const item = { id: 'pausa', tipo: 'sofa' as const, rotacao, celula: { x: 10, z: 10 } };
        expect(capacidadeItem(item)).toBe(2);
        expect(celulaDeUso(item, 0)).not.toEqual(celulaDeUso(item, 1));
    }
    expect(capacidadeItem({ tipo: 'vitrola' })).toBe(1);
});

test('companhia incentiva conversa privada no item e encerra o diálogo quando uma pausa termina', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe;
    estado.sala = salaCom('sofa');
    estado.social.eventos.push({ id: 'conversa-antiga', sequencia: 1, tipo: 'reservado',
        autorId: 'Ana', alvoId: 'Bia', texto: 'A máquina está livre. Vou entrar em pausa.',
        alcance: 'reservado', ouvintes: ['Ana', 'Bia'], fontes: [], criadoEm: '2020-01-01T00:00:00.000Z' });
    estado.geral.push({ id: 'geral-antigo', autorId: 'Ana', texto: 'Preciso comer antes do próximo arquivo.',
        criadaEm: '2020-01-01T00:00:00.000Z', ferramentas: [] });
    estado.necessidades = Object.fromEntries(equipe.map((pessoa) =>
        [pessoa.id, { ...necessidadesIniciais, energia: 10 }]));
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    const cliente = new Client({ name: 'companhia-de-pausa', version: '1' });
    let agora = 0;
    const simulacao = escritorio['simulacao'];
    simulacao['registro'].agoraPausaMs = () => agora;
    const prompts: string[] = [];
    const pendente = Promise.withResolvers<void>();
    let turnos = 0;
    escritorio['geral']['abrirSessao'] = (_pessoa, configuracao) => ({
        enviar: async (prompt, ouvinte, sinal, opcoes) => {
            expect(configuracao.instrucoes).toContain('Somente vocês dois recebem');
            expect(opcoes?.ferramentas).not.toContain('fazer_pausa');
            expect(opcoes?.ferramentas).toContain('conversar_reservado');
            prompts.push(prompt);
            turnos++;
            if (turnos === 1) { ouvinte.texto('Qual café você mais gosta?'); return; }
            pendente.resolve();
            await new Promise<void>((resolver) => sinal.addEventListener('abort', () => resolver(), { once: true }));
        }, encerrar: () => {},
    });
    try {
        const ana = escritorio['fazerPausa']('Ana', 'descansando', 1, 'geral');
        const bia = escritorio['fazerPausa']('Bia', 'descansando', 5, 'geral');
        expect(await ana).toContain('Pausa iniciada');
        expect(await bia).toContain('Pausa iniciada');
        for (let passo = 0; passo < 300; passo++) simulacao.avancar(0.1);
        await pendente.promise;
        const url = await escritorio['mcp'].urlDe('Ana', 'reservado');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        expect((await cliente.callTool({ name: 'falar_no_geral',
            arguments: { mensagem: 'Vou avisar a equipe.' } })).isError).toBe(true);
        expect((await cliente.callTool({ name: 'conversar_reservado',
            arguments: { funcionario: 'Caio', mensagem: 'Vamos sair daqui.', fontes: [] } })).isError).toBe(true);
        expect(prompts[0]).toContain('conversa à toa');
        expect(prompts[0]).toContain('Bia [Bia] também já está em pausa no mesmo item');
        expect(prompts[1]).toContain('Ana [Ana] também já está em pausa no mesmo item');
        for (const prompt of prompts) {
            expect(prompt).toContain('Você já está em pausa em Sofá');
            expect(prompt).not.toContain('Seu corpo pede pausa:');
            expect(prompt).toContain('Não precisa iniciar outra pausa');
            expect(prompt.split('Histórico deste diálogo privado:')[1]).not.toContain('Vou entrar em pausa');
            expect(prompt).not.toContain('Falas recentes no Geral');
            expect(prompt).toEndWith('sem narrar estas instruções.');
            expect(prompt).toContain('Não ofereça a vaga que vocês já ocupam');
        }
        const conversa = escritorio.publico().social.eventos.find((evento) =>
            evento.texto === 'Qual café você mais gosta?')!;
        expect(conversa.alcance).toBe('reservado');
        expect(conversa.ouvintes.sort()).toEqual(['Ana', 'Bia']);
        expect(escritorio.mensagensGeral().map((mensagem) => mensagem.id)).toEqual(['geral-antigo']);
        expect(falasDoChat([], [conversa])[0]!.participantes).toEqual(['Ana', 'Bia']);
        const energiaAntes = simulacao.necessidadesDe('Bia').energia;
        agora = 30000;
        simulacao.avancar(0.1);
        expect(simulacao.necessidadesDe('Bia').energia).toBeGreaterThan(energiaAntes);
        expect(simulacao.necessidadesDe('Bia').fome).toBe(estado.necessidades.Bia!.fome);
        expect(simulacao.emPausa('Ana')).toBe(true);
        agora = 60000;
        simulacao.avancar(0.1);
        await Bun.sleep(20);
        expect(simulacao.emPausa('Ana')).toBe(false);
        expect(simulacao.emPausa('Bia')).toBe(true);
        expect(simulacao.contextoPausa('Bia')).toContain('sem companhia');
        expect(escritorio['geral'].situacao().reservadosAtivos).toEqual([]);
    } finally { await cliente.close(); escritorio.encerrar(); }
});
