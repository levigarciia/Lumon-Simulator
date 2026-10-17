import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Persistencia } from '../electron/services/persistencia';
import { estadoInicial } from '../shared/estado';

async function preparar() {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-persistencia-'));
    const persistencia = new Persistencia(pasta);
    persistencia.salvar(estadoInicial());
    await persistencia.descarregar();
    return { pasta, persistencia };
}

test('falha antes do commit preserva a revisão e permite repetir a gravação', async () => {
    const { pasta, persistencia } = await preparar();
    await mkdir(join(pasta, 'estado.json.tmp'));
    persistencia.salvar({ ...estadoInicial(), moedas: 123 });
    await expect(persistencia.descarregar()).rejects.toThrow();
    expect((await persistencia.carregar()).moedas).toBe(600);
    await rmdir(join(pasta, 'estado.json.tmp'));
    await persistencia.descarregar();
    expect((await persistencia.carregar()).moedas).toBe(123);
});

test('gravações posteriores a uma falha não restauram dados antigos', async () => {
    const { pasta, persistencia } = await preparar();
    await mkdir(join(pasta, 'estado.json.tmp'));
    persistencia.salvar({ ...estadoInicial(), moedas: 100 });
    const primeira = persistencia.descarregar();
    persistencia.salvar({ ...estadoInicial(), moedas: 200 });
    const segunda = persistencia.descarregar();
    expect((await Promise.allSettled([primeira, segunda])).map((item) => item.status))
        .toEqual(['rejected', 'rejected']);
    await rmdir(join(pasta, 'estado.json.tmp'));
    await persistencia.descarregar();
    expect((await persistencia.carregar()).moedas).toBe(200);
});

test('migração preserva o JSON antigo e separa os domínios com conteúdo legível', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-legado-'));
    const legado = JSON.stringify({
        ...estadoInicial(), moedas: 321, identidade: { nome: 'Levi', tratamento: 'chefe' },
    });
    await writeFile(join(pasta, 'lumon.json'), legado);
    const persistencia = new Persistencia(pasta);
    expect((await persistencia.carregar()).moedas).toBe(321);
    expect(await readFile(join(pasta, 'lumon.json'), 'utf8')).toBe(legado);
    const arquivos = await readdir(join(pasta, 'dados'));
    expect(arquivos).toHaveLength(6);
    const equipe = arquivos.find((nome) => nome.startsWith('equipe.'))!;
    expect(JSON.parse(await readFile(join(pasta, 'dados', equipe), 'utf8'))).toHaveProperty('funcionarios');
    expect(await persistencia.carregar()).not.toHaveProperty('identidade');
});

test('arquivo ausente inicia vazio e corrupção é diagnosticada sem apagar o arquivo', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-invalido-'));
    const persistencia = new Persistencia(pasta);
    expect(await persistencia.carregar()).toEqual(estadoInicial());
    await writeFile(join(pasta, 'lumon.json'), '{inválido');
    await expect(persistencia.carregar()).rejects.toThrow('lumon.json');
    expect(await readFile(join(pasta, 'lumon.json'), 'utf8')).toBe('{inválido');
});

test('domínio alterado fora da persistência e domínio ausente geram diagnóstico preciso', async () => {
    const { pasta, persistencia } = await preparar();
    const manifesto = JSON.parse(await readFile(join(pasta, 'estado.json'), 'utf8'));
    const arquivo = join(pasta, 'dados', `equipe.${manifesto.arquivos.equipe}.json`);
    await writeFile(arquivo, '{}');
    await expect(persistencia.carregar()).rejects.toThrow(arquivo);
    expect(await readFile(arquivo, 'utf8')).toBe('{}');
    await unlink(arquivo);
    await expect(persistencia.carregar()).rejects.toThrow(arquivo);
});

test('reutiliza domínios iguais e mantém somente as duas revisões recentes', async () => {
    const { pasta, persistencia } = await preparar();
    const anterior = JSON.parse(await readFile(join(pasta, 'estado.json'), 'utf8'));
    for (const moedas of [100, 200, 300]) {
        persistencia.salvar({ ...estadoInicial(), moedas });
        await persistencia.descarregar();
    }
    const atual = JSON.parse(await readFile(join(pasta, 'estado.json'), 'utf8'));
    expect(atual.arquivos.equipe).toBe(anterior.arquivos.equipe);
    expect(atual.arquivos.escritorio).not.toBe(anterior.arquivos.escritorio);
    expect(await readdir(join(pasta, 'dados'))).toHaveLength(7);
    expect((await persistencia.carregar()).moedas).toBe(300);
});

test('captura o estado ao agendar a gravação', async () => {
    const { persistencia } = await preparar();
    const estado = estadoInicial();
    persistencia.salvar(estado);
    estado.moedas = 1;
    await persistencia.descarregar();
    expect((await persistencia.carregar()).moedas).toBe(600);
});
