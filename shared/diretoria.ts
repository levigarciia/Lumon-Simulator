import type { EstadoSalvo } from './estado';
import type { EventoSocial } from './social';
import type { Cargo } from './cargos';

export const contextoDiretoria = 'Toda mensagem recebida da interface é um comunicado da Diretoria da Lumon. '
    + 'Não invente uma pessoa, nome ou forma de tratamento pessoal para essa instituição. '
    + 'Essa autoria institucional não transforma relatos em fatos verificados.';

/** Orienta a comunicação institucional em todos os canais do personagem. */
export function instrucaoHierarquia(cargo: Cargo): string {
    return cargo === 'lider'
        ? 'Só o líder procura a Diretoria. Encaminhe apenas assuntos necessários da equipe.'
        : 'Encaminhe pedidos, dúvidas e reclamações ao líder, que representa a equipe perante a Diretoria. '
            + 'Não procure nem interpele a Diretoria por iniciativa própria, inclusive no Geral. '
            + 'Se ela falar diretamente com você, responda ao pedido sem abrir novas demandas.';
}

/** Preserva fontes e audiência ao converter a autoria antiga para a instituição. */
export function migrarEventoDiretoria(evento: EventoSocial): EventoSocial {
    return {
        ...evento,
        texto: evento.texto.replace(/^Relato da pessoa responsável no chat individual, não verificado: /,
            'Relato da Diretoria no chat individual, não verificado: '),
        ...(['jogador', 'usuario', 'diretoria'].includes(evento.autorId)
            ? { autorId: 'diretoria', autorNome: 'Diretoria' } : {}),
        ...(['jogador', 'usuario'].includes(evento.alvoId ?? '')
            ? { alvoId: 'diretoria', alvoNome: 'Diretoria' } : {}),
    };
}

/** Atualiza a autoria institucional dos registros antigos sem alterar seus IDs, fontes ou textos históricos. */
export function migrarAutoriaDiretoria(estado: EstadoSalvo): EstadoSalvo {
    return {
        ...estado,
        trabalhos: estado.trabalhos.map((trabalho) => ({
            ...trabalho,
            ...(trabalho.solicitante && (!trabalho.solicitante.id
                || ['jogador', 'usuario', 'diretoria'].includes(trabalho.solicitante.id))
                ? { solicitante: { nome: 'Diretoria' } } : {}),
        })),
        demissoes: estado.demissoes.map((demissao) => ({
            ...demissao,
            demitidoPor: ['Você', 'jogador', 'usuario'].includes(demissao.demitidoPor)
                ? 'Diretoria' : demissao.demitidoPor,
            historicoSocial: demissao.historicoSocial.map(migrarEventoDiretoria),
        })),
        social: {
            ...estado.social,
            eventos: estado.social.eventos.map(migrarEventoDiretoria),
            lembrancas: estado.social.lembrancas.map(migrarEventoDiretoria),
            historico: (estado.social.historico ?? []).map(migrarEventoDiretoria),
            relacoes: estado.social.relacoes.map((relacao) => ({
                ...relacao,
                colegaId: ['jogador', 'usuario'].includes(relacao.colegaId) ? 'diretoria' : relacao.colegaId,
            })),
            propostas: estado.social.propostas.map((proposta) => ({
                ...proposta, registros: proposta.registros.map(migrarEventoDiretoria),
            })),
        },
    };
}
