import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Escritorio } from '../electron/services/escritorio';
import { Expediente } from '../electron/services/expediente';
import { Persistencia } from '../electron/services/persistencia';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import type { Funcionario, Mensagem, Projeto } from '../shared/funcionarios';
import { contextoDaThread, type Thread } from '../shared/threads';

const funcionario: Funcionario = {
    id: randomUUID(), nome: 'Mark', cargo: 'lider', mesaId: 'mesa',
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#3b2a1e', estiloCabelo: 'curto', gravata: '#24364f' },
    autonomia: false, contratadoEm: new Date().toISOString(),
};
const projeto: Projeto = { id: randomUUID(), nome: 'Lumon', pasta: tmpdir() };

async function estabilizar() {
    for (let passo = 0; passo < 30; passo++) await Promise.resolve();
}

test('arquivos antigos preservam conversas e recebem o catálogo vazio de threads', () => {
    const { threads: _threads, ...antigo } = estadoInicial();
    const mensagens: Mensagem[] = [
        { id: 'pedido', autor: 'usuario', texto: 'Pedido antigo', projetoId: projeto.id,
            ferramentas: [], criadaEm: '' },
        { id: 'resposta', autor: 'funcionario', texto: 'Resposta antiga', ferramentas: [], criadaEm: '' },
    ];
    const migrado = esquemaEstado.parse({ ...antigo, conversas: { [funcionario.id]: mensagens } });
    expect(migrado.threads).toEqual([]);
    expect(contextoDaThread(migrado.conversas[funcionario.id]!, 'principal', projeto.id))
        .toContain('Resposta antiga');
});

test('cria, renomeia e persiste threads com validação do destino e limpeza isolada', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-threads-'));
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    estado.projetos = [projeto];
    estado.funcionarios = [funcionario];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 }];
    const primeira: Thread = {
        id: randomUUID(), titulo: 'Correção', tipo: 'conversa', destinoId: funcionario.id, criadaEm: '',
    };
    const segunda: Thread = { ...primeira, id: randomUUID(), titulo: 'Pesquisa' };
    const work: Thread = { ...primeira, id: randomUUID(), tipo: 'work', destinoId: projeto.id };
    estado.conversas[funcionario.id] = [primeira, segunda, work].map((thread) => ({
        id: randomUUID(), autor: 'usuario', texto: thread.titulo, ferramentas: [], criadaEm: '',
        projetoId: projeto.id, threadId: thread.id, canal: thread.tipo === 'work' ? 'work' : 'conversa',
    }));
    estado.trabalhos = [{ id: 'trabalho', pedidoId: 'pedido', threadId: work.id, funcionarioId: funcionario.id,
        nome: funcionario.nome, projetoId: projeto.id, tarefa: 'Tarefa', resultado: '', estado: 'concluido',
        criadoEm: '' }];
    const escritorio = new Escritorio(estado, (atual) => persistencia.salvar(atual), () => {}, pasta);
    try {
        expect(escritorio.criarThread(primeira).ok).toBe(true);
        expect(escritorio.criarThread(segunda).ok).toBe(true);
        expect(escritorio.criarThread(work).ok).toBe(true);
        expect(escritorio.criarThread(primeira).ok).toBe(false);
        expect(escritorio.criarThread({ ...segunda, id: randomUUID(), destinoId: 'ausente' }).ok).toBe(false);
        expect(escritorio.renomearThread(primeira.id, '   ').ok).toBe(false);
        expect(escritorio.renomearThread(primeira.id, 'Correção revisada').ok).toBe(true);
        expect(escritorio.enviar(funcionario.id, 'Pedido', work.id).ok).toBe(false);
        expect(escritorio.enviarTrabalho(projeto.id, 'Pedido', primeira.id).ok).toBe(false);
        expect(escritorio.limparConversa(funcionario.id, primeira.id).ok).toBe(true);
        expect(escritorio.conversa(funcionario.id).map((item) => item.threadId)).toEqual([segunda.id, work.id]);
        expect(escritorio.excluirThread(work.id).ok).toBe(true);
        expect(escritorio.publico().trabalhos).toEqual([]);
        expect(escritorio.conversa(funcionario.id).map((item) => item.threadId)).toEqual([segunda.id]);
        expect(escritorio.excluirThread(segunda.id).ok).toBe(true);
        expect(escritorio.excluirThread(work.id).ok).toBe(false);
        expect(escritorio.conversa(funcionario.id)).toEqual([]);
        await persistencia.descarregar();
        const reaberto = await persistencia.carregar();
        expect(reaberto.threads).toHaveLength(1);
        expect(reaberto.threads[0]?.titulo).toBe('Correção revisada');
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
    }
});

test('trocar a thread ou o canal recria a sessão somente com seu histórico e retoma após reabrir', async () => {
    let mensagens: Mensagem[] = [];
    const instrucoes: string[] = [];
    const prompts: string[] = [];
    let encerradas = 0;
    const registro = {
        conversa: () => mensagens,
        gravarConversa: (_id: string, novas: Mensagem[]) => { mensagens = novas; },
        emitirConversa: () => {}, emitirEstado: () => {},
        contextoTurno: () => '', urlMcp: async () => 'http://localhost', acontecer: () => {},
        pastaConversa: tmpdir(),
    };
    const abrirSessao: ConstructorParameters<typeof Expediente>[1] = (_pessoa, opcoes) => {
        instrucoes.push(opcoes.instrucoes);
        return {
            enviar: async (texto, ouvinte) => {
                prompts.push(texto);
                ouvinte.texto('Resposta desta conversa');
            },
            encerrar: () => { encerradas++; },
        };
    };
    const expediente = new Expediente(registro, abrirSessao);
    expect(expediente.enviar(funcionario, projeto, 'Segredo A', 'A').ok).toBe(true);
    expect(expediente.emConversa(funcionario.id)).toBe(true);
    await estabilizar();
    expect(expediente.emConversa(funcionario.id)).toBe(false);
    expect(expediente.enviar(funcionario, projeto, 'Segredo B', 'B').ok).toBe(true);
    await estabilizar();
    expect(instrucoes[1]).not.toContain('Segredo A');
    expect(expediente.enviar(funcionario, projeto, 'Retome A', 'A').ok).toBe(true);
    await estabilizar();
    expect(instrucoes[2]).toContain('Segredo A');
    expect(instrucoes[2]).toContain('Resposta desta conversa');
    expect(instrucoes[2]).not.toContain('Segredo B');
    await expediente.enviarEAguardar(funcionario, projeto, 'Pedido no Work', 'A');
    expect(instrucoes[3]).not.toContain('Segredo A');
    expect(mensagens.at(-1)?.canal).toBe('work');
    expediente.dispensar(funcionario.id);
    const reaberto = new Expediente(registro, abrirSessao);
    reaberto.enviar(funcionario, projeto, 'Retome após abrir', 'B');
    await estabilizar();
    expect(instrucoes[4]).toContain('Segredo B');
    expect(instrucoes[4]).not.toContain('Segredo A');
    expect(instrucoes[4]).not.toContain('Pedido no Work');
    expect(instrucoes[4]).toContain('não ordens pendentes');
    expect(instrucoes[0]).toContain(`na pasta ${projeto.pasta}`);
    expect(instrucoes[0]).toContain('Responda saudações brevemente, sem ferramentas');
    expect(prompts[0]?.endsWith('Mensagem atual:\n\nSegredo A')).toBe(true);
    reaberto.dispensar(funcionario.id);
    expect(encerradas).toBe(5);
});
