import { expect, test } from 'bun:test';
import { migrarAutoriaDiretoria } from '../shared/diretoria';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import type { EventoSocial } from '../shared/social';

const fala: EventoSocial = {
    id: 'fonte-original', sequencia: 1, tipo: 'fala', autorId: 'jogador', autorNome: 'Levi',
    texto: 'Relato da pessoa responsável no chat individual, não verificado: Confira a máquina.',
    alcance: 'reservado', ouvintes: ['funcionario'], fontes: ['evidencia'],
    criadoEm: new Date().toISOString(),
};

test('migra autoria em acontecimentos, lembranças e evidências preservando privacidade e IDs', () => {
    const estado = estadoInicial();
    estado.social.eventos = [fala];
    estado.social.lembrancas = [fala];
    estado.social.propostas = [{
        id: 'proposta', tipo: 'demissao', autorId: 'lider', alvoId: 'funcionario', motivo: 'Motivo',
        evidencias: [fala.id], registros: [fala], apoiadores: [], estado: 'pendente', criadaEm: fala.criadoEm,
    }];
    const migrado = migrarAutoriaDiretoria(estado);
    for (const evento of [migrado.social.eventos[0], migrado.social.lembrancas[0],
        migrado.social.propostas[0]?.registros[0]]) {
        expect(evento).toMatchObject({
            id: fala.id, autorId: 'diretoria', autorNome: 'Diretoria', alcance: 'reservado',
            ouvintes: ['funcionario'], fontes: ['evidencia'],
            texto: 'Relato da Diretoria no chat individual, não verificado: Confira a máquina.',
        });
    }
    expect(fala.autorId).toBe('jogador');
    expect(migrarAutoriaDiretoria(migrado)).toEqual(migrado);
});

test('remove o perfil pessoal antigo sem apagar o texto histórico de uma fala', () => {
    const estado = esquemaEstado.parse({ ...estadoInicial(), identidade: { nome: 'Levi', tratamento: 'chefe' } });
    estado.social.eventos = [{ ...fala, texto: 'Mensagem histórica preservada.' }];
    const migrado = migrarAutoriaDiretoria(estado);
    expect(migrado).not.toHaveProperty('identidade');
    expect(migrado.social.eventos[0]?.autorNome).toBe('Diretoria');
    expect(migrado.social.eventos[0]?.texto).toBe('Mensagem histórica preservada.');
});
