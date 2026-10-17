import { z } from 'zod';
import { catalogo, type Sala } from './escritorio';
import type { Necessidades } from './necessidades';

export const esquemaNecessidadesLiberadas = z.array(z.enum(['energia', 'estresse', 'fome']));
export type NecessidadeLiberada = z.infer<typeof esquemaNecessidadesLiberadas>[number];

/** Libera desgaste quando o escritório adquire seu primeiro recurso para recuperar cada necessidade. */
export function liberarNecessidades(
    anteriores: NecessidadeLiberada[], sala: Sala,
): NecessidadeLiberada[] {
    const liberadas = new Set(anteriores);
    for (const item of sala.itens) {
        const atividade = catalogo[item.tipo].uso?.atividade;
        if (atividade === 'cafe' || atividade === 'descansando') liberadas.add('energia');
        if (atividade === 'comendo') liberadas.add('fome');
        if (atividade === 'descansando' || atividade === 'ouvindo_musica') liberadas.add('estresse');
    }
    return [...liberadas];
}

/** Conserva melhorias e consequências diretas, protegendo somente o desgaste passivo ainda bloqueado. */
export function protegerNecessidades(
    anterior: Necessidades, proxima: Necessidades, liberadas: NecessidadeLiberada[],
): Necessidades {
    return {
        ...proxima,
        energia: liberadas.includes('energia') ? proxima.energia : Math.max(anterior.energia, proxima.energia),
        fome: liberadas.includes('fome') ? proxima.fome : Math.min(anterior.fome, proxima.fome),
        estresse: liberadas.includes('estresse') ? proxima.estresse : Math.min(anterior.estresse, proxima.estresse),
        esgotamento: liberadas.includes('estresse')
            ? proxima.esgotamento : Math.min(anterior.esgotamento, proxima.esgotamento),
    };
}
