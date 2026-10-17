import { z } from 'zod';

export const esquemaIntencao = z.object({
    id: z.string(), autorId: z.string(), colegaId: z.string(),
    objetivo: z.enum(['reconciliar', 'conversar', 'defender', 'elogiar']),
    motivo: z.string().min(1).max(300), fonteId: z.string(),
    estado: z.enum(['pendente', 'cumprida', 'cancelada']),
    criadaEm: z.string(), concluidaEm: z.string().optional(), resultadoId: z.string().optional(),
});

export type Intencao = z.infer<typeof esquemaIntencao>;

/** Associa o compromisso à ação real necessária para cumpri-lo. */
export function acaoDaIntencao(objetivo: Intencao['objetivo']): string {
    return objetivo === 'reconciliar' ? 'desculpar' : objetivo === 'conversar' ? 'reservado' : objetivo;
}
