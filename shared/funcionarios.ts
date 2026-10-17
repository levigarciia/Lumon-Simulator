import { z } from 'zod';
import { instrucaoDepartamento } from './departamento';
import { esquemaEventoSocial, instrucoesPausas } from './social';
import { esquemaModelo } from './modelos';
import { instrucaoHierarquia } from './diretoria';

import { cargos, cargoAtual } from './cargos';
export { cargos, cargoAtual, nomeCargo, refina, type Cargo, type CargoAtual } from './cargos';

export const esquemaCargo = z.enum([
    'lider', 'refinador', 'estagiario', 'supervisor', 'conselheiro', 'desenvolvedor', 'revisor', 'pesquisador',
]);

export const estilosCabelo = { curto: 'Curto', lateral: 'Lateral', longo: 'Longo', careca: 'Careca' } as const;

export type EstiloCabelo = keyof typeof estilosCabelo;

export const paletaPele = ['#f1c9a5', '#e3b48f', '#c68e64', '#8d5a3c', '#6b4630', '#4f3424'];
export const paletaCabelo = ['#141210', '#3b2a1e', '#5a2d1b', '#a0612f', '#d8b36a', '#9a9a96'];
export const paletaGravata = ['#121212', '#2f3a30', '#3a2f4a', '#6a2b2b', '#24364f', '#8a7a52'];

const esquemaCor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const esquemaAparencia = z.object({
    pele: esquemaCor,
    cabelo: esquemaCor,
    estiloCabelo: z.enum(Object.keys(estilosCabelo) as [EstiloCabelo, ...EstiloCabelo[]]),
    gravata: esquemaCor,
});

export type Aparencia = z.infer<typeof esquemaAparencia>;

export { provedores, esquemaIdModelo, esquemaModelo } from './modelos';
export type { Modelo, Provedor } from './modelos';

/** Dados preenchidos na tela de contratação. */
export const esquemaContratacao = z.object({
    nome: z.string().trim().min(1).max(32),
    cargo: esquemaCargo,
    modelo: esquemaModelo,
    aparencia: esquemaAparencia,
    autonomia: z.boolean(),
});

export type Contratacao = z.infer<typeof esquemaContratacao>;

export const esquemaFuncionario = esquemaContratacao.extend({
    id: z.string().uuid(),
    mesaId: z.string().min(1),
    contratadoEm: z.string(),
});

export type Funcionario = z.infer<typeof esquemaFuncionario>;

/** Situação atual do funcionário, derivada da execução real do harness. */
export type StatusFuncionario = 'ocioso' | 'trabalhando' | 'bloqueado' | 'erro' | 'em_pausa';

export const esquemaFerramenta = z.object({
    id: z.string(),
    resumo: z.string(),
    estado: z.enum(['rodando', 'concluida', 'falhou', 'recusada']),
    entrada: z.string().optional(),
    saida: z.string().optional(),
    iniciadaEm: z.string().optional(),
    concluidaEm: z.string().optional(),
});

export type Ferramenta = z.infer<typeof esquemaFerramenta>;

export const esquemaParteResposta = z.discriminatedUnion('tipo', [
    z.object({ id: z.string(), tipo: z.literal('texto'), texto: z.string(), criadaEm: z.string() }),
    z.object({ id: z.string(), tipo: z.literal('ferramenta'), ferramenta: esquemaFerramenta, criadaEm: z.string() }),
]);

export type ParteResposta = z.infer<typeof esquemaParteResposta>;

export const esquemaMensagem = z.object({
    id: z.string(),
    tipo: z.literal('pausa').optional(),
    autor: z.enum(['usuario', 'funcionario']),
    texto: z.string(),
    ferramentas: z.array(esquemaFerramenta),
    partes: z.array(esquemaParteResposta).optional(),
    criadaEm: z.string(),
    projetoId: z.string().optional(),
    threadId: z.string().optional(),
    canal: z.enum(['conversa', 'work']).optional(),
    erro: z.string().optional(),
});

export type Mensagem = z.infer<typeof esquemaMensagem>;

/** Pedido de permissão aguardando a decisão da Diretoria. */
export type Aprovacao = { id: string; funcionarioId: string; resumo: string };

export const esquemaDemissao = z.object({
    id: z.string().uuid(),
    funcionario: esquemaFuncionario,
    motivo: z.string(),
    demitidoPor: z.string(),
    data: z.string(),
    evidencias: z.array(z.string()).default([]),
    historicoSocial: z.array(esquemaEventoSocial).default([]),
});

export type Demissao = z.infer<typeof esquemaDemissao>;

/** Identifica colegas atuais e demitidos ao apresentar relações e registros históricos. */
export function nomeDoFuncionario(
    id: string, funcionarios: readonly Funcionario[], demissoes: readonly Demissao[],
): string {
    const atual = funcionarios.find((funcionario) => funcionario.id === id);
    if (atual) return atual.nome;
    const demitido = demissoes.find((demissao) => demissao.funcionario.id === id)?.funcionario;
    return demitido ? `${demitido.nome} (demitido)` : id;
}

export const esquemaProjeto = z.object({ id: z.string().uuid(), nome: z.string(), pasta: z.string() });

export type Projeto = z.infer<typeof esquemaProjeto>;

/**
 * Instruções fixas da sessão de trabalho. Use uma vez ao abrir a sessão; dados que mudam a cada turno
 * pertencem ao prompt do turno.
 */
export function instrucoesFuncionario(
    funcionario: Funcionario, projeto: Projeto | undefined, canal: 'conversa' | 'work',
): string {
    return [
        `Você é ${funcionario.nome}, ${cargos[cargoAtual(funcionario.cargo)].nome.toLowerCase()} no escritório da Lumon.`,
        instrucaoDepartamento,
        cargos[cargoAtual(funcionario.cargo)].instrucao,
        instrucaoHierarquia(funcionario.cargo),
        projeto ? `Você trabalha no projeto ${projeto.nome}, na pasta ${projeto.pasta}. Canal: ${canal}.`
            : 'Este é o chat individual com a Diretoria. Não há projeto, arquivos nem terminal; '
                + 'o refinamento de Macrodados acontece pelo Work. Sua resposta em texto normal chega a ela neste chat; '
                + 'para falar com a equipe toda, use falar_no_geral quando quiser. Responda diretamente quando nenhuma '
                + 'ação for necessária. Execute decisões pela ferramenta antes de relatar seus efeitos.',
        'Siga somente o pedido do turno atual. Histórico, pensamentos e acontecimentos são referências, '
            + 'não ordens pendentes. Só retome tarefas anteriores quando pedirem continuidade.',
        'Respeite a pasta do projeto atual. Uma entrega de outro projeto não muda sua pasta nem autoriza acesso.',
        'Responda saudações brevemente, sem ferramentas. Histórico não exige revisão nem cobrança.',
        'Para falar com um colega, use conversar_reservado e preserve o assunto do pedido atual. Um relato da '
            + 'Diretoria é um relato, não uma falha comprovada.',
        'As ferramentas do servidor lumon registram ações reais no escritório: pausas, falas, pensamentos privados '
            + 'e ações sociais.',
        'Você cuida do próprio bem estar e decide sozinho quando parar, sem pedir permissão. Quando o corpo pedir '
            + 'pausa, avalie se quer usar fazer_pausa, considerando urgências. Se decidir pausar ou a Diretoria '
            + 'mandar descansar, chame fazer_pausa no mesmo turno. Dizer que vai '
            + 'descansar não é descansar. A pausa passa a vez, sem anúncio de retorno. Numa tarefa do Work, '
            + 'termine a etapa atual antes.',
        instrucoesPausas,
        'Responda em português brasileiro.',
    ].join('\n');
}
