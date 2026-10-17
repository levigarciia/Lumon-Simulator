import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { urlDesenvolvimento } from '../shared/desenvolvimento';
import { canalEventos } from '../shared/ponte';
import { registrarIpc } from './ipc';
import { Partidas } from './services/partidas';
import { configurarMotorLocal } from './services/motor';

const corFundo = '#101c20';
const urlInformada = !app.isPackaged ? process.env.LUMON_VITE_URL : undefined;
if (urlInformada && urlInformada !== urlDesenvolvimento) throw new Error('Origem de desenvolvimento inválida.');
const urlInterface = urlInformada ?? pathToFileURL(join(__dirname, '../dist/index.html')).href;

let janela: BrowserWindow | null = null;
let encerrando = false;

async function criarJanela(): Promise<void> {
    janela = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 680,
        backgroundColor: corFundo,
        title: 'Lumon',
        show: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: corFundo, symbolColor: '#b1c8c2', height: 36 },
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    });
    janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    janela.webContents.session.setPermissionRequestHandler((_conteudo, _permissao, responder) => responder(false));
    janela.once('ready-to-show', () => janela?.show());
    janela.once('closed', () => (janela = null));
    await janela.loadURL(urlInterface);
}

app.whenReady().then(async () => {
    const motor = configurarMotorLocal(app.getPath('userData'), (estado) => {
        if (janela && !janela.isDestroyed()) janela.webContents.send(canalEventos, { tipo: 'motor', estado });
    });
    const partidas = await Partidas.abrir(app.getPath('userData'), (evento) => {
        if (janela && !janela.isDestroyed()) janela.webContents.send(canalEventos, evento);
    });
    registrarIpc(() => partidas.obter(), () => janela, () => partidas.reiniciar(), partidas);
    app.on('before-quit', (evento) => {
        if (encerrando) return;
        evento.preventDefault();
        encerrando = true;
        motor.parar();
        void partidas.encerrar().then(() => app.quit()).catch((erro: unknown) => {
            encerrando = false;
            console.error('Não foi possível salvar antes de sair.', erro);
        });
    });
    await criarJanela();
}).catch((erro: unknown) => {
    dialog.showErrorBox('Não foi possível abrir o escritório',
        erro instanceof Error ? erro.message : String(erro));
    app.exit(1);
});

app.on('window-all-closed', () => app.quit());
