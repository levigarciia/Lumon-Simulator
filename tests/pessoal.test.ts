import { describe, expect, test } from 'bun:test';
import { DepartamentoPessoal, type RegistroPessoal } from '../electron/services/pessoal';
import type { Ausencia } from '../shared/ausencias';
import type { Funcionario, StatusFuncionario } from '../shared/funcionarios';
import { necessidadesIniciais } from '../shared/necessidades';
import { criarPersonalidade, type EventoSocial } from '../shared/social';

function pessoa(id: string, cargo: Funcionario['cargo']): Funcionario {
    return { id, nome: id, cargo, mesaId: `mesa_${id}`, contratadoEm: '2026-10-01T12:00:00.000Z', autonomia: false,
        modelo: { provedor: 'claude', id: 'x', nome: 'x' } as Funcionario['modelo'],
        aparencia: { pele: '#f1c9a5', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' } };
}

function montar(status: Record<string, StatusFuncionario> = {}) {
    const equipe = [pessoa('ana', 'refinador'), pessoa('bia', 'supervisor'), pessoa('caio', 'conselheiro'),
        pessoa('duda', 'refinador')];
    const estado = { moedas: 200, ausencias: {} as Record<string, Ausencia>, estresse: {} as Record<string, number>,
        esgotamento: {} as Record<string, number>, eventos: [] as EventoSocial[], relacoes: [] as unknown[] };
    const registro: RegistroPessoal = {
        funcionarios: () => equipe,
        moedas: () => estado.moedas,
        debitar: (valor) => { estado.moedas -= valor; },
        status: (id) => status[id] ?? 'ocioso',
        necessidades: () => necessidadesIniciais,
        personalidade: (id) => ({ ...criarPersonalidade(id), ambicao: id === 'duda' ? 95 : 10 }),
        confianca: () => 50,
        afastar: (id, ausencia) => {
            if (estado.ausencias[id]) return 'O funcionário já está fora da sala.';
            estado.ausencias[id] = { ...ausencia, terminaEm: 100 };
        },
        ausencia: (id) => estado.ausencias[id],
        dispensar: () => {},
        estressar: (id, delta) => { estado.estresse[id] = (estado.estresse[id] ?? 0) + delta; },
        esgotar: (id, delta) => { estado.esgotamento[id] = (estado.esgotamento[id] ?? 0) + delta; },
        registrar: (evento) => {
            const registrado = { ...evento, id: `e${estado.eventos.length}`, sequencia: 1, criadoEm: '' };
            estado.eventos.push(registrado);
            return registrado;
        },
        ajustarRelacao: (autorId, colegaId, _evento, delta) => { estado.relacoes.push({ autorId, colegaId, delta }); },
        conversarReservado: async () => 'Ação registrada [r1]. Somente vocês dois receberam a conversa.',
        agora: () => 0,
    };
    return { pessoal: new DepartamentoPessoal(registro), estado, registro };
}

describe('departamento pessoal', () => {
    test('sessão valida todas as vagas antes de afastar alguém e espera a chegada para aliviar', async () => {
        const { pessoal, estado, registro } = montar();
        registro.validarAfastamento = () => 'Não há lugares livres no anexo.';
        expect(await pessoal.sessaoBemEstar('caio', 'ana', 'Como você está?')).toContain('lugares livres');
        expect(estado.ausencias).toEqual({});
        registro.validarAfastamento = () => undefined;
        let concluir!: (chegaram: boolean) => void;
        registro.aguardarChegadaAnexos = () => new Promise((resolver) => { concluir = resolver; });
        const sessao = pessoal.sessaoBemEstar('caio', 'ana', 'Como você está?');
        expect(estado.esgotamento.ana).toBeUndefined();
        concluir(false);
        expect(await sessao).toContain('interrompida');
        expect(estado.esgotamento.ana).toBeUndefined();
    });
    test('folga tira da sala, é pública e não vale durante o trabalho', () => {
        const { pessoal, estado } = montar({ duda: 'trabalhando' });
        expect(pessoal.concederFolga('ana')).toEqual({ ok: true });
        expect(estado.ausencias.ana?.motivo).toBe('folga');
        expect(estado.eventos.at(-1)?.tipo).toBe('folga');
        expect(pessoal.concederFolga('ana').ok).toBe(false);
        expect(pessoal.concederFolga('duda').ok).toBe(false);
    });

    test('Sala de Descanso aumenta estresse e gera ressentimento contra o supervisor que propôs', () => {
        const { pessoal, estado } = montar();
        expect(pessoal.enviarSalaDescanso('ana', 'Desrespeitou a doutrina.', 'bia').ok).toBe(true);
        expect(estado.ausencias.ana?.motivo).toBe('sala_descanso');
        expect(estado.estresse.ana).toBeGreaterThan(0);
        expect(estado.relacoes).toContainEqual({ autorId: 'ana', colegaId: 'bia',
            delta: { ressentimento: 15, afinidade: -8 } });
    });

    test('festa dos waffles cobra moedas, alivia o homenageado e desperta inveja em ambiciosos', () => {
        const { pessoal, estado } = montar();
        expect(pessoal.concederIncentivo('bia', 'festa_waffles', 'Melhor da semana.', 'ana').ok).toBe(true);
        expect(estado.moedas).toBe(50);
        expect(estado.estresse.ana).toBeLessThan(0);
        expect(estado.relacoes).toContainEqual(expect.objectContaining({ autorId: 'duda', colegaId: 'ana' }));
        expect(estado.relacoes.some((item) => (item as { autorId: string }).autorId === 'caio')).toBe(false);
        expect(pessoal.concederIncentivo('bia', 'festa_waffles', 'De novo.', 'ana').ok).toBe(false);
    });

    test('incentivo coletivo alcança só quem está na sala', () => {
        const { pessoal, estado } = montar();
        pessoal.concederFolga('duda');
        expect(pessoal.concederIncentivo('diretoria', 'festa_melancia', 'Cota cumprida.').ok).toBe(true);
        expect(estado.estresse.duda).toBeUndefined();
        expect(estado.estresse.ana).toBeLessThan(0);
    });

    test('sessão de bem estar exige conselheiro e respeita o intervalo por atendido', async () => {
        const { pessoal, estado } = montar();
        expect(await pessoal.sessaoBemEstar('bia', 'ana', 'Como você está?')).toContain('Somente o conselheiro');
        expect(await pessoal.sessaoBemEstar('caio', 'ana', 'Como você está?')).toContain('aliviou');
        expect(estado.esgotamento.ana).toBeLessThan(0);
        delete estado.ausencias.ana;
        delete estado.ausencias.caio;
        expect(await pessoal.sessaoBemEstar('caio', 'ana', 'De novo.')).toContain('acabou de ter uma sessão');
    });
});
