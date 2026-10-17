import { app, BrowserWindow } from 'electron';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { configurarMotorLocal } from '../electron/services/motor';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-contexto-'));
    app.setPath('userData', pasta);
    const janela = new BrowserWindow({ show: false, width: 1440, height: 900,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            offscreen: true, backgroundThrottling: false } });
    const motor = configurarMotorLocal(join(process.env.APPDATA!, 'Lumon'), (estado) => {
        if (estado.contexto) console.log(`Contexto carregado: ${estado.contexto}. Backend: ${estado.backend}.`);
    });
    const estado = estadoInicial();
    estado.funcionarios = [{ id: 'avaliacao', nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa', autonomia: false,
        contratadoEm: new Date().toISOString(),
        modelo: { provedor: 'local', id: 'qwen3.5-9b-q4', nome: 'Qwen3.5 9B' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' } }];
    estado.social.personalidades.avaliacao = { orgulho: 94, ambicao: 98, empatia: 89,
        autoritarismo: 97, tolerancia: 63, interesse: 'qualidade' };
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 }];
    estado.projetos = [{ id: 'projeto', nome: 'ClaudioProject', pasta }];
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 150));
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        for (let tentativa = 0; tentativa < 80; tentativa++) {
            if (await executar("!!document.querySelector('ul button')")) break;
            await esperar();
        }
        await executar("[...document.querySelectorAll('ul button')].find(b => b.textContent.includes('Cláudio')).click()");
        await esperar();
        await executar("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.trim() === 'Chat').click()");
        await esperar();
        const envio = await executar("window.lumon.enviar('avaliacao', 'Oi')");
        if (!envio.ok) throw new Error(envio.erro);
        const limite = Date.now() + 180000;
        while (escritorio.publico().status.avaliacao === 'trabalhando' && Date.now() < limite) await esperar();
        const resposta = escritorio.conversa('avaliacao').findLast((mensagem) => mensagem.autor === 'funcionario');
        if (!resposta?.texto.trim() || resposta.erro) throw new Error(resposta?.erro ?? 'Sem resposta ao Oi.');
        if (!motor.estado.contexto || motor.estado.contexto < 16384) {
            throw new Error('Contexto insuficiente para a validação com todas as ferramentas.');
        }
        await esperar();
        await writeFile('artifacts/contexto-automatico.png', (await janela.webContents.capturePage()).toPNG());
        const resultado = { contexto: motor.estado.contexto, backend: motor.estado.backend,
            modelo: motor.estado.modeloId, resposta: resposta.texto, ferramentas: resposta.ferramentas.length,
            ipcReal: true, dadosIsolados: true };
        await writeFile('artifacts/contexto-automatico.json', JSON.stringify(resultado, null, 4));
        console.log(JSON.stringify(resultado));
    } finally {
        escritorio.encerrar();
        const processo = motor['processo'];
        motor.parar();
        if (processo && processo.exitCode === null) {
            await Promise.race([new Promise((resolver) => processo.once('close', resolver)),
                new Promise((resolver) => setTimeout(resolver, 5000))]);
        }
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
