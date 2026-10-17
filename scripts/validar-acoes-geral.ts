import { app, BrowserWindow } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

function garantir(condicao: unknown, mensagem: string): asserts condicao {
    if (!condicao) throw new Error(mensagem);
}

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-acoes-geral-'));
    app.setPath('userData', pasta);
    await mkdir('artifacts', { recursive: true });
    const estado = estadoInicial();
    estado.funcionarios = [{
        id: 'ana', nome: 'Ana', cargo: 'lider', mesaId: 'mesa', autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'validacao', nome: 'Validação' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 }];
    const janela = new BrowserWindow({
        show: false, width: 1440, height: 1000, backgroundColor: '#101c20',
        webPreferences: {
            preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            offscreen: true, backgroundThrottling: false,
        },
    });
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    escritorio['simulacao'].encerrar();
    let liberar!: () => void;
    const espera = new Promise<void>((resolver) => { liberar = resolver; });
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => {
            ouvinte.iniciarFerramenta('consulta', 'Escritório: ver_escritorio', '{}');
            ouvinte.concluirFerramenta('consulta', false, 'Saldo do escritório: 600 moedas.');
            ouvinte.iniciarFerramenta('conserto', 'Escritório: consertar_item', '{"item":"maquina"}');
            ouvinte.concluirFerramenta('conserto', true, 'Móvel não encontrado.');
            ouvinte.iniciarFerramenta('pausa', 'Escritório: fazer_pausa', '{"atividade":"comendo"}');
            await espera;
            ouvinte.concluirFerramenta('pausa', false, 'Pausa concluída.');
            ouvinte.texto('Consultei o saldo. O conserto falhou porque o móvel não foi encontrado.');
        },
        encerrar: () => {},
    });
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const capturar = async (nome: string) => {
        janela.webContents.invalidate();
        await new Promise((resolver) => setTimeout(resolver, 300));
        await writeFile(join('artifacts', nome), (await janela.webContents.capturePage()).toPNG());
    };
    const aguardar = async (codigo: string) => {
        for (let tentativa = 0; tentativa < 100; tentativa++) {
            if (await executar(codigo)) return;
            await new Promise((resolver) => setTimeout(resolver, 100));
        }
        throw new Error(`A interface não atingiu o estado esperado: ${codigo}`);
    };
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await aguardar("[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === 'Geral')");
        await executar("[...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Geral').click()");
        garantir(escritorio.enviarGeral('Confira o escritório.').ok, 'O Geral recusou a mensagem.');
        await aguardar("document.querySelectorAll('aside details').length === 3");
        await executar("document.querySelectorAll('aside details').forEach((item) => { item.open = true; })");
        const conteudo = await executar("document.querySelector('aside').textContent");
        for (const esperado of ['Estado: concluida', 'Estado: falhou', 'Estado: rodando',
            'Entrada', 'Retorno', 'Móvel não encontrado.', 'Saldo do escritório: 600 moedas.']) {
            garantir(conteudo.includes(esperado), `Informação ausente no Chat: ${esperado}`);
        }
        await executar("document.querySelectorAll('aside details').forEach((item) => { item.open = false; })");
        await capturar('acoes-geral-pendente.png');
        await executar("document.querySelectorAll('aside details').forEach((item) => { item.open = true; })");
        liberar();
        await aguardar("document.querySelector('aside').textContent.includes('Pausa concluída.')");
        garantir(!await executar("document.querySelector('aside').textContent.includes('Estado: rodando')"),
            'A ação permaneceu executando após o retorno.');
        await capturar('acoes-geral-concluida.png');
        await writeFile('artifacts/acoes-geral-validacao.json', JSON.stringify({
            ok: true, estadoTemporario: true, ferramentas: 3,
            estadosConferidos: ['rodando', 'concluida', 'falhou'], entradaERetorno: true,
        }, null, 4));
        console.log('Ações do Geral renderizadas com estados, argumentos e retorno.');
    } finally {
        liberar();
        escritorio.encerrar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => {
    console.error(erro);
    app.exit(1);
});
