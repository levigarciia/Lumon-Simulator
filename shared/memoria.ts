import type { EventoSocial } from './social';

const importantes = new Set(['demissao', 'decisao', 'cobrar', 'contestar', 'elogiar', 'desculpar', 'defender',
    'apoio', 'proposta', 'fofocar', 'entrega', 'falha', 'contratacao', 'quebra', 'conserto']);

/** Seleciona episódios com autoria e audiência intactas para manter continuidade após a poda do chat. */
export function preservarLembrancas(eventos: EventoSocial[], anteriores: EventoSocial[]): EventoSocial[] {
    const unicos = new Map(anteriores.map((evento) => [evento.id, evento]));
    for (const evento of eventos) {
        if (importantes.has(evento.tipo) || evento.tipo === 'reacao') unicos.set(evento.id, evento);
    }
    return [...unicos.values()];
}

/** Prioriza episódios sobre envolvidos atuais sem confundir relatos ou interpretações com fatos. */
export function recuperarLembrancas(eventos: EventoSocial[], id: string, assunto: string, limite = 4): EventoSocial[] {
    const palavras = assunto.toLocaleLowerCase('pt-BR').split(/\W+/).filter((palavra) => palavra.length > 3);
    const pontuar = (evento: EventoSocial) => (importantes.has(evento.tipo) ? 3 : 0)
        + (evento.alvoId === id ? 4 : 0)
        + palavras.filter((palavra) => evento.texto.toLocaleLowerCase('pt-BR').includes(palavra)).length * 2;
    return eventos.filter((evento) => palavras.some((palavra) =>
        evento.texto.toLocaleLowerCase('pt-BR').includes(palavra)))
        .sort((a, b) => pontuar(b) - pontuar(a) || b.sequencia - a.sequencia).slice(0, limite);
}
