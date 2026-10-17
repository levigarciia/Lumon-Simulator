import { expect, test } from 'bun:test';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import type { Funcionario } from '../shared/funcionarios';
import { instrucoesPausas } from '../shared/social';

const orcamento = {
    instrucoesGeral: 4750,
    promptGeral: 2600,
    instrucoesTrabalho: 3800,
    promptTrabalho: 1800,
};

function contratar(id: string, nome: string, cargo: Funcionario['cargo'], mesaId: string): Funcionario {
    return {
        id, nome, cargo, mesaId, autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    };
}

async function estabilizar() {
    await Bun.sleep(10);
    for (let indice = 0; indice < 80; indice++) await Promise.resolve();
}

test('instruções e prompts por turno respeitam o orçamento de caracteres', async () => {
    const estado = estadoInicial();
    const equipe = [
        contratar('lider', 'Alex', 'lider', 'mesa1'),
        contratar('dev', 'Bia', 'desenvolvedor', 'mesa2'),
        contratar('revisor', 'Caio', 'revisor', 'mesa3'),
    ];
    estado.funcionarios = equipe;
    estado.sala.itens = equipe.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa' as const, celula: { x: 2 + indice * 3, z: 4 }, rotacao: 0 as const,
    }));
    estado.projetos = [{ id: 'projeto', nome: 'Projeto', pasta: 'C:/temporario' }];
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    for (let indice = 0; indice < 10; indice++) {
        escritorio['social'].registrar({ tipo: 'fala', autorId: 'dev', texto: `Atualização ${indice} da entrega.`,
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
    }
    const sessoes: { instrucoes: string; prompts: string[] }[] = [];
    const capturar = (_pessoa: Funcionario, configuracao: { instrucoes: string }) => {
        const sessao = { instrucoes: configuracao.instrucoes, prompts: [] as string[] };
        sessoes.push(sessao);
        return { enviar: async (prompt: string) => { sessao.prompts.push(prompt); }, encerrar: () => {} };
    };
    escritorio['geral']['abrirSessao'] = capturar;
    escritorio['expediente']['abrirSessao'] = capturar;
    try {
        expect(escritorio.enviarGeral('@Alex como está a equipe?').ok).toBe(true);
        await estabilizar();
        await escritorio['expediente'].enviarEAguardar(equipe[0]!, estado.projetos[0]!, 'Revise o módulo.');
        const [geral, trabalho] = sessoes;
        expect(geral!.instrucoes).toContain(instrucoesPausas);
        expect(trabalho!.instrucoes).toContain(instrucoesPausas);
        const medidas = {
            instrucoesGeral: geral!.instrucoes.length,
            promptGeral: geral!.prompts[0]!.length,
            instrucoesTrabalho: trabalho!.instrucoes.length,
            promptTrabalho: trabalho!.prompts[0]!.length,
        };
        const excedentes = Object.entries(medidas)
            .filter(([chave, tamanho]) => tamanho > orcamento[chave as keyof typeof orcamento]);
        expect(excedentes).toEqual([]);
    } finally { escritorio.encerrar(); }
});
