import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Partidas } from '../electron/services/partidas';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-validacao-escritorios-'));
    app.setPath('userData', pasta);
    const legado = { ...estadoInicial(), moedas: 123 };
    const mesaId = randomUUID();
    legado.sala.itens = [{ id: mesaId, tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 }];
    legado.funcionarios = [{
        id: randomUUID(), nome: 'Helena', cargo: 'lider', mesaId, autonomia: false,
        contratadoEm: new Date().toISOString(), modelo: { provedor: 'codex', id: 'teste', nome: 'Teste' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }];
    await writeFile(join(pasta, 'lumon.json'), JSON.stringify(legado));
    const janela = new BrowserWindow({ show: false, width: 1100, height: 720,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const erros: string[] = [];
    let etapa = 'abertura';
    janela.webContents.on('dom-ready', () => {
        void janela.webContents.executeJavaScript(
            "window.addEventListener('error', (evento) => console.error(evento.error?.stack || evento.message))");
    });
    janela.webContents.on('console-message', (evento) => {
        if (evento.level === 'error') erros.push(`${etapa}: ${evento.message}`);
    });
    const partidas = await Partidas.abrir(pasta,
        (evento) => janela.webContents.send(canalEventos, evento));
    const principal = partidas.listar().ativoId;
    registrarIpc(() => partidas.obter(), () => janela, () => partidas.reiniciar(), partidas);
    const executar = <T = unknown>(codigo: string): Promise<T> => janela.webContents.executeJavaScript(codigo);
    const esperar = async (condicao: () => Promise<boolean>) => {
        for (let tentativa = 0; tentativa < 100; tentativa++) {
            if (await condicao()) return;
            await new Promise((resolver) => setTimeout(resolver, 100));
        }
        throw new Error('A interface não atingiu o estado esperado.');
    };
    const clicar = (texto: string) => executar(`(() => {
        const botao = [...document.querySelectorAll('button')].find((item) =>
            item.textContent.trim() === ${JSON.stringify(texto)}
                || item.getAttribute('aria-label') === ${JSON.stringify(texto)});
        if (!botao) throw new Error('Botão ausente: ' + ${JSON.stringify(texto)});
        botao.click();
    })()`);
    const textoVisivel = (texto: string) =>
        executar<boolean>(`document.body.innerText.includes(${JSON.stringify(texto)})`);
    const garantir = (condicao: unknown, mensagem: string) => { if (!condicao) throw new Error(mensagem); };
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await esperar(() => textoVisivel('Helena'));
        await esperar(() => executar<boolean>(`(document.querySelector('canvas')?.width ?? 0) > 100`));
        await clicar('Configurações');
        await esperar(() => textoVisivel('Escritório principal'));
        garantir(!await textoVisivel('Forma de tratamento'), 'Preferência pessoal ainda aparece.');
        garantir(!await textoVisivel('Seu nome'), 'Campo pessoal ainda aparece.');
        await executar(`(() => {
            const entrada = document.querySelector('input');
            const valor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            valor.set.call(entrada, 'Cenário alternativo');
            entrada.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await esperar(() => executar<boolean>(`!([...document.querySelectorAll('button')]
            .find((item) => item.textContent.trim() === 'Criar escritório')).disabled`));
        etapa = 'criação';
        const criacaoCarregada = new Promise<void>((resolver) => {
            janela.webContents.once('did-finish-load', () => resolver());
        });
        await clicar('Criar escritório');
        await criacaoCarregada;
        await esperar(() => executar<boolean>(`(document.querySelector('canvas')?.width ?? 0) > 100`));
        await esperar(async () => await executar<boolean>(`!document.body.innerText.includes('Configurações')`)
            && (await executar<{ ativoId: string }>('window.lumon.listarEscritorios()')).ativoId !== principal);
        await clicar('Configurações');
        await esperar(() => textoVisivel('Cenário alternativo'));
        await mkdir('artifacts', { recursive: true });
        await writeFile('artifacts/escritorios-configuracoes.png', (await janela.webContents.capturePage()).toPNG());
        garantir(partidas.obter().publico().moedas === 600, 'Novo escritório herdou o saldo.');
        etapa = 'troca';
        const trocaCarregada = new Promise<void>((resolver) => {
            janela.webContents.once('did-finish-load', () => resolver());
        });
        await clicar('Abrir');
        await trocaCarregada;
        await esperar(() => executar<boolean>(`(document.querySelector('canvas')?.width ?? 0) > 100`));
        await esperar(async () =>
            (await executar<{ ativoId: string }>('window.lumon.listarEscritorios()')).ativoId === principal);
        garantir(partidas.obter().publico().moedas === 123, 'Saldo anterior não voltou.');
        await esperar(() => textoVisivel('Helena'));
        await clicar('Geral');
        partidas.obter()['geral']['abrirSessao'] = () => ({
            enviar: async () => {}, encerrar: () => {},
        });
        await executar(`window.lumon.enviarGeral('Comunicado de teste da Diretoria.')`);
        await esperar(() => textoVisivel('Diretoria'));
        await writeFile('artifacts/escritorios-diretoria.png', (await janela.webContents.capturePage()).toPNG());
        garantir(partidas.obter().publico().social.eventos.some((evento) =>
            evento.autorId === 'diretoria' && evento.autorNome === 'Diretoria'), 'Autoria incorreta.');
        garantir(JSON.parse(await readFile(join(pasta, 'lumon.json'), 'utf8')).moedas === 123,
            'Legado foi alterado.');
        garantir(erros.length === 0, `Erros na interface: ${erros.join('; ')}`);
        await writeFile('artifacts/escritorios-validacao.json', JSON.stringify({
            ok: true, criacaoPelaInterface: true, trocaPelaInterface: true,
            saldoIsolado: true, autoriaDiretoria: true, legadoPreservado: true,
        }, null, 4));
        console.log('Validação dos escritórios concluída.');
    } finally {
        await partidas.encerrar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
