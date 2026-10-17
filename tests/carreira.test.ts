import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { situacaoCarreira, orientacaoCarreira, aplicarMerito } from '../shared/carreira';
import { estadoInicial } from '../shared/estado';
import { Persistencia } from '../electron/services/persistencia';
import { anexosDaSala, lugarNoAnexo, anexoDaAusencia, capacidadeAnexo } from '../shared/anexos';
import { salaVazia } from '../shared/escritorio';

test('carreira exige mérito e vaga, preservando o conselheiro fora da disputa', () => {
    const equipe = [
        { id: 'ana', nome: 'Ana', cargo: 'refinador' as const },
        { id: 'bia', nome: 'Bia', cargo: 'lider' as const },
        { id: 'caio', nome: 'Caio', cargo: 'conselheiro' as const },
    ];
    expect(situacaoCarreira('ana', equipe, {})).toEqual({ tipo: 'insuficiente', proximo: 'lider', falta: 45 });
    expect(situacaoCarreira('ana', equipe, { ana: { merito: 45 } }).tipo).toBe('sem_vaga');
    expect(situacaoCarreira('bia', equipe, { bia: { merito: 80 } }))
        .toEqual({ tipo: 'elegivel', proximo: 'supervisor' });
    expect(situacaoCarreira('caio', equipe, {}).tipo).toBe('fora_da_escada');
    expect(aplicarMerito(199, 5)).toBe(200);
    expect(aplicarMerito(1, -4)).toBe(0);
});

test('supervisor recebe orientação para defender seu cargo diante de um líder elegível', () => {
    const equipe = [
        { id: 'ana', nome: 'Ana', cargo: 'supervisor' as const },
        { id: 'bia', nome: 'Bia', cargo: 'lider' as const },
    ];
    const contexto = orientacaoCarreira('ana', equipe, { bia: { merito: 80 } });
    expect(contexto).toContain('preserve o cargo');
    expect(contexto).toContain('Bia');
    expect(contexto).toContain('sem inventar falhas');
});

test('mérito e data da promoção sobrevivem à gravação por domínio', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-carreira-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    estado.carreira.ana = { merito: 32, promovidoEm: '2026-10-17T12:00:00.000Z' };
    persistencia.salvar(estado);
    await persistencia.descarregar();
    expect((await new Persistencia(pasta).carregar()).carreira).toEqual(estado.carreira);
});

test('ausências internas possuem lugares dentro dos anexos e folga sai do prédio', () => {
    expect(anexoDaAusencia('folga')).toBeUndefined();
    for (const anexo of anexosDaSala(salaVazia)) {
        for (let indice = 0; indice < capacidadeAnexo[anexo.tipo]; indice++) {
            const { posicao } = lugarNoAnexo(salaVazia, anexo.tipo, indice);
            expect(posicao.x).toBeGreaterThan(anexo.x);
            expect(posicao.x).toBeLessThan(anexo.x + anexo.largura);
            expect(posicao.z).toBeGreaterThan(anexo.z);
            expect(posicao.z).toBeLessThan(anexo.z + anexo.profundidade);
        }
    }
});
