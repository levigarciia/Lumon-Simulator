import { readFile, readdir, realpath, mkdir, writeFile, stat, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { executarProcesso } from '../processos';
import type { ConfiguracaoSessao } from './tipos';

const caminho = z.string().min(1).max(500);
const esquemaCaminho = z.object({ caminho });
const esquemaEscrita = z.object({ caminho, conteudo: z.string().max(512 * 1024) });
const esquemaComando = z.object({ comando: z.string().min(1).max(12000) });

export const ferramentasProjeto = [
    { type: 'function', function: { name: 'listar_arquivos', description: 'Lista os arquivos de uma pasta do projeto.',
        parameters: z.toJSONSchema(esquemaCaminho) } },
    { type: 'function', function: { name: 'ler_arquivo', description: 'Lê um arquivo de texto do projeto.',
        parameters: z.toJSONSchema(esquemaCaminho) } },
    { type: 'function', function: { name: 'escrever_arquivo',
        description: 'Cria ou substitui um arquivo do projeto. Pode exigir aprovação da Diretoria.',
        parameters: z.toJSONSchema(esquemaEscrita) } },
    { type: 'function', function: { name: 'executar_comando',
        description: 'Executa um comando no projeto com PowerShell. Pode exigir aprovação da Diretoria.',
        parameters: z.toJSONSchema(esquemaComando) } },
];

function garantirDentro(raiz: string, destino: string): void {
    const trecho = relative(raiz, destino);
    if (trecho === '..' || trecho.startsWith(`..${sep}`) || isAbsolute(trecho)) {
        throw new Error('O caminho precisa permanecer na pasta do projeto.');
    }
}

/** Confere a pasta física para impedir escape por caminhos relativos ou links simbólicos. */
export async function caminhoDoProjeto(pasta: string, entrada: string): Promise<string> {
    const raiz = await realpath(pasta);
    const destino = resolve(raiz, entrada);
    garantirDentro(raiz, destino);
    let existente = destino;
    while (true) {
        const fisico = await realpath(existente).catch((erro: NodeJS.ErrnoException) => {
            if (erro.code === 'ENOENT') return null;
            throw erro;
        });
        if (fisico) { garantirDentro(raiz, fisico); return destino; }
        const metadados = await lstat(existente).catch((erro: NodeJS.ErrnoException) => {
            if (erro.code === 'ENOENT') return null;
            throw erro;
        });
        if (metadados?.isSymbolicLink()) {
            throw new Error('O caminho contém um link sem destino válido na pasta do projeto.');
        }
        const pai = dirname(existente);
        if (pai === existente) throw new Error('Não foi possível resolver o caminho do projeto.');
        existente = pai;
    }
}

/** Executa somente ferramentas de projeto anunciadas para o modo de trabalho. */
export async function executarFerramentaLocal(
    nome: string, entrada: unknown, configuracao: ConfiguracaoSessao, sinal: AbortSignal,
): Promise<string> {
    sinal.throwIfAborted();
    if (configuracao.modo !== 'trabalho') throw new Error('Ferramentas de projeto indisponíveis na conversa social.');
    if (nome === 'executar_comando') {
        const { comando } = esquemaComando.parse(entrada);
        const resultado = await executarProcesso('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', comando], configuracao.pasta, sinal);
        if (resultado.codigo !== 0) throw new Error(`Código: ${resultado.codigo}\n${resultado.saida}`);
        return `Código: ${resultado.codigo}\n${resultado.saida}`;
    }
    const dados = nome === 'escrever_arquivo' ? esquemaEscrita.parse(entrada) : esquemaCaminho.parse(entrada);
    const destino = await caminhoDoProjeto(configuracao.pasta, dados.caminho);
    if (nome === 'listar_arquivos') {
        const arquivos = await readdir(destino, { withFileTypes: true });
        return arquivos.slice(0, 1000).map((item) => item.name + (item.isDirectory() ? '/' : '')).join('\n');
    }
    if (nome === 'ler_arquivo') {
        if ((await stat(destino)).size > 512 * 1024) {
            throw new Error('Arquivo maior que o limite de leitura de 512 KB.');
        }
        return (await readFile(destino, 'utf8')).slice(0, 30000);
    }
    if (nome === 'escrever_arquivo' && 'conteudo' in dados) {
        await mkdir(dirname(destino), { recursive: true });
        sinal.throwIfAborted();
        await writeFile(destino, esquemaEscrita.parse(dados).conteudo, 'utf8');
        return 'Arquivo salvo.';
    }
    throw new Error('Ferramenta local desconhecida.');
}
