import { describe, expect, test } from 'bun:test';
import { alivioAmbiente } from '../shared/ambiente';
import { avancarAgente, criarAgenteNaMesa } from '../shared/agentes';
import { estagioEsgotamento, fatorEstresseTrabalho, recusaTrabalho, ritmoCaminhada } from '../shared/esgotamento';
import type { Sala } from '../shared/escritorio';
import { aplicarAcontecimento, aplicarTempo, necessidadesIniciais } from '../shared/necessidades';
import { escolherEvento, rankingDoDia, semanasDeCasa } from '../shared/eventosDepartamento';
import { invejaDoColega } from '../shared/incentivos';
import { limiteEnviosEtapa, refina } from '../shared/cargos';

const sala: Sala = { largura: 12, profundidade: 10, itens: [
    { id: 'mesa_1', tipo: 'mesa', celula: { x: 2, z: 4 }, rotacao: 0 },
    { id: 'planta_1', tipo: 'planta', celula: { x: 4, z: 4 }, rotacao: 0 },
    { id: 'planta_2', tipo: 'planta', celula: { x: 10, z: 9 }, rotacao: 0 },
] };

describe('esgotamento', () => {
    test('estágios seguem os limites e só o esgotado recusa trabalho', () => {
        expect([0, 40, 65, 85].map(estagioEsgotamento)).toEqual(['estavel', 'cansado', 'desgastado', 'esgotado']);
        expect(recusaTrabalho(84)).toBe(false);
        expect(recusaTrabalho(85)).toBe(true);
        expect(ritmoCaminhada(90)).toBeLessThan(ritmoCaminhada(0));
        expect(fatorEstresseTrabalho(70)).toBeGreaterThan(1);
    });

    test('trabalho sob estresse acumula mais que trabalho calmo, e a folga recupera', () => {
        const calmo = aplicarTempo({ ...necessidadesIniciais, estresse: 10 }, 'trabalhando', 600);
        const tenso = aplicarTempo({ ...necessidadesIniciais, estresse: 90 }, 'trabalhando', 600);
        expect(tenso.esgotamento).toBeGreaterThan(calmo.esgotamento);
        const folga = aplicarTempo({ ...necessidadesIniciais, esgotamento: 80 }, 'folga', 300);
        expect(folga.esgotamento).toBeLessThan(10);
        const punido = aplicarTempo({ ...necessidadesIniciais, esgotamento: 10 }, 'sala_descanso', 180);
        expect(punido.esgotamento).toBeGreaterThan(10);
    });

    test('rejeição de entrega soma esgotamento uma vez por acontecimento', () => {
        const depois = aplicarAcontecimento(necessidadesIniciais, 'entrega_rejeitada');
        expect(depois.esgotamento).toBe(4);
    });

    test('estado salvo sem esgotamento continua válido', () => {
        const { esgotamento: _ignorado, ...antigo } = necessidadesIniciais;
        expect(aplicarTempo(antigo as typeof necessidadesIniciais, 'ocioso', 1).esgotamento).toBeGreaterThanOrEqual(0);
    });
});

describe('ambiente e ausências', () => {
    test('decoração próxima alivia o estresse e a distante não', () => {
        expect(alivioAmbiente(sala, { x: 3.5, z: 4.5 })).toBeGreaterThan(0);
        expect(alivioAmbiente(sala, { x: 0.5, z: 9.5 })).toBe(0);
        const calmo = aplicarTempo(necessidadesIniciais, 'trabalhando', 60, alivioAmbiente(sala, { x: 3.5, z: 4.5 }));
        const comum = aplicarTempo(necessidadesIniciais, 'trabalhando', 60);
        expect(calmo.estresse).toBeLessThan(comum.estresse);
    });

    test('a ordem de saída leva o corpo até a porta e o tira de cena', () => {
        const contexto = { sala, agoraSegundos: 0, sortear: () => 0.5 };
        let agente = criarAgenteNaMesa('a', 'mesa_1', contexto);
        for (let passo = 0; passo < 200 && agente.atividade !== 'ausente'; passo++) {
            agente = avancarAgente(agente, contexto, 0.1, { tipo: 'saida' });
        }
        expect(agente.atividade).toBe('ausente');
        const volta = avancarAgente(agente, contexto, 0.1, { tipo: 'mesa' });
        expect(volta.destinoId).toBe('mesa_1');
    });
});

describe('cargos, incentivos e eventos', () => {
    test('supervisor e conselheiro não refinam; estagiário tem etapa menor', () => {
        expect(refina('supervisor')).toBe(false);
        expect(refina('conselheiro')).toBe(false);
        expect(refina('estagiario')).toBe(true);
        expect(limiteEnviosEtapa('estagiario')).toBe(2);
        expect(limiteEnviosEtapa('refinador')).toBe(4);
    });

    test('só homenagens individuais despertam inveja em ambiciosos', () => {
        expect(invejaDoColega('festa_waffles', 90)).toBeGreaterThan(0);
        expect(invejaDoColega('festa_waffles', 30)).toBe(0);
        expect(invejaDoColega('festa_melancia', 100)).toBe(0);
    });

    test('sorteio respeita a chance e só escolhe eventos possíveis', () => {
        expect(escolherEvento(0.9, ['visita_diretoria'])).toBeUndefined();
        expect(escolherEvento(0, ['auditoria', 'visita_diretoria'])).toBe('auditoria');
        expect(escolherEvento(0.01, [])).toBeUndefined();
        expect(() => escolherEvento(1, ['auditoria'])).toThrow();
    });

    test('entrega de arquivo recebe maior probabilidade sem aumentar a chance dos demais eventos', () => {
        const possiveis = ['visita_diretoria', 'auditoria', 'avaria_terminal', 'entrega_arquivo'] as const;
        const contagem = new Map<string, number>();
        for (let indice = 0; indice < 7000; indice++) {
            const evento = escolherEvento((indice + 0.5) / 7000, possiveis);
            if (evento) contagem.set(evento, (contagem.get(evento) ?? 0) + 1);
        }
        expect(contagem.get('entrega_arquivo')).toBe(600);
        expect(contagem.get('visita_diretoria')).toBe(150);
        expect(contagem.get('auditoria')).toBe(150);
        expect(contagem.get('avaria_terminal')).toBe(150);
        expect(escolherEvento(0.15, ['entrega_arquivo'])).toBeUndefined();
        expect(escolherEvento(0.14, ['entrega_arquivo'])).toBe('entrega_arquivo');
        expect(escolherEvento(0.14, ['visita_diretoria', 'avaria_terminal'])).toBe('avaria_terminal');
    });

    test('ranking conta grupos aceitos do dia e marcos de casa fecham semanas exatas', () => {
        const hoje = new Date(2026, 9, 17, 12);
        const arquivo = { id: 'a', nome: 'A', grade: [], grupos: [], tentativas: {}, duracaoMinutos: 5, rodadas: [],
            prazo: hoje.toISOString(), envios: [
                { funcionarioId: 'x', celulas: [], temperamento: 'alegria' as const, resultado: 'aceito' as const },
                { funcionarioId: 'y', celulas: [], temperamento: 'pavor' as const, resultado: 'rejeitado' as const },
                { funcionarioId: 'x', celulas: [], temperamento: 'pavor' as const, resultado: 'aceito' as const },
            ] };
        expect(rankingDoDia([arquivo], '2026/10/17')).toEqual([['x', 2]]);
        expect(semanasDeCasa(new Date(2026, 9, 3).toISOString(), hoje)).toBe(2);
        expect(semanasDeCasa(new Date(2026, 9, 4).toISOString(), hoje)).toBeUndefined();
        expect(semanasDeCasa(hoje.toISOString(), hoje)).toBeUndefined();
    });
});
