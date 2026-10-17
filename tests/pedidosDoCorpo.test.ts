import { expect, test } from 'bun:test';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import { instrucoesFuncionario, type Funcionario } from '../shared/funcionarios';
import { disposicaoAtual, pedidosDoCorpo } from '../shared/necessidades';

test('disposição acompanha as necessidades e preserva a decisão do funcionário', () => {
    const atual = { energia: 20, estresse: 70, fome: 95, segundosSeguidos: 0, falhasHoje: 0, esgotamento: 0 };
    expect(disposicaoAtual(atual)).toContain('menos paciência');
    expect(disposicaoAtual(atual)).toContain('A fome incomoda');
    expect(disposicaoAtual(atual)).toContain('respostas mais breves');
    const saudavel = { ...atual, energia: 90, estresse: 10, fome: 20 };
    expect(disposicaoAtual(atual)).toContain('Você decide');
    expect(disposicaoAtual(saudavel)).toBe('');
});

const funcionario: Funcionario = {
    id: 'autor', nome: 'Alex', cargo: 'desenvolvedor', mesaId: 'mesa', autonomia: false, contratadoEm: '',
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
};
const projeto = { id: 'projeto', nome: 'Projeto', pasta: 'C:/temporario' };

test('estresse alto vira pedido de pausa no turno e a sessão autoriza pausar sem permissão', () => {
    const calmo = { energia: 90, estresse: 10, fome: 20, segundosSeguidos: 0, falhasHoje: 0, esgotamento: 0 };
    expect(pedidosDoCorpo(calmo)).toEqual([]);
    expect(pedidosDoCorpo({ ...calmo, estresse: 70 })[0]).toContain('estresse alto');
    expect(instrucoesFuncionario(funcionario, projeto, 'conversa')).toContain('sem pedir permissão');
    const estado = estadoInicial();
    estado.funcionarios = [funcionario];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 2, z: 4 }, rotacao: 0 }];
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    try {
        expect(escritorio['contextoTurno'](funcionario.id)).not.toContain('Seu corpo pede pausa');
        escritorio['simulacao'].ajustarEstresse(funcionario.id, 80);
        expect(escritorio['contextoTurno'](funcionario.id)).toContain('Seu corpo pede pausa: estresse alto');
    } finally { escritorio.encerrar(); }
});
