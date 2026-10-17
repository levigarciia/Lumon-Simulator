import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { configurarMotorLocal } from '../electron/services/motor';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-local-desktop-'));
    app.setPath('userData', pasta);
    const raizMotor = join(process.env.APPDATA!, 'Lumon');
    const janela = new BrowserWindow({
        show: false, width: 1440, height: 900, backgroundColor: '#101c20',
        webPreferences: {
            preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            offscreen: true, backgroundThrottling: false,
        },
    });
    const motor = configurarMotorLocal(raizMotor,
        (estado) => janela.webContents.send(canalEventos, { tipo: 'motor', estado }));
    const estado = estadoInicial();
    estado.sala.itens.push({ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 });
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 150));
    const garantir = (condicao: unknown, mensagem: string) => {
        if (!condicao) throw new Error(mensagem);
    };
    await mkdir('artifacts', { recursive: true });
    let codigoSaida = 0;
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        for (let tentativa = 0; tentativa < 80; tentativa++) {
            if (await executar("!!document.querySelector('nav button')")) break;
            await esperar();
        }
        await executar("[...document.querySelectorAll('nav button')]"
            + ".find(b => b.textContent.includes('Contratar')).click()");
        await esperar();
        const selecao = await executar(`(() => {
            const seletor = document.querySelector('select');
            if (!seletor) throw new Error('Seleção de modelo ausente');
            const opcao = [...seletor.options].find(o => o.textContent.includes('Qwen3.5 9B'));
            if (!opcao) throw new Error('Qwen 9B ausente do catálogo');
            seletor.value = opcao.value;
            seletor.dispatchEvent(new Event('change', { bubbles: true }));
            return opcao.textContent;
        })()`);
        await esperar();
        garantir(await executar("document.body.textContent.includes('Preparação automática')"),
            'Aviso de preparação automática ausente.');
        await writeFile('artifacts/modelo-local-catalogo.png', (await janela.webContents.capturePage()).toPNG());
        await executar("document.querySelector('[aria-label=Fechar]').click()");
        await writeFile(join(pasta, 'entrada.txt'), 'CODIGO_LOCAL_9472');
        escritorio.adicionarProjeto(pasta);
        const resultado = await executar(`window.lumon.contratar({
            nome: 'Validação local', cargo: 'lider', autonomia: false,
            modelo: { provedor: 'local', id: 'qwen3.5-9b-q4', nome: 'Qwen3.5 9B' },
            aparencia: { pele: '#e3b48f', cabelo: '#3b2a1e', estiloCabelo: 'curto', gravata: '#24364f' }
        })`);
        garantir(resultado.ok, 'Contratação pelo IPC falhou.');
        const funcionario = escritorio.publico().funcionarios[0]!;
        const projeto = escritorio.publico().projetos[0]!;
        const pedido = 'Use ler_arquivo para ler entrada.txt. Depois use escrever_arquivo para criar saida.txt '
            + 'com o conteúdo exato lido. Não execute comandos. Ao terminar, diga apenas Concluído.';
        await executar(`window.lumon.enviarTrabalho(${JSON.stringify(projeto.id)},
            ${JSON.stringify(pedido)})`);
        let aprovou = false;
        const inicio = Date.now();
        while (Date.now() - inicio < 300000) {
            const publico = escritorio.publico();
            for (const aprovacao of publico.aprovacoes) {
                garantir(aprovacao.resumo.includes('escrever_arquivo'), 'Ferramenta inesperada pediu aprovação.');
                await executar(`window.lumon.responderAprovacao(${JSON.stringify(aprovacao.id)}, true)`);
                aprovou = true;
            }
            if (publico.status[funcionario.id] === 'ocioso' && escritorio.conversa(funcionario.id).length >= 2) break;
            if (publico.status[funcionario.id] === 'erro') {
                throw new Error(JSON.stringify(escritorio.conversa(funcionario.id).at(-1)));
            }
            await esperar();
        }
        garantir(aprovou, 'A escrita não passou pela aprovação do jogador.');
        garantir(await readFile(join(pasta, 'saida.txt'), 'utf8') === 'CODIGO_LOCAL_9472',
            'O agente não escreveu o conteúdo retornado pela leitura.');
        garantir(motor.estado.backend === 'rocm', 'O desktop não usou ROCm.');
        await esperar();
        garantir(await executar("document.querySelector('[role=status]').textContent.includes('ROCM')"),
            'O backend ativo não apareceu na interface.');
        await writeFile('artifacts/modelo-local-desktop.png', (await janela.webContents.capturePage()).toPNG());
        await writeFile('artifacts/modelo-local-desktop.json', JSON.stringify({
            selecao, aprovou, estado: motor.estado, conversa: escritorio.conversa(funcionario.id),
        }, null, 4));
        console.log('Desktop validado: contratação, leitura, aprovação, escrita e ROCm.');
    } catch (erro) {
        codigoSaida = 1;
        await writeFile('artifacts/modelo-local-desktop-erro.json', JSON.stringify({
            erro: erro instanceof Error ? erro.message : String(erro), motor: motor.estado,
            conversas: escritorio.publico().funcionarios.map((pessoa) => escritorio.conversa(pessoa.id)),
        }, null, 4));
    } finally {
        escritorio.encerrar();
        motor.parar();
        janela.destroy();
        app.exit(codigoSaida);
    }
}).catch((erro) => { console.error(erro); app.exit(1); });
