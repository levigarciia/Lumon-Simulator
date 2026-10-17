import { expect, test } from 'bun:test';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { criarVerificadorCirculacao } from '../shared/circulacao';
import { anexosDaSala, capacidadeAnexo, lugarNoAnexo, portaDoAnexo } from '../shared/anexos';
import { celulaAcessoAnexos, celulaDoPonto, salaVazia, validarSala, type Sala } from '../shared/escritorio';
import { encontrarRota } from '../shared/caminhos';
import type { Funcionario } from '../shared/funcionarios';
import type { Ausencia } from '../shared/ausencias';

function preparar(ausencias: Record<string, Ausencia> = {}) {
    const equipe = ['ana', 'bia', 'caio', 'duda'].map((id, indice): Funcionario => ({
        id, nome: id, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false,
        contratadoEm: '2026-10-17T12:00:00.000Z', modelo: { provedor: 'codex', id: 'controlado', nome: 'Controlado' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    const sala: Sala = { ...salaVazia, itens: equipe.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 1 + indice * 3, z: 2 }, rotacao: 0,
    })) };
    let salvas = ausencias;
    const retornos: string[] = [];
    const simulacao = new SimulacaoEscritorio({ sala: () => sala, funcionarios: () => equipe,
        statusTrabalho: () => 'ocioso', relogioInicial: 0, necessidadesIniciais: {}, automatica: false,
        ausenciasIniciais: ausencias, gravar: () => {}, emitirQuadro: () => {}, emitirEstado: () => {},
        gravarAusencias: (atual) => { salvas = structuredClone(atual); },
        aoRetornar: (id) => { retornos.push(id); },
    });
    return { simulacao, sala, salvas: () => salvas, retornos };
}

test('todas as vagas têm rota de ida e volta pelas portas, sem atravessar paredes ou móveis', () => {
    const livre = criarVerificadorCirculacao(salaVazia);
    const origem = celulaAcessoAnexos(salaVazia);
    for (const anexo of anexosDaSala(salaVazia)) {
        for (let indice = 0; indice < capacidadeAnexo[anexo.tipo]; indice++) {
            const destino = celulaDoPonto(lugarNoAnexo(salaVazia, anexo.tipo, indice).posicao);
            const rota = encontrarRota(origem, destino, livre)!;
            expect(rota).not.toBeNull();
            expect(rota).toContainEqual(portaDoAnexo(anexo));
            expect(rota.every(livre)).toBe(true);
            expect(encontrarRota(destino, origem, livre)).not.toBeNull();
        }
        expect(livre({ x: anexo.x, z: anexo.z })).toBe(false);
    }
    expect(livre({ x: salaVazia.largura, z: origem.z - 1 })).toBe(false);
});

test('permanência começa ao chegar e retorno caminha até a mesa mantendo a indisponibilidade', () => {
    const { simulacao, sala, retornos } = preparar();
    expect(simulacao.afastar('ana', {
        motivo: 'sala_descanso', autorId: 'diretoria', justificativa: 'Validação.',
    }, 2)).toBeUndefined();
    let anterior = simulacao.agentes()[0].posicao;
    let chegou = false;
    let retornouPeloCorredor = false;
    for (let passo = 0; passo < 2000 && !retornos.length; passo++) {
        simulacao.avancar(0.1);
        const agente = simulacao.agentes()[0];
        expect(Math.hypot(agente.posicao.x - anterior.x, agente.posicao.z - anterior.z)).toBeLessThanOrEqual(0.141);
        anterior = agente.posicao;
        const ausencia = simulacao.ausenciaDe('ana');
        if (agente.anexo && !chegou) {
            chegou = true;
            expect(ausencia?.terminaEm).toBeCloseTo(simulacao.segundosAtuais() + 2);
        }
        if (ausencia?.retornando && agente.posicao.x >= sala.largura && agente.posicao.x < sala.largura + 2) {
            retornouPeloCorredor = true;
            expect(simulacao.emPausa('ana')).toBe(true);
        }
    }
    expect(chegou).toBe(true);
    expect(retornouPeloCorredor).toBe(true);
    expect(retornos).toEqual(['ana']);
    expect(simulacao.agentes()[0]).toMatchObject({ atividade: 'trabalhando', destinoId: 'mesa0' });
    expect(simulacao.emPausa('ana')).toBe(false);
});

test('lotação recusa novos afastamentos e lugares persistidos não mudam quando alguém sai', () => {
    const { simulacao, sala, salvas } = preparar();
    for (const id of ['ana', 'bia', 'caio']) {
        expect(simulacao.afastar(id, {
            motivo: 'sala_descanso', autorId: 'diretoria', justificativa: 'Validação.',
        }, 180)).toBeUndefined();
    }
    expect(simulacao.afastar('duda', {
        motivo: 'sala_descanso', autorId: 'diretoria', justificativa: 'Validação.',
    }, 180)).toContain('lugares');
    for (let passo = 0; passo < 600; passo++) simulacao.avancar(0.1);
    const salvasBia = { bia: salvas().bia };
    expect(salvasBia.bia.lugar).toBe(1);
    const reaberta = preparar(salvasBia).simulacao;
    expect(reaberta.agentes().find((agente) => agente.id === 'bia')?.posicao)
        .toEqual(lugarNoAnexo(sala, 'sala_descanso', 1).posicao);
    expect(() => lugarNoAnexo(sala, 'bem_estar', 2)).toThrow('Lugar inválido');
});

test('layout preserva o acesso ao corredor e rejeita bloqueios antes da mudança', () => {
    const acesso = celulaAcessoAnexos(salaVazia);
    expect(validarSala({ ...salaVazia, itens: [{ id: 'planta', tipo: 'planta', celula: acesso, rotacao: 0 }] }))
        .toContain('corredor');
    const { simulacao, sala } = preparar();
    sala.itens.push({ id: 'bloqueio', tipo: 'planta', celula: acesso, rotacao: 0 });
    expect(simulacao.afastar('ana', { motivo: 'sala_descanso', autorId: 'diretoria', justificativa: 'Validação.' }, 10))
        .toContain('caminho livre');
    expect(simulacao.todasAusencias()).toEqual({});
});

test('ausências antigas recebem vagas distintas e excedentes retornam sem sobrepor os ocupantes', () => {
    const ausencia: Ausencia = { motivo: 'sala_descanso', autorId: 'diretoria', justificativa: '', terminaEm: 180 };
    const { simulacao } = preparar(Object.fromEntries(['ana', 'bia', 'caio', 'duda'].map((id) => [id, ausencia])));
    const internos = simulacao.agentes().filter((agente) => agente.anexo);
    expect(internos).toHaveLength(3);
    expect(new Set(internos.map((agente) => `${agente.posicao.x}:${agente.posicao.z}`)).size).toBe(3);
    expect(simulacao.ausenciaDe('duda')?.retornando).toBe(true);
    simulacao.avancar(0.1);
    expect(simulacao.ausenciaDe('duda')).toBeUndefined();
});

test('folga restaurada volta pela entrada em vez de reaparecer na mesa', () => {
    const { simulacao, retornos } = preparar({ ana: {
        motivo: 'folga', autorId: 'diretoria', justificativa: '', terminaEm: 1,
    } });
    expect(simulacao.agentes()[0].posicao).toEqual({ x: 7.5, z: 0.5 });
    for (let passo = 0; passo < 30; passo++) simulacao.avancar(0.1);
    expect(simulacao.agentes()[0].atividade).toBe('andando');
    expect(retornos).toEqual([]);
    for (let passo = 0; passo < 200; passo++) simulacao.avancar(0.1);
    expect(retornos).toEqual(['ana']);
});

test('sessão só confirma chegada com ambos no cômodo e interrupção libera a espera', async () => {
    const { simulacao } = preparar();
    for (const id of ['ana', 'bia']) {
        simulacao.afastar(id, { motivo: 'bem_estar', autorId: 'bia', justificativa: 'Validação.' }, 90);
    }
    const espera = simulacao.aguardarChegadaAnexos(['ana', 'bia']);
    expect(simulacao.podeResponderSocialmente('ana', 'bia')).toBe(false);
    for (let passo = 0; passo < 600; passo++) simulacao.avancar(0.1);
    expect(await espera).toBe(true);
    expect(simulacao.podeResponderSocialmente('ana', 'bia')).toBe(true);
    expect(simulacao.podeResponderSocialmente('ana', 'caio')).toBe(false);
    const outra = preparar().simulacao;
    outra.afastar('ana', { motivo: 'bem_estar', autorId: 'bia', justificativa: 'Validação.' }, 90);
    outra.afastar('bia', { motivo: 'bem_estar', autorId: 'bia', justificativa: 'Validação.' }, 90);
    const interrompida = outra.aguardarChegadaAnexos(['ana', 'bia']);
    outra.cancelarEncontro('ana');
    expect(await interrompida).toBe(false);
    expect(outra.ausenciaDe('bia')?.retornando).toBe(true);
});

