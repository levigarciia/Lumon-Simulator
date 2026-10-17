import type { RegistroTrabalho } from './trabalho';

/** Projeta a hierarquia e a espera sem confundir atividade do departamento com geração de texto. */
export function atividadeDepartamento(id: string, trabalhos: RegistroTrabalho[]): string | undefined {
    const ativo = trabalhos.findLast((item) => item.funcionarioId === id && item.estado === 'trabalhando');
    if (ativo) {
        const delegado = trabalhos.findLast((item) => item.pedidoId === ativo.pedidoId
            && item.solicitante?.id === id && item.estado === 'trabalhando');
        if (delegado) return `Coordena ${delegado.nome}`;
        const principal = trabalhos.find((item) => item.pedidoId === ativo.pedidoId && !item.solicitante?.id);
        return principal?.origemCorrecaoId ? 'Corrigindo Macrodados' : 'Refinando Macrodados';
    }
    const ultimo = trabalhos.findLast((item) => item.funcionarioId === id && item.arquivoId && !item.solicitante?.id);
    return ultimo?.avaliacao?.estado === 'aguardando_aprovacao' ? 'Aguarda a Diretoria' : undefined;
}
