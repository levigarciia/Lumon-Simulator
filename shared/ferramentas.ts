import type { Cargo } from './cargos';

export type OrigemFerramenta = 'trabalho' | 'chat' | 'geral' | 'reservado';
export type EfeitoFerramenta = 'consulta' | 'privado' | 'social' | 'escritorio' | 'trabalho' | 'encerramento';
export type AudienciaFerramenta = 'autor' | 'destinatario' | 'proximos' | 'equipe' | 'diretoria';
export type PoliticaFerramenta = {
    origens: readonly OrigemFerramenta[];
    efeito: EfeitoFerramenta;
    audiencia: AudienciaFerramenta;
    cargos?: readonly Cargo[];
    naPausa?: boolean;
    naReacao?: 'sempre' | 'diretoria';
    exigeArquivo?: boolean;
};
export type ContextoFerramentas = {
    cargo?: Cargo;
    ausente?: string;
    refinando?: boolean;
    etapaEncerrada?: boolean;
    participacaoEncerrada?: boolean;
    emPausa?: boolean;
    parceiroDePausa?: boolean;
    reacao?: { diretoria: boolean; embate: boolean };
};

const sociais = ['chat', 'geral', 'reservado'] as const;
const todas = [...sociais, 'trabalho'] as const;
const consulta: PoliticaFerramenta = { origens: todas, efeito: 'consulta', audiencia: 'autor', naPausa: true };
const social: PoliticaFerramenta = { origens: sociais, efeito: 'social', audiencia: 'destinatario' };
const trabalho: PoliticaFerramenta = {
    origens: ['trabalho'], efeito: 'trabalho', audiencia: 'autor', exigeArquivo: true,
};

export const politicasFerramentas = {
    consultar: { ...consulta, naReacao: 'sempre' },
    ver_escritorio: { ...consulta, naReacao: 'diretoria' },
    revisar_trabalho: consulta,
    atualizar_pensamento: {
        ...social, efeito: 'privado', audiencia: 'autor', naPausa: true, naReacao: 'sempre',
    },
    nenhuma_acao: {
        ...social, efeito: 'encerramento', audiencia: 'autor', naPausa: true, naReacao: 'sempre',
    },
    cobrar: { ...social, naPausa: true, naReacao: 'sempre' },
    contestar: { ...social, naPausa: true, naReacao: 'sempre' },
    elogiar: { ...social, naPausa: true, naReacao: 'sempre' },
    desculpar: { ...social, naPausa: true, naReacao: 'sempre' },
    defender: { ...social, naPausa: true, naReacao: 'sempre' },
    fofocar: { ...social, naPausa: true, naReacao: 'sempre' },
    conversar_reservado: { ...social, naPausa: true, naReacao: 'sempre' },
    propor_mudanca: { ...social, audiencia: 'diretoria', naReacao: 'sempre' },
    apoiar_proposta: { ...social, audiencia: 'diretoria' },
    escolher_carreira: { ...social, efeito: 'privado', audiencia: 'autor', naReacao: 'sempre' },
    conceder_incentivo: { ...social, cargos: ['supervisor'], audiencia: 'equipe' },
    sessao_bem_estar: { ...social, cargos: ['conselheiro'] },
    comprar_item: { ...social, efeito: 'escritorio', audiencia: 'equipe' },
    consertar_item: { ...social, efeito: 'escritorio', audiencia: 'equipe', naReacao: 'diretoria' },
    fazer_pausa: { ...social, origens: todas, efeito: 'escritorio', audiencia: 'autor', naReacao: 'diretoria' },
    ir_para_work: {
        ...social, efeito: 'trabalho', audiencia: 'autor', cargos: ['lider', 'refinador', 'estagiario'],
        naReacao: 'sempre',
    },
    sair_do_work: { ...trabalho, efeito: 'encerramento' },
    falar_no_geral: { ...social, origens: ['chat', 'reservado'], audiencia: 'equipe' },
    abrir_arquivo: { ...trabalho, efeito: 'consulta' },
    refinar: trabalho,
    delegar: { ...trabalho, cargos: ['lider'] },
    invocar_pro_work: { ...trabalho, cargos: ['lider'], audiencia: 'equipe' },
    cancelar_delegacao: { ...trabalho, cargos: ['lider'] },
    pedir_refazer: { ...trabalho, cargos: ['lider'] },
} as const satisfies Record<string, PoliticaFerramenta>;

export type NomeFerramenta = keyof typeof politicasFerramentas;
export const aliasesFerramentas: Record<string, NomeFerramenta> = {
    silencio: 'nenhuma_acao', consultar_acontecimento: 'consultar',
};

/** Resolve nomes antigos sem anunciá los no catálogo atual. */
export function nomeCanonicoFerramenta(nome: string): string {
    return Object.hasOwn(aliasesFerramentas, nome) ? aliasesFerramentas[nome]! : nome;
}

/** Identifica consultas pela mesma definição usada no catálogo MCP. */
export function ehConsultaFerramenta(nome: string): boolean {
    const canonico = nomeCanonicoFerramenta(nome);
    return Object.hasOwn(politicasFerramentas, canonico)
        && politicasFerramentas[canonico as NomeFerramenta].efeito === 'consulta';
}

/** Aplica as mesmas condições ao anúncio e ? execução, usando sempre o estado atual. */
export function impedimentoFerramenta(
    nomeOriginal: string, origem: OrigemFerramenta, contexto: ContextoFerramentas = {},
): string | undefined {
    const nome = nomeCanonicoFerramenta(nomeOriginal);
    if (!Object.hasOwn(politicasFerramentas, nome)) return 'Ferramenta desconhecida.';
    const politica = (politicasFerramentas as Record<string, PoliticaFerramenta>)[nome];
    if (!politica || !politica.origens.includes(origem)) return 'Ferramenta indisponível neste canal.';
    if (contexto.cargo && politica.cargos && !politica.cargos.includes(contexto.cargo)) {
        return 'Seu cargo não dispõe desta capacidade.';
    }
    if (contexto.ausente) return contexto.ausente;
    const socialAtual = origem === 'geral' || origem === 'reservado';
    if (socialAtual && contexto.participacaoEncerrada) return 'Sua ação já encerrou a participação neste turno.';
    if (socialAtual && contexto.emPausa) {
        if (origem !== 'reservado' || !contexto.parceiroDePausa || !politica.naPausa) {
            return 'Durante a pausa, converse somente em particular com quem divide o item.';
        }
    }
    if (socialAtual && contexto.refinando) return 'Conclua a etapa no Work antes de outras ações.';
    if (origem === 'trabalho') {
        if (contexto.refinando === false && politica.exigeArquivo) return 'Nenhum refinamento ativo.';
        if (contexto.etapaEncerrada && !['abrir_arquivo', 'refinar', 'consultar',
            'ver_escritorio', 'revisar_trabalho', 'sair_do_work', 'fazer_pausa'].includes(nome)) {
            return 'Etapa encerrada. Resuma, saia do Work ou faça uma pausa.';
        }
    }
    if (socialAtual && contexto.reacao) {
        const { diretoria, embate } = contexto.reacao;
        if (embate && nome === 'nenhuma_acao') return 'Encerre o embate com uma ação concreta.';
        if (embate && nome === 'fazer_pausa') return;
        if (!politica.naReacao || politica.naReacao === 'diretoria' && !diretoria) {
            return 'Ferramenta indisponível neste turno de reação.';
        }
    }
}

/** Lista nomes por contexto sem manter listas paralelas nos canais e provedores. */
export function ferramentasDisponiveis(origem: OrigemFerramenta, contexto: ContextoFerramentas = {}): string[] {
    return Object.keys(politicasFerramentas).filter((nome) => !impedimentoFerramenta(nome, origem, contexto));
}
