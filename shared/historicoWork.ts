import type { ParteResposta } from './funcionarios';
import type { RegistroTrabalho } from './trabalho';

export type EntradaWork = {
    id: string;
    trabalho: RegistroTrabalho;
    tipo: 'pedido' | 'resposta';
    partes: ParteResposta[];
    ordem: number;
};

/** Organiza a execução entre funcionários sem mover trechos anteriores quando um deles retoma a fala. */
export function organizarHistoricoWork(trabalhos: RegistroTrabalho[]): EntradaWork[] {
    const entradas = trabalhos.flatMap((trabalho, indice): EntradaWork[] => {
        if (!trabalho.solicitante) {
            const principal = trabalhos.find((item) => item.pedidoId === trabalho.pedidoId)!;
            trabalho = { ...trabalho, solicitante: principal.id === trabalho.id
                ? { nome: 'Diretoria' } : {
                    id: principal.funcionarioId, nome: principal.nome, aparencia: principal.aparencia,
                } };
        }
        const base = trabalho.ordem ?? indice * 2;
        const pedido: EntradaWork = {
            id: `${trabalho.id}:pedido`, trabalho, tipo: 'pedido', partes: [], ordem: base,
        };
        if (!trabalho.eventos?.length) return [pedido, {
            id: `${trabalho.id}:resposta`, trabalho, tipo: 'resposta', partes: [], ordem: base + 0.5,
        }];
        return [pedido, ...trabalho.eventos.map((evento): EntradaWork => ({
            id: `${trabalho.id}:${evento.parte.id}`, trabalho, tipo: 'resposta',
            partes: [evento.parte], ordem: evento.ordem,
        }))];
    }).sort((a, b) => a.ordem - b.ordem);
    return entradas.reduce<EntradaWork[]>((agrupadas, entrada) => {
        const anterior = agrupadas.at(-1);
        if (entrada.tipo === 'resposta' && anterior?.tipo === 'resposta'
            && anterior.trabalho.id === entrada.trabalho.id && anterior.partes.length && entrada.partes.length) {
            anterior.partes.push(...entrada.partes);
        } else agrupadas.push({ ...entrada, partes: [...entrada.partes] });
        return agrupadas;
    }, []);
}
