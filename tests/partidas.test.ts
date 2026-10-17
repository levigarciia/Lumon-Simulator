import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Partidas } from '../electron/services/partidas';
import { estadoInicial } from '../shared/estado';
import type { EventoLumon } from '../shared/ponte';

async function preparar() {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-escritorios-'));
    const estado = { ...estadoInicial(), moedas: 123 };
    await writeFile(join(pasta, 'lumon.json'), JSON.stringify(estado));
    return { pasta, partidas: await Partidas.abrir(pasta, () => {}) };
}

test('importa o escritório anterior, isola os saves e reabre o último selecionado', async () => {
    const { pasta, partidas } = await preparar();
    const principal = partidas.listar().ativoId;
    const antigo = partidas.obter();
    const salvarAntigo = antigo['salvar'];
    try {
        expect(antigo.publico().moedas).toBe(123);
        expect(await partidas.criar('Cenário alternativo')).toEqual({ ok: true });
        const segundo = partidas.listar().ativoId;
        expect(segundo).not.toBe(principal);
        expect(partidas.listar().escritorios).toHaveLength(2);
        expect(partidas.obter().publico().moedas).toBe(600);
        expect(partidas.obter().comprar('mesa', { x: 3, z: 4 }, 0).ok).toBe(true);
        const moedasSegundo = partidas.obter().publico().moedas;
        salvarAntigo({ ...estadoInicial(), moedas: 1 });
        expect(await partidas.selecionar(principal)).toEqual({ ok: true });
        expect(partidas.obter().publico().moedas).toBe(123);
        expect(partidas.obter().publico().sala.itens).toHaveLength(0);
        expect(await partidas.selecionar(segundo)).toEqual({ ok: true });
        expect(partidas.obter().publico().moedas).toBe(moedasSegundo);
        expect(partidas.obter().publico().sala.itens).toHaveLength(1);
        expect(JSON.parse(await readFile(join(pasta, 'lumon.json'), 'utf8')).moedas).toBe(123);
        await partidas.encerrar();
        const reabertas = await Partidas.abrir(pasta, () => {});
        try {
            expect(reabertas.listar().ativoId).toBe(segundo);
            expect(reabertas.obter().publico().moedas).toBe(moedasSegundo);
            await reabertas.reiniciar();
            expect(reabertas.obter().publico().moedas).toBe(600);
            await reabertas.selecionar(principal);
            expect(reabertas.obter().publico().moedas).toBe(123);
        } finally { await reabertas.encerrar(); }
    } finally { await partidas.encerrar(); }
});

test('falha ao confirmar o catálogo restaura o escritório anterior e permite repetir', async () => {
    const { pasta, partidas } = await preparar();
    const principal = partidas.listar().ativoId;
    try {
        await mkdir(join(pasta, 'escritorios.json.tmp'));
        expect((await partidas.criar('Outro')).ok).toBe(false);
        expect(partidas.listar().ativoId).toBe(principal);
        expect(partidas.listar().escritorios).toHaveLength(1);
        expect(partidas.obter().publico().moedas).toBe(123);
        await rmdir(join(pasta, 'escritorios.json.tmp'));
        expect((await partidas.criar('Outro')).ok).toBe(true);
    } finally { await partidas.encerrar(); }
});

test('escritório corrompido não substitui a partida aberta e IDs arbitrários são recusados', async () => {
    const { pasta, partidas } = await preparar();
    const principal = partidas.listar().ativoId;
    try {
        await partidas.criar('Segundo');
        const segundo = partidas.listar().ativoId;
        await writeFile(join(pasta, 'escritorios', principal, 'estado.json'), '{}');
        expect((await partidas.selecionar(principal)).ok).toBe(false);
        expect(partidas.listar().ativoId).toBe(segundo);
        expect(partidas.obter().publico().moedas).toBe(600);
        expect((await partidas.selecionar('../fora')).ok).toBe(false);
        expect((await partidas.criar('  ')).ok).toBe(false);
    } finally { await partidas.encerrar(); }
});

test('trocas simultâneas são recusadas e sessões encerradas não publicam em outra partida', async () => {
    const { partidas } = await preparar();
    try {
        const primeira = partidas.criar('Segundo');
        expect((await partidas.criar('Terceiro')).ok).toBe(false);
        expect(() => partidas.obter()).toThrow('troca de escritório');
        expect((await primeira).ok).toBe(true);
        expect(partidas.listar().escritorios).toHaveLength(2);
    } finally { await partidas.encerrar(); }
});

test('uma troca não publica o novo estado na cena que ainda pertence ao escritório anterior', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-eventos-troca-'));
    const eventos: EventoLumon[] = [];
    const partidas = await Partidas.abrir(pasta, (evento) => eventos.push(evento));
    try {
        eventos.length = 0;
        expect((await partidas.criar('Outra cena')).ok).toBe(true);
        expect(eventos.filter((evento) => evento.tipo === 'estado')).toEqual([]);
        expect(partidas.obter().publico().funcionarios).toEqual([]);
    } finally { await partidas.encerrar(); }
});
