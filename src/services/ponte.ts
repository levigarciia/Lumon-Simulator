import type { ApiLumon, Resultado } from '../../shared/ponte';

/** Ponte com o processo principal. Ausente quando a interface é aberta fora do Electron. */
export const lumon: ApiLumon | undefined = window.lumon;

/** Limpa uma conversa e orienta a reabertura quando o desktop ainda usa uma ponte antiga. */
export async function limparHistorico(funcionarioId?: string): Promise<Resultado> {
    const acao = funcionarioId ? lumon?.limparConversa : lumon?.limparGeral;
    if (typeof acao !== 'function') {
        return { ok: false, erro: 'Reabra o Lumon para carregar a atualização da limpeza de histórico.' };
    }
    return funcionarioId ? lumon!.limparConversa(funcionarioId) : lumon!.limparGeral();
}
