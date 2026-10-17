import type { Agente } from '../../shared/agentes';
import type { QuadroSimulacao } from '../../shared/estado';

/**
 * Último quadro recebido do processo principal. Os componentes 3D leem daqui dentro do próprio `useFrame` e
 * interpolam até ele, sem renderizar o React a cada quadro.
 */
export type Simulacao = { quadro: QuadroSimulacao; recebidoEm: number; porId: Map<string, Agente> };

export function criarSimulacao(): Simulacao {
    return { quadro: { segundos: 0, agentes: [] }, recebidoEm: performance.now(), porId: new Map() };
}

export function receberQuadro(simulacao: Simulacao, quadro: QuadroSimulacao): void {
    simulacao.quadro = quadro;
    simulacao.recebidoEm = performance.now();
    simulacao.porId = new Map(quadro.agentes.map((agente) => [agente.id, agente]));
}

/** Instante do escritório estimado entre dois quadros, para o relógio andar de forma contínua. */
export function segundosEstimados(simulacao: Simulacao): number {
    return simulacao.quadro.segundos + (performance.now() - simulacao.recebidoEm) / 1000;
}
