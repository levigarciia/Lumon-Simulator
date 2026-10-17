import { expect, test } from 'bun:test';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import type { Funcionario } from '../shared/funcionarios';
import { necessidadesIniciais } from '../shared/necessidades';

test('conversa livre recebe a situação atual e mantém pensamentos e suspeitas restritos ao autor', async () => {
    const estado = estadoInicial();
    estado.funcionarios = ['Ana', 'Bia'].map((nome, indice): Funcionario => ({
        id: nome, nome, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    estado.sala.itens = [
        { id: 'mesa0', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 },
        { id: 'mesa1', tipo: 'mesa', celula: { x: 6, z: 4 }, rotacao: 0 },
        { id: 'cafe', tipo: 'aparador_cafe', celula: { x: 9, z: 0 }, rotacao: 0,
            quebrado: true, ultimoUsuarioId: 'Ana' },
        { id: 'lanche', tipo: 'maquina_guloseimas', celula: { x: 12, z: 0 }, rotacao: 0 },
    ];
    estado.necessidades = { Ana: { ...necessidadesIniciais, estresse: 70, fome: 75 } };
    estado.pensamentos = {
        Ana: { texto: 'Quero me entender com Bia.', atualizadoEm: '' },
        Bia: { texto: 'Prefiro guardar minha opinião.', atualizadoEm: '' },
    };
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    const turnos = new Map<string, { instrucoes: string; prompt: string }>();
    escritorio['geral']['abrirSessao'] = (pessoa, configuracao) => ({
        enviar: async (prompt) => {
            turnos.set(pessoa.id, { instrucoes: configuracao.instrucoes, prompt });
        },
        encerrar: () => {},
    });
    try {
        escritorio['social'].registrar({ tipo: 'sala', autorId: 'diretoria', alcance: 'publico',
            ouvintes: [], fontes: [], texto: 'A Diretoria reorganizou a sala hoje.' }, false);
        expect(escritorio.alternarConversaLivre(true).ok).toBe(true);
        for (let tentativa = 0; tentativa < 100 && turnos.size < 2; tentativa++) await Bun.sleep(10);
        expect(turnos.size).toBe(2);
        const ana = turnos.get('Ana')!;
        const bia = turnos.get('Bia')!;
        expect(ana.prompt).toContain('Considere seu pensamento, relações e acontecimentos');
        for (const { prompt } of turnos.values()) {
            expect(prompt).toContain('Conversa espontânea a partir da situação atual do escritório');
            expect(prompt).toContain('Consertos pendentes: Cafeteira [ID cafe]');
            expect(prompt).toContain('Itens de pausa: Máquina de guloseimas');
            expect(prompt).toContain('A Diretoria reorganizou a sala hoje.');
        }
        expect(ana.prompt).toContain('Colegas: Bia [ID Bia]');
        expect(ana.prompt).toContain('estresse 70');
        expect(ana.prompt).toContain('menos paciência');
        expect(ana.prompt).toContain('Quero me entender com Bia.');
        expect(ana.prompt).toContain('Provavelmente foi você quem causou a quebra');
        expect(ana.prompt).not.toContain('Prefiro guardar minha opinião.');
        expect(bia.prompt).toContain('Prefiro guardar minha opinião.');
        expect(bia.prompt).not.toContain('Quero me entender com Bia.');
        expect(bia.prompt).not.toContain('Provavelmente foi você');
    } finally {
        escritorio.encerrar();
    }
});
