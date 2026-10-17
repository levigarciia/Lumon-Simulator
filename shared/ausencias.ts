import { z } from 'zod';

export const motivosAusencia = ['folga', 'sala_descanso', 'bem_estar'] as const;

export type MotivoAusencia = typeof motivosAusencia[number];

export const nomesAusencia: Record<MotivoAusencia, string> = {
    folga: 'De folga', sala_descanso: 'Na Sala de Descanso', bem_estar: 'Em sessão de bem estar',
};

/** Duração em segundos do relógio da simulação. */
export const duracaoAusencia: Record<MotivoAusencia, number> = { folga: 300, sala_descanso: 180, bem_estar: 90 };

/** Ausências em que o funcionário continua conversando a sós, como na sessão de bem estar. */
export function conversaDuranteAusencia(motivo: MotivoAusencia): boolean {
    return motivo === 'bem_estar';
}

export const esquemaAusencia = z.object({
    motivo: z.enum(motivosAusencia),
    terminaEm: z.number().min(0),
    autorId: z.string().min(1),
    justificativa: z.string().max(600).default(''),
    lugar: z.number().int().min(0).max(2).optional(),
    duracao: z.number().positive().optional(),
    retornando: z.boolean().optional(),
});

/**
 * Período fora da sala principal. Folga sai do prédio; Sala de Descanso e sessão de bem estar acontecem nos
 * anexos visíveis da cena (`anexos.ts`). `duracao` guarda a permanência antes da chegada; depois vale `terminaEm`.
 * `retornando` mantém a reserva até alcançar a mesa. Ausentes não trabalham nem fazem pausas.
 */
export type Ausencia = z.infer<typeof esquemaAusencia>;
