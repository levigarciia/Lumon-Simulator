import { expect, test } from 'bun:test';
import { Escritorio } from '../electron/services/escritorio';
import { CanalGeral } from '../electron/services/geral';
import type { MensagemGeral } from '../shared/geral';
import { estadoInicial } from '../shared/estado';
import type { Funcionario } from '../shared/funcionarios';
import { descreverPersonalidade, type Personalidade } from '../shared/personalidade';
import { instrucaoDepartamento } from '../shared/departamento';

const neutra: Personalidade = {
    orgulho: 50, ambicao: 50, empatia: 50, autoritarismo: 50, tolerancia: 50, interesse: 'qualidade',
};
const funcionario: Funcionario = {
    id: 'autor', nome: 'Alex', cargo: 'lider', mesaId: 'mesa', autonomia: false, contratadoEm: '',
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
};

async function estabilizar() {
    await Bun.sleep(10);
    for (let indice = 0; indice < 80; indice++) await Promise.resolve();
}

test('extremos, valores médios e interesses produzem orientações de fala e decisão diferentes', () => {
    const baixa = descreverPersonalidade({ ...neutra, orgulho: 0, empatia: 0, autoritarismo: 0, tolerancia: 0 });
    const alta = descreverPersonalidade({ ...neutra, orgulho: 100, empatia: 100, autoritarismo: 100, tolerancia: 100 });
    expect(baixa).toContain('Seja ríspido');
    expect(baixa).toContain('Não dê ordens');
    expect(baixa).toContain('Você perde a paciência');
    expect(alta).toContain('Proteja fortemente sua competência');
    expect(alta).toContain('acolha a dificuldade');
    expect(alta).toContain('Você manda e não negocia');
    expect(alta).toContain('empatia muda o cuidado com a pessoa, não apaga a firmeza');
    const gradações = [0, 21, 41, 61, 81].map((orgulho) =>
        descreverPersonalidade({ ...neutra, orgulho }).split('\n').find((linha) => linha.startsWith('orgulho'))!
            .replace(/\d+\/100/, 'pontos'));
    expect(new Set(gradações).size).toBe(5);
    expect(descreverPersonalidade({ ...neutra, interesse: 'reconhecimento' })).toContain('quem recebeu o crédito');
    expect(() => descreverPersonalidade({ ...neutra, empatia: 101 })).toThrow();
});

test('Geral, reservado, conversa individual e Work usam o perfil salvo só nas instruções da sessão', async () => {
    const estado = estadoInicial();
    estado.funcionarios = [funcionario, { ...funcionario, id: 'colega', nome: 'Colega', mesaId: 'mesa2' }];
    estado.sala.itens = [
        { id: 'mesa', tipo: 'mesa', celula: { x: 2, z: 4 }, rotacao: 0 },
        { id: 'mesa2', tipo: 'mesa', celula: { x: 5, z: 4 }, rotacao: 0 },
    ];
    estado.projetos = [
        { id: 'projeto', nome: 'DomeCode', pasta: 'C:/temporario' },
        { id: 'legado', nome: 'ClaudioProject', pasta: 'C:/antigo' },
    ];
    estado.social.personalidades[funcionario.id] = { ...neutra, empatia: 0, tolerancia: 0 };
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    const sessoes: { instrucoes: string; prompts: string[] }[] = [];
    const capturar = (_pessoa: Funcionario, configuracao: { instrucoes: string }) => {
        const sessao = { instrucoes: configuracao.instrucoes, prompts: [] as string[] };
        sessoes.push(sessao);
        return { enviar: async (prompt: string) => { sessao.prompts.push(prompt); }, encerrar: () => {} };
    };
    escritorio['geral']['abrirSessao'] = capturar;
    escritorio['expediente']['abrirSessao'] = capturar;
    try {
        const consulta = escritorio['descreverEscritorio'](funcionario.id);
        expect(consulta).toContain('exclusivamente refinamento de Macrodados');
        expect(consulta).not.toContain('DomeCode');
        expect(consulta).not.toContain('ClaudioProject');
        expect(escritorio.publico().projetos).toHaveLength(2);
        expect(escritorio.enviarGeral('@Alex como foi a semana?').ok).toBe(true);
        await estabilizar();
        escritorio['geral'].notificarReservado(funcionario.id, 'colega', 'Vamos conversar sobre a semana.');
        await estabilizar();
        expect(escritorio.enviar(funcionario.id, 'Oi.').ok).toBe(true);
        await estabilizar();
        await escritorio['expediente'].enviarEAguardar(funcionario, estado.projetos[0]!, 'Verifique o arquivo.');
        expect(escritorio.mensagensGeral().filter((mensagem) => mensagem.autorId === 'sistema')).toEqual([]);
        expect(sessoes.length).toBe(4);
        for (const sessao of sessoes) {
            expect(sessao.instrucoes).toContain(instrucaoDepartamento);
            expect(sessao.instrucoes).toContain('Seja ríspido');
            expect(sessao.instrucoes).toContain('Você perde a paciência');
            expect(sessao.instrucoes).toContain('empatia 0/100');
            expect(sessao.prompts[0]).not.toContain('Você perde a paciência');
        }
        escritorio['estado'].social.personalidades[funcionario.id] = { ...neutra, empatia: 100, tolerancia: 100 };
        await escritorio['expediente'].enviarEAguardar(funcionario, estado.projetos[0]!, 'Confira novamente.');
        expect(sessoes).toHaveLength(5);
        expect(sessoes[4]!.instrucoes).toContain('acolha a dificuldade');
        expect(sessoes[4]!.instrucoes).toContain('empatia 100/100');
        escritorio.enviarGeral('@Alex e hoje?');
        await estabilizar();
        expect(sessoes.at(-1)!.instrucoes).toContain('acolha a dificuldade');
    } finally { escritorio.encerrar(); }
});

test('uma sessão pública já aberta é refeita quando os pontos de personalidade mudam', async () => {
    let personalidade = { ...neutra, empatia: 0 };
    let mensagens: MensagemGeral[] = [];
    const instrucoes: string[] = [];
    let encerradas = 0;
    const canal = new CanalGeral({
        funcionarios: () => [funcionario], mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; },
        contexto: () => '', personalidade: () => descreverPersonalidade(personalidade),
        urlMcp: async () => '', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
    }, (_pessoa, configuracao) => {
        instrucoes.push(configuracao.instrucoes);
        return { enviar: async () => {}, encerrar: () => { encerradas++; } };
    });
    try {
        canal.enviarDoUsuario('Como você está?');
        await estabilizar();
        personalidade = { ...neutra, empatia: 100 };
        canal.enviarDoUsuario('E agora?');
        await estabilizar();
        expect(instrucoes).toHaveLength(2);
        expect(encerradas).toBe(1);
        expect(instrucoes[0]).toContain('Seja ríspido');
        expect(instrucoes[1]).toContain('acolha a dificuldade');
        expect(instrucoes[1]).not.toContain('empatia 0/100');
    } finally { canal.encerrar(); }
});
