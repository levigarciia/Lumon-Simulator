import { z } from 'zod';
import { esquemaAparencia, esquemaParteResposta } from './funcionarios';

export const esquemaPensamento = z.object({
    id: z.string().optional(),
    texto: z.string().trim().min(1).max(600),
    atualizadoEm: z.string(),
});

export type Pensamento = z.infer<typeof esquemaPensamento>;

export const esquemaCriterioEntrega = z.object({
    criterio: z.string().trim().min(1).max(300),
    tipo: z.enum(['estatica', 'funcional', 'visual']),
    estado: z.enum(['verificado', 'pendente', 'falhou']),
    evidencia: z.string().trim().min(1).max(1500),
});

export const esquemaValidacaoEntrega = z.object({
    resumo: z.string().trim().min(1).max(1500),
    criterios: z.array(esquemaCriterioEntrega).min(1).max(20),
});

export type ValidacaoEntrega = z.infer<typeof esquemaValidacaoEntrega>;

export const esquemaAvaliacaoEntrega = z.object({
    estado: z.enum(['pendente', 'aguardando_aprovacao', 'aprovada', 'rejeitada', 'reprovada']),
    validacao: esquemaValidacaoEntrega.optional(),
    motivo: z.string().max(2000).optional(),
    avaliadaEm: z.string().optional(),
    recompensa: z.number().int().nonnegative().default(0),
});

export const esquemaRegistroTrabalho = z.object({
    id: z.string(),
    pedidoId: z.string(),
    threadId: z.string().optional(),
    funcionarioId: z.string(),
    nome: z.string(),
    projetoId: z.string(),
    tarefa: z.string(),
    resultado: z.string().default(''),
    estado: z.enum(['trabalhando', 'concluido', 'falhou', 'interrompido']),
    falhaTecnica: z.boolean().optional(),
    criadoEm: z.string(),
    avaliacao: esquemaAvaliacaoEntrega.optional(),
    origemCorrecaoId: z.string().optional(),
    arquivoId: z.string().optional(),
    aparencia: esquemaAparencia.optional(),
    solicitante: z.object({
        id: z.string().optional(), nome: z.string(), aparencia: esquemaAparencia.optional(),
    }).optional(),
    ordem: z.number().int().nonnegative().optional(),
    eventos: z.array(z.object({ ordem: z.number().int().nonnegative(), parte: esquemaParteResposta })).optional(),
});

export type RegistroTrabalho = z.infer<typeof esquemaRegistroTrabalho>;
export type RespostaTrabalho = { ok: boolean; texto: string };

/** Exige inspeção visual quando o pedido envolve aparência ou uma interface renderizada. */
export function exigeValidacaoVisual(tarefa: string): boolean {
    return /visual|interface|aparência|aparencia|layout|css|redesenh|landing page|página web|painel web/i.test(tarefa);
}

/** Mantém uma entrega pendente enquanto faltarem critérios executados ou a inspeção visual exigida. */
export function pendenciaValidacao(tarefa: string, validacao?: ValidacaoEntrega): string | null {
    if (!validacao) return 'A Diretoria ainda não registrou os critérios e as evidências da entrega.';
    const pendentes = validacao.criterios.filter((item) => item.estado !== 'verificado');
    if (pendentes.length) return pendentes.map((item) => `${item.criterio}: ${item.evidencia}`).join('\n');
    if (exigeValidacaoVisual(tarefa) && !validacao.criterios.some((item) => item.tipo === 'visual')) {
        return 'Falta validar a interface renderizada. Inspeção do código não comprova a aparência.';
    }
    return null;
}
