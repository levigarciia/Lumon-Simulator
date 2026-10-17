import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial, type EstadoSalvo } from '../shared/estado';

test('limpar o Geral salva o histórico vazio e publica a alteração', () => {
    const estado = estadoInicial();
    estado.geral = [{ id: 'fala', autorId: 'usuario', texto: 'Olá', ferramentas: [], criadaEm: new Date().toISOString() }];
    const salvos: EstadoSalvo[] = [];
    const eventos: string[] = [];
    const escritorio = new Escritorio(estado, (atual) => salvos.push(atual), (evento) => eventos.push(evento.tipo), tmpdir());
    try {
        expect(escritorio.limparGeral()).toEqual({ ok: true });
        expect(salvos.at(-1)?.geral).toEqual([]);
        expect(escritorio.mensagensGeral()).toEqual([]);
        expect(eventos).toContain('geral');
        expect(escritorio.publico().geral.conversaLivre).toBe(false);
        expect(escritorio.limparConversa('inexistente').ok).toBe(false);
    } finally {
        escritorio.encerrar();
    }
});
