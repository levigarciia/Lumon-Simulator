import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Expediente } from '../electron/services/expediente';
import { Orquestracao } from '../electron/services/orquestracao';
import { Persistencia } from '../electron/services/persistencia';
import { Escritorio } from '../electron/services/escritorio';
import { organizarHistoricoWork } from '../shared/historicoWork';
import { estadoInicial } from '../shared/estado';
import type { Funcionario, Mensagem } from '../shared/funcionarios';
import type { OuvinteTurno } from '../electron/services/harness/tipos';

const lider: Funcionario = {
    id: randomUUID(), nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa',
    modelo: { provedor: 'claude', id: 'modelo', nome: 'Modelo' }, autonomia: false,
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    contratadoEm: new Date().toISOString(),
};
const colega: Funcionario = { ...lider, id: randomUUID(), nome: 'Gepeto', cargo: 'desenvolvedor' };

test('Work mantém autoria, ferramentas e retomada após delegação e reabertura', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-historico-work-'));
    const persistencia = new Persistencia(pasta);
    let estado = estadoInicial();
    const projeto = { id: randomUUID(), nome: 'Projeto', pasta };
    let orquestracao: Orquestracao;
    const expediente = new Expediente({
        conversa: (id) => estado.conversas[id] ?? [],
        gravarConversa: (id, mensagens) => { estado.conversas[id] = mensagens; },
        emitirConversa: () => {}, emitirEstado: () => {},
        contextoTurno: () => '', urlMcp: async () => 'http://127.0.0.1', acontecer: () => {}, pastaConversa: '.',
    }, (funcionario) => ({
        enviar: async (_prompt, ouvinte) => {
            if (funcionario.id === colega.id) {
                ouvinte.texto('Vou conferir a documentação.');
                ouvinte.iniciarFerramenta('leitura', 'Read', 'docs/ROADMAP.md');
                ouvinte.concluirFerramenta('leitura', false, 'Visão e critérios do produto.');
                ouvinte.texto('Vou conferir a documentação.\n\nA visão já está registrada.');
                return;
            }
            ouvinte.texto('Vou pedir uma revisão ao Gepeto.');
            ouvinte.iniciarFerramenta('delegacao', 'Escritório: delegar', 'Revise a documentação.');
            await orquestracao.delegar(lider.id, colega.id, 'Revise a documentação.');
            ouvinte.concluirFerramenta('delegacao', false, 'Gepeto concluiu a revisão.');
            ouvinte.texto('Vou pedir uma revisão ao Gepeto.\n\nRevisei o retorno e vou registrar o plano.');
        },
        encerrar: () => {},
    }));
    orquestracao = new Orquestracao({
        funcionarios: () => [lider, colega], projetos: () => [projeto],
        trabalhos: () => estado.trabalhos, gravar: (trabalhos) => { estado.trabalhos = trabalhos; },
        status: (id) => expediente.statusDe(id), interromper: (id) => expediente.interromper(id),
        executar: (...argumentos) => expediente.enviarEAguardar(...argumentos),
    });
    try {
        expect(orquestracao.enviar(projeto.id, 'Confira o roadmap.').ok).toBe(true);
        for (let passo = 0; passo < 100; passo++) await Promise.resolve();
        const entradas = organizarHistoricoWork(estado.trabalhos);
        expect(entradas.map((entrada) => entrada.tipo === 'pedido'
            ? `${entrada.trabalho.solicitante?.nome} para ${entrada.trabalho.nome}` : entrada.trabalho.nome))
            .toEqual(['Diretoria para Cláudio', 'Cláudio', 'Cláudio para Gepeto', 'Gepeto', 'Cláudio']);
        expect(entradas[1]?.partes.map((parte) => parte.tipo)).toEqual(['texto', 'ferramenta']);
        expect(entradas[3]?.partes.map((parte) => parte.tipo)).toEqual(['texto', 'ferramenta', 'texto']);
        expect(entradas[4]?.partes[0]).toMatchObject({
            tipo: 'texto', texto: '\n\nRevisei o retorno e vou registrar o plano.',
        });
        expect(estado.trabalhos.every((trabalho) => trabalho.estado === 'concluido')).toBe(true);
        persistencia.salvar(estado);
        await persistencia.descarregar();
        estado = await persistencia.carregar();
        expect(organizarHistoricoWork(estado.trabalhos)).toEqual(entradas);
        expect(estado.trabalhos[1]?.eventos?.find((evento) => evento.parte.tipo === 'ferramenta')?.parte)
            .toMatchObject({ ferramenta: { entrada: 'docs/ROADMAP.md', saida: 'Visão e critérios do produto.' } });
    } finally {
        expediente.dispensar(lider.id);
        expediente.dispensar(colega.id);
        await persistencia.descarregar();
        await rm(pasta, { recursive: true, force: true });
    }
});

test('interrupção preserva os trechos e encerra ferramentas em andamento, inclusive ao reabrir', async () => {
    let mensagens: Mensagem[] = [];
    let ouvinteAtivo: OuvinteTurno | undefined;
    const expediente = new Expediente({
        conversa: () => mensagens, gravarConversa: (_id, novas) => { mensagens = novas; },
        emitirConversa: () => {}, emitirEstado: () => {}, acontecer: () => {}, pastaConversa: '.',
        contextoTurno: () => '', urlMcp: async () => 'http://127.0.0.1',
    }, () => ({
        enviar: async (_prompt, ouvinte, sinal) => {
            ouvinteAtivo = ouvinte;
            ouvinte.texto('Vou conferir antes de alterar.');
            ouvinte.iniciarFerramenta('terminal', 'Terminal: bun test');
            await new Promise((_resolver, rejeitar) => sinal.addEventListener('abort',
                () => rejeitar(new Error('Interrompido')), { once: true }));
        }, encerrar: () => {},
    }));
    const promessa = expediente.enviarEAguardar(lider, { id: randomUUID(), nome: 'Projeto', pasta: tmpdir() }, 'Confira.');
    for (let passo = 0; passo < 20 && !ouvinteAtivo; passo++) await Promise.resolve();
    expediente.interromper(lider.id);
    expect((await promessa).ok).toBe(false);
    expect(mensagens.at(-1)?.partes).toEqual([
        expect.objectContaining({ tipo: 'texto', texto: 'Vou conferir antes de alterar.' }),
        expect.objectContaining({ tipo: 'ferramenta', ferramenta: expect.objectContaining({ estado: 'recusada' }) }),
    ]);
    const estado = estadoInicial();
    estado.trabalhos = [{
        id: 'trabalho', pedidoId: 'pedido', funcionarioId: lider.id, nome: lider.nome, projetoId: 'projeto',
        tarefa: 'Confira.', resultado: '', estado: 'trabalhando', criadoEm: new Date().toISOString(),
        eventos: [{ ordem: 1, parte: { id: 'tool', tipo: 'ferramenta', criadaEm: new Date().toISOString(),
            ferramenta: { id: 'tool', resumo: 'Terminal', estado: 'rodando' } } }],
    }];
    const escritorio = new Escritorio(estado, () => {}, () => {}, tmpdir());
    try {
        expect(escritorio.publico().trabalhos[0]).toMatchObject({ estado: 'interrompido',
            eventos: [{ parte: { ferramenta: { estado: 'recusada' } } }] });
    } finally {
        escritorio.encerrar();
    }
});

test('registros antigos mantêm origem e ficam antes das novas execuções', () => {
    const trabalho = { id: 'lider', pedidoId: 'pedido', funcionarioId: lider.id, nome: lider.nome,
        projetoId: 'projeto', tarefa: 'Confira.', resultado: 'Concluído', estado: 'concluido' as const, criadoEm: '' };
    const entradas = organizarHistoricoWork([trabalho, { ...trabalho, id: 'colega', nome: colega.nome },
        { ...trabalho, id: 'novo', pedidoId: 'novo', ordem: 5 }]);
    expect(entradas.filter((entrada) => entrada.tipo === 'pedido')
        .map((entrada) => entrada.trabalho.solicitante?.nome)).toEqual(['Diretoria', 'Cláudio', 'Diretoria']);
    expect(entradas.at(-1)?.trabalho.id).toBe('novo');
});
