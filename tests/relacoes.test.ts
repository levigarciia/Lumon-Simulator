import { expect, test } from 'bun:test';
import { aplicarReacao, descreverCondutaRelacional, registrarImpactoRelacao, statusRelacao } from '../shared/relacoes';
import { criarPersonalidade, relacaoInicial } from '../shared/social';

const personalidade = { ...criarPersonalidade('jamal'), tolerancia: 25, empatia: 25, orgulho: 90 };
const magoada = { ...relacaoInicial('jamal', 'claudio'), ressentimento: 100, afinidade: 0 };

test('romance exige afinidade acima de 90 e inimizade prevalece a partir de 90 de ressentimento', () => {
    const neutra = relacaoInicial('jamal', 'claudio');
    expect(statusRelacao({ ...neutra, afinidade: 90 })).toBe('Amizade');
    expect(statusRelacao({ ...neutra, afinidade: 91 })).toBe('Romance');
    expect(statusRelacao({ ...neutra, afinidade: 100, ressentimento: 89 })).toBe('Romance');
    expect(statusRelacao({ ...neutra, afinidade: 100, ressentimento: 90 })).toBe('Inimizade');
    expect(statusRelacao(neutra)).toBe('Neutra');
    const romance = descreverCondutaRelacional({ ...neutra, afinidade: 91 }, personalidade);
    expect(romance).toContain('interesse romântico');
    expect(romance).toContain('Não presuma reciprocidade');
    expect(romance).toContain('apoio e defesa');
    const inimiga = descreverCondutaRelacional(magoada, personalidade);
    expect(inimiga).toContain('proponha demissão');
    expect(inimiga).toContain('Só a Diretoria decide');
    expect(inimiga).toContain('Não invente faltas');
});

test('uma nova reação registra sinal mesmo com números saturados e preserva o estado anterior', () => {
    const saturada = { ...magoada, confianca: 100, respeito: 100, afinidade: 100, ressentimento: 0 };
    const { relacao, impacto } = registrarImpactoRelacao(saturada, saturada, 'concordar', 'novo');
    expect(impacto).toMatchObject({ tipo: 'positivo', rotulo: 'Concordância', mudancas: [] });
    expect(relacao.marcadores).toHaveLength(1);
    expect(saturada.marcadores).toBeUndefined();
    const negativa = registrarImpactoRelacao(relacao, relacao, 'discordar', 'outro');
    expect(negativa.relacao.marcadores).toHaveLength(2);
    expect(negativa.impacto.tipo).toBe('negativo');
});

test('concordância reduz ressentimento extremo sem apagar a mágoa nem mudar a relação original', () => {
    const proxima = aplicarReacao(magoada, personalidade, 'concordar', 'fala', 'concordancia');
    expect(proxima.ressentimento).toBeLessThan(100);
    expect(proxima.ressentimento).toBeGreaterThanOrEqual(90);
    expect(proxima.respeito).toBeGreaterThan(magoada.respeito);
    expect(magoada.ressentimento).toBe(100);
    expect(proxima.ultimoEventoId).toBe('concordancia');
    expect(descreverCondutaRelacional(proxima, personalidade)).toContain('ríspido');
});

test('perdão repara mais que concordância e abertura pessoal facilita a recuperação', () => {
    const aberta = { ...personalidade, tolerancia: 100, empatia: 100, orgulho: 0 };
    const concordancia = aplicarReacao(magoada, personalidade, 'concordar', 'fala', 'a');
    const perdao = aplicarReacao(magoada, personalidade, 'perdoar', 'fala', 'b');
    const perdaoAberto = aplicarReacao(magoada, aberta, 'perdoar', 'fala', 'c');
    expect(perdao.ressentimento).toBeLessThan(concordancia.ressentimento);
    expect(perdaoAberto.ressentimento).toBeLessThan(perdao.ressentimento);
});

test('discordância pontual não vira desconfiança ou hostilidade por si só', () => {
    const neutra = relacaoInicial('jamal', 'claudio');
    const discordancia = aplicarReacao(neutra, personalidade, 'discordar', 'fala', 'a');
    const conflito = aplicarReacao(neutra, personalidade, 'discordar', 'cobrar', 'b');
    const desconfianca = aplicarReacao(neutra, personalidade, 'desconfiar', 'fala', 'c');
    expect(discordancia.ressentimento).toBe(0);
    expect(discordancia.confianca).toBe(neutra.confianca);
    expect(conflito.ressentimento).toBeGreaterThan(discordancia.ressentimento);
    expect(desconfianca.confianca).toBeLessThan(discordancia.confianca);
});

test('mesma mágoa aparece como rispidez ou frieza conforme a personalidade', () => {
    const contida = { ...personalidade, empatia: 90, tolerancia: 90, orgulho: 10 };
    const amiga = { ...magoada, ressentimento: 0, afinidade: 90 };
    expect(descreverCondutaRelacional(magoada, personalidade)).toContain('ríspido');
    expect(descreverCondutaRelacional(magoada, contida)).toContain('mantendo a educação');
    expect(descreverCondutaRelacional(amiga, personalidade)).toContain('familiaridade');
    expect(descreverCondutaRelacional(amiga, personalidade)).not.toContain('Mágoa');
    expect(descreverCondutaRelacional({ ...magoada, respeito: 90 }, personalidade))
        .toContain('Reconheça a competência');
});
