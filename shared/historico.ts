import type { EventoSocial } from './social';

export const categoriasHistorico = {
    equipe: 'Equipe', trabalho: 'Trabalho', convivio: 'Convivência', escritorio: 'Escritório',
    comunicados: 'Comunicados', pensamentos: 'Pensamentos', conversas: 'Conversas',
} as const;

export type CategoriaHistorico = keyof typeof categoriasHistorico;
export const nomesAcontecimentos: Record<EventoSocial['tipo'], string> = {
    cobrar: 'Cobrança', contestar: 'Contestação', elogiar: 'Elogio', desculpar: 'Pedido de desculpas',
    defender: 'Defesa', fofocar: 'Fofoca', reservado: 'Conversa reservada', reacao: 'Interpretação privada',
    proposta: 'Proposta', apoio: 'Apoio', decisao: 'Decisão', contratacao: 'Contratação', demissao: 'Demissão',
    sala: 'Mudança na sala', delegacao: 'Delegação', entrega: 'Entrega', falha: 'Falha', fala: 'Fala',
    pausa: 'Pausa', quebra: 'Quebra', conserto: 'Conserto', folga: 'Folga', punicao: 'Sala de Descanso',
    incentivo: 'Incentivo', comunicado: 'Comunicado', promocao: 'Promoção',
};
export type RegistroHistorico = {
    id: string;
    categoria: CategoriaHistorico;
    titulo: string;
    texto: string;
    data: string;
    autor: string;
    alcance?: string;
    funcionarioId?: string;
};

/** Agrupa acontecimentos para a navegação do jogador sem alterar sua audiência original. */
export function categoriaAcontecimento(tipo: EventoSocial['tipo']): CategoriaHistorico {
    if (['contratacao', 'demissao', 'promocao', 'folga', 'punicao', 'incentivo'].includes(tipo)) return 'equipe';
    if (['delegacao', 'entrega', 'falha'].includes(tipo)) return 'trabalho';
    if (['sala', 'pausa', 'quebra', 'conserto'].includes(tipo)) return 'escritorio';
    if (tipo === 'comunicado') return 'comunicados';
    return 'convivio';
}
