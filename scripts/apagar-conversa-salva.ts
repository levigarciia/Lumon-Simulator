import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { esquemaEstado, type EstadoSalvo } from '../shared/estado';
import { apagarConversaHistorica } from '../electron/services/historico';
import { Persistencia } from '../electron/services/persistencia';

const [pastaInformada, nome] = process.argv.slice(2);
if (!pastaInformada || !nome) throw new Error('Informe a pasta de dados e o nome completo do funcionário.');
const raiz = resolve(pastaInformada);
const normalizar = (texto: string) => texto.trim().toLocaleLowerCase('pt-BR');
let mensagensRemovidas = 0;
let estadosAlterados = 0;
const trechos = new Set<string>();

function apagar(estado: EstadoSalvo): EstadoSalvo {
    const pessoas = [...estado.funcionarios, ...estado.demissoes.map((demissao) => demissao.funcionario)];
    const ids = [...new Set(pessoas.filter((pessoa) => normalizar(pessoa.nome) === normalizar(nome!))
        .map((pessoa) => pessoa.id))];
    if (ids.length > 1) throw new Error('Nome ambíguo nesse escritório. Nenhum dado deste estado foi alterado.');
    let proximo = estado;
    for (const id of ids) {
        const mensagens = (estado.conversas[id] ?? []).filter((mensagem) => mensagem.canal !== 'work');
        mensagensRemovidas += mensagens.length;
        for (const mensagem of mensagens) {
            const trecho = mensagem.texto.trim().slice(0, 120);
            if (trecho.length >= 24) trechos.add(trecho);
        }
        proximo = apagarConversaHistorica(proximo, id);
    }
    return proximo;
}

const pastas = [raiz];
const catalogo = join(raiz, 'escritorios.json');
if (await Bun.file(catalogo).exists()) {
    const dados = await Bun.file(catalogo).json() as { escritorios: { id: string }[] };
    for (const escritorio of dados.escritorios) {
        if (!/^[a-f0-9-]{36}$/i.test(escritorio.id)) throw new Error('ID de escritório inválido.');
        pastas.push(resolve(raiz, 'escritorios', escritorio.id));
    }
}
for (const pasta of pastas) {
    if (pasta !== raiz && !pasta.startsWith(`${raiz}\\`)) throw new Error('Pasta fora da raiz autorizada.');
    if (await Bun.file(join(pasta, 'estado.json')).exists()) {
        const persistencia = new Persistencia(pasta);
        const estado = await persistencia.carregar(false);
        const proximo = apagar(estado);
        if (JSON.stringify(estado) !== JSON.stringify(proximo)) {
            persistencia.salvar(proximo);
            await persistencia.esquecerRevisoes();
            estadosAlterados++;
        }
    }
    for (const arquivo of await readdir(pasta)) {
        if (!/^lumon(?:\.antes[^/]*)?\.json$/.test(arquivo)) continue;
        const caminho = join(pasta, arquivo);
        const estado = esquemaEstado.parse(JSON.parse(await readFile(caminho, 'utf8')));
        const proximo = apagar(estado);
        if (JSON.stringify(estado) !== JSON.stringify(proximo)) {
            await writeFile(caminho, JSON.stringify(proximo, null, 4), 'utf8');
            estadosAlterados++;
        }
    }
}
let arquivosVerificados = 0;
for (const pasta of pastas) {
    const arquivos = (await readdir(pasta)).filter((arquivo) => arquivo.endsWith('.json'))
        .map((arquivo) => join(pasta, arquivo));
    const pastaDados = join(pasta, 'dados');
    if (await Bun.file(join(pasta, 'estado.json')).exists()) {
        arquivos.push(...(await readdir(pastaDados)).filter((arquivo) => arquivo.endsWith('.json'))
            .map((arquivo) => join(pastaDados, arquivo)));
    }
    for (const caminho of arquivos) {
        const conteudo = await readFile(caminho, 'utf8');
        const compacto = JSON.stringify(JSON.parse(conteudo));
        if ([...trechos].some((trecho) => compacto.includes(JSON.stringify(trecho).slice(1, -1)))) {
            throw new Error(`Ainda existe trecho do diálogo em ${caminho}.`);
        }
        arquivosVerificados++;
    }
}
console.log(JSON.stringify({ estadosAlterados, mensagensRemovidas, arquivosVerificados, dialogoRemovido: true }));
