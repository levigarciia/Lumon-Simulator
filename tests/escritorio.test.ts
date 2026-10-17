import { describe, expect, test } from 'bun:test';
import { avancarAgente, criarAgente, reajustarAgente, type ContextoSimulacao, type Ordem } from '../shared/agentes';
import { encontrarRota } from '../shared/caminhos';
import {
    celulaDeUso,
    celulasOcupadas,
    comItem,
    criarVerificadorLivre,
    salaVazia,
    validarSala,
    type ItemPosicionado,
    type Sala,
} from '../shared/escritorio';
import { lerRelogio } from '../shared/relogio';

const mesa: ItemPosicionado = { id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 };
const cafe: ItemPosicionado = { id: 'cafe', tipo: 'aparador_cafe', celula: { x: 1, z: 0 }, rotacao: 0 };
const sala: Sala = { ...salaVazia, itens: [mesa, cafe] };

function simular(
    contexto: ContextoSimulacao,
    passos: number,
    ordem: Ordem = { tipo: 'mesa' },
    inicial = criarAgente('a', 'mesa', contexto),
) {
    let agente = inicial;
    const atividades = new Set<string>();
    for (let passo = 0; passo < passos; passo++) {
        contexto.agoraSegundos += 0.1;
        agente = avancarAgente(agente, contexto, 0.1, ordem);
        atividades.add(agente.atividade);
    }
    return { agente, atividades };
}

describe('sala', () => {
    test('rotação desloca o ponto de uso para a frente do item', () => {
        const norte: ItemPosicionado = { id: 'n', tipo: 'mesa', celula: { x: 2, z: 2 }, rotacao: 2 };
        const sofa: ItemPosicionado = { id: 's', tipo: 'sofa', celula: { x: 0, z: 3 }, rotacao: 3 };
        expect(celulaDeUso(norte)).toEqual({ x: 3, z: 1 });
        expect(celulasOcupadas(sofa)).toEqual([
            { x: 0, z: 3 },
            { x: 0, z: 4 },
        ]);
        expect(celulaDeUso(sofa)).toEqual({ x: 1, z: 4 });
    });

    test('recusa sobreposição, itens fora do piso, entrada ocupada e frente encostada na parede', () => {
        expect(validarSala(sala)).toBeNull();
        expect(validarSala(comItem(sala, { ...mesa, id: 'b' }))).toContain('sobre outro item');
        expect(validarSala(comItem(sala, { ...mesa, celula: { x: 14, z: 0 } }))).toContain('sai da sala');
        expect(validarSala(comItem(sala, { ...mesa, celula: { x: 7, z: 0 } }))).toContain('entrada');
        expect(validarSala(comItem(sala, { ...mesa, celula: { x: 3, z: 0 }, rotacao: 2 }))).toContain('inacessível');
    });
});

test('rotas contornam móveis', () => {
    const rota = encontrarRota({ x: 6, z: 4 }, { x: 6, z: 6 }, criarVerificadorLivre(sala));
    expect(rota).not.toBeNull();
    expect(rota!.every(criarVerificadorLivre(sala))).toBe(true);
});

describe('agentes', () => {
    test('entram pela porta e só vão ao café quando há ordem de pausa', () => {
        const contexto: ContextoSimulacao = { sala, agoraSegundos: 0, sortear: () => 0 };
        const { agente, atividades } = simular(contexto, 400);
        expect(atividades.has('andando')).toBe(true);
        expect(agente.atividade).toBe('trabalhando');
        const { atividades: naPausa } = simular(contexto, 400, { tipo: 'item', itemId: 'cafe' }, agente);
        expect(naPausa.has('cafe')).toBe(true);
    });

    test('sem ordem de pausa, não saem da mesa', () => {
        const contexto: ContextoSimulacao = { sala, agoraSegundos: 0, sortear: () => 0 };
        const { agente, atividades } = simular(contexto, 4000);
        expect(atividades.has('cafe')).toBe(false);
        expect(agente.atividade).toBe('trabalhando');
    });

    test('refazem o trajeto quando a mesa é movida', () => {
        const contexto: ContextoSimulacao = { sala, agoraSegundos: 0, sortear: () => 0 };
        const { agente } = simular(contexto, 400);
        contexto.sala = comItem(sala, { ...mesa, celula: { x: 10, z: 8 } });
        const reajustado = reajustarAgente(agente, contexto);
        const { agente: final } = simular(contexto, 400, { tipo: 'mesa' }, reajustado);
        expect(final.posicao).toEqual({ x: 10.5, z: 9.5 });
        expect(final.atividade).toBe('trabalhando');
    });
});

test('relógio começa às 09:00 e vira o dia após o expediente', () => {
    expect(lerRelogio(0)).toEqual({ dia: 1, hora: '09:00' });
    expect(lerRelogio(9 * 60 + 42)).toEqual({ dia: 2, hora: '09:42' });
});
