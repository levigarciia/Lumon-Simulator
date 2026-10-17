import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Partida } from '../electron/services/partida';
import { Persistencia } from '../electron/services/persistencia';
import { estadoInicial, type EstadoSalvo } from '../shared/estado';

test('reinício limpa todo o progresso em disco e ignora gravações e eventos de sessões antigas', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-reinicio-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    estado.moedas = 73;
    estado.projetos = [{ id: '00000000-0000-4000-8000-000000000002', nome: 'Externo', pasta: 'C:/projeto-preservado' }];
    estado.geral = [{ id: 'fala', autorId: 'usuario', texto: 'Antiga', criadaEm: '', ferramentas: [] }];
    estado.sala.itens = [{ id: '00000000-0000-4000-8000-000000000001', tipo: 'aparador_cafe', celula: { x: 9, z: 0 }, rotacao: 0 }];
    let eventos = 0;
    const partida = new Partida(estado, persistencia, () => eventos++, pasta);
    const antigo = partida.obter();
    const gravarAntigo = antigo['salvar'];
    const emitirAntigo = antigo['emitir'];
    try {
        persistencia.salvar(estado);
        const pendente = persistencia.descarregar();
        expect(await partida.reiniciar()).toEqual({ ok: true });
        await pendente;
        expect(partida.obter()).not.toBe(antigo);
        expect(partida.obter().publico().funcionarios).toEqual([]);
        const depois = eventos;
        gravarAntigo(estado);
        emitirAntigo({ tipo: 'geral', mensagens: estado.geral });
        expect(eventos).toBe(depois);
        await persistencia.descarregar();
        expect(await persistencia.carregar()).toEqual(estadoInicial());
        expect(partida.obter().mensagensGeral()).toEqual([]);
    } finally {
        partida.encerrar();
        await persistencia.descarregar();
    }
});

test('falha ao reiniciar restaura uma partida utilizável e permite nova tentativa', async () => {
    let salvo: EstadoSalvo = { ...estadoInicial(), moedas: 123 };
    let falhar = true;
    const partida = new Partida(salvo, {
        salvar: (estado) => { salvo = estado; },
        descarregar: async () => { if (falhar) throw new Error('Disco indisponível'); },
    }, () => {}, await mkdtemp(join(tmpdir(), 'lumon-reinicio-falha-')));
    try {
        expect(await partida.reiniciar()).toEqual({ ok: false, erro: 'Disco indisponível' });
        expect(partida.obter().publico().moedas).toBe(123);
        expect(salvo.moedas).toBe(123);
        falhar = false;
        expect(await partida.reiniciar()).toEqual({ ok: true });
        expect(partida.obter().publico().moedas).toBe(600);
    } finally { partida.encerrar(); }
});
