import { encontrarRota } from './caminhos';
import { lugarNoAnexo, type TipoAnexo } from './anexos';
import { criarVerificadorCirculacao } from './circulacao';
import {
    anguloRotacao,
    catalogo,
    celulaDeUso,
    celulaDoPonto,
    celulaEntrada,
    centroCelula,
    criarVerificadorLivre,
    type Atividade,
    type Celula,
    type ItemPosicionado,
    type Ponto,
    type Sala,
} from './escritorio';

/**
 * Corpo de um funcionário na sala. Avance sempre por `avancarAgente`, que devolve um novo estado. A atividade
 * `trabalhando` significa estar sentado à própria mesa; se ele digita depende do status real do harness.
 */
export type Agente = {
    id: string;
    mesaId: string;
    posicao: Ponto;
    direcao: number;
    rota: Celula[];
    atividade: Atividade;
    destinoId: string;
    ateSegundo: number;
    indiceUso?: number;
    anexo?: TipoAnexo;
};

export type ContextoSimulacao = { sala: Sala; agoraSegundos: number; sortear: () => number };

const velocidadeCelulasPorSegundo = 1.4;
const esperaSemRotaSegundos = 5;

const duracoes: Record<Atividade, [number, number]> = {
    observando: [3, 7],
    trabalhando: [40, 100],
    andando: [0, 0],
    cafe: [8, 14],
    comendo: [10, 16],
    descansando: [15, 25],
    ouvindo_musica: [15, 25],
    conversando: [0, 0],
    ausente: [0, 0],
};

function sortearDuracao(atividade: Atividade, sortear: () => number): number {
    const [minimo, maximo] = duracoes[atividade];
    return minimo + (maximo - minimo) * sortear();
}

function buscarItem(sala: Sala, id: string): ItemPosicionado | undefined {
    return sala.itens.find((candidato) => candidato.id === id);
}

function angulo(de: Ponto, para: Ponto): number {
    return Math.atan2(para.x - de.x, para.z - de.z);
}

function direcaoDeUso(item: ItemPosicionado): number {
    return anguloRotacao(item.rotacao) + Math.PI;
}

function mesmaCelula(a: Celula, b: Celula): boolean {
    return a.x === b.x && a.z === b.z;
}

/** Cria o agente na porta, já a caminho da própria mesa. */
export function criarAgente(id: string, mesaId: string, contexto: ContextoSimulacao): Agente {
    const entrada: Agente = {
        id,
        mesaId,
        posicao: centroCelula(celulaEntrada),
        direcao: 0,
        rota: [],
        atividade: 'andando',
        destinoId: mesaId,
        ateSegundo: 0,
    };
    return irParaMesa(entrada, contexto);
}

/**
 * O que o processo principal exige do corpo: ficar na própria mesa, ou ir a um item e permanecer nele durante
 * uma pausa decidida pelo agente. A ronda mantém supervisores circulando pelo departamento.
 */
export type Ordem = { tipo: 'mesa' } | { tipo: 'item'; itemId: string; indiceUso?: number }
    | { tipo: 'encontro'; celula: Celula; encontroId: string } | { tipo: 'saida' }
    | { tipo: 'anexo'; anexo: TipoAnexo; lugar: number } | { tipo: 'ronda' };

const destinoSaida = 'saida';

/** Cria o agente já sentado à própria mesa, como ao abrir o escritório com a equipe existente. */
export function criarAgenteNaMesa(id: string, mesaId: string, contexto: ContextoSimulacao): Agente {
    const mesa = buscarItem(contexto.sala, mesaId);
    const assento = mesa && celulaDeUso(mesa);
    if (!mesa || !assento) return criarAgente(id, mesaId, contexto);
    return {
        id,
        mesaId,
        posicao: centroCelula(assento),
        direcao: direcaoDeUso(mesa),
        rota: [],
        atividade: 'trabalhando',
        destinoId: mesaId,
        ateSegundo: contexto.agoraSegundos + sortearDuracao('trabalhando', contexto.sortear),
    };
}

/**
 * Avança o agente em `segundos`, obedecendo à ordem atual. `ritmo` reduz a velocidade da caminhada,
 * como no esgotamento.
 */
export function avancarAgente(
    agente: Agente, contexto: ContextoSimulacao, segundos: number, ordem: Ordem, ritmo = 1,
): Agente {
    const passo = segundos * ritmo;
    if (ordem.tipo === 'ronda') return fazerRonda(agente, contexto, passo);
    if (ordem.tipo === 'anexo') return irParaAnexo(agente, contexto, passo, ordem);
    if (ordem.tipo === 'saida') return sairDaSala(agente, contexto, passo);
    if (ordem.tipo === 'encontro') {
        if (agente.destinoId !== ordem.encontroId) {
            const rota = encontrarRota(celulaDoPonto(agente.posicao), ordem.celula,
                criarVerificadorCirculacao(contexto.sala));
            return { ...agente, destinoId: ordem.encontroId, rota: rota ?? [],
                atividade: rota?.length === 0 ? 'conversando' : 'andando' };
        }
        return agente.rota.length ? caminhar(agente, contexto, passo, (chegou) =>
            ({ ...chegou, atividade: 'conversando' })) : agente;
    }
    const destino = ordem.tipo === 'mesa' ? agente.mesaId : ordem.itemId;
    const indiceUso = ordem.tipo === 'item' ? ordem.indiceUso ?? 0 : 0;
    if (agente.destinoId !== destino || (agente.indiceUso ?? 0) !== indiceUso) {
        const item = buscarItem(contexto.sala, destino);
        return item ? irPara(agente, item, contexto, indiceUso) : irParaMesa(agente, contexto);
    }
    if (agente.rota.length > 0) return caminhar(agente, contexto, passo);
    if (contexto.agoraSegundos < agente.ateSegundo || agente.atividade !== 'andando') return agente;
    const item = buscarItem(contexto.sala, destino);
    return item ? irPara(agente, item, contexto, indiceUso) : agente;
}

function fazerRonda(agente: Agente, contexto: ContextoSimulacao, passo: number): Agente {
    const observar = (chegou: Agente): Agente => ({ ...chegou, anexo: undefined, atividade: 'observando',
        ateSegundo: contexto.agoraSegundos + sortearDuracao('observando', contexto.sortear) });
    if (agente.destinoId === 'ronda') {
        if (agente.rota.length) return caminhar(agente, contexto, passo, observar);
        if (contexto.agoraSegundos < agente.ateSegundo) return agente;
    }
    const livre = criarVerificadorLivre(contexto.sala);
    const origem = celulaDoPonto(agente.posicao);
    const candidatos: Celula[] = [];
    for (let z = 0; z < contexto.sala.profundidade; z++) {
        for (let x = 0; x < contexto.sala.largura; x++) {
            const celula = { x, z };
            if (livre(celula) && !mesmaCelula(origem, celula)) candidatos.push(celula);
        }
    }
    const inicio = Math.floor(contexto.sortear() * candidatos.length);
    for (let indice = 0; indice < candidatos.length; indice++) {
        const destino = candidatos[(inicio + indice) % candidatos.length];
        const rota = encontrarRota(origem, destino, criarVerificadorCirculacao(contexto.sala));
        if (!rota?.length) continue;
        return { ...agente, anexo: undefined, destinoId: 'ronda', rota, atividade: 'andando' };
    }
    return observar({ ...agente, destinoId: 'ronda', rota: [] });
}

function irParaAnexo(
    agente: Agente, contexto: ContextoSimulacao, passo: number, ordem: Extract<Ordem, { tipo: 'anexo' }>,
): Agente {
    const lugar = lugarNoAnexo(contexto.sala, ordem.anexo, ordem.lugar);
    const destinoId = `anexo:${ordem.anexo}:${ordem.lugar}`;
    const concluir = (chegou: Agente): Agente => ({ ...chegou, atividade: 'ausente',
        anexo: ordem.anexo, direcao: lugar.direcao });
    if (agente.destinoId !== destinoId) {
        const rota = encontrarRota(celulaDoPonto(agente.posicao), celulaDoPonto(lugar.posicao),
            criarVerificadorCirculacao(contexto.sala));
        const partida: Agente = { ...agente, anexo: undefined, destinoId, rota: rota ?? [], atividade: 'andando' };
        return rota?.length === 0 ? concluir(partida) : partida;
    }
    if (agente.rota.length) return caminhar(agente, contexto, passo, concluir);
    if (agente.atividade === 'andando') return irParaAnexo({ ...agente, destinoId: '' }, contexto, passo, ordem);
    return agente;
}

/** Leva o corpo até a porta e o tira de cena. Sem caminho livre, ele sai imediatamente. */
function sairDaSala(agente: Agente, contexto: ContextoSimulacao, passo: number): Agente {
    if (agente.destinoId !== destinoSaida) {
        const rota = encontrarRota(celulaDoPonto(agente.posicao), celulaEntrada,
            criarVerificadorCirculacao(contexto.sala));
        return { ...agente, destinoId: destinoSaida, rota: rota ?? [],
            atividade: rota?.length ? 'andando' : 'ausente' };
    }
    return agente.rota.length ? caminhar(agente, contexto, passo, (chegou) =>
        ({ ...chegou, atividade: 'ausente' })) : agente;
}

/** Indica se o agente já está usando o item, e não apenas a caminho dele. */
export function usandoItem(agente: Agente, itemId: string): boolean {
    return agente.destinoId === itemId && agente.rota.length === 0 && agente.atividade !== 'andando';
}

/** Refaz o trajeto depois que a sala mudou: o destino pode ter sido movido, vendido ou bloqueado. */
export function reajustarAgente(agente: Agente, contexto: ContextoSimulacao): Agente {
    if (agente.destinoId.startsWith('anexo:')) {
        return { ...agente, destinoId: '', rota: [], anexo: undefined };
    }
    if (agente.destinoId === destinoSaida) return agente;
    const destino = buscarItem(contexto.sala, agente.destinoId);
    if (!destino) return irParaMesa(agente, contexto);
    const uso = celulaDeUso(destino, agente.indiceUso ?? 0);
    const parado = agente.rota.length === 0 && agente.atividade !== 'andando';
    if (parado && uso && mesmaCelula(uso, celulaDoPonto(agente.posicao))) {
        return { ...agente, direcao: direcaoDeUso(destino) };
    }
    return irPara(agente, destino, contexto, agente.indiceUso ?? 0);
}

function caminhar(
    agente: Agente, contexto: ContextoSimulacao, segundos: number,
    aoChegar: (agente: Agente) => Agente = (chegou) => chegar(chegou, contexto),
): Agente {
    const [proxima, ...restante] = agente.rota;
    const alvo = centroCelula(proxima);
    const dx = alvo.x - agente.posicao.x;
    const dz = alvo.z - agente.posicao.z;
    const distancia = Math.hypot(dx, dz);
    const passo = velocidadeCelulasPorSegundo * segundos;
    if (passo < distancia) {
        const fracao = passo / distancia;
        const posicao = { x: agente.posicao.x + dx * fracao, z: agente.posicao.z + dz * fracao };
        return { ...agente, posicao, direcao: angulo(agente.posicao, alvo) };
    }
    const chegou = { ...agente, posicao: alvo, rota: restante };
    return restante.length > 0 ? chegou : aoChegar(chegou);
}

function chegar(agente: Agente, contexto: ContextoSimulacao): Agente {
    const item = buscarItem(contexto.sala, agente.destinoId);
    const uso = item && catalogo[item.tipo].uso;
    if (!item || !uso) return irParaMesa(agente, contexto);
    return {
        ...agente,
        atividade: uso.atividade,
        direcao: direcaoDeUso(item),
        ateSegundo: contexto.agoraSegundos + sortearDuracao(uso.atividade, contexto.sortear),
    };
}

function irParaMesa(agente: Agente, contexto: ContextoSimulacao): Agente {
    const mesa = buscarItem(contexto.sala, agente.mesaId);
    if (!mesa) {
        const espera = contexto.agoraSegundos + esperaSemRotaSegundos;
        return { ...agente, destinoId: agente.mesaId, rota: [], ateSegundo: espera };
    }
    return irPara(agente, mesa, contexto);
}

function irPara(agente: Agente, item: ItemPosicionado, contexto: ContextoSimulacao, indiceUso = 0): Agente {
    const destino = celulaDeUso(item, indiceUso);
    const rota = destino && encontrarRota(celulaDoPonto(agente.posicao), destino,
        criarVerificadorCirculacao(contexto.sala));
    if (!rota) {
        const espera = contexto.agoraSegundos + esperaSemRotaSegundos;
        return { ...agente, destinoId: item.id, rota: [], atividade: 'andando', ateSegundo: espera };
    }
    const partida = { ...agente, anexo: undefined, destinoId: item.id, indiceUso, rota };
    return rota.length > 0 ? { ...partida, atividade: 'andando' } : chegar(partida, contexto);
}
