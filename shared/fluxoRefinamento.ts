import { progressoRefinamento, type ArquivoRefinamento } from './refinamento';
import type { RegistroTrabalho } from './trabalho';

/** Encontra o arquivo a continuar sem reabrir entregas antigas já aprovadas pela Diretoria. */
export function encontrarArquivoDisponivel(
    arquivos: Record<string, ArquivoRefinamento>, trabalhos: RegistroTrabalho[],
): ArquivoRefinamento | undefined {
    const aprovados = new Set(trabalhos.filter((item) => item.avaliacao?.estado === 'aprovada')
        .map((item) => item.arquivoId));
    return Object.values(arquivos).find((arquivo) => !aprovados.has(arquivo.id)
        && progressoRefinamento(arquivo) < 100);
}

/** Atualiza entregas parciais antigas para o ciclo contínuo sem alterar avaliações já decididas. */
export function recuperarPeriodosRefinamento(
    trabalhos: RegistroTrabalho[], arquivos: Record<string, ArquivoRefinamento>,
): RegistroTrabalho[] {
    return trabalhos.map((trabalho) => {
        const arquivo = trabalho.arquivoId ? arquivos[trabalho.arquivoId] : undefined;
        if (!arquivo || trabalho.solicitante?.id || trabalho.estado !== 'concluido'
            || progressoRefinamento(arquivo) === 100
            || trabalho.avaliacao && !['pendente', 'aguardando_aprovacao'].includes(trabalho.avaliacao.estado)) {
            return trabalho;
        }
        return { ...trabalho, estado: 'pausado', avaliacao: { estado: 'pendente', recompensa: 0,
            motivo: 'O arquivo permanece disponível até atingir 100% de refinamento.' } };
    });
}
