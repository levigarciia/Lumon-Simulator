import { autorSistema, autorUsuario, type MensagemGeral } from './geral';
import type { EventoSocial } from './social';

export type FalaBalao = { texto: string; parte: number; total: number };

/** Divide falas em trechos legíveis, preservando palavras e pontuação sempre que possível. */
export function dividirFala(texto: string): string[] {
    const palavras = texto.trim().split(/\s+/u).filter(Boolean);
    const partes: string[] = [];
    let parte = '';
    for (const palavra of palavras) {
        if (parte && parte.length + palavra.length + 1 > 190) {
            partes.push(parte);
            parte = '';
        }
        parte = parte ? `${parte} ${palavra}` : palavra;
    }
    if (parte) partes.push(parte);
    return partes;
}

function duracaoParte(texto: string): number {
    return Math.max(4500, texto.split(/\s+/u).length * 320 + 1200);
}

/** Seleciona a parte atual de cada fala pelo relógio, inclusive nos diálogos privados visíveis à Diretoria. */
export function falasNosBaloes(
    mensagens: MensagemGeral[], eventos: EventoSocial[], agora: number,
): Record<string, FalaBalao> {
    const recentes = new Map<string, { texto: string; instante: number }>();
    const registrar = (id: string, texto: string, data: string) => {
        const instante = Date.parse(data);
        if (!texto.trim() || !Number.isFinite(instante) || instante > agora) return;
        if (instante < (recentes.get(id)?.instante ?? -Infinity)) return;
        recentes.set(id, { texto, instante });
    };
    for (const mensagem of mensagens) {
        if (mensagem.tipo || [autorUsuario, autorSistema].includes(mensagem.autorId)) continue;
        registrar(mensagem.autorId, mensagem.texto, mensagem.criadaEm);
    }
    for (const evento of eventos) {
        if (!['cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar', 'reservado']
            .includes(evento.tipo)) continue;
        registrar(evento.autorId, evento.texto, evento.criadoEm);
    }
    const falas: Record<string, FalaBalao> = {};
    for (const [id, fala] of recentes) {
        const partes = dividirFala(fala.texto);
        let decorrido = agora - fala.instante;
        for (const [indice, texto] of partes.entries()) {
            const duracao = duracaoParte(texto);
            if (decorrido < duracao) {
                falas[id] = { texto, parte: indice + 1, total: partes.length };
                break;
            }
            decorrido -= duracao;
        }
    }
    return falas;
}
