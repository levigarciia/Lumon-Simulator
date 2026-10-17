import { expect, test } from 'bun:test';
import { gerarArquivo, descreverGrade, refinar, progressoRefinamento, recompensaRefinamento,
    orientarRefinamento, descreverEnvios, esquemaArquivoRefinamento, problemaSelecao,
    temperamentos } from '../shared/refinamento';

test('seleção fora da regra pública é explicada antes de consumir tentativa', () => {
    const arquivo = gerarArquivo(7, new Date('2030-01-01T00:00:00Z'));
    for (const grupo of arquivo.grupos) expect(problemaSelecao(arquivo, grupo.celulas)).toBeUndefined();
    expect(problemaSelecao(arquivo, ['D10', 'E1', 'E2'])).toContain('mesma linha');
    expect(problemaSelecao(arquivo, ['A1', 'A2', 'A4'])).toContain('consecutivas');
    expect(problemaSelecao(arquivo, ['A1', 'A2'])).toContain('exatamente três');
    const refinado = refinar(arquivo, 'pessoa', arquivo.grupos[0]!.celulas, arquivo.grupos[0]!.temperamento).arquivo;
    expect(problemaSelecao(refinado, arquivo.grupos[0]!.celulas)).toContain('já refinadas');
});

test('arquivos determinísticos aceitam grupos corretos uma vez e preservam o original', () => {
    const prazo = new Date('2030-01-01T00:00:00Z');
    for (let semente = 0; semente < 100; semente++) {
        const original = gerarArquivo(semente, prazo);
        expect(gerarArquivo(semente, prazo)).toEqual(original);
        expect(new Set(original.grupos.flatMap((grupo) => grupo.celulas)).size).toBe(18);
        let arquivo = original;
        for (const grupo of original.grupos) {
            const envio = refinar(arquivo, 'pessoa', grupo.celulas, grupo.temperamento);
            expect(envio.resultado).toBe('aceito');
            arquivo = envio.arquivo;
            expect(refinar(arquivo, 'colega', grupo.celulas, grupo.temperamento).resultado).toBe('rejeitado');
        }
        expect(progressoRefinamento(original)).toBe(0);
        expect(progressoRefinamento(arquivo)).toBe(100);
        expect(recompensaRefinamento(arquivo)).toBe(60);
        expect(descreverGrade(arquivo)).toContain('*');
        expect(descreverGrade(original)).not.toContain('temperamento');
    }
});

test('recompensa acompanha grupos aceitos e reserva o bônus para o arquivo completo', () => {
    const arquivo = gerarArquivo(9, new Date('2030-01-01'));
    expect(recompensaRefinamento(arquivo)).toBe(0);
    for (let indice = 0; indice < arquivo.grupos.length; indice++) {
        arquivo.grupos[indice]!.refinadoPor = 'refinador';
        expect(recompensaRefinamento(arquivo)).toBe([8, 16, 24, 32, 40, 60][indice]!);
    }
    expect(recompensaRefinamento({ ...arquivo, grupos: [] })).toBe(0);
});

test('seleção inválida e caixa incorreta dão orientações diferentes sem expor a solução', () => {
    const arquivo = gerarArquivo(9, new Date('2030-01-01'));
    const grupo = arquivo.grupos[0]!;
    const caixaErrada = grupo.temperamento === 'alegria' ? 'pavor' : 'alegria';
    const errado = refinar(arquivo, 'pessoa', ['A1', 'A2', 'A3', 'A4', 'A5'], caixaErrada, 'etapa1');
    expect(errado.resultado).toBe('rejeitado');
    expect(orientarRefinamento(errado.resultado)).toContain('Mude as células');
    const reconhecido = refinar(errado.arquivo, 'colega', grupo.celulas, caixaErrada, 'etapa2');
    expect(reconhecido.resultado).toBe('temperamento_incorreto');
    expect(orientarRefinamento(reconhecido.resultado)).toContain('Preserve as células');
    expect(progressoRefinamento(reconhecido.arquivo)).toBe(0);
    expect(descreverEnvios(reconhecido.arquivo)).toContain('A1, A2, A3, A4, A5');
    expect(reconhecido.arquivo.envios.map((item) => item.trabalhoId)).toEqual(['etapa1', 'etapa2']);
    expect(arquivo.envios).toHaveLength(0);
    const legado = { ...arquivo, envios: undefined };
    expect(esquemaArquivoRefinamento.parse(legado).envios).toEqual([]);
});

test('não registra de novo uma seleção rejeitada nem consome outra tentativa', () => {
    const arquivo = gerarArquivo(9, new Date('2030-01-01'));
    const primeira = refinar(arquivo, 'pessoa', ['A1', 'B1', 'C1'], 'pavor', 'etapa1');
    expect(primeira.resultado).toBe('rejeitado');
    expect(primeira.arquivo.envios).toHaveLength(1);

    const repetida = refinar(primeira.arquivo, 'colega', ['C1', 'A1', 'B1'], 'alegria', 'etapa2');
    expect(repetida.repetida).toBe('rejeitada');
    expect(repetida.arquivo).toBe(primeira.arquivo);
    expect(repetida.arquivo.envios).toHaveLength(1);
});

test('próximo colega recebe a seleção reconhecida e as caixas restantes só a partir dos envios', () => {
    let arquivo = gerarArquivo(9, new Date('2030-01-01'));
    const grupo = arquivo.grupos[0]!;
    for (const caixa of temperamentos.filter((item) => item !== grupo.temperamento)) {
        arquivo = refinar(arquivo, 'pessoa', grupo.celulas, caixa, 'etapa1').arquivo;
    }
    const descricao = descreverEnvios(arquivo);
    expect(descricao).toContain('Prioridade para a próxima etapa');
    expect(descricao).toContain(`Caixas ainda não testadas: ${grupo.temperamento}.`);
    expect(descreverEnvios({ ...arquivo, grupos: [] })).toBe(descricao);
    arquivo = refinar(arquivo, 'colega', grupo.celulas, grupo.temperamento, 'etapa2').arquivo;
    expect(descreverEnvios(arquivo)).not.toContain('Prioridade para a próxima etapa');
    expect(progressoRefinamento(arquivo)).toBe(17);
});
