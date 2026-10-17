import { expect, test } from 'bun:test';
import { cotaAtual, creditarArquivo, prepararTerminal, comunicadoDiretoria, metaDiaria } from '../shared/departamento';
import { gerarArquivo, refinar } from '../shared/refinamento';
import { esquemaEstado, estadoInicial } from '../shared/estado';

test('cota usa o dia local, mantém resultados na reabertura e reinicia no dia seguinte', () => {
    const hoje = new Date(2030, 0, 2, 23, 59);
    const amanha = new Date(2030, 0, 3, 0, 1);
    const arquivo = gerarArquivo(1, amanha);
    arquivo.grupos[0]!.refinadoPor = 'refinador';
    const cota = creditarArquivo(cotaAtual(undefined, hoje), arquivo, hoje);
    expect(cota.grupos).toBe(1);
    expect(cotaAtual(cota, hoje)).toEqual(cota);
    expect(cotaAtual(cota, amanha)).toEqual({ dia: '2030/1/3', grupos: 0, arquivos: [] });
    const salvo = esquemaEstado.parse(JSON.parse(JSON.stringify({ ...estadoInicial(), cota })));
    expect(salvo.cota).toEqual(cota);
    const { cota: _cota, ...legado } = estadoInicial();
    expect(esquemaEstado.parse(legado).cota.grupos).toBe(0);
});

test('aprovação parcial conta grupos uma vez e uma cota completa muda o comunicado', () => {
    const agora = new Date();
    const arquivo = gerarArquivo(1, agora);
    arquivo.grupos[0]!.refinadoPor = 'refinador';
    const primeira = creditarArquivo(cotaAtual(), arquivo);
    expect(primeira.grupos).toBe(1);
    expect(creditarArquivo(primeira, arquivo)).toEqual(primeira);
    let cota = cotaAtual();
    for (let semente = 1; semente <= 3; semente++) {
        const completo = gerarArquivo(semente, agora);
        completo.grupos.forEach((grupo) => { grupo.refinadoPor = 'refinador'; });
        cota = creditarArquivo(cota, completo);
    }
    expect(cota.grupos).toBe(metaDiaria);
    expect(comunicadoDiretoria(cota, false)).toContain('cota foi cumprida');
    expect(comunicadoDiretoria(primeira, false)).toContain('progresso');
});

test('terminal só expõe células refinadas e classificações aceitas, nunca os grupos secretos', () => {
    const original = gerarArquivo(9, new Date());
    const secreto = original.grupos[0]!;
    expect(prepararTerminal(original)).toMatchObject({ celulasRefinadas: [], caixas: [], refinados: 0 });
    expect(prepararTerminal(original)).not.toHaveProperty('grupos');
    const outro = original.grupos[1]!;
    const arquivo = refinar(original, 'refinador', outro.celulas, outro.temperamento).arquivo;
    const terminal = prepararTerminal(arquivo);
    expect(terminal.celulasRefinadas).toEqual(outro.celulas);
    expect(terminal.caixas).toEqual([outro.temperamento]);
    expect(terminal.ultimoEnvio?.celulas).toEqual(outro.celulas);
    expect(terminal.celulasRefinadas).not.toContain(secreto.celulas[0]);
    expect(original.grupos.every((grupo) => !grupo.refinadoPor)).toBe(true);
});
