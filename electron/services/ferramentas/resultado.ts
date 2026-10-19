import type { AudienciaFerramenta, EfeitoFerramenta } from '../../../shared/ferramentas';

export type ResultadoAcao = {
    mensagem: string;
    codigo: string;
    erro: boolean;
    terminal: boolean;
    audiencia?: AudienciaFerramenta;
    efeito?: EfeitoFerramenta;
};

/** Confirma o resultado no serviço que executou a ação, sem depender da redação da mensagem. */
export function concluirAcao(
    mensagem: string, codigo = 'acao_concluida', estado: Partial<Omit<ResultadoAcao, 'mensagem' | 'codigo'>> = {},
): ResultadoAcao {
    return { mensagem, codigo, erro: false, terminal: false, ...estado };
}

/** Recusa a operação sem atribuir à personagem um efeito que não aconteceu. */
export function recusarAcao(mensagem: string, codigo = 'acao_recusada'): ResultadoAcao {
    return { mensagem, codigo, erro: true, terminal: false };
}

/** Preserva callbacks textuais antigos durante a migração das integrações locais. */
export function normalizarResultado(resultado: string | ResultadoAcao): ResultadoAcao {
    return typeof resultado === 'string' ? concluirAcao(resultado, 'compatibilidade_textual') : resultado;
}
