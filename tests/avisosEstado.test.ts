import { expect, test } from 'bun:test';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { CanalGeral } from '../electron/services/geral';
import { Escritorio } from '../electron/services/escritorio';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import { nomeDoFuncionario, type Funcionario, type StatusFuncionario } from '../shared/funcionarios';
import { necessidadesIniciais } from '../shared/necessidades';
import { relacaoInicial } from '../shared/social';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FichaSocial } from '../src/components/FichaSocial';

const funcionario: Funcionario = {
    id: 'ana', nome: 'Ana', cargo: 'refinador', mesaId: 'mesa', autonomia: false, contratadoEm: '',
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
};

test('aviso periódico aguarda disponibilidade e nunca inicia pausa', () => {
    let status: StatusFuncionario = 'ocioso';
    let conversando = false;
    let social = false;
    let avisos = 0;
    const simulacao = new SimulacaoEscritorio({
        sala: () => estadoInicial().sala, funcionarios: () => [funcionario],
        statusTrabalho: () => status, emConversa: () => conversando, emTurnoSocial: () => social,
        relogioInicial: 0, necessidadesIniciais: { ana: { ...necessidadesIniciais, fome: 95 } },
        gravar: () => {}, emitirQuadro: () => {}, emitirEstado: () => {}, automatica: false,
        aoOcioso: () => { avisos++; },
    });
    try {
        simulacao.avancar(1);
        simulacao.avancar(119);
        expect(avisos).toBe(0);
        simulacao.avancar(1);
        expect(avisos).toBe(1);
        expect(simulacao.emPausa('ana')).toBe(false);
        for (const ocupado of ['trabalhando', 'bloqueado'] as const) {
            status = ocupado;
            simulacao.avancar(120);
            expect(avisos).toBe(1);
        }
        status = 'ocioso';
        conversando = true;
        simulacao.avancar(120);
        conversando = false;
        social = true;
        simulacao.avancar(120);
        expect(avisos).toBe(1);
        social = false;
        simulacao.avancar(1);
        expect(avisos).toBe(2);
        simulacao.avancar(119);
        expect(avisos).toBe(2);
        simulacao.avancar(1);
        expect(avisos).toBe(3);
    } finally { simulacao.encerrar(); }
});

test('retorno da pausa encerra a vez com estado privado sem sugerir anúncio ou continuação automática', async () => {
    const sala = estadoInicial().sala;
    sala.itens = [
        { id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 },
        { id: 'lanche', tipo: 'maquina_guloseimas', celula: { x: 10, z: 0 }, rotacao: 0 },
    ];
    const simulacao = new SimulacaoEscritorio({
        sala: () => sala, funcionarios: () => [funcionario], statusTrabalho: () => 'ocioso',
        relogioInicial: 0,
        necessidadesIniciais: { ana: { ...necessidadesIniciais, fome: 95, energia: 10, estresse: 90 } },
        gravar: () => {}, emitirQuadro: () => {}, emitirEstado: () => {}, automatica: false,
    });
    try {
        const retorno = simulacao.pedirPausa('ana', 'comendo', 1);
        for (let passo = 0; passo < 1000 && simulacao.emPausa('ana'); passo++) simulacao.avancar(0.1);
        const texto = await retorno;
        expect(texto).toContain('1 minuto real');
        expect(texto).toContain('Estado privado');
        expect(texto).toContain('Sua vez terminou');
        expect(simulacao.emPausa('ana')).toBe(false);
    } finally { simulacao.encerrar(); }
});

test('aviso oferece ferramentas de pausa e permite silêncio mesmo após o limite social', async () => {
    const prompts: string[] = [];
    const canal = new CanalGeral({
        funcionarios: () => [funcionario], mensagens: () => [], gravar: () => {},
        contexto: () => 'energia 10, fome 95', urlMcp: async () => 'http://127.0.0.1', pasta: '.',
        emitirMensagens: () => {}, emitirEstado: () => {},
    }, () => ({
        enviar: async (prompt, ouvinte, _sinal, opcoes) => {
            prompts.push(prompt);
            expect(opcoes?.ferramentas).toBeUndefined();
            ouvinte.texto('(silêncio)');
        },
        encerrar: () => {},
    }));
    try {
        canal['falasSeguidas'] = 999;
        canal.avisarEstado('ana');
        canal.avisarEstado('ana');
        await Bun.sleep(20);
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('energia 10, fome 95');
        expect(prompts[0]).toContain('Não é uma ordem da Diretoria');
    } finally { canal.encerrar(); }
});

test('aviso inclui pensamento e relações do autor com nomes distintos dos demitidos', async () => {
    const estado = estadoInicial();
    const ana = { ...funcionario, id: '11111111-1111-4111-8111-111111111111' };
    const bia = { ...funcionario, id: '22222222-2222-4222-8222-222222222222', nome: 'Bia' };
    const caio = { ...funcionario, id: '33333333-3333-4333-8333-333333333333', nome: 'Caio' };
    const davi = { ...funcionario, id: '44444444-4444-4444-8444-444444444444', nome: 'Davi' };
    estado.funcionarios = [ana, bia];
    estado.pensamentos = {
        [ana.id]: { texto: 'Quero descansar antes de conversar com Bia.', atualizadoEm: new Date().toISOString() },
        [bia.id]: { texto: 'Meu pensamento exclusivo da Bia.', atualizadoEm: new Date().toISOString() },
    };
    estado.social.relacoes = [
        { ...relacaoInicial(ana.id, bia.id), confianca: 76 },
        { ...relacaoInicial(ana.id, caio.id), ressentimento: 23 },
        { ...relacaoInicial(ana.id, davi.id), afinidade: 81 },
        { ...relacaoInicial(bia.id, caio.id), confianca: 19 },
    ];
    estado.demissoes = [caio, davi].map((pessoa, indice) => ({
        id: indice === 0 ? '55555555-5555-4555-8555-555555555555' : '66666666-6666-4666-8666-666666666666',
        funcionario: pessoa, motivo: 'Decisão da Diretoria.', demitidoPor: 'Diretoria',
        data: new Date().toISOString(), evidencias: [], historicoSocial: [],
    }));
    const salvo = esquemaEstado.parse(JSON.parse(JSON.stringify(estado)));
    const escritorio = new Escritorio(salvo, () => {}, () => {}, 'C:/temporario');
    const prompts: string[] = [];
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (prompt, ouvinte) => {
            prompts.push(prompt);
            ouvinte.texto('(silêncio)');
        }, encerrar: () => {},
    });
    try {
        escritorio['geral'].avisarEstado(ana.id);
        await Bun.sleep(20);
        expect(prompts).toHaveLength(1);
        const prompt = prompts[0]!;
        expect(prompt).toContain('Aviso periódico:');
        expect(prompt).toContain(estado.pensamentos[ana.id]!.texto);
        expect(prompt).not.toContain(estado.pensamentos[bia.id]!.texto);
        expect(prompt).toContain(`Bia [${bia.id}]: confiança 76`);
        expect(prompt).toContain(`Caio (demitido) [${caio.id}]`);
        expect(prompt).toContain(`Davi (demitido) [${davi.id}]`);
        expect(prompt).not.toContain('confiança 19');
        expect(escritorio['contextoGeral'](bia.id)).not.toContain(estado.pensamentos[ana.id]!.texto);
        const ficha = renderToStaticMarkup(createElement(FichaSocial, {
            id: ana.id, social: salvo.social, funcionarios: salvo.funcionarios, demissoes: salvo.demissoes,
        }));
        expect(ficha).toContain('Caio (demitido)');
        expect(ficha).toContain('Davi (demitido)');
        expect(ficha).not.toContain('Ex funcionário');
        expect(nomeDoFuncionario('registro_antigo', [], [])).toBe('registro_antigo');
    } finally { escritorio.encerrar(); }
});
