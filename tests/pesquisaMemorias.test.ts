import { expect, test } from 'bun:test';
import { DinamicaSocial } from '../electron/services/social';
import { esquemaSocial } from '../shared/social';
import type { Funcionario } from '../shared/funcionarios';

function preparar(nomes = ['Ana', 'Cláudio', 'Bia']) {
    let estado = esquemaSocial.parse({});
    const equipe = nomes.map((nome, indice): Funcionario => ({
        id: `pessoa${indice}`, nome, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    const social = new DinamicaSocial({ estado: () => estado, funcionarios: () => equipe, agentes: () => [],
        gravar: (novo) => { estado = novo; }, notificar: () => {}, estressar: () => {},
        decidir: () => ({ ok: true }) });
    return { social, estado: () => estado };
}

test('reação por nome escolhe a fonte conhecida mais recente e mantém a idempotência entre nome e ID', () => {
    const { social, estado } = preparar();
    const fonte = social.registrar({ tipo: 'fala', autorId: 'pessoa1', texto: 'Quero ajudar com o café.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    social.registrar({ tipo: 'reservado', autorId: 'pessoa1', alvoId: 'pessoa2', texto: 'Uma confidência.',
        alcance: 'reservado', ouvintes: ['pessoa1', 'pessoa2'], fontes: [] }, false);
    expect(social.reagir('pessoa0', undefined, 'concordar', 'Boa iniciativa.', '@CLAUDIO'))
        .toContain(`Fonte: [${fonte.id}]`);
    expect(estado().eventos.at(-1)?.fontes).toEqual([fonte.id]);
    expect(social.reagir('pessoa0', fonte.id, 'concordar', 'Boa iniciativa.', 'pessoa1'))
        .toContain('Você já registrou');
    expect(social.consultarHistorico('pessoa0', 'confidência')).not.toContain('Uma confidência.');
});

test('nomes repetidos ou inexistentes não alteram relações nem escolhem destinatários arbitrários', () => {
    const { social, estado } = preparar(['Ana', 'Cláudio', 'Claudio']);
    social.registrar({ tipo: 'fala', autorId: 'pessoa1', texto: 'Podemos conversar.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const antes = JSON.stringify(estado());
    expect(social.reagir('pessoa0', undefined, 'concordar', 'Tudo bem.', 'Claudio')).toContain('Nome ambíguo');
    expect(social.reagir('pessoa0', undefined, 'concordar', 'Tudo bem.', 'Outra pessoa'))
        .toContain('Funcionário não encontrado');
    expect(JSON.stringify(estado())).toBe(antes);
});

test('contexto traz prévias curtas e confirma apenas o lote apresentado, mantendo o texto completo pesquisável', () => {
    const { social, estado } = preparar();
    const texto = 'Um acontecimento detalhado. '.repeat(60);
    for (let indice = 0; indice < 9; indice++) social.registrar({ tipo: 'fala', autorId: 'pessoa1',
        texto: `${indice}: ${texto}`, alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const contexto = social.contexto('pessoa0', 'social');
    expect(contexto).not.toContain(texto);
    expect(contexto).toContain('Mais 3 novidades aguardam leitura');
    expect(contexto.length).toBeLessThan(6500);
    social.confirmarLeitura('pessoa0', 'social');
    expect(estado().leituras['social:pessoa0']).toBe(6);
    social.contexto('pessoa0', 'social');
    social.confirmarLeitura('pessoa0', 'social');
    expect(estado().leituras['social:pessoa0']).toBe(9);
    const pagina = JSON.parse(social.consultarHistorico('pessoa0', '', 'fala', 1));
    expect(pagina.registros[0].truncado).toBe(true);
    expect(pagina.registros[0].resumo.length).toBe(240);
    const detalhe = JSON.parse(social.consultarHistorico('pessoa0', '', 'fala', 1, { detalhar: true }));
    expect(detalhe.registros[0].resumo).toContain(texto);
    expect(detalhe.registros[0].truncado).toBe(false);
    expect(social.consultarHistorico('pessoa0', '', 'fala', 5, { detalhar: true }))
        .toContain('um registro por vez');
    expect(estado().leituras['social:pessoa0']).toBe(9);
});
