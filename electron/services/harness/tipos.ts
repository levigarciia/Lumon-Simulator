import type { EtapaResposta } from '../../../shared/geral';

/**
 * Ganchos para atualizar conversa, status e aprovações. Use `texto` para prévias e `confirmarTexto` quando o
 * harness validar a fala com suas chamadas, inclusive se a ação encerrar a participação.
 * Cada prévia contém o texto completo atual e pode substituir ou retirar trechos ainda provisórios.
 */
export type OuvinteTurno = {
    etapa?: (etapa: EtapaResposta) => void;
    texto: (completo: string) => void;
    confirmarTexto?: (completo: string) => void;
    iniciarFerramenta: (id: string, resumo: string, entrada?: string) => void;
    concluirFerramenta: (id: string, erro: boolean, saida?: string) => void;
    aprovar: (id: string, resumo: string, sinal: AbortSignal) => Promise<boolean>;
};

/**
 * Restrições de um único turno. `ferramentas` limita os nomes oferecidos, na ordem de prioridade dada, e
 * `exigirFerramenta` exige uma ação real. Decisões sociais podem continuar após consultas, interpretações e pausas,
 * dentro do limite do turno. Use quando o comportamento social não pode depender da iniciativa do modelo.
 * O MCP aplica as permissões do contexto a todos os provedores. O harness local também limita cada inferência
 * por estas opções; os CLIs oficiais recebem o catálogo do servidor e revalidam as chamadas na execução.
 * `encerrarFerramentasQuando` retira as ferramentas após um retorno terminal e pede o resumo da etapa.
 * `exigirFerramentaAteConclusao` exige ações reais até esse retorno e publica texto somente no resumo.
 */
export type OpcoesTurno = {
    ferramentas?: string[];
    exigirFerramenta?: boolean;
    exigirFerramentaAteConclusao?: boolean;
    encerrarFerramentasQuando?: (
        nome: string, saida: string, estado?: { terminal?: boolean; codigo?: string },
    ) => boolean;
};

/**
 * Conversa contínua de um funcionário com o CLI oficial. Mantém o contexto entre turnos até ser encerrada,
 * o que acontece na demissão, na troca de projeto ou numa interrupção.
 */
export type SessaoAgente = {
    enviar: (prompt: string, ouvinte: OuvinteTurno, sinal: AbortSignal, opcoes?: OpcoesTurno) => Promise<void>;
    encerrar: () => void;
};

/**
 * Como abrir a sessão. No modo `conversa`, usado no canal Geral, nenhuma ferramenta de arquivo ou terminal é
 * permitida. `mcpUrl` liga o servidor do escritório, cujas ferramentas nunca pedem aprovação.
 */
export type ConfiguracaoSessao = {
    modelo: string;
    pasta: string;
    autonomia: boolean;
    instrucoes: string;
    historico?: string;
    modo: 'trabalho' | 'conversa' | 'personagem';
    atividade?: 'social' | 'refinamento';
    mcpUrl?: string;
};

/** Prefixo das ferramentas do escritório no Claude Code. */
export const prefixoFerramentasEscritorio = 'mcp__lumon__';

/** Limite de texto de uma resposta, impedindo que um CLI defeituoso consuma a memória. */
export const limiteResposta = 2 * 1024 ** 2;

export const mensagemInterrupcao = 'Tarefa interrompida.';

/** Guarda os detalhes consultáveis de uma ferramenta sem incluir cargas binárias nem saídas ilimitadas. */
export function detalharFerramenta(valor: unknown): string | undefined {
    if (valor === undefined) return undefined;
    const texto = typeof valor === 'string' ? valor : JSON.stringify(valor, (chave, dado: unknown) =>
        chave === 'data' && typeof dado === 'string' && dado.length > 1000 ? '(conteúdo binário omitido)' : dado, 4);
    return texto.length > 32768 ? `${texto.slice(0, 32768)}\n(conteúdo restante omitido)` : texto;
}

/** Linha curta que descreve uma ferramenta na conversa e nos cartões de aprovação. */
export function resumirFerramenta(nome: string, entrada: Record<string, unknown>): string {
    const detalhe = [entrada.command, entrada.file_path, entrada.pattern, entrada.url, entrada.query].find(
        (valor): valor is string => typeof valor === 'string' && valor.length > 0,
    );
    const rotulo = nome.startsWith(prefixoFerramentasEscritorio)
        ? `Escritório: ${nome.slice(prefixoFerramentasEscritorio.length)}`
        : nome;
    const linha = detalhe ? `${rotulo}: ${detalhe}` : rotulo;
    return linha.length > 200 ? `${linha.slice(0, 197)}...` : linha;
}
