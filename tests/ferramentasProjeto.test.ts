import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caminhoDoProjeto } from '../electron/services/harness/ferramentasLocais';

test('links para destinos inexistentes fora do projeto são recusados', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-caminhos-'));
    const raiz = join(pasta, 'projeto');
    await mkdir(raiz);
    await symlink(join(pasta, 'externo-ainda-ausente'), join(raiz, 'atalho'), 'junction');
    await expect(caminhoDoProjeto(raiz, 'atalho/novo.txt')).rejects.toThrow();
});
