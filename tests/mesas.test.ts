import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { Escritorio } from '../electron/services/escritorio';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { celulaDeUso, centroCelula, salaVazia, type ItemPosicionado, type Sala } from '../shared/escritorio';
import { estadoInicial, type EstadoPublico, type EstadoSalvo } from '../shared/estado';
import type { Funcionario, StatusFuncionario } from '../shared/funcionarios';
import { reconciliarMesas } from '../shared/mesas';

const mesa: ItemPosicionado = { id: 'mesa_nova', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 };

function funcionario(id: string, mesaId: string): Funcionario {
    return {
        id,
        nome: id,
        mesaId,
        cargo: 'desenvolvedor',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
        autonomia: false,
        contratadoEm: '2026-10-16T00:00:00.000Z',
    };
}

function estadoSemMesa(): EstadoSalvo {
    return { ...estadoInicial(), funcionarios: [funcionario('Roberto', 'mesa_removida')] };
}

function simulacaoManual(estado: { sala: Sala; funcionarios: Funcionario[] }, status: StatusFuncionario = 'trabalhando') {
    return new SimulacaoEscritorio({
        sala: () => estado.sala,
        funcionarios: () => estado.funcionarios,
        statusTrabalho: () => status,
        relogioInicial: 0,
        necessidadesIniciais: {},
        gravar: () => {},
        emitirQuadro: () => {},
        emitirEstado: () => {},
        automatica: false,
    });
}

describe('recuperação de mesas', () => {
    test('reserva as mesas dos donos antes de atender quem perdeu a sua', () => {
        const dono = funcionario('Cláudio', mesa.id);
        const funcionarios = [funcionario('Roberto', 'mesa_removida'), dono];
        const outra = { ...mesa, id: 'outra_mesa', celula: { x: 9, z: 5 } };
        const resultado = reconciliarMesas(funcionarios, { ...salaVazia, itens: [mesa, outra] });
        expect(resultado[0].mesaId).toBe(outra.id);
        expect(resultado[1]).toBe(dono);
        expect(funcionarios[0].mesaId).toBe('mesa_removida');
    });

    test('não atribui a mesma mesa duas vezes nem usa outros tipos de móvel', () => {
        const funcionarios = [funcionario('a', mesa.id), funcionario('b', mesa.id)];
        const cafe: ItemPosicionado = { id: 'cafe', tipo: 'aparador_cafe', celula: { x: 1, z: 0 }, rotacao: 0 };
        const resultado = reconciliarMesas(funcionarios, { ...salaVazia, itens: [mesa, cafe] });
        expect(resultado).toBe(funcionarios);
        const outra = { ...mesa, id: 'outra_mesa' };
        const recuperado = reconciliarMesas(resultado, { ...salaVazia, itens: [mesa, outra] });
        expect(recuperado.map((atual) => atual.mesaId)).toEqual([mesa.id, outra.id]);
    });

    test('recupera e salva a associação ao abrir um escritório com mesa livre', () => {
        const estado = { ...estadoSemMesa(), sala: { ...salaVazia, itens: [mesa] } };
        const salvos: EstadoSalvo[] = [];
        const escritorio = new Escritorio(estado, (atual) => salvos.push(atual), () => {}, tmpdir());
        expect(escritorio.publico().funcionarios[0].mesaId).toBe(mesa.id);
        expect(salvos.at(-1)?.funcionarios[0].mesaId).toBe(mesa.id);
        escritorio.encerrar();
    });

    test('compra de uma mesa recupera o funcionário e ele caminha até ela', () => {
        const salvos: EstadoSalvo[] = [];
        const eventos: EstadoPublico[] = [];
        const escritorio = new Escritorio(
            estadoSemMesa(),
            (atual) => salvos.push(atual),
            (evento) => {
                if (evento.tipo === 'estado') eventos.push(evento.estado);
            },
            tmpdir(),
        );
        expect(escritorio.comprar('mesa', mesa.celula, mesa.rotacao)).toEqual({ ok: true });
        const atualizado = eventos.at(-1)!;
        const comprada = atualizado.sala.itens[0];
        expect(salvos.at(-1)?.funcionarios[0].mesaId).toBe(comprada.id);
        escritorio.encerrar();
        const simulacao = simulacaoManual({ sala: atualizado.sala, funcionarios: atualizado.funcionarios });
        for (let passo = 0; passo < 400; passo++) simulacao.avancar(0.1);
        const [agente] = simulacao.agentes();
        expect(agente.posicao).toEqual(centroCelula(celulaDeUso(comprada)!));
        expect(agente.atividade).toBe('trabalhando');
    });

    test('editar troca o modelo e preserva mesa e identidade', () => {
        const estado = { ...estadoInicial(), sala: { ...salaVazia, itens: [mesa] }, funcionarios: [funcionario('Roberto', mesa.id)] };
        const escritorio = new Escritorio(estado, () => {}, () => {}, tmpdir());
        const { id, mesaId, contratadoEm, ...dados } = escritorio.publico().funcionarios[0];
        const novoModelo = { provedor: 'claude' as const, id: 'sonnet', nome: 'Claude Sonnet' };
        expect(escritorio.editar(id, { ...dados, nome: 'Beto', modelo: novoModelo })).toEqual({ ok: true });
        const editado = escritorio.publico().funcionarios[0];
        expect(editado).toMatchObject({ id, mesaId, contratadoEm, nome: 'Beto', modelo: novoModelo });
        expect(escritorio.editar('inexistente', dados).ok).toBe(false);
        escritorio.encerrar();
    });

    test('atualiza a mesa do agente mesmo quando o layout não muda', () => {
        const estado = { sala: { ...salaVazia, itens: [mesa] }, funcionarios: [funcionario('Roberto', 'mesa_removida')] };
        const simulacao = simulacaoManual(estado);
        simulacao.avancar(0.1);
        estado.funcionarios = [funcionario('Roberto', mesa.id)];
        for (let passo = 0; passo < 400; passo++) simulacao.avancar(0.1);
        const [agente] = simulacao.agentes();
        expect(agente.mesaId).toBe(mesa.id);
        expect(agente.atividade).toBe('trabalhando');
        expect(agente.posicao).toEqual(centroCelula(celulaDeUso(mesa)!));
    });
});
