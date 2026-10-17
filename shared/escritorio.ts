import { z } from 'zod';

/** Célula da grade do piso. Cada célula mede uma unidade do mundo 3D. */
export type Celula = { x: number; z: number };

/** Ponto contínuo sobre o piso, em unidades do mundo. */
export type Ponto = { x: number; z: number };

/** Quartos de volta. Na rotação 0 a frente do item aponta para +z. */
export type Rotacao = 0 | 1 | 2 | 3;

/** `ausente` indica um corpo fora da sala, em folga ou na Sala de Descanso. */
export type Atividade = 'trabalhando' | 'andando' | 'cafe' | 'comendo' | 'descansando' | 'ouvindo_musica'
    | 'conversando' | 'ausente';

export const tiposItem = [
    'mesa',
    'aparador_cafe',
    'maquina_guloseimas',
    'aparador',
    'planta',
    'luminaria_piso',
    'sofa',
    'mesa_centro',
    'vitrola',
] as const;

export type TipoItem = (typeof tiposItem)[number];

type DefinicaoItem = {
    nome: string;
    descricao: string;
    preco: number;
    largura: number;
    profundidade: number;
    /** Atividade exercida na célula logo à frente do item, na coluna indicada. */
    uso?: { atividade: Atividade; coluna: number; capacidade?: number };
    /** Pontos de conforto ambiental que reduzem o estresse de quem está por perto. Veja `ambiente.ts`. */
    conforto?: number;
};

/** Catálogo da loja: área ocupada, preço e uso de cada móvel pelos funcionários. */
export const catalogo: Record<TipoItem, DefinicaoItem> = {
    mesa: {
        nome: 'Mesa de trabalho',
        descricao: 'Estação com terminal. Cada funcionário precisa de uma.',
        preco: 120,
        largura: 2,
        profundidade: 1,
        uso: { atividade: 'trabalhando', coluna: 0 },
    },
    aparador_cafe: {
        nome: 'Cafeteira',
        descricao: 'Café para as pausas curtas.',
        preco: 90,
        largura: 2,
        profundidade: 1,
        uso: { atividade: 'cafe', coluna: 1, capacidade: 2 },
    },
    maquina_guloseimas: {
        nome: 'Máquina de guloseimas',
        descricao: 'Lanches para aliviar o estresse.',
        preco: 160,
        largura: 1,
        profundidade: 1,
        uso: { atividade: 'comendo', coluna: 0, capacidade: 2 },
    },
    sofa: {
        nome: 'Sofá',
        descricao: 'Descanso entre uma tarefa e outra.',
        preco: 140,
        largura: 2,
        profundidade: 1,
        uso: { atividade: 'descansando', coluna: 0, capacidade: 2 },
    },
    vitrola: {
        nome: 'Vitrola',
        descricao: 'Música para quem precisa desligar.',
        preco: 110,
        largura: 1,
        profundidade: 1,
        uso: { atividade: 'ouvindo_musica', coluna: 0 },
    },
    aparador: { nome: 'Aparador', descricao: 'Móvel baixo com planta. Acalma quem está perto.', preco: 60,
        largura: 2, profundidade: 1, conforto: 1 },
    planta: { nome: 'Planta', descricao: 'Um pouco de verde. Acalma quem está perto.', preco: 30,
        largura: 1, profundidade: 1, conforto: 1 },
    luminaria_piso: { nome: 'Luminária de piso', descricao: 'Luz quente. Acalma quem está perto.', preco: 45,
        largura: 1, profundidade: 1, conforto: 1 },
    mesa_centro: { nome: 'Mesa de centro', descricao: 'Para acompanhar o sofá.', preco: 35, largura: 1, profundidade: 1 },
};

export const esquemaItemPosicionado = z.object({
    usos: z.number().int().nonnegative().optional(),
    quebrado: z.boolean().optional(),
    ultimoUsuarioId: z.string().min(1).optional(),
    id: z.string().min(1).max(64),
    tipo: z.enum(tiposItem),
    celula: z.object({ x: z.number().int(), z: z.number().int() }),
    rotacao: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export type ItemPosicionado = z.infer<typeof esquemaItemPosicionado>;

export type Sala = { largura: number; profundidade: number; itens: ItemPosicionado[] };

/** Célula diante da porta, sempre livre: é por ela que os funcionários entram e saem. */
export const celulaEntrada: Celula = { x: 7, z: 0 };

function transformar(dx: number, dz: number, tipo: TipoItem, rotacao: Rotacao): Celula {
    const { largura, profundidade } = catalogo[tipo];
    switch (rotacao) {
        case 0:
            return { x: dx, z: dz };
        case 1:
            return { x: profundidade - 1 - dz, z: dx };
        case 2:
            return { x: largura - 1 - dx, z: profundidade - 1 - dz };
        case 3:
            return { x: dz, z: largura - 1 - dx };
    }
}

/** Dimensões ocupadas no piso depois da rotação. */
export function dimensoesItem(item: Pick<ItemPosicionado, 'tipo' | 'rotacao'>): { largura: number; profundidade: number } {
    const { largura, profundidade } = catalogo[item.tipo];
    return item.rotacao % 2 === 0 ? { largura, profundidade } : { largura: profundidade, profundidade: largura };
}

/** Células do piso cobertas pelo item. */
export function celulasOcupadas(item: ItemPosicionado): Celula[] {
    const { largura, profundidade } = dimensoesItem(item);
    const celulas: Celula[] = [];
    for (let x = 0; x < largura; x++) {
        for (let z = 0; z < profundidade; z++) celulas.push({ x: item.celula.x + x, z: item.celula.z + z });
    }
    return celulas;
}

/** Posição de uso do item pelo índice da vaga, ou `null` para itens decorativos. O índice padrão é zero. */
export function celulaDeUso(item: ItemPosicionado, indice = 0): Celula | null {
    const uso = catalogo[item.tipo].uso;
    if (!uso) return null;
    if (!Number.isInteger(indice) || indice < 0 || indice >= capacidadeItem(item)) {
        throw new Error('Posição de uso inválida para este item.');
    }
    const coluna = indice === 0 ? uso.coluna : uso.coluna === 0 ? 1 : 0;
    const relativa = transformar(coluna, catalogo[item.tipo].profundidade, item.tipo, item.rotacao);
    return { x: item.celula.x + relativa.x, z: item.celula.z + relativa.z };
}

/** Quantidade de funcionários que podem reservar simultaneamente os pontos de uso de um item. */
export function capacidadeItem(item: Pick<ItemPosicionado, 'tipo'>): number {
    const uso = catalogo[item.tipo].uso;
    return uso ? uso.capacidade ?? 1 : 0;
}

/** Centro do item no mundo, usado para posicionar o modelo e orientar quem o usa. */
export function centroItem(item: Pick<ItemPosicionado, 'tipo' | 'celula' | 'rotacao'>): Ponto {
    const { largura, profundidade } = dimensoesItem(item);
    return { x: item.celula.x + largura / 2, z: item.celula.z + profundidade / 2 };
}

/** Ângulo em torno do eixo vertical que leva a frente do modelo (+z) para a rotação do item. */
export function anguloRotacao(rotacao: Rotacao): number {
    return (-rotacao * Math.PI) / 2;
}

/** Centro de uma célula no mundo. */
export function centroCelula(celula: Celula): Ponto {
    return { x: celula.x + 0.5, z: celula.z + 0.5 };
}

/** Célula que contém um ponto do mundo. */
export function celulaDoPonto(ponto: Ponto): Celula {
    return { x: Math.floor(ponto.x), z: Math.floor(ponto.z) };
}

function chave(celula: Celula): string {
    return `${celula.x},${celula.z}`;
}

function dentroDaSala(sala: Sala, celula: Celula): boolean {
    return celula.x >= 0 && celula.z >= 0 && celula.x < sala.largura && celula.z < sala.profundidade;
}

/** Função que informa se uma célula pode ser percorrida: dentro da sala e sem móvel. */
export function criarVerificadorLivre(sala: Sala): (celula: Celula) => boolean {
    const ocupadas = new Set(sala.itens.flatMap(celulasOcupadas).map(chave));
    return (celula) => dentroDaSala(sala, celula) && !ocupadas.has(chave(celula));
}

/** Passagem fixa para o corredor dos anexos, mantida livre na edição do layout. */
export function celulaAcessoAnexos(sala: Sala): Celula {
    return { x: sala.largura - 1, z: Math.floor(sala.profundidade / 2) };
}

function celulasAlcancaveis(sala: Sala, livre: (celula: Celula) => boolean): Set<string> {
    const alcancadas = new Set([chave(celulaEntrada)]);
    const fila = [celulaEntrada];
    while (fila.length > 0) {
        const atual = fila.shift()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const proxima = { x: atual.x + dx, z: atual.z + dz };
            if (!livre(proxima) || alcancadas.has(chave(proxima))) continue;
            alcancadas.add(chave(proxima));
            fila.push(proxima);
        }
    }
    return alcancadas;
}

/**
 * Motivo pelo qual o layout é inválido, ou `null`. Um layout válido mantém os itens no piso, sem sobreposição,
 * deixa a entrada livre e permite chegar da porta a todos os pontos de uso. Use antes de comprar ou mover.
 */
export function validarSala(sala: Sala): string | null {
    const ocupadas = new Set<string>();
    for (const item of sala.itens) {
        for (const celula of celulasOcupadas(item)) {
            if (!dentroDaSala(sala, celula)) return `${catalogo[item.tipo].nome} sai da sala.`;
            if (ocupadas.has(chave(celula))) return `${catalogo[item.tipo].nome} ficaria sobre outro item.`;
            ocupadas.add(chave(celula));
        }
    }
    if (ocupadas.has(chave(celulaEntrada))) return 'A entrada precisa ficar livre.';
    const livre = criarVerificadorLivre(sala);
    const alcancaveis = celulasAlcancaveis(sala, livre);
    if (!alcancaveis.has(chave(celulaAcessoAnexos(sala)))) {
        return 'O acesso ao corredor dos anexos precisa ficar livre e alcançável.';
    }
    for (const item of sala.itens) {
        const uso = celulaDeUso(item);
        if (uso && !alcancaveis.has(chave(uso))) return `A frente de ${catalogo[item.tipo].nome} ficaria inacessível.`;
    }
    return null;
}

/** Sala com o item acrescentado, ou substituído quando o identificador já existe. */
export function comItem(sala: Sala, item: ItemPosicionado): Sala {
    return { ...sala, itens: [...sala.itens.filter((existente) => existente.id !== item.id), item] };
}

/** Sala sem o item indicado. */
export function semItem(sala: Sala, id: string): Sala {
    return { ...sala, itens: sala.itens.filter((item) => item.id !== id) };
}

/**
 * Remove os itens que tornam um layout salvo inválido, por exemplo depois que um móvel do catálogo mudou de
 * tamanho. Os itens de `preservarIds` entram primeiro, para que mesas com dono não sejam descartadas.
 */
export function sanearSala(sala: Sala, preservarIds: Set<string>): Sala {
    const ordenados = [...sala.itens].sort((a, b) => Number(preservarIds.has(b.id)) - Number(preservarIds.has(a.id)));
    return ordenados.reduce<Sala>((atual, item) => {
        const proxima = comItem(atual, item);
        return validarSala(proxima) === null ? proxima : atual;
    }, { ...sala, itens: [] });
}

/** Escritório recém alugado: só paredes, porta e luz. A decoração é comprada pela Diretoria. */
export const salaVazia: Sala = { largura: 14, profundidade: 12, itens: [] };
