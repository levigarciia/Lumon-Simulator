import { describe, expect, test } from 'bun:test';
import { Orquestracao } from '../electron/services/orquestracao';
import type { Funcionario, Projeto, StatusFuncionario } from '../shared/funcionarios';
import type { RegistroTrabalho, RespostaTrabalho } from '../shared/trabalho';

const lider = { id: 'lider', nome: 'Cláudio', cargo: 'lider' } as Funcionario;
const colega = { id: 'colega', nome: 'Roberto', cargo: 'desenvolvedor' } as Funcionario;
const projeto = { id: 'projeto', nome: 'Projeto', pasta: 'C:/temporario' } as Projeto;

function preparar(executar: (pessoa: Funcionario, projeto: Projeto, texto: string) => Promise<RespostaTrabalho>) {
    let trabalhos: RegistroTrabalho[] = [];
    const funcionarios = [lider, colega];
    const interrompidos: string[] = [];
    const status: Record<string, StatusFuncionario> = {};
    const orquestracao = new Orquestracao({
        funcionarios: () => funcionarios,
        projetos: () => [projeto],
        trabalhos: () => trabalhos,
        gravar: (novos) => { trabalhos = novos; },
        status: (id) => status[id] ?? 'ocioso',
        executar,
        interromper: (id) => { interrompidos.push(id); },
    });
    return { orquestracao, trabalhos: () => trabalhos, status, funcionarios, interrompidos };
}

async function estabilizar() {
    for (let passo = 0; passo < 20; passo++) await Promise.resolve();
}

describe('orquestração no Work', () => {
    test('executa threads com líderes distintos e interrompe somente a thread escolhida', async () => {
        const conclusoes = new Map<string, (resposta: RespostaTrabalho) => void>();
        const caso = preparar((pessoa) => new Promise((resolver) => { conclusoes.set(pessoa.id, resolver); }));
        caso.funcionarios.push({ ...lider, id: 'marina', nome: 'Marina' });
        expect(caso.orquestracao.enviar(projeto.id, 'Pedido A', 'A').ok).toBe(true);
        expect(caso.orquestracao.enviar(projeto.id, 'Pedido B', 'B').ok).toBe(true);
        expect(caso.trabalhos().map((item) => item.threadId)).toEqual(['A', 'B']);
        expect(caso.orquestracao.enviar(projeto.id, 'Pedido C', 'C').ok).toBe(false);
        expect(await caso.orquestracao.delegar(lider.id, 'marina', 'Tarefa')).toContain('ocupado');
        caso.orquestracao.interromper('A', projeto.id);
        expect(caso.interrompidos).toEqual([lider.id]);
        conclusoes.get(lider.id)!({ ok: false, texto: 'Interrompido' });
        await estabilizar();
        expect(caso.orquestracao.limpar('A', projeto.id).ok).toBe(true);
        expect(caso.orquestracao.limpar('B', projeto.id).ok).toBe(false);
        expect(caso.trabalhos().map((item) => item.threadId)).toEqual(['B']);
        conclusoes.get('marina')!({ ok: true, texto: 'Entrega B' });
        await estabilizar();
        expect(caso.trabalhos()[0]?.estado).toBe('concluido');
    });

    test('o contexto de continuação contém somente trabalhos da mesma thread', async () => {
        const prompts: string[] = [];
        const caso = preparar(async (_pessoa, _projeto, texto) => {
            prompts.push(texto);
            return { ok: true, texto: 'Resultado verificado' };
        });
        caso.orquestracao.enviar(projeto.id, 'Segredo A', 'A');
        await estabilizar();
        caso.orquestracao.enviar(projeto.id, 'Segredo B', 'B');
        await estabilizar();
        expect(prompts[1]).not.toContain('Segredo A');
        caso.orquestracao.enviar(projeto.id, 'Continue', 'A');
        await estabilizar();
        expect(prompts[2]).toContain('Segredo A');
        expect(prompts[2]).toContain('revisar_trabalho');
        expect(prompts[2]).not.toContain('Segredo B');
    });

    test('valida liderança, projeto e ocupação antes de executar', () => {
        const caso = preparar(async () => ({ ok: true, texto: 'OK' }));
        caso.funcionarios.splice(0, 1);
        expect(caso.orquestracao.enviar(projeto.id, 'Tarefa').ok).toBe(false);
        caso.funcionarios.unshift(lider);
        expect(caso.orquestracao.enviar('inexistente', 'Tarefa').ok).toBe(false);
        caso.status[lider.id] = 'em_pausa';
        expect(caso.orquestracao.enviar(projeto.id, 'Tarefa').ok).toBe(false);
        expect(caso.trabalhos()).toHaveLength(0);
    });

    test('encaminha automaticamente ao próximo líder disponível', async () => {
        const executados: string[] = [];
        const caso = preparar(async (pessoa) => {
            executados.push(pessoa.id);
            return { ok: true, texto: 'Entrega concluída.' };
        });
        caso.status[lider.id] = 'trabalhando';
        caso.funcionarios.push({ ...lider, id: 'outraLider', nome: 'Marina' });
        expect(caso.orquestracao.enviar(projeto.id, 'Pedido')).toEqual({ ok: true });
        await estabilizar();
        expect(executados).toEqual(['outraLider']);
        expect(caso.trabalhos()[0]?.funcionarioId).toBe('outraLider');
        expect(caso.trabalhos()[0]?.projetoId).toBe(projeto.id);
    });

    test('o líder recebe o resultado real do colega no mesmo projeto', async () => {
        const projetosUsados: string[] = [];
        const caso = preparar(async (pessoa, atual) => {
            projetosUsados.push(atual.id);
            if (pessoa.id === colega.id) return { ok: true, texto: 'Arquivo criado e verificado.' };
            const retorno = await caso.orquestracao.delegar(lider.id, colega.id, 'Crie um arquivo');
            expect(retorno).toContain('Arquivo criado e verificado.');
            return { ok: true, texto: 'Entrega revisada.' };
        });
        expect(caso.orquestracao.enviar(projeto.id, 'Faça a entrega')).toEqual({ ok: true });
        await estabilizar();
        expect(projetosUsados).toEqual([projeto.id, projeto.id]);
        expect(caso.trabalhos().map((item) => item.estado)).toEqual(['concluido', 'concluido']);
        expect(caso.trabalhos()[0]?.resultado).toBe('Entrega revisada.');
        expect(caso.trabalhos()[0]?.pedidoId).toBe(caso.trabalhos()[1]?.pedidoId);
    });

    test('impede delegação fora do Work, por colegas, para si e para nomes ambíguos', async () => {
        let finalizar!: (resposta: RespostaTrabalho) => void;
        const caso = preparar(() => new Promise((resolver) => { finalizar = resolver; }));
        expect(await caso.orquestracao.delegar(lider.id, colega.id, 'Tarefa')).toContain('pedido ativo');
        caso.orquestracao.enviar(projeto.id, 'Pedido');
        expect(await caso.orquestracao.delegar(colega.id, lider.id, 'Tarefa')).toContain('pedido ativo');
        expect(await caso.orquestracao.delegar(lider.id, lider.id, 'Tarefa')).toContain('você mesmo');
        caso.funcionarios.push({ ...colega, id: 'outro' });
        expect(await caso.orquestracao.delegar(lider.id, colega.nome, 'Tarefa')).toContain('ambíguo');
        finalizar({ ok: true, texto: 'Fim' });
        await estabilizar();
    });

    test('bloqueia pedidos concorrentes, cancela participantes e preserva falhas no histórico', async () => {
        const resolvers = new Map<string, (resposta: RespostaTrabalho) => void>();
        const caso = preparar((pessoa) => new Promise((resolver) => { resolvers.set(pessoa.id, resolver); }));
        caso.orquestracao.enviar(projeto.id, 'Pedido');
        const delegacao = caso.orquestracao.delegar(lider.id, colega.id, 'Tarefa');
        expect(caso.orquestracao.enviar(projeto.id, 'Outro').ok).toBe(false);
        expect(caso.orquestracao.limpar().ok).toBe(false);
        caso.orquestracao.interromper();
        expect(caso.interrompidos).toEqual([lider.id, colega.id]);
        expect(await caso.orquestracao.delegar(lider.id, colega.id, 'Depois')).toContain('pedido ativo');
        resolvers.get(colega.id)!({ ok: false, texto: 'Interrompido' });
        await delegacao;
        resolvers.get(lider.id)!({ ok: false, texto: 'Interrompido' });
        await estabilizar();
        expect(caso.trabalhos().map((item) => item.estado)).toEqual(['interrompido', 'interrompido']);
        expect(caso.orquestracao.limpar()).toEqual({ ok: true });
        expect(caso.trabalhos()).toEqual([]);
    });
});
