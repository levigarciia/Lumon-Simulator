import { app, BrowserWindow } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';
import { registrarIpc } from '../electron/ipc';
import { configurarMotorLocal } from '../electron/services/motor';
import { Partida } from '../electron/services/partida';
import { Persistencia } from '../electron/services/persistencia';

function garantir(condicao: unknown, mensagem: string): asserts condicao {
    if (!condicao) throw new Error(mensagem);
}

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-validacao-manutencao-'));
    app.setPath('userData', pasta);
    await mkdir('artifacts', { recursive: true });
    const motor = configurarMotorLocal(pasta, () => {});
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    estado.funcionarios = [{
        id: 'ana', nome: 'Ana', cargo: 'lider', mesaId: 'mesa', autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'validacao', nome: 'Validação' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }];
    estado.sala.itens = [
        { id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 },
        { id: 'cafe', tipo: 'aparador_cafe', celula: { x: 9, z: 0 }, rotacao: 0,
            usos: 28, quebrado: true, ultimoUsuarioId: 'ana' },
    ];
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
    const partida = new Partida(estado, persistencia,
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    const escritorio = partida.obter();
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    registrarIpc(() => partida.obter(), () => janela, () => partida.reiniciar());
    const cliente = new Client({ name: 'validacao-manutencao', version: '1' });
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 150));
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
        await janela.loadFile(join(process.cwd(), 'artifacts/interface-manutencao/index.html'));
        for (let tentativa = 0; tentativa < 60; tentativa++) {
            if (await executar("document.body.textContent.includes('Quebrado: 23 moedas')")) break;
            await esperar();
        }
        garantir(await executar("document.body.textContent.includes('Quebrado: 23 moedas')"),
            'O móvel quebrado não exibiu o custo na sala.');
        await capturar('manutencao-quebra.png');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(await escritorio['mcp'].urlDe('ana', 'geral'))));
        const ferramentas = await cliente.listTools();
        garantir(ferramentas.tools.some((item) => item.name === 'consertar_item'), 'Conserto ausente no MCP.');
        garantir(!ferramentas.tools.some((item) => item.name === 'reiniciar'), 'Reinício exposto aos agentes.');
        const consulta = await cliente.callTool({ name: 'ver_escritorio', arguments: {} });
        garantir(JSON.stringify(consulta).includes('custo 23 moedas'), 'Consulta omitiu o conserto pendente.');
        const reparo = await cliente.callTool({ name: 'consertar_item', arguments: { item: 'cafe' } });
        garantir(!reparo.isError, 'O conserto pelo MCP falhou.');
        const repetido = await cliente.callTool({ name: 'consertar_item', arguments: { item: 'cafe' } });
        garantir(repetido.isError, 'Reparo repetido deveria informar que o móvel está recuperado.');
        garantir(escritorio.publico().moedas === 577, 'O conserto não cobrou exatamente uma vez.');
        await esperar();
        garantir(!await executar("document.body.textContent.includes('Quebrado: 23 moedas')"),
            'Aviso de quebra permaneceu após o reparo.');
        await clicar('Geral');
        garantir(await executar("document.querySelector('aside').textContent.includes('conserto providenciado')"),
            'O conserto não apareceu no Geral.');
        await capturar('manutencao-conserto.png');
        await clicar('Configurações');
        await clicar('Recomeçar do zero');
        garantir(await executar("document.body.textContent.includes('Essa ação não pode ser desfeita')"),
            'O reinício não pediu confirmação.');
        await capturar('manutencao-confirmacao.png');
        await clicar('Cancelar');
        garantir(partida.obter().publico().moedas === 577, 'Cancelar alterou a partida.');
        await clicar('Recomeçar do zero');
        await executar("localStorage.setItem('validacaoReinicio', 'antigo')");
        await clicar('Apagar e recomeçar');
        for (let tentativa = 0; tentativa < 60; tentativa++) {
            if (await executar("document.body.textContent.includes('O escritório está vazio')")) break;
            await esperar();
        }
        garantir(await executar("document.body.textContent.includes('O escritório está vazio')"),
            'O reinício não voltou à sala vazia.');
        garantir(await executar("localStorage.getItem('validacaoReinicio') === null"),
            'O reinício preservou preferências locais antigas.');
        garantir(partida.obter().publico().moedas === 600, 'Saldo inicial não foi restaurado.');
        garantir(partida.obter().mensagensGeral().length === 0, 'Histórico do Geral não foi apagado.');
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        garantir(salvo.funcionarios.length === 0 && salvo.sala.itens.length === 0, 'Reinício não persistido.');
        await capturar('manutencao-reinicio.png');
        garantir(erros.length === 0, `Erros na interface: ${erros.join('; ')}`);
        await writeFile('artifacts/manutencao-validacao.json', JSON.stringify({
            pasta, mcpReal: true, ipcReal: true, cobrancaUnica: true, confirmacao: true,
            cancelamento: true, reinicioPersistido: true, agentesReais: false, erros,
        }, null, 4));
        console.log('Manutenção e reinício validados no Electron com dados isolados, MCP, IPC e renderização.');
    } catch (erro) {
        await capturar('manutencao-falha.png');
        await writeFile('artifacts/manutencao-falha.json', JSON.stringify({
            erros, corpo: await executar('document.body.textContent'), estado: partida.obter().publico(),
        }, null, 4));
        throw erro;
    } finally {
        await cliente.close();
        partida.encerrar();
        motor.parar();
        await persistencia.descarregar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
