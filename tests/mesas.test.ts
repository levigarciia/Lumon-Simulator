import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { Escritorio } from '../electron/services/escritorio';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { celulaDeUso, centroCelula, salaVazia, type ItemPosicionado, type Sala } from '../shared/escritorio';
import { estadoInicial, type EstadoPublico, type EstadoSalvo } from '../shared/estado';
import { esquemaFuncionario, type Funcionario, type StatusFuncionario } from '../shared/funcionarios';
import { reconciliarMesas } from '../shared/mesas';
import { lugarNoAnexo } from '../shared/anexos';
import { escolherLugarEncontro } from '../shared/encontros';

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
    test('libera mesas antigas dos cargos sociais antes de distribuir as vagas', () => {
        const supervisor = { ...funcionario('supervisor', mesa.id), cargo: 'supervisor' as const };
        const conselheiro = { ...funcionario('conselheiro', 'antiga'), cargo: 'conselheiro' as const };
        const resultado = reconciliarMesas([supervisor, conselheiro, funcionario('refinador', '')],
            { ...salaVazia, itens: [mesa] });
        expect(resultado.map((pessoa) => pessoa.mesaId)).toEqual(['', '', mesa.id]);
    });

    test('contrata cargos sociais sem mesa e exige mesa para voltar ao refinamento', () => {
        const escritorio = new Escritorio({ ...estadoInicial(), sala: salaVazia, funcionarios: [] },
            () => {}, () => {}, tmpdir());
        try {
            const { id, mesaId, contratadoEm, ...dados } = funcionario('Pessoa', '');
            expect(escritorio.contratar({ ...dados, cargo: 'supervisor' }).ok).toBe(true);
            expect(escritorio.contratar({ ...dados, cargo: 'conselheiro' }).ok).toBe(true);
            expect(escritorio.contratar({ ...dados, cargo: 'refinador' }).ok).toBe(false);
            const [supervisor, conselheiro] = escritorio.publico().funcionarios;
            expect([supervisor.mesaId, conselheiro.mesaId]).toEqual(['', '']);
            expect(esquemaFuncionario.safeParse(supervisor).success).toBe(true);
            expect(esquemaFuncionario.safeParse(conselheiro).success).toBe(true);
            expect(esquemaFuncionario.safeParse({ ...supervisor, cargo: 'lider' }).success).toBe(false);
            expect(escritorio.editar(supervisor.id, { ...dados, cargo: 'lider' }).ok).toBe(false);
            expect(escritorio.publico().funcionarios[0].cargo).toBe('supervisor');
        } finally {
            escritorio.encerrar();
        }
    });

    test('supervisor circula em pé e conselheiro permanece no anexo sem ficar indisponível', () => {
        const estado = { sala: salaVazia, funcionarios: [
            { ...funcionario('supervisor', ''), cargo: 'supervisor' as const },
            { ...funcionario('conselheiro', ''), cargo: 'conselheiro' as const },
        ] };
        const simulacao = simulacaoManual(estado);
        const posicoes = new Set<string>();
        const atividades = new Set<string>();
        for (let passo = 0; passo < 2400; passo++) {
            simulacao.avancar(0.1);
            const [supervisor] = simulacao.agentes();
            posicoes.add(`${Math.round(supervisor.posicao.x)}:${Math.round(supervisor.posicao.z)}`);
            atividades.add(supervisor.atividade);
        }
        const [supervisor, conselheiro] = simulacao.agentes();
        expect(posicoes.size).toBeGreaterThan(2);
        expect(atividades.has('observando')).toBe(true);
        expect(atividades.has('trabalhando')).toBe(false);
        expect(supervisor.destinoId).toBe('ronda');
        expect(conselheiro.posicao).toEqual(lugarNoAnexo(salaVazia, 'bem_estar', 0).posicao);
        expect(conselheiro.anexo).toBe('bem_estar');
        expect(simulacao.emPausa('conselheiro')).toBe(false);
        expect(simulacao.podeResponderSocialmente('conselheiro')).toBe(true);
        expect(escolherLugarEncontro(salaVazia, conselheiro.posicao, supervisor.posicao, [])).toBeDefined();
    });

    test('sessão reserva o assento do atendido e libera os cargos sociais depois do retorno', () => {
        const estado = { sala: { ...salaVazia, itens: [mesa] }, funcionarios: [
            { ...funcionario('supervisor', ''), cargo: 'supervisor' as const },
            { ...funcionario('conselheiro', ''), cargo: 'conselheiro' as const },
            funcionario('refinador', mesa.id),
        ] };
        const simulacao = simulacaoManual(estado);
        for (let passo = 0; passo < 1200; passo++) simulacao.avancar(0.1);
        expect(simulacao.validarAfastamento(['refinador', 'conselheiro'], 'bem_estar')).toBeUndefined();
        const sessao = { motivo: 'bem_estar' as const, autorId: 'conselheiro', justificativa: 'Sessão' };
        expect(simulacao.afastar('refinador', sessao, 5)).toBeUndefined();
        expect(simulacao.afastar('conselheiro', sessao, 5)).toBeUndefined();
        expect(simulacao.ausenciaDe('refinador')?.lugar).toBe(1);
        expect(simulacao.ausenciaDe('conselheiro')?.lugar).toBe(0);
        expect(simulacao.afastar('supervisor', {
            motivo: 'folga', autorId: 'diretoria', justificativa: 'Descanso',
        }, 5)).toBeUndefined();
        for (let passo = 0; passo < 2000; passo++) simulacao.avancar(0.1);
        expect(simulacao.todasAusencias()).toEqual({});
        expect(simulacao.agentes().find((agente) => agente.id === 'conselheiro')?.anexo).toBe('bem_estar');
        expect(simulacao.agentes().find((agente) => agente.id === 'supervisor')?.destinoId).toBe('ronda');
        expect(simulacao.agentes().find((agente) => agente.id === 'refinador')?.atividade).toBe('trabalhando');
    });

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
