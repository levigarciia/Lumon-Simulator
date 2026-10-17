import { app, BrowserWindow } from 'electron';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-pausa-dupla-'));
    app.setPath('userData', pasta);
    const estado = estadoInicial();
    estado.funcionarios = ['Ana', 'Bia'].map((nome, indice) => ({
        id: crypto.randomUUID(), nome, cargo: 'refinador', mesaId: `mesa${indice}`, autonomia: false,
        contratadoEm: new Date().toISOString(), modelo: { provedor: 'local', id: 'modelo', nome: 'Validação' },
        aparencia: { pele: '#e3b48f', cabelo: '#3b2a1e', estiloCabelo: 'curto', gravata: '#24364f' },
    }));
    estado.sala.itens = [
        { id: 'mesa0', tipo: 'mesa', celula: { x: 3, z: 7 }, rotacao: 0 },
        { id: 'mesa1', tipo: 'mesa', celula: { x: 11, z: 7 }, rotacao: 0 },
        { id: 'sofa', tipo: 'sofa', celula: { x: 7, z: 2 }, rotacao: 0 },
    ];
    const janela = new BrowserWindow({ show: false, width: 1440, height: 900,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    registrarIpc(escritorio, () => janela);
    let falas = 0;
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => {
            falas++;
            ouvinte.texto(falas === 1 ? 'Bia, qual café você mais gosta?'
                : falas === 2 ? 'Prefiro o café forte. E uma conversa tranquila no sofá.' : '(silêncio)');
        }, encerrar: () => {},
    });
    escritorio['simulacao']['registro'].agoraPausaMs = () => 0;
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 100));
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        for (let tentativa = 0; tentativa < 60; tentativa++) {
            if (await janela.webContents.executeJavaScript("document.body.textContent.includes('Lumon')")) break;
            await esperar();
        }
        for (const pessoa of estado.funcionarios) {
            void escritorio['simulacao'].pedirPausa(pessoa.id, 'descansando', 5);
        }
        for (let passo = 0; passo < 300; passo++) escritorio['simulacao'].avancar(0.1);
        for (let tentativa = 0; tentativa < 60 && falas < 3; tentativa++) await esperar();
        if (falas < 3) throw new Error('A conversa privada não percorreu as duas respostas e o silêncio.');
        const corpos = escritorio['simulacao'].agentes();
        if (corpos.some((agente) => agente.destinoId !== 'sofa' || agente.rota.length)) {
            throw new Error('Um dos participantes saiu do sofá durante a conversa.');
        }
        if (JSON.stringify(corpos[0]!.posicao) === JSON.stringify(corpos[1]!.posicao)) {
            throw new Error('Os dois participantes ocuparam a mesma posição.');
        }
        await janela.webContents.executeJavaScript("[...document.querySelectorAll('button')]"
            + ".find((item) => item.textContent.trim() === 'Geral').click()");
        await esperar();
        await esperar();
        const visivel = await janela.webContents.executeJavaScript("document.querySelector('aside').textContent");
        if (!visivel.includes('qual café') || !visivel.includes('Reservado:')) {
            throw new Error('A conversa privada não apareceu na interface.');
        }
        await writeFile('artifacts/pausa-compartilhada.png', (await janela.webContents.capturePage()).toPNG());
        await writeFile('artifacts/pausa-compartilhada-validacao.json', JSON.stringify({
            corpos, falas, duasVagas: true, conversaReservada: true, estadoDoUsuarioAlterado: false,
            harnessControlado: true,
        }, null, 4));
        console.log('Pausa compartilhada validada no Electron com duas posições e conversa privada.');
    } finally { escritorio.encerrar(); janela.destroy(); app.quit(); }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
