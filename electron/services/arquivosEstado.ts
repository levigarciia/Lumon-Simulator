import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { esquemaEstado, type EstadoSalvo } from '../../shared/estado';

const dominios = {
    escritorio: esquemaEstado.pick({ versao: true, moedas: true, sala: true, necessidadesLiberadas: true }),
    equipe: esquemaEstado.pick({ funcionarios: true, demissoes: true, carreira: true }),
    simulacao: esquemaEstado.pick({ relogio: true, diaNecessidades: true, necessidades: true, ausencias: true }),
    conversas: esquemaEstado.pick({ conversas: true, geral: true, threads: true, leiturasGeral: true, naoLidas: true }),
    social: esquemaEstado.pick({ social: true, pensamentos: true, historicoPensamentos: true }),
    trabalho: esquemaEstado.pick({ projetos: true, trabalhos: true, refinamentos: true, cota: true }),
};
const nomes = Object.keys(dominios) as (keyof typeof dominios)[];
const esquemaManifesto = z.object({
    versao: z.literal(1),
    salvoEm: z.iso.datetime(),
    arquivos: z.object(Object.fromEntries(nomes.map((nome) => [nome, z.string().regex(/^[a-f0-9]{64}$/)]))),
});

/** Substitui um arquivo somente depois de concluir sua escrita no mesmo volume. */
export async function gravarJsonAtomico(arquivo: string, dados: unknown): Promise<void> {
    await writeFile(`${arquivo}.tmp`, JSON.stringify(dados, null, 4), 'utf8');
    await rename(`${arquivo}.tmp`, arquivo);
}

/** Distingue arquivo ausente de falhas de acesso e inclui o caminho nos erros de diagnóstico. */
export async function lerJson(arquivo: string): Promise<unknown | undefined> {
    let bruto: string;
    try {
        bruto = await readFile(arquivo, 'utf8');
    } catch (erro) {
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`Não foi possível ler ${arquivo}.`, { cause: erro });
    }
    try {
        return JSON.parse(bruto);
    } catch (erro) {
        throw new Error(`JSON inválido em ${arquivo}. O arquivo foi preservado.`, { cause: erro });
    }
}

/** Lê uma revisão completa, validando cada domínio antes de reconstruir o estado da partida. */
export async function lerDominios(pasta: string): Promise<EstadoSalvo | undefined> {
    const caminho = join(pasta, 'estado.json');
    const bruto = await lerJson(caminho);
    if (bruto === undefined) return undefined;
    const validadoManifesto = esquemaManifesto.safeParse(bruto);
    if (!validadoManifesto.success) {
        throw new Error(`Manifesto inválido em ${caminho}: ${validadoManifesto.error.message}`);
    }
    const manifesto = validadoManifesto.data;
    let estado = {};
    for (const nome of nomes) {
        const arquivo = join(pasta, 'dados', `${nome}.${manifesto.arquivos[nome]}.json`);
        const conteudo = await readFile(arquivo, 'utf8').catch((erro: unknown) => {
            throw new Error(`Não foi possível ler ${arquivo}.`, { cause: erro });
        });
        if (createHash('sha256').update(conteudo).digest('hex') !== manifesto.arquivos[nome]) {
            throw new Error(`Integridade inválida em ${arquivo}. O arquivo foi preservado.`);
        }
        const validado = dominios[nome].safeParse(await lerJson(arquivo));
        if (!validado.success) throw new Error(`Estado inválido em ${arquivo}: ${validado.error.message}`);
        estado = { ...estado, ...validado.data };
    }
    return esquemaEstado.parse(estado);
}

/** Publica uma revisão indivisível e reutiliza os domínios que não mudaram pelo hash de seu conteúdo. */
export async function gravarDominios(pasta: string, estado: EstadoSalvo): Promise<number> {
    await mkdir(join(pasta, 'dados'), { recursive: true });
    const arquivos: Record<string, string> = {};
    let bytes = 0;
    for (const nome of nomes) {
        const conteudo = JSON.stringify(dominios[nome].parse(estado), null, 4);
        const hash = createHash('sha256').update(conteudo).digest('hex');
        arquivos[nome] = hash;
        const arquivo = join(pasta, 'dados', `${nome}.${hash}.json`);
        try {
            const existente = await readFile(arquivo, 'utf8');
            if (existente !== conteudo) throw new Error(`Conteúdo divergente em ${arquivo}.`);
        } catch (erro) {
            if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro;
            await writeFile(`${arquivo}.tmp`, conteudo, 'utf8');
            await rename(`${arquivo}.tmp`, arquivo);
        }
        bytes += Buffer.byteLength(conteudo, 'utf8');
    }
    const anterior = await lerJson(join(pasta, 'estado.json'));
    if (anterior !== undefined) {
        await gravarJsonAtomico(join(pasta, 'estado.anterior.json'), esquemaManifesto.parse(anterior));
    }
    await gravarJsonAtomico(join(pasta, 'estado.json'), {
        versao: 1, salvoEm: new Date().toISOString(), arquivos,
    });
    try {
        await podarDominios(pasta);
    } catch (erro) {
        console.error('A revisão foi salva, mas não foi possível remover revisões antigas.', erro);
    }
    return bytes;
}

async function podarDominios(pasta: string): Promise<void> {
    const preservar = new Set<string>();
    for (const nome of ['estado.json', 'estado.anterior.json']) {
        const bruto = await lerJson(join(pasta, nome));
        if (bruto === undefined) continue;
        const manifesto = esquemaManifesto.parse(bruto);
        for (const dominio of nomes) preservar.add(`${dominio}.${manifesto.arquivos[dominio]}.json`);
    }
    for (const nome of await readdir(join(pasta, 'dados'))) {
        if (/^[a-z]+\.[a-f0-9]{64}\.json$/.test(nome) && !preservar.has(nome)) {
            await unlink(join(pasta, 'dados', nome));
        }
    }
}

/** Remove a revisão anterior após uma exclusão definitiva solicitada pela Diretoria. */
export async function esquecerRevisoesAnteriores(pasta: string): Promise<void> {
    await unlink(join(pasta, 'estado.anterior.json')).catch((erro: NodeJS.ErrnoException) => {
        if (erro.code !== 'ENOENT') throw erro;
    });
    await podarDominios(pasta);
}
