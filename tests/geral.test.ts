import { expect, test } from 'bun:test';
import { CanalGeral } from '../electron/services/geral';
import type { SessaoAgente } from '../electron/services/harness/tipos';
import type { Funcionario } from '../shared/funcionarios';
import { esquemaMensagemGeral, repeteFala, type MensagemGeral } from '../shared/geral';

test('repetição tolera pequenas variações sem descartar perguntas ou mudanças de informação', () => {
    const fala = 'Sem arquivo ativo no Work, não há etapas para redistribuir. Vamos aguardar o comunicado da Diretoria.';
    expect(repeteFala(`@Gwen, concordo. ${fala}`, fala)).toBe(true);
    expect(repeteFala(fala, fala)).toBe(true);
    expect(repeteFala(`${fala} Quando chega?`, fala)).toBe(false);
    expect(repeteFala(fala.replace('não há', 'há'), fala)).toBe(false);
    expect(repeteFala(`${fala} Temos 2 arquivos.`, `${fala} Temos 3 arquivos.`)).toBe(false);
    expect(repeteFala('Bom dia.', 'Bom dia.')).toBe(false);
});

const claudio: Funcionario = {
    id: 'claudio', nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa',
    modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' }, autonomia: false,
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    contratadoEm: '',
};

/** Ignora o turno de reação nos testes que observam só a fala pública. */
function semReacao(enviar: SessaoAgente['enviar']): SessaoAgente['enviar'] {
    return async (prompt, ouvinte, sinal, opcoes) => {
        if (!opcoes?.exigirFerramenta) await enviar(prompt, ouvinte, sinal, opcoes);
    };
}

function preparar(enviar: SessaoAgente['enviar'], iniciais: MensagemGeral[] = [], ignorarReacao = true) {
    let mensagens: MensagemGeral[] = iniciais;
    const falas: string[] = [];
    let aberturas = 0;
    const canal = new CanalGeral({
        funcionarios: () => [claudio], mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; }, contexto: () => '',
        registrarFala: (id, texto) => { falas.push(`${id}: ${texto}`); },
        urlMcp: async () => 'http://localhost', pasta: '.',
        emitirMensagens: () => {}, emitirEstado: () => {},
    }, () => {
        aberturas++;
        return { enviar: ignorarReacao ? semReacao(enviar) : enviar, encerrar: () => {} };
    });
    return { canal, falas, mensagens: () => mensagens, aberturas: () => aberturas };
}

async function estabilizar() {
    for (let passo = 0; passo < 40; passo++) await Promise.resolve();
}

test('nova pausa da mesma dupla abre outra sessão sem reaproveitar a situação física anterior', async () => {
    let chave = 'primeira-pausa';
    let aberturas = 0;
    let encerramentos = 0;
    const prompts: string[] = [];
    const canal = new CanalGeral({
        funcionarios: () => [claudio], mensagens: () => [], gravar: () => {}, contexto: () => '',
        contextoReservado: () => ({ chave, texto: `Situação física: ${chave}.` }),
        urlMcp: async () => 'http://localhost', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
    }, () => {
        aberturas++;
        return { enviar: async (prompt) => { prompts.push(prompt); }, encerrar: () => { encerramentos++; } };
    });
    try {
        canal.notificarReservado('claudio', 'jamal', 'Uma conversa no item.');
        await estabilizar();
        canal.notificarReservado('claudio', 'jamal', 'A conversa continua.');
        await estabilizar();
        expect(aberturas).toBe(1);
        chave = 'segunda-pausa';
        canal.notificarReservado('claudio', 'jamal', 'Outra pausa começou.');
        await estabilizar();
        expect(aberturas).toBe(2);
        expect(encerramentos).toBe(1);
        expect(prompts.at(-1)).toEndWith('Situação física: segunda-pausa.');
        expect(prompts.at(-1)).not.toContain('primeira-pausa');
    } finally { canal.encerrar(); }
});

test('relato longo idêntico não reaparece por notificações, mas um novo pedido pode pedir repetição', async () => {
    const texto = 'Estou pronto para o próximo arquivo. Minha energia está boa e a fome foi atendida. '
        + 'Aguardo o próximo comunicado da Diretoria.';
    const caso = preparar(async (_prompt, ouvinte) => { ouvinte.texto(texto); });
    try {
        caso.canal.enviarDoUsuario('Como você está?');
        await estabilizar();
        caso.canal.notificar([claudio.id]);
        await estabilizar();
        expect(caso.falas).toHaveLength(1);
        caso.canal.enviarDoUsuario('Repita a resposta, por favor.');
        await estabilizar();
        expect(caso.falas).toHaveLength(2);
    } finally { caso.canal.encerrar(); }
});

test('menções repetidas entre dois colegas não impedem a vez do terceiro', async () => {
    const gwen = { ...claudio, id: 'gwen', nome: 'Gwen' };
    const jamal = { ...claudio, id: 'jamal', nome: 'Jamal' };
    let mensagens: MensagemGeral[] = [];
    const ordem: string[] = [];
    const canal = new CanalGeral({
        funcionarios: () => [claudio, gwen, jamal], mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; }, contexto: () => '',
        urlMcp: async () => 'http://localhost', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
    }, (pessoa) => ({
        enviar: semReacao(async (_prompt, ouvinte) => {
            ordem.push(pessoa.id);
            ouvinte.texto(pessoa.id === claudio.id ? '@Gwen, sua vez.'
                : pessoa.id === gwen.id ? '@Cláudio, responda.' : 'Eu também estou participando.');
        }), encerrar: () => {},
    }));
    try {
        canal.enviarDoUsuario('Como vocês estão?');
        for (let passo = 0; passo < 8; passo++) await estabilizar();
        expect(ordem.slice(0, 3)).toEqual(['claudio', 'gwen', 'jamal']);
        expect(mensagens.some((mensagem) => mensagem.autorId === jamal.id && mensagem.texto)).toBe(true);
        expect(canal.situacao().conversaAtiva).toBe(false);
    } finally { canal.encerrar(); }
});

test('novas notificações após o limite não repetem o aviso nem geram turnos adicionais', async () => {
    let turnos = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turnos++;
        ouvinte.texto('Resposta.');
    });
    try {
        for (let passo = 0; passo < 10; passo++) {
            caso.canal.notificar([claudio.id], `Acontecimento ${passo}`);
            await estabilizar();
        }
        expect(turnos).toBe(6);
        const avisos = () => caso.mensagens().filter((mensagem) => mensagem.texto.includes('Mande uma mensagem'));
        expect(avisos()).toHaveLength(1);
        caso.canal.enviarDoUsuario('Podem retomar.');
        await estabilizar();
        expect(turnos).toBe(7);
        for (let passo = 0; passo < 7; passo++) {
            caso.canal.notificar([claudio.id]);
            await estabilizar();
        }
        expect(avisos()).toHaveLength(2);
    } finally { caso.canal.encerrar(); }
});

test('todas as ferramentas exibem argumentos, estados e retorno sem entrar nas falas dos colegas', async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((resolver) => { liberar = resolver; });
    let turno = 0;
    const caso = preparar(async (prompt, ouvinte) => {
        expect(prompt).not.toContain('detalhe privado');
        if (++turno > 1) return;
        ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio', '{}');
        ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio', '{"atualizado":true}');
        ouvinte.iniciarFerramenta('conserto', 'Escritório: consertar_item', '{"item":"maquina"}');
        await espera;
        ouvinte.concluirFerramenta('consulta', false, 'detalhe privado da consulta');
        ouvinte.concluirFerramenta('conserto', true, 'Moedas insuficientes.');
        ouvinte.texto('Não há saldo suficiente.');
    });
    try {
        caso.canal.enviarDoUsuario('Confira a máquina.');
        await estabilizar();
        const acoes = caso.mensagens().filter((mensagem) => mensagem.tipo === 'acao');
        expect(acoes).toHaveLength(2);
        expect(acoes[0]?.ferramentas[0]).toMatchObject({ estado: 'rodando', entrada: '{"atualizado":true}' });
        expect(acoes[0]?.ferramentas[0]?.iniciadaEm).toBeTruthy();
        liberar();
        await estabilizar();
        const finais = caso.mensagens().filter((mensagem) => mensagem.tipo === 'acao');
        expect(finais[0]?.ferramentas[0]).toMatchObject({ estado: 'concluida', saida: 'detalhe privado da consulta' });
        expect(finais[1]?.ferramentas[0]).toMatchObject({ estado: 'falhou', saida: 'Moedas insuficientes.' });
        expect(finais[1]?.ferramentas[0]?.concluidaEm).toBeTruthy();
        expect(esquemaMensagemGeral.parse(JSON.parse(JSON.stringify(finais[0])))).toEqual(finais[0]);
        expect(caso.falas).toEqual(['claudio: Não há saldo suficiente.']);
        expect(caso.canal.falasRecentes()).not.toContain('detalhe privado');
        caso.canal.enviarDoUsuario('E agora?');
        await estabilizar();
    } finally { liberar(); caso.canal.encerrar(); }
});

test('ações de reação e de conversa reservada aparecem sem publicar falas privadas', async () => {
    const caso = preparar(async (_prompt, ouvinte, _sinal, opcoes) => {
        const reflexao = !!opcoes?.exigirFerramenta;
        ouvinte.iniciarFerramenta('pensamento', 'Escritório: atualizar_pensamento', '{"pensamento":"Privado"}');
        ouvinte.concluirFerramenta('pensamento', false, 'Pensamento registrado.');
        if (!reflexao) ouvinte.texto('(silêncio)');
    }, [], false);
    try {
        caso.canal.enviarDoUsuario('@claudio confira a cobrança');
        await estabilizar();
        expect(caso.mensagens().filter((mensagem) => mensagem.tipo === 'acao')).toHaveLength(2);
        caso.canal.notificarReservado(claudio.id, 'colega', 'Conversa privada.');
        await estabilizar();
        expect(caso.mensagens().at(-1)).toMatchObject({
            tipo: 'acao', participantes: [claudio.id, 'colega'],
            ferramentas: [{ resumo: 'Escritório: atualizar_pensamento', estado: 'concluida' }],
        });
        expect(caso.falas).toEqual([]);
        expect(caso.canal.falasRecentes()).not.toContain('Privado');
    } finally { caso.canal.encerrar(); }
});

test('falha encerra ferramentas pendentes e reabertura recupera ações interrompidas', async () => {
    const caso = preparar(async (_prompt, ouvinte) => {
        ouvinte.iniciarFerramenta('pausa', 'Escritório: fazer_pausa', '{"atividade":"comendo"}');
        throw new Error('Falha controlada');
    });
    try {
        caso.canal.enviarDoUsuario('Faça uma pausa.');
        await estabilizar();
        expect(caso.mensagens().find((mensagem) => mensagem.tipo === 'acao')?.ferramentas[0])
            .toMatchObject({ estado: 'falhou', saida: 'O turno terminou sem confirmar o resultado desta ação.' });
        const reaberto = preparar(async () => {}, [{ id: 'interrompida', autorId: claudio.id,
            tipo: 'acao', texto: '', criadaEm: new Date().toISOString(),
            ferramentas: [{ id: 'antiga', resumo: 'Escritório: fazer_pausa', estado: 'rodando' }],
        }]);
        try {
            expect(reaberto.mensagens()[0]?.ferramentas[0]).toMatchObject({
                estado: 'recusada', saida: 'O aplicativo foi encerrado durante esta ação.',
            });
        } finally { reaberto.canal.encerrar(); }
    } finally { caso.canal.encerrar(); }
});

test('encerrar marca a ação como interrompida antes de o harness terminar', async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((resolver) => { liberar = resolver; });
    const caso = preparar(async (_prompt, ouvinte) => {
        ouvinte.iniciarFerramenta('pausa', 'Escritório: fazer_pausa');
        await espera;
        ouvinte.concluirFerramenta('pausa', false, 'Retorno atrasado.');
    });
    try {
        caso.canal.enviarDoUsuario('Faça uma pausa.');
        await estabilizar();
        caso.canal.encerrar();
        expect(caso.mensagens().at(-1)?.ferramentas[0]).toMatchObject({
            estado: 'recusada', saida: 'Ação interrompida.',
        });
        liberar();
        await estabilizar();
        expect(caso.mensagens().at(-1)?.ferramentas[0]?.estado).toBe('recusada');
    } finally { liberar(); caso.canal.encerrar(); }
});

test('limpar durante a geração libera novos turnos e ignora a conclusão antiga', async () => {
    let liberarAntiga!: () => void;
    const esperaAntiga = new Promise<void>((resolver) => { liberarAntiga = resolver; });
    let liberarNova!: () => void;
    const esperaNova = new Promise<void>((resolver) => { liberarNova = resolver; });
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        if (++turno === 1) {
            ouvinte.texto('Resposta antiga');
            await esperaAntiga;
            ouvinte.texto('Texto atrasado');
            return;
        }
        ouvinte.texto('Resposta nova');
        await esperaNova;
    });
    try {
        caso.canal.enviarDoUsuario('@claudio primeira');
        await estabilizar();
        caso.canal.limpar();
        expect(caso.canal.situacao()).toMatchObject({ falandoId: null, conversaAtiva: false });
        caso.canal.enviarDoUsuario('@claudio segunda');
        await estabilizar();
        expect(turno).toBe(2);
        liberarAntiga();
        await estabilizar();
        expect(caso.canal.situacao().falasEmAndamento).toMatchObject([{ texto: 'Resposta nova' }]);
        expect(caso.canal.situacao().falandoId).toBe(claudio.id);
        liberarNova();
        await estabilizar();
        expect(caso.falas).toEqual(['claudio: Resposta nova']);
        expect(caso.canal.situacao()).toMatchObject({ falandoId: null, conversaAtiva: false });
    } finally { liberarAntiga(); liberarNova(); caso.canal.encerrar(); }
});

test('distingue a espera pelo motor da geração de texto', async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((resolver) => { liberar = resolver; });
    const caso = preparar(async (_prompt, ouvinte) => {
        ouvinte.etapa?.('aguardando_motor');
        expect(caso.canal.situacao().etapaResposta).toBe('aguardando_motor');
        ouvinte.etapa?.('processando');
        expect(caso.canal.situacao().etapaResposta).toBe('processando');
        ouvinte.texto('Estou respondendo.');
        expect(caso.canal.situacao().etapaResposta).toBe('escrevendo');
        await espera;
    });
    try {
        caso.canal.enviarDoUsuario('@claudio oi');
        await estabilizar();
        expect(caso.canal.situacao().etapaResposta).toBe('escrevendo');
        liberar();
        await estabilizar();
        expect(caso.canal.situacao().etapaResposta).toBeUndefined();
    } finally { liberar(); caso.canal.encerrar(); }
});

test('exibe texto durante a geração e registra somente a resposta concluída', async () => {
    let continuar!: () => void;
    const espera = new Promise<void>((resolver) => { continuar = resolver; });
    const caso = preparar(async (_prompt, ouvinte) => {
        ouvinte.texto('Estou');
        ouvinte.texto('Estou preparando a resposta.');
        await espera;
        ouvinte.texto('Estou preparando a resposta. Pronto.');
    });
    try {
        caso.canal.enviarDoUsuario('@claudio explique');
        await estabilizar();
        expect(caso.canal.situacao().falasEmAndamento).toMatchObject([
            { autorId: claudio.id, texto: 'Estou preparando a resposta.' },
        ]);
        expect(caso.mensagens()).toHaveLength(1);
        expect(caso.falas).toEqual([]);
        continuar();
        await estabilizar();
        expect(caso.canal.situacao().falasEmAndamento).toEqual([]);
        expect(caso.falas).toEqual(['claudio: Estou preparando a resposta. Pronto.']);
        expect(caso.mensagens()).toHaveLength(2);
    } finally { continuar(); caso.canal.encerrar(); }
});

test('descarta a prévia em caso de erro ou limpeza sem aceitar texto atrasado', async () => {
    for (const limpar of [false, true]) {
        let continuar!: () => void;
        const espera = new Promise<void>((resolver) => { continuar = resolver; });
        const caso = preparar(async (_prompt, ouvinte) => {
            ouvinte.texto('Resposta parcial');
            await espera;
            ouvinte.texto('Resposta atrasada');
            throw new Error('Falha controlada');
        });
        try {
            caso.canal.enviarDoUsuario('@claudio explique');
            await estabilizar();
            expect(caso.canal.situacao().falasEmAndamento).toHaveLength(1);
            if (limpar) caso.canal.limpar();
            continuar();
            await estabilizar();
            expect(caso.canal.situacao().falasEmAndamento).toEqual([]);
            expect(caso.falas).toEqual([]);
            expect(caso.mensagens().some((mensagem) => mensagem.autorId === claudio.id)).toBe(false);
            if (limpar) expect(caso.mensagens()).toEqual([]);
        } finally { continuar(); caso.canal.encerrar(); }
    }
});

test('marcadores parciais de silêncio não aparecem como prévia pública', async () => {
    const caso = preparar(async (_prompt, ouvinte) => {
        for (const texto of ['(', '(sil', '(silêncio)']) {
            ouvinte.texto(texto);
            expect(caso.canal.situacao().falasEmAndamento).toEqual([]);
        }
    });
    try {
        caso.canal.enviarDoUsuario('@claudio algo?');
        await estabilizar();
        expect(caso.falas).toEqual([]);
    } finally { caso.canal.encerrar(); }
});

test('resposta normal é publicada no Geral sem exigir ferramenta nem repetir o turno', async () => {
    let turnos = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turnos++;
        ouvinte.texto('Estou aqui');
        ouvinte.texto('Estou aqui, relaxa. Vou sentir falta da máquina, mas está tudo bem.');
    });
    try {
        caso.canal.enviarDoUsuario('@claudio ta ai?');
        await estabilizar();
        expect(turnos).toBe(1);
        expect(caso.falas).toEqual([
            'claudio: Estou aqui, relaxa. Vou sentir falta da máquina, mas está tudo bem.',
        ]);
        expect(caso.mensagens().at(-1)).toMatchObject({
            autorId: 'claudio',
            texto: 'Estou aqui, relaxa. Vou sentir falta da máquina, mas está tudo bem.',
        });
        expect(caso.mensagens().at(-1)?.tipo).toBeUndefined();
        expect(caso.canal.situacao().falandoId).toBeNull();
    } finally {
        caso.canal.encerrar();
    }
});

test('modo infinito permite ultrapassar seis turnos e desativar restaura o limite', async () => {
    let falas = 0;
    let parar!: () => void;
    const espera = new Promise<void>((resolver) => { parar = resolver; });
    const caso = preparar(async (_prompt, ouvinte) => {
        falas++;
        if (falas === 9) await espera;
        ouvinte.texto('Continuo a conversa.');
    });
    try {
        caso.canal.alternarConversaSemLimite(true);
        for (let indice = 0; indice < 9; indice++) caso.canal.notificar([claudio.id], `Assunto ${indice}`);
        for (let indice = 0; indice < 8; indice++) {
            await estabilizar();
            if (falas < 9) caso.canal.notificar([claudio.id]);
        }
        expect(falas).toBe(9);
        expect(caso.canal.situacao()).toMatchObject({ semLimite: true, conversaAtiva: true });
        caso.canal.alternarConversaSemLimite(false);
        caso.canal.notificar([claudio.id]);
        parar();
        for (let indice = 0; indice < 3; indice++) await estabilizar();
        expect(falas).toBe(9);
        expect(caso.mensagens().some((item) => item.texto.includes('pararam de conversar'))).toBe(true);
        expect(caso.canal.situacao().conversaAtiva).toBe(false);
    } finally { parar(); caso.canal.encerrar(); }
});

test('encerrar conversa conclui a fala atual, descarta próximos turnos e permite nova mensagem', async () => {
    let concluir!: () => void;
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turno++;
        if (turno === 1) await new Promise<void>((resolver) => { concluir = resolver; });
        ouvinte.texto(turno === 1 ? 'Concluí meu raciocínio.' : 'Resposta nova.');
    });
    try {
        caso.canal.enviarDoUsuario('Primeira mensagem');
        await estabilizar();
        caso.canal.notificar([claudio.id]);
        await estabilizar();
        expect(caso.canal.situacao()).toMatchObject({ conversaAtiva: true, conversaLivre: false });
        caso.canal.alternarConversaLivre(false);
        expect(caso.canal.situacao()).toMatchObject({ conversaAtiva: true, encerrando: true, falandoId: claudio.id });
        caso.canal.notificar([claudio.id]);
        concluir();
        await estabilizar();
        expect(caso.falas).toEqual(['claudio: Concluí meu raciocínio.']);
        expect(caso.canal.situacao()).toMatchObject({ conversaAtiva: false, encerrando: false, falandoId: null });
        expect(caso.mensagens().map((item) => item.texto)).toEqual(['Primeira mensagem', 'Concluí meu raciocínio.']);
        caso.canal.enviarDoUsuario('Segunda mensagem');
        await estabilizar();
        expect(caso.falas).toEqual(['claudio: Concluí meu raciocínio.', 'claudio: Resposta nova.']);
    } finally { concluir?.(); caso.canal.encerrar(); }
});

test('bloqueia a sequência de falas repetidas do mesmo turno e permite responder ao próximo pedido', async () => {
    const caso = preparar(async () => {
        caso.canal.falarDoAgente(claudio.id, 'Entendo a preocupação. Vou conversar com o colega.');
        for (let repeticao = 0; repeticao < 8; repeticao++) {
            expect(() => caso.canal.falarDoAgente(claudio.id, 'Bom dia novamente.'))
                .toThrow('já publicou');
        }
    });
    try {
        caso.canal.enviarDoUsuario('@claudio c vai deixar teu funcionario se comportar assim?');
        await estabilizar();
        expect(caso.mensagens().filter((mensagem) => mensagem.autorId === claudio.id)).toHaveLength(1);
        caso.canal.enviarDoUsuario('@claudio e agora?');
        await estabilizar();
        expect(caso.mensagens().filter((mensagem) => mensagem.autorId === claudio.id)).toHaveLength(2);
    } finally { caso.canal.encerrar(); }
});

test('fala automática entrega a mensagem aos colegas mencionados e mantém o fluxo público', async () => {
    let mensagens: MensagemGeral[] = [];
    const prompts = new Map<string, string>();
    const colega = { ...claudio, id: 'gepeto', nome: 'Gepeto' };
    const canal = new CanalGeral({
        funcionarios: () => [claudio, colega], mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; },
        contexto: () => '', urlMcp: async () => 'http://localhost', pasta: '.',
        emitirMensagens: () => {}, emitirEstado: () => {},
    }, (pessoa, configuracao) => ({
        enviar: async (prompt, ouvinte) => {
            expect(configuracao.instrucoes).toContain('Texto normal nunca é privado');
            prompts.set(pessoa.id, prompt);
            ouvinte.texto(pessoa.id === claudio.id ? '@Gepeto, como você está?' : 'Estou bem e sem fome.');
        }, encerrar: () => {},
    }));
    try {
        canal.enviarDoUsuario('@Claudio pergunte como está o colega.');
        await estabilizar();
        expect(prompts.size).toBe(2);
        expect(prompts.get('gepeto')).toContain('Cláudio: @Gepeto, como você está?');
        expect(mensagens.filter((mensagem) => mensagem.autorId !== 'usuario').map((mensagem) => mensagem.texto))
            .toEqual(['@Gepeto, como você está?', 'Estou bem e sem fome.']);
        expect(mensagens.every((mensagem) => mensagem.tipo !== 'pensamento')).toBe(true);
    } finally { canal.encerrar(); }
});

test('citado passa pelo turno de reação com ferramenta obrigatória antes de responder', async () => {
    let mensagens: MensagemGeral[] = [];
    const turnos: string[] = [];
    const colega = { ...claudio, id: 'gepeto', nome: 'Gepeto', cargo: 'desenvolvedor' as const };
    let instrucoesLider = '';
    const canal: CanalGeral = new CanalGeral({
        funcionarios: () => [claudio, colega], mensagens: () => mensagens,
        gravar: (novas) => { mensagens = novas; }, registrarFala: (id) => `evt_${id}`,
        contexto: () => '', urlMcp: async () => 'http://localhost', pasta: '.',
        emitirMensagens: () => {}, emitirEstado: () => {},
    }, (pessoa, configuracao) => {
        if (pessoa.id === claudio.id) instrucoesLider = configuracao.instrucoes;
        return {
            enviar: async (prompt, ouvinte, _sinal, opcoes) => {
                const reflexao = !!opcoes?.exigirFerramenta;
                turnos.push(`${pessoa.id}:${reflexao ? 'reflexao' : 'fala'}`);
                if (reflexao) {
                    ouvinte.texto('Minha reação privada.');
                    expect(canal.situacao().falasEmAndamento).toEqual([]);
                    expect(prompt).toStartWith('Turno de');
                    expect(opcoes?.ferramentas?.includes('interagir_socialmente')).toBe(true);
                    expect(() => canal.falarDoAgente(pessoa.id, 'Vou publicar')).toThrow('turno de reação');
                    if (pessoa.id === colega.id) expect(prompt).toContain('(fonte evt_claudio)');
                    const citadoPeloJogador = pessoa.id === claudio.id;
                    expect(opcoes?.ferramentas?.includes('fazer_pausa')).toBe(citadoPeloJogador);
                    expect(opcoes?.ferramentas?.includes('ver_escritorio')).toBe(citadoPeloJogador);
                    expect(opcoes?.ferramentas?.includes('consertar_item')).toBe(citadoPeloJogador);
                    expect(opcoes?.ferramentas?.includes('nenhuma_acao')).toBe(true);
                }
                ouvinte.texto(pessoa.id === claudio.id ? '@Gepeto, faça a tarefa.' : 'Certo.');
            }, encerrar: () => {},
        };
    });
    try {
        canal.enviarDoUsuario('@Claudio dê uma ordem.');
        await estabilizar();
        expect(turnos).toEqual(['claudio:reflexao', 'claudio:fala', 'gepeto:reflexao', 'gepeto:fala']);
        expect(mensagens.filter((mensagem) => mensagem.autorId !== 'usuario').map((item) => item.texto))
            .toEqual(['@Gepeto, faça a tarefa.', 'Certo.']);
        expect(instrucoesLider).toContain('acao cobrar');
        expect(instrucoesLider).toContain('tipo demissao');
    } finally { canal.encerrar(); }
});

for (const pelaFerramenta of [false, true]) {
    test(`menção prioriza reação e resposta já pendente sem duplicar fala (${pelaFerramenta ? 'ferramenta' : 'texto'})`,
        async () => {
            let mensagens: MensagemGeral[] = [];
            const turnos: string[] = [];
            const gwen = { ...claudio, id: 'gwen', nome: 'Gwen' };
            const jamal = { ...claudio, id: 'jamal', nome: 'Jamal' };
            const canal: CanalGeral = new CanalGeral({
                funcionarios: () => [claudio, gwen, jamal], mensagens: () => mensagens,
                gravar: (novas) => { mensagens = novas; }, contexto: () => '',
                urlMcp: async () => 'http://localhost', pasta: '.',
                emitirMensagens: () => {}, emitirEstado: () => {},
            }, (pessoa) => ({
                enviar: async (_prompt, ouvinte, _sinal, opcoes) => {
                    const reflexao = !!opcoes?.exigirFerramenta;
                    turnos.push(`${pessoa.id}:${reflexao ? 'reacao' : 'fala'}`);
                    if (reflexao) return;
                    if (pessoa.id === claudio.id) {
                        const texto = '@Jamal, como você está?';
                        if (pelaFerramenta) canal.falarDoAgente(pessoa.id, texto);
                        else ouvinte.texto(texto);
                        return;
                    }
                    ouvinte.texto('Estou bem.');
                }, encerrar: () => {},
            }));
            try {
                canal.enviarDoUsuario('E aí pessoal, vocês estão bem?');
                for (let passo = 0; passo < 4; passo++) await estabilizar();
                expect(turnos).toEqual(['claudio:fala', 'jamal:reacao', 'jamal:fala', 'gwen:fala']);
                expect(mensagens.filter((item) => item.autorId !== 'usuario').map((item) => item.autorId))
                    .toEqual(['claudio', 'jamal', 'gwen']);
            } finally { canal.encerrar(); }
        });
}

test('pensamentos antigos não entram na transcrição pública nem disparam menções', async () => {
    const prompts: string[] = [];
    const caso = preparar(async (prompt, ouvinte) => {
        prompts.push(prompt);
        ouvinte.texto('(silêncio)');
    }, [{ id: 'privado', autorId: 'colega', texto: 'Minha impressão privada sobre @claudio.',
        tipo: 'pensamento', criadaEm: '', ferramentas: [] }]);
    try {
        caso.canal.enviarDoUsuario('@claudio?');
        await estabilizar();
        expect(prompts).toHaveLength(1);
        caso.canal.enviarDoUsuario('@claudio outra pergunta');
        await estabilizar();
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).not.toContain('Minha impressão privada');
    } finally {
        caso.canal.encerrar();
    }
});

test('silêncio, texto vazio e confirmação de fala publicada não substituem o pensamento', async () => {
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turno++;
        if (turno === 1) ouvinte.texto(' (silêncio) ');
        if (turno === 2) ouvinte.texto('   ');
        if (turno === 3) {
            caso.canal.falarDoAgente(claudio.id, 'Oi, estou aqui!');
            ouvinte.texto('Mensagem enviada.');
        }
    });
    try {
        for (let indice = 0; indice < 3; indice++) {
            caso.canal.enviarDoUsuario('@claudio?');
            await estabilizar();
        }
        expect(caso.falas).toEqual(['claudio: Oi, estou aqui!']);
        expect(caso.mensagens().filter((item) => item.autorId === claudio.id).map((item) => item.texto))
            .toEqual(['Oi, estou aqui!']);
    } finally {
        caso.canal.encerrar();
    }
});

test('falha aparece no canal e a próxima chamada abre uma sessão nova', async () => {
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turno++;
        if (turno === 1) throw Error('Conexão encerrada');
        ouvinte.texto('Agora estou aqui.');
    });
    try {
        caso.canal.enviarDoUsuario('@claudio?');
        await estabilizar();
        expect(caso.mensagens().at(-1)).toMatchObject({
            autorId: 'sistema', texto: 'Cláudio não conseguiu responder: Conexão encerrada',
        });
        caso.canal.enviarDoUsuario('@claudio voltou?');
        await estabilizar();
        expect(caso.aberturas()).toBe(2);
        expect(caso.falas).toEqual(['claudio: Agora estou aqui.']);
    } finally {
        caso.canal.encerrar();
    }
});

test('silêncio explícito descarta texto do turno e permite responder à próxima mensagem', async () => {
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => {
        turno++;
        if (turno === 1) {
            expect(caso.canal.guardarSilencio(claudio.id)).toStartWith('Silêncio registrado.');
            expect(() => caso.canal.falarDoAgente(claudio.id, 'Silêncio.')).toThrow('encerrou sua vez');
            ouvinte.texto('Não tenho nada a acrescentar.');
            return;
        }
        ouvinte.texto('Agora tenho uma resposta.');
    });
    try {
        caso.canal.enviarDoUsuario('@claudio?');
        await estabilizar();
        expect(caso.falas).toEqual([]);
        expect(caso.mensagens().map((item) => item.autorId)).toEqual(['usuario']);
        caso.canal.enviarDoUsuario('@claudio outra pergunta');
        await estabilizar();
        expect(caso.falas).toEqual(['claudio: Agora tenho uma resposta.']);
    } finally { caso.canal.encerrar(); }
});

test('variantes isoladas de silêncio não viram fala, mas frases sobre silêncio são preservadas', async () => {
    const textos = ['Silêncio.', 'silencio', '(silêncio)', ' SILÊNCIO! ', 'O silêncio da sala me incomoda.'];
    let turno = 0;
    const caso = preparar(async (_prompt, ouvinte) => { ouvinte.texto(textos[turno++]!); });
    try {
        for (const _texto of textos) {
            caso.canal.enviarDoUsuario('@claudio?');
            await estabilizar();
        }
        expect(caso.falas).toEqual(['claudio: O silêncio da sala me incomoda.']);
    } finally { caso.canal.encerrar(); }
});

test('mensagem recebida durante a resposta permanece na fila e no contexto seguinte', async () => {
    let terminar!: () => void;
    const prompts: string[] = [];
    const caso = preparar(async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) await new Promise<void>((resolver) => { terminar = resolver; });
    });
    try {
        caso.canal.enviarDoUsuario('@claudio primeira pergunta');
        await estabilizar();
        caso.canal.enviarDoUsuario('@claudio segunda pergunta');
        terminar();
        await estabilizar();
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).toContain('segunda pergunta');
    } finally {
        caso.canal.encerrar();
    }
});

test('retomar depois do trabalho separa histórico lido de mensagens novas e informa o acontecimento', async () => {
    const prompts: string[] = [];
    const caso = preparar(async (prompt) => { prompts.push(prompt); });
    try {
        caso.canal.enviarDoUsuario('Bom dia, como você está?');
        await estabilizar();
        caso.canal.dispensar(claudio.id);
        caso.canal.notificar([claudio.id], 'A entrega do jardim foi encerrada com validação visual pendente.');
        await estabilizar();
        expect(caso.aberturas()).toBe(2);
        expect(prompts[1]).toContain('Histórico já lido');
        expect(prompts[1]).toContain('validação visual pendente');
        expect(prompts[1]?.split('Novas mensagens no Geral:')[1]).not.toContain('Bom dia');
        expect(prompts[1]).not.toContain('Jogador:');
        caso.canal.enviarDoUsuario('@Cláudio confira a nova versão');
        await estabilizar();
        expect(prompts[2]?.split('Novas mensagens no Geral:')[1]).toContain('confira a nova versão');
    } finally { caso.canal.encerrar(); }
});

test('cursor persistido sobrevive à recriação do canal e não depende do tamanho do histórico', async () => {
    const mensagens: MensagemGeral[] = [
        { id: 'lida', autorId: 'usuario', texto: 'Mensagem já respondida', criadaEm: '', ferramentas: [] },
        { id: 'nova', autorId: 'usuario', texto: 'Mensagem durante a ausência', criadaEm: '', ferramentas: [] },
    ];
    let cursor = 'lida';
    let prompt = '';
    const canal = new CanalGeral({
        funcionarios: () => [claudio], mensagens: () => mensagens, gravar: () => {},
        leitura: () => cursor, gravarLeitura: (_id, valor) => { cursor = valor; }, contexto: () => '',
        nomeResponsavel: () => 'Levi', urlMcp: async () => 'http://localhost', pasta: '.',
        emitirEstado: () => {}, emitirMensagens: () => {},
    }, () => ({ enviar: async (texto) => { prompt = texto; }, encerrar: () => {} }));
    try {
        canal.notificar([claudio.id]);
        await estabilizar();
        expect(prompt.split('Novas mensagens no Geral:')[1]).toContain('Levi: Mensagem durante a ausência');
        expect(prompt.split('Novas mensagens no Geral:')[1]).not.toContain('Mensagem já respondida');
        expect(cursor).toBe('nova');
        mensagens.shift();
        canal.dispensar(claudio.id);
        canal.notificar([claudio.id]);
        await estabilizar();
        expect(prompt.split('Novas mensagens no Geral:')[1]).not.toContain('Mensagem durante a ausência');
    } finally { canal.encerrar(); }
});
