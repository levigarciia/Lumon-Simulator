import { z } from 'zod';

export const temperamentos = ['aflicao', 'alegria', 'pavor', 'malicia'] as const;

export type Temperamento = (typeof temperamentos)[number];

export const nomesTemperamento: Record<Temperamento, string> = {
    aflicao: 'Aflição', alegria: 'Alegria', pavor: 'Pavor', malicia: 'Malícia',
};

const linhas = 8;
const colunas = 10;
const gruposPorArquivo = 6;
const letrasLinha = 'ABCDEFGH';

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

export const esquemaArquivoRefinamento = z.object({
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

export type ArquivoRefinamento = z.infer<typeof esquemaArquivoRefinamento>;

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
    return `${letrasLinha[linha]}${coluna + 1}`;
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
        id: `arquivo_${semente.toString(36)}`,
        nome: cidades[Math.floor(sortear() * cidades.length)]!,
        grade, grupos, tentativas: {}, envios: [], prazo: prazo.toISOString(), duracaoMinutos: 5, rodadas: [],
    };
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

/** Grade como texto para o agente. Células já refinadas aparecem como `*`. */
export function descreverGrade(arquivo: ArquivoRefinamento): string {
    const refinadas = new Set(arquivo.grupos.filter((grupo) => grupo.refinadoPor).flatMap((grupo) => grupo.celulas));
    return arquivo.grade.map((linha, l) => linha.map((digito, c) =>
        `${nomeCelula(l, c)}=${refinadas.has(nomeCelula(l, c)) ? '*' : digito}`).join('  ')).join('\n');
}

/** Orienta a próxima tentativa sem revelar células corretas nem a classificação interna. */
export function orientarRefinamento(resultado: ResultadoRefinamento): string {
    if (resultado === 'aceito') return 'Grupo aceito. Escolha outra região ainda não refinada.';
    if (resultado === 'temperamento_incorreto') {
        return 'Seleção reconhecida, caixa incorreta. Preserve as células e teste outra caixa ainda não tentada.';
    }
    return 'Seleção não reconhecida. Mude as células antes de reenviar; trocar só a caixa não resolve. '
        + 'Selecione três células consecutivas na mesma linha, com o mesmo dígito, sem incluir o restante da linha.';
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
 * Confere um envio do agente. É aceito quando cobre um grupo ainda não refinado com no máximo uma célula a
 * mais e o temperamento certo. Função pura: devolve o arquivo atualizado e o resultado.
 */
export function refinar(
    arquivo: ArquivoRefinamento, funcionarioId: string, celulas: string[], temperamento: Temperamento,
    trabalhoId?: string,
): { arquivo: ArquivoRefinamento; resultado: ResultadoRefinamento } {
    const enviadas = new Set(celulas.map((celula) => celula.trim().toUpperCase()));
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
