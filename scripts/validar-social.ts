import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { Persistencia } from '../electron/services/persistencia';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-validacao-social-'));
    app.setPath('userData', pasta);
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    estado.funcionarios = ['Helena', 'Pedro', 'Lia'].map((nome, indice) => ({
        id: randomUUID(), nome, cargo: indice === 0 ? 'lider' : 'desenvolvedor', mesaId: `mesa${indice}`,
        contratadoEm: new Date().toISOString(), autonomia: false,
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo de validação' },
        aparencia: { pele: '#e3b48f', cabelo: '#3b2a1e', estiloCabelo: 'curto', gravata: '#24364f' },
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 2 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const [helena, pedro, lia] = estado.funcionarios;
    estado.sala.itens.push({ id: 'lanche', tipo: 'maquina_guloseimas', celula: { x: 12, z: 0 }, rotacao: 0 });
    if (!helena || !pedro || !lia) throw new Error('Equipe de validação incompleta.');
    const janela = new BrowserWindow({
        show: false, width: 1440, height: 900, backgroundColor: '#101c20',
        webPreferences: {
            preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            offscreen: true, backgroundThrottling: false,
        },
    });
    const erros: string[] = [];
    janela.webContents.on('console-message', (evento) => {
        if (evento.level === 'error') erros.push(evento.message);
    });
    const escritorio = new Escritorio(estado, (atual) => persistencia.salvar(atual),
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    let respostasPrivadas = 0;
    escritorio['geral']['abrirSessao'] = (pessoa, configuracao) => ({
        enviar: async (_prompt, ouvinte) => {
            if (!configuracao.instrucoes.includes('Somente vocês dois recebem')) return;
            respostasPrivadas++;
            ouvinte.texto(respostasPrivadas > 2 ? '(silêncio)' : pessoa.id === lia.id
                ? 'Sim, faltou testar a sessão expirada. Vou corrigir essa validação.'
                : 'Obrigado por reconhecer. Vamos conferir os testes antes da próxima entrega.');
        }, encerrar: () => {},
    });
    const cliente = new Client({ name: 'validacao-convite', version: '1' });
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 150));
    const garantir = (condicao: unknown, mensagem: string) => {
        if (!condicao) throw new Error(mensagem);
    };
    const clicar = async (rotulo: string) => {
        await executar(`(() => {
            const botao = [...document.querySelectorAll('button')].find((item) =>
                item.textContent.trim() === ${JSON.stringify(rotulo)}
                || item.getAttribute('aria-label') === ${JSON.stringify(rotulo)});
            if (!botao || botao.disabled) throw new Error('Botão indisponível');
            botao.click();
        })()`);
        await esperar();
    };
    const capturar = async (nome: string) => {
        await writeFile(join('artifacts', nome), (await janela.webContents.capturePage()).toPNG());
    };
    try {
        const social = escritorio['social'];
        const fonte = social.registrar({ tipo: 'falha', autorId: pedro.id, alvoId: helena.id,
            texto: 'A entrega do login falhou no teste de sessão expirada.', trabalhoId: 'login',
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        social.interagir(helena.id, pedro.id, 'cobrar', 'Pedro, essa sessão expirada precisava ter sido testada.',
            'publico', [fonte.id]);
        const cobranca = escritorio.publico().social.eventos.at(-1)!;
        social.reagir(pedro.id, cobranca.id, 'discordar', 'Reconheço o erro, mas a exposição foi desnecessária.');
        social.planejar(pedro.id, helena.id, 'reconciliar', 'Reparar a relação com Helena.', cobranca.id);
        social.interagir(lia.id, pedro.id, 'elogiar', 'Pedro, reconheço seu cuidado ao revisar a sessão.',
            'publico', [fonte.id]);
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        for (let tentativa = 0; tentativa < 60; tentativa++) {
            if (await executar("!!document.querySelector('ul button')")) break;
            await esperar();
        }
        await clicar('Geral');
        garantir(await executar("![...document.querySelectorAll('[role=tab]')].some((item) => "
            + "item.textContent.includes('Escritório'))"), 'A aba Escritório ainda existe.');
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('sessão expirada')"),
            'Cobrança não apareceu na atividade.');
        await capturar('social-chat.png');
        garantir(await executar('document.querySelectorAll(\'[aria-label="Mudanças nas relações"]\').length >= 2'),
            'Impactos das relações não apareceram no Geral.');
        await executar('document.querySelectorAll(\'[aria-label="Mudanças nas relações"] details\')'
            + '.forEach((item) => { item.open = true; })');
        await esperar();
        await capturar('social-impactos-relacao.png');
        escritorio['simulacao']['registro'].agoraPausaMs = () => escritorio['simulacao'].segundosAtuais() * 1000;
        const pausa = escritorio['simulacao'].pedirPausa(pedro.id, 'comendo', 5);
        for (let passo = 0; passo < 3500; passo++) escritorio['simulacao'].avancar(0.1);
        garantir((await pausa).includes('Pausa concluída'), 'Pausa física não terminou.');
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('via ferramenta')"),
            'Pausa ausente do Geral.');
        await capturar('social-pausa-geral.png');
        await executar("[...document.querySelectorAll('ul button')].find((item) => "
            + "item.textContent.includes('Pedro')).click()");
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('Interesse:')"),
            'Personalidade ausente da ficha.');
        await executar("document.querySelector('aside details').open = true");
        await esperar();
        garantir(await executar("document.querySelector('aside details').open"), 'Relações não expandiram.');
        await capturar('social-relacoes.png');
        garantir(await executar(`(() => {
            const compromissos = [...document.querySelectorAll('aside details')].find((item) =>
                item.querySelector('summary').textContent.includes('Compromissos privados'));
            if (!compromissos) return false;
            compromissos.open = true;
            compromissos.scrollIntoView({ block: 'center' });
            return compromissos.textContent.includes('Reparar a relação com Helena.')
                && compromissos.textContent.includes('Pendente');
        })()`), 'Compromisso privado não apareceu na ficha.');
        await esperar();
        await capturar('social-compromissos.png');
        await clicar('Chat');
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('via ferramenta')"),
            'Pausa ausente do chat individual.');
        await capturar('social-pausa-individual.png');
        await clicar('Ficha');
        await cliente.connect(new StreamableHTTPClientTransport(
            new URL(await escritorio['mcp'].urlDe(helena.id, 'geral')),
        ));
        const mensagemPrivada = 'Lia, podemos conversar em particular sobre os testes da entrega?';
        const convite = cliente.callTool({ name: 'conversar_reservado',
            arguments: { funcionario: lia.id, mensagem: mensagemPrivada } });
        for (let tentativa = 0; tentativa < 100 && !escritorio['simulacao'].emPausa(helena.id); tentativa++) {
            await esperar();
        }
        garantir(escritorio['simulacao'].emPausa(helena.id), 'Convite não iniciou caminhada.');
        garantir(!escritorio.publico().social.eventos.some((item) => item.texto === mensagemPrivada),
            'Convite entregou a mensagem antes de chegar.');
        for (let indice = 0; indice < 180; indice++) escritorio['simulacao'].avancar(0.1);
        garantir(JSON.stringify(await convite).includes('Ação registrada'), 'Convite automático falhou.');
        garantir(escritorio['simulacao'].agentes().find((item) => item.id === helena.id)?.atividade === 'conversando',
            'O personagem não chegou para conversar.');
        garantir(!escritorio['contextoGeral'](pedro.id).includes(mensagemPrivada), 'Convite vazou para terceiros.');
        await esperar();
        const posicoes = escritorio['simulacao'].agentes().filter((agente) => [helena.id, lia.id].includes(agente.id))
            .map((agente) => agente.posicao);
        for (let indice = 0; indice < 300; indice++) escritorio['simulacao'].avancar(0.1);
        garantir(JSON.stringify(escritorio['simulacao'].agentes()
            .filter((agente) => [helena.id, lia.id].includes(agente.id)).map((agente) => agente.posicao))
            === JSON.stringify(posicoes), 'Os parceiros saíram entre as respostas.');
        await clicar('Geral');
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('faltou testar a sessão')"),
            'Resposta reservada não apareceu no Chat.');
        await executar(`(() => {
            const filtro = document.querySelector('select[aria-label="Filtrar conversa"]');
            const opcao = [...filtro.options].find((item) => item.textContent.includes('Helena e Lia'));
            if (!opcao) throw new Error('Conversa reservada ausente do filtro.');
            filtro.value = opcao.value;
            filtro.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await esperar();
        garantir(await executar("!document.querySelector('aside textarea')"),
            'Filtro privado exibiu compositor público.');
        await capturar('social-convite-automatico.png');
        escritorio['simulacao'].cancelarEncontro(helena.id);
        const encontro = escritorio['simulacao'].encontrarColega(pedro.id, lia.id);
        for (let indice = 0; indice < 180; indice++) escritorio['simulacao'].avancar(0.1);
        garantir((await encontro).includes('Você chegou'), 'O encontro não chegou ao colega.');
        const propostaTexto = social.propor(pedro.id, helena.id, 'troca_lideranca',
            'Quero coordenar as revisões sem expor os colegas.', [cobranca.id], pedro.id);
        const proposta = escritorio.publico().social.propostas.at(-1)!;
        garantir(propostaTexto.includes(proposta.id), 'Proposta não criada.');
        social.interagir(pedro.id, lia.id, 'reservado',
            `Você apoia minha proposta ${proposta.id}? Quero mudar a forma de cobrar.`, 'reservado', [cobranca.id],
            undefined, helena.id);
        const conversa = escritorio.publico().social.eventos.at(-1)!;
        garantir(!escritorio['contextoGeral'](helena.id).includes('Quero mudar a forma de cobrar'),
            'Conversa reservada vazou para Helena.');
        garantir(social.apoiar(lia.id, proposta.id, conversa.id).includes('Apoio registrado'), 'Apoio não registrado.');
        await executar("[...document.querySelectorAll('ul button')].find((item) => "
            + "item.textContent.includes('Pedro')).click()");
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('Apoiam: Pedro, Lia')"),
            'Apoios não aparecem na proposta.');
        await capturar('social-proposta.png');
        await clicar('Aprovar');
        garantir(escritorio.publico().funcionarios.find((item) => item.id === pedro.id)?.cargo !== 'lider',
            'A proposta foi executada antes da confirmação.');
        escritorio['simulacao'].cancelarEncontro(pedro.id);
        await clicar('Confirmar decisão');
        garantir(escritorio.publico().funcionarios.find((item) => item.id === pedro.id)?.cargo === 'lider',
            'A decisão não alterou a liderança pelo IPC.');
        await capturar('social-decisao.png');
        escritorio['geral'].encerrar();
        const falaLonga = 'Chefe, sinto falta da experiência que ele trazia, mas a decisão de demitir foi '
            + 'necessária para manter a disciplina. Preciso de mais pessoas para manter a equipe funcionando '
            + 'sem sobrecarregar quem ficou. Também precisamos reservar tempo para descansar e conversar '
            + 'sobre os próximos passos com calma.';
        const falaReservada = social.registrar({ tipo: 'reservado', autorId: pedro.id, alvoId: lia.id,
            texto: falaLonga, alcance: 'reservado', ouvintes: [pedro.id, lia.id], fontes: [] }, false);
        await new Promise((resolver) => setTimeout(resolver, 350));
        garantir(await executar("[...document.querySelectorAll('[data-balao-fala]')].some((item) => "
            + "item.textContent.includes('Chefe, sinto falta'))"), 'Texto reservado ausente do balão.');
        await capturar('social-balao-primeira-parte.png');
        const partes = (await import('../shared/baloes')).dividirFala(falaLonga);
        const duracaoPrimeira = Math.max(4500, partes[0]!.split(/\s+/u).length * 320 + 1200);
        const esperaSegunda = Math.max(0, Date.parse(falaReservada.criadoEm) + duracaoPrimeira + 500 - Date.now());
        await new Promise((resolver) => setTimeout(resolver, esperaSegunda));
        garantir(await executar("[...document.querySelectorAll('[data-balao-fala]')].some((item) => "
            + "item.textContent.includes('2 /'))"), 'Balão não avançou para a segunda parte.');
        await capturar('social-balao-segunda-parte.png');
        escritorio['simulacao']['registro'].emitirEstado = () => {};
        const estadoSemFalas = escritorio.publico();
        estadoSemFalas.social = { ...estadoSemFalas.social, eventos: [] };
        estadoSemFalas.geral = { ...estadoSemFalas.geral, falandoId: null };
        janela.webContents.send(canalEventos, { tipo: 'geral', mensagens: [] });
        janela.webContents.send(canalEventos, { tipo: 'estado', estado: estadoSemFalas });
        await new Promise((resolver) => setTimeout(resolver, 100));
        garantir(await executar("[...document.querySelectorAll('[data-balao-fala]')].some((item) => { "
            + "const opacidade = Number(getComputedStyle(item).opacity); "
            + "return item.textContent.includes('2 /') && opacidade > 0 && opacidade < 1; })"),
        'Balão não preservou o texto durante o desaparecimento suave.');
        await new Promise((resolver) => setTimeout(resolver, 700));
        garantir(await executar("[...document.querySelectorAll('[data-balao-fala]')].every((item) => "
            + "getComputedStyle(item).visibility === 'hidden')"), 'Balão continuou visível após o efeito.');
        janela.webContents.send(canalEventos, { tipo: 'estado', estado: {
            ...estadoSemFalas, geral: { ...estadoSemFalas.geral, falandoId: pedro.id, etapaResposta: 'escrevendo' },
        } });
        await new Promise((resolver) => setTimeout(resolver, 300));
        garantir(await executar("[...document.querySelectorAll('[data-pensando]')].some((item) => "
            + "item.getBoundingClientRect().width < 80 && getComputedStyle(item).visibility === 'visible')"),
        'Indicador de pensamento não ficou compacto.');
        await capturar('social-balao-pensando.png');
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        garantir(salvo.social.propostas[0]?.estado === 'aprovada', 'Decisão não persistida.');
        garantir(salvo.social.eventos.some((item) => item.id === conversa.id), 'Conversa não persistida.');
        garantir(salvo.social.relacoes.some((item) => item.autorId === pedro.id), 'Relações não persistidas.');
        garantir(erros.length === 0, `Erros na interface: ${erros.join('; ')}`);
        await writeFile('artifacts/social-validacao.json', JSON.stringify({
            pasta, persistencia: true, privacidade: true, encontro: true, conviteAutomatico: true,
            encontroConjunto: true, chatReservado: true, semAbaEscritorio: true, decisaoPorIpc: true,
            agentesReais: false, compromissosPrivados: true, balaoCompacto: true, balaoDesapareceSuavemente: true,
            impactosRelacoesVisiveis: true,
            erros, eventos: salvo.social.eventos.length,
        }, null, 4));
        console.log('Dinâmica social validada no Electron com estado isolado, IPC, renderização e persistência.');
    } finally {
        await cliente.close();
        escritorio.encerrar();
        await persistencia.descarregar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
