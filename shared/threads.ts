import { z } from 'zod';
import type { Mensagem } from './funcionarios';

export const threadPrincipal = 'principal';

export const esquemaThread = z.object({
    id: z.string().uuid(),
    titulo: z.string().trim().min(1).max(80),
    tipo: z.enum(['conversa', 'work']),
    destinoId: z.string().min(1),
    criadaEm: z.string(),
});

export type Thread = z.infer<typeof esquemaThread>;

/**
 * Recupera somente o contexto salvo da thread que será retomada. No Work, também filtra pelo projeto;
 * o chat individual não pertence a projetos.
 */
export function contextoDaThread(
    mensagens: Mensagem[], threadId: string, projetoId: string | undefined, canal: 'conversa' | 'work' = 'conversa',
): string {
    let projetoAtual: string | undefined;
    return mensagens
        .map((mensagem) => {
            projetoAtual = mensagem.projetoId ?? projetoAtual;
            return { ...mensagem, projetoId: projetoAtual };
        })
        .filter((mensagem) => (mensagem.threadId ?? threadPrincipal) === threadId
            && (canal === 'conversa' || mensagem.projetoId === projetoId) && (mensagem.canal ?? 'conversa') === canal && mensagem.texto)
        .map((mensagem) => `${mensagem.autor === 'usuario' ? 'Diretoria' : 'Funcionário'}: ${mensagem.texto}`)
        .join('\n\n');
}
