import { z } from 'zod';

export const temperamentos = ['aflicao', 'alegria', 'pavor', 'malicia'] as const;

export type Temperamento = (typeof temperamentos)[number];

export const nomesTemperamento: Record<Temperamento, string> = {
    aflicao: 'Aflição', alegria: 'Alegria', pavor: 'Pavor', malicia: 'Malícia',
};

const linhas = 8;
const colunas = 10;
const gruposPorArquivo = 6;
const letrasColuna = 'ABCDEFGHIJ';

const cidades = [
    'Cold Harbor', 'Siena', 'Tumwater', 'Allentown', 'Dranesville', 'Moonbeam', 'Jesup', 'Kingsport',
    'Labrador', 'Eminence', 'Nanning', 'Wellington', 'Yakima', 'Ocula', 'Bramford', 'Halcyon',
];

/** Nome do projeto que concentra os arquivos de refinamento no Work. */
export const nomeProjetoMacrodados = 'Macrodados';

export const esquemaGrupoRefinamento = z.object({
    celulas: z.array(z.string()),
    temperamento: z.enum(temperamentos),
    refinadoPor: z.string().optional(),
});

const esquemaArquivoAtual = z.object({
    versaoCoordenadas: z.literal(2).optional(),
    id: z.string(),
    nome: z.string(),
    grade: z.array(z.array(z.number().int().min(0).max(9))),
    grupos: z.array(esquemaGrupoRefinamento),
    tentativas: z.record(z.string(), z.object({
        aceitas: z.number().int().nonnegative(), rejeitadas: z.number().int().nonnegative(),
    })).default({}),
    prazo: z.string(),
    duracaoMinutos: z.number().int().min(1).max(60).default(5),
    rodadas: z.array(z.object({ prazo: z.string(), motivo: z.string(), iniciadaEm: z.string() })).default([]),
    envios: z.array(z.object({
        funcionarioId: z.string(), trabalhoId: z.string().optional(), celulas: z.array(z.string()),
        temperamento: z.enum(temperamentos),
        resultado: z.enum(['aceito', 'temperamento_incorreto', 'rejeitado']),
    })).default([]),
});

/** Use ao carregar arquivos antigos para preservar as posições da grade no padrão atual. */
export const esquemaArquivoRefinamento = z.preprocess((entrada) => {
    if (!entrada || typeof entrada !== 'object' || !('grade' in entrada)) return entrada;
    const arquivo = entrada as Record<string, unknown>;
    if (arquivo.versaoCoordenadas === 2) return entrada;
    const converter = (celula: string) => {
        const posicao = celula.match(/^([A-H])(10|[1-9])$/);
        return posicao ? letrasColuna[Number(posicao[2]) - 1]! + (posicao[1]!.charCodeAt(0) - 64) : celula;
    };
    const converterRegistros = (registros: unknown) => Array.isArray(registros)
        ? registros.map((registro) => ({ ...registro,
            celulas: Array.isArray(registro.celulas) ? registro.celulas.map(converter) : registro.celulas }))
        : registros;
    return { ...arquivo, versaoCoordenadas: 2, grupos: converterRegistros(arquivo.grupos),
        envios: converterRegistros(arquivo.envios) };
}, esquemaArquivoAtual);

export type ArquivoRefinamento = z.infer<typeof esquemaArquivoAtual>;

export type ResultadoRefinamento = 'aceito' | 'temperamento_incorreto' | 'rejeitado';

function gerador(semente: number): () => number {
    let estado = semente >>> 0;
    return () => {
        estado = (estado + 0x6d2b79f5) >>> 0;
        let valor = estado;
        valor = Math.imul(valor ^ (valor >>> 15), valor | 1);
        valor ^= valor + Math.imul(valor ^ (valor >>> 7), valor | 61);
        return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
    };
}

function nomeCelula(linha: number, coluna: number): string {
    return `${letrasColuna[coluna]}${linha + 1}`;
}

function vizinhos(linha: number, coluna: number): [number, number][] {
    return ([[linha - 1, coluna], [linha + 1, coluna], [linha, coluna - 1], [linha, coluna + 1]] as [number, number][])
        .filter(([l, c]) => l >= 0 && c >= 0 && l < linhas && c < colunas);
}

function digitoDiferente(grade: number[][], linha: number, coluna: number, sortear: () => number): number {
    const proibidos = new Set(vizinhos(linha, coluna).map(([l, c]) => grade[l]![c]!));
    const livres = [...Array(10).keys()].filter((digito) => !proibidos.has(digito));
    return livres[Math.floor(sortear() * livres.length)]!;
}

function embaralhar<T>(itens: T[], sortear: () => number): T[] {
    const copia = [...itens];
    for (let indice = copia.length - 1; indice > 0; indice--) {
        const troca = Math.floor(sortear() * (indice + 1));
        [copia[indice], copia[troca]] = [copia[troca]!, copia[indice]!];
    }
    return copia;
}

/**
 * Gera um arquivo determinístico a partir da semente. Cada temperamento recebe um dígito secreto, e os grupos
 * a refinar são sequências de três desse dígito. O fundo nunca repete dígitos vizinhos, então só os grupos
 * plantados formam sequências. Use ao iniciar um refinamento; as posições e caixas corretas são privadas.
 */
export function gerarArquivo(semente: number, prazo: Date): ArquivoRefinamento {
    const sortear = gerador(semente);
    const grade: number[][] = Array.from({ length: linhas }, () => Array<number>(colunas).fill(-1));
    for (let linha = 0; linha < linhas; linha++) {
        for (let coluna = 0; coluna < colunas; coluna++) {
            grade[linha]![coluna] = digitoDiferente(grade, linha, coluna, sortear);
        }
    }
    const digitos = embaralhar([...Array(10).keys()], sortear).slice(0, temperamentos.length);
    const grupos: ArquivoRefinamento['grupos'] = [];
    const origens = embaralhar([...Array(linhas).keys()], sortear).slice(0, gruposPorArquivo)
        .map((linha) => [linha, Math.floor(sortear() * (colunas - 2))] as const);
    for (const [linha, inicio] of origens.slice(0, gruposPorArquivo)) {
        const coluna = inicio;
        const posicoes = [0, 1, 2].map((passo): [number, number] =>
            [linha, coluna + passo]);
        const indice = grupos.length % temperamentos.length;
        for (const [l, c] of posicoes) grade[l]![c] = digitos[indice]!;
        grupos.push({ celulas: posicoes.map(([l, c]) => nomeCelula(l, c)), temperamento: temperamentos[indice]! });
    }
    const plantadas = new Set(grupos.flatMap((grupo) => grupo.celulas));
    for (let linha = 0; linha < linhas; linha++) {
        for (let coluna = 0; coluna < colunas; coluna++) {
            if (plantadas.has(nomeCelula(linha, coluna))) continue;
            const repete = vizinhos(linha, coluna).some(([l, c]) => grade[l]![c] === grade[linha]![coluna]);
            if (repete) grade[linha]![coluna] = digitoDiferente(grade, linha, coluna, sortear);
        }
    }
    return {
        versaoCoordenadas: 2, id: `arquivo_${semente.toString(36)}`,
        nome: cidades[Math.floor(sortear() * cidades.length)]!,
        grade, grupos, tentativas: {}, envios: [], prazo: prazo.toISOString(), duracaoMinutos: 10, rodadas: [],
    };
}

const formatoPrazo = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Use ao mostrar o prazo em textos: converte o ISO salvo para o horário local da máquina. */
export function formatarPrazo(arquivo: Pick<ArquivoRefinamento, 'prazo'>): string {
    return formatoPrazo.format(new Date(arquivo.prazo));
}

export function progressoRefinamento(arquivo: ArquivoRefinamento): number {
    const refinados = arquivo.grupos.filter((grupo) => grupo.refinadoPor).length;
    return Math.round((refinados / arquivo.grupos.length) * 100);
}

/** Use na aprovação: oito moedas por grupo refinado e bônus de doze pelo arquivo completo. */
export function recompensaRefinamento(arquivo: ArquivoRefinamento): number {
    const refinados = arquivo.grupos.filter((grupo) => grupo.refinadoPor).length;
    return refinados * 8 + (refinados > 0 && refinados === arquivo.grupos.length ? 12 : 0);
}

function digitoDaCelula(arquivo: ArquivoRefinamento, celula: string): number {
    const coluna = letrasColuna.indexOf(celula[0]!);
    const linha = Number(celula.slice(1)) - 1;
    return arquivo.grade[linha]![coluna]!;
}

function caixasDescobertas(arquivo: ArquivoRefinamento): string {
    const caixas = new Map(arquivo.grupos.filter((grupo) => grupo.refinadoPor)
        .map((grupo) => [digitoDaCelula(arquivo, grupo.celulas[0]!), grupo.temperamento]));
    if (!caixas.size) return '';
    return '\nCaixas já descobertas (o mesmo dígito sempre vai para a mesma caixa): '
        + [...caixas].map(([digito, temperamento]) => `dígito ${digito} = ${temperamento}`).join(', ') + '.';
}

/**
 * Grade como texto para o agente, no padrão de planilha: letra é a coluna e número é a linha. Células já
 * refinadas aparecem como `*`, seguidas das caixas já descobertas por dígito.
 */
export function descreverGrade(arquivo: ArquivoRefinamento): string {
    const refinadas = new Set(arquivo.grupos.filter((grupo) => grupo.refinadoPor).flatMap((grupo) => grupo.celulas));
    const grade = arquivo.grade.map((linha, l) => `Linha ${l + 1}: ` + linha.map((digito, c) =>
        `${nomeCelula(l, c)}=${refinadas.has(nomeCelula(l, c)) ? '*' : digito}`).join('  ')).join('\n');
    return 'Letra é a coluna, número é a linha. Um grupo são três letras seguidas com o mesmo número.\n'
        + grade + caixasDescobertas(arquivo);
}

/** Registra uma seleção recusada pela regra pública, para a equipe não repeti-la. Função pura. */
export function registrarRecusa(
    arquivo: ArquivoRefinamento, funcionarioId: string, celulas: string[], temperamento: Temperamento,
    trabalhoId?: string,
): ArquivoRefinamento {
    const envio = { funcionarioId, trabalhoId, celulas: celulas.map((celula) => celula.trim().toUpperCase()),
        temperamento, resultado: 'rejeitado' as const };
    return { ...arquivo, envios: [...(arquivo.envios ?? []), envio].slice(-48) };
}

/** Orienta a próxima tentativa sem revelar células corretas nem a classificação interna. */
export function orientarRefinamento(resultado: ResultadoRefinamento): string {
    if (resultado === 'aceito') return 'Grupo aceito. Escolha outra região ainda não refinada.';
    if (resultado === 'temperamento_incorreto') {
        return 'Seleção reconhecida, caixa incorreta. Preserve as células e teste outra caixa ainda não tentada.';
    }
    return 'Seleção não reconhecida. Mude as células antes de reenviar; trocar só a caixa não resolve. '
        + 'Selecione três células consecutivas na mesma linha (mesmo número, letras seguidas), com o mesmo dígito.';
}

/**
 * Confere a regra pública da seleção (três células consecutivas, mesma linha, mesmo dígito, ainda não refinadas)
 * antes de consumir uma tentativa. Devolve a explicação do problema ou `undefined` quando a seleção é plausível.
 */
export function problemaSelecao(arquivo: ArquivoRefinamento, celulas: string[]): string | undefined {
    const posicoes = celulas.map((celula) => celula.trim().toUpperCase().match(/^([A-J])([1-8])$/));
    if (posicoes.length !== 3 || posicoes.some((posicao) => !posicao)) {
        return 'Informe exatamente três células válidas, de A1 a J8 (letra é a coluna, número é a linha).';
    }
    const coordenadas = posicoes.map((posicao) =>
        [Number(posicao![2]) - 1, letrasColuna.indexOf(posicao![1]!)] as const)
        .sort((a, b) => a[1] - b[1]);
    const nomes = coordenadas.map(([linha, coluna]) => nomeCelula(linha, coluna));
    if (new Set(coordenadas.map(([linha]) => linha)).size !== 1) {
        return `${nomes.join(', ')} não estão na mesma linha. Uma seleção nunca atravessa linhas: `
            + 'mantenha o número e avance a letra, como C4, D4 e E4.';
    }
    if (coordenadas.some(([, coluna], indice) => indice > 0 && coluna !== coordenadas[indice - 1]![1] + 1)) {
        return `${nomes.join(', ')} não são consecutivas.`;
    }
    const refinadas = new Set(arquivo.grupos.filter((grupo) => grupo.refinadoPor).flatMap((grupo) => grupo.celulas));
    if (nomes.some((nome) => refinadas.has(nome))) return 'Essa seleção inclui células já refinadas (`*`).';
    const digitos = coordenadas.map(([linha, coluna]) => arquivo.grade[linha]![coluna]!);
    if (new Set(digitos).size !== 1) {
        return `${nomes.map((nome, indice) => `${nome}=${digitos[indice]}`).join(', ')} não têm o mesmo dígito. `
            + 'Procure na grade três dígitos iguais lado a lado.';
    }
}

/** Compartilha apenas envios realmente feitos para a equipe não repetir tentativas descartadas. */
export function descreverEnvios(arquivo: ArquivoRefinamento): string {
    if (!arquivo.envios?.length) return 'Nenhum envio registrado pela equipe.';
    const recentes = arquivo.envios.slice(-12).map((envio) =>
        `${envio.celulas.join(', ')}: ${envio.temperamento}, ${envio.resultado}.`).join('\n');
    const selecoes = new Map<string, typeof arquivo.envios>();
    for (const envio of arquivo.envios) {
        const chave = [...envio.celulas].sort().join(', ');
        selecoes.set(chave, [...(selecoes.get(chave) ?? []), envio]);
    }
    const pendentes = [...selecoes.entries()].flatMap(([celulas, envios]) => {
        if (!envios.some((envio) => envio.resultado === 'temperamento_incorreto')
            || envios.some((envio) => envio.resultado === 'aceito')) return [];
        const testadas = new Set(envios.map((envio) => envio.temperamento));
        const restantes = temperamentos.filter((item) => !testadas.has(item));
        return restantes.length ? [`${celulas}: seleção reconhecida. Caixas ainda não testadas: ${restantes.join(', ')}.`]
            : [];
    });
    return recentes + (pendentes.length ? '\nPrioridade para a próxima etapa:\n' + pendentes.join('\n') : '');
}

/**
 * Use para conferir exatamente três células de um grupo ainda não refinado e a caixa escolhida.
 * Função pura: devolve o arquivo atualizado e o resultado.
 */
export function refinar(
    arquivo: ArquivoRefinamento, funcionarioId: string, celulas: string[], temperamento: Temperamento,
    trabalhoId?: string,
): { arquivo: ArquivoRefinamento; resultado: ResultadoRefinamento; repetida?: 'aceita' | 'rejeitada' } {
    const enviadas = new Set(celulas.map((celula) => celula.trim().toUpperCase()));
    const chaveEnvio = celulas.map((celula) => celula.trim().toUpperCase()).sort().join('\0');
    const envioAnterior = arquivo.envios?.find((envio) => envio.resultado !== 'temperamento_incorreto'
        && [...envio.celulas].sort().join('\0') === chaveEnvio);
    if (envioAnterior) return { arquivo, resultado: 'rejeitado',
        repetida: envioAnterior.resultado === 'aceito' ? 'aceita' : 'rejeitada' };
    const indice = arquivo.grupos.findIndex((grupo) => !grupo.refinadoPor
        && grupo.celulas.every((celula) => enviadas.has(celula)) && enviadas.size === 3 && celulas.length === 3);
    const grupo = arquivo.grupos[indice];
    const resultado: ResultadoRefinamento = !grupo ? 'rejeitado'
        : grupo.temperamento === temperamento ? 'aceito' : 'temperamento_incorreto';
    const anterior = arquivo.tentativas[funcionarioId] ?? { aceitas: 0, rejeitadas: 0 };
    const tentativas = { ...arquivo.tentativas, [funcionarioId]: resultado === 'aceito'
        ? { ...anterior, aceitas: anterior.aceitas + 1 } : { ...anterior, rejeitadas: anterior.rejeitadas + 1 } };
    const grupos = resultado === 'aceito'
        ? arquivo.grupos.map((item, posicao) => posicao === indice ? { ...item, refinadoPor: funcionarioId } : item)
        : arquivo.grupos;
    const envio = { funcionarioId, trabalhoId, celulas: [...enviadas], temperamento, resultado };
    return { arquivo: { ...arquivo, grupos, tentativas,
        envios: [...(arquivo.envios ?? []), envio].slice(-48) }, resultado };
}
