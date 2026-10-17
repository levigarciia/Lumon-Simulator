import { expect, test } from 'bun:test';
import { dividirFala, falasNosBaloes } from '../shared/baloes';
import type { EventoSocial } from '../shared/social';
import type { MensagemGeral } from '../shared/geral';

const instante = Date.parse('2026-10-16T20:00:00.000Z');
const mensagem = (texto: string, atraso = 0): MensagemGeral => ({
    id: 'fala', autorId: 'Ana', texto, criadaEm: new Date(instante + atraso).toISOString(), ferramentas: [],
});

test('fala longa passa por todas as partes antes de desaparecer', () => {
    const texto = Array.from({ length: 90 }, (_, indice) => `palavra${indice}`).join(' ');
    const partes = dividirFala(texto);
    expect(partes.join(' ')).toBe(texto);
    expect(partes.every((parte) => parte.length <= 190)).toBe(true);
    const vistas = new Set<string>();
    for (let tempo = 0; tempo <= 90000; tempo += 100) {
        const fala = falasNosBaloes([mensagem(texto)], [], instante + tempo).Ana;
        if (fala) vistas.add(fala.texto);
    }
    expect([...vistas]).toEqual(partes);
    expect(falasNosBaloes([mensagem(texto)], [], instante + 90000)).toEqual({});
});

test('conversa reservada mostra o texto ao jogador sem mudar audiência', () => {
    const evento: EventoSocial = {
        id: 'reservado', sequencia: 1, tipo: 'reservado', autorId: 'Ana', alvoId: 'Bia',
        texto: 'Podemos conversar sobre o que aconteceu?', alcance: 'reservado',
        ouvintes: ['Ana', 'Bia'], fontes: [], criadoEm: new Date(instante).toISOString(),
    };
    expect(falasNosBaloes([], [evento], instante).Ana?.texto).toBe(evento.texto);
    expect(evento.ouvintes).toEqual(['Ana', 'Bia']);
    expect(evento.alcance).toBe('reservado');
});

test('fala nova prevalece sobre um evento social antigo e pensamentos não aparecem', () => {
    const pensamento = { ...mensagem('Pensamento privado', 2000), tipo: 'pensamento' as const };
    expect(falasNosBaloes([mensagem('Primeira'), mensagem('Nova', 1000), pensamento], [], instante + 2100)
        .Ana?.texto).toBe('Nova');
    expect(falasNosBaloes([mensagem('   ')], [], instante)).toEqual({});
});
