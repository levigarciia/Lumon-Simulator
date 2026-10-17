import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-controles-geral-'));
    app.setPath('userData', pasta);
    const estado = estadoInicial();
    estado.funcionarios = ['Cláudio', 'Gwen'].map((nome, indice) => ({
        id: crypto.randomUUID(), nome, cargo: indice === 0 ? 'lider' : 'desenvolvedor', mesaId: `mesa${indice}`,
        contratadoEm: '', autonomia: false, modelo: { provedor: 'codex', id: 'teste', nome: 'Teste' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const janela = new BrowserWindow({ show: false, width: 1100, height: 800,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    let concluirFala: (() => void) | undefined;
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte, sinal) => new Promise<void>((resolver) => {
            concluirFala = () => { ouvinte.texto('Estou bem. Terminei meu raciocínio.'); resolver(); };
            if (sinal.aborted) resolver();
            else sinal.addEventListener('abort', () => resolver(), { once: true });
        }), encerrar: () => {},
    });
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 100));
    const garantir = (valor: unknown, mensagem: string) => { if (!valor) throw new Error(mensagem); };
    const clicar = async (nome: string) => {
        await executar(`(() => {
            const botao = [...document.querySelectorAll('button')].find((item) =>
                item.textContent.trim() === ${JSON.stringify(nome)}
                || item.getAttribute('aria-label') === ${JSON.stringify(nome)});
            if (!botao) throw new Error('Controle ausente');
            botao.click();
        })()`);
        await esperar();
    };
    try {
        await mkdir('artifacts', { recursive: true });
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        for (let tentativa = 0; tentativa < 60; tentativa++) {
            if (await executar("!!document.querySelector('ul button')")) break;
            await esperar();
        }
        await clicar('Geral');
        await clicar('Conversa sem limite de turnos');
        garantir(escritorio.publico().geral.semLimite, 'O controle não ativou o modo infinito.');
        escritorio.enviarGeral('Como vocês estão?');
        await esperar();
        garantir(await executar("document.querySelector('aside').textContent.includes('Encerrar conversa')"),
            'Uma mensagem comum não mudou o botão para encerrar.');
        const limites = await executar(`(() => {
            const painel = document.querySelector('aside').getBoundingClientRect();
            const botao = document.querySelector('[aria-label="Conversa sem limite de turnos"]');
            const limite = botao.getBoundingClientRect();
            return botao.getAttribute('aria-pressed') === 'true'
                && limite.left >= painel.left && limite.right <= painel.right;
        })()`);
        garantir(limites, 'O controle de infinito está desativado ou fora do painel.');
        await writeFile('artifacts/controles-geral-ativo.png', (await janela.webContents.capturePage()).toPNG());
        await clicar('Encerrar conversa');
        garantir(escritorio.publico().geral.encerrando, 'O encerramento não aguardou a fala atual.');
        garantir(await executar("[...document.querySelectorAll('button')].some((item) => "
            + "item.textContent.includes('Encerrando conversa') && item.disabled)"),
            'O painel não sinalizou o encerramento em andamento.');
        await writeFile('artifacts/controles-geral-encerrando.png', (await janela.webContents.capturePage()).toPNG());
        concluirFala?.();
        await esperar();
        garantir(!escritorio.publico().geral.conversaAtiva, 'A conversa permaneceu ativa após encerrar.');
        garantir(await executar("document.querySelector('aside').textContent.includes('Conversa livre')"),
            'O botão não voltou ao estado inicial.');
        garantir(escritorio.mensagensGeral().length === 2, 'O histórico não preservou a conclusão da fala.');
        await writeFile('artifacts/controles-geral-encerrado.png', (await janela.webContents.capturePage()).toPNG());
        await writeFile('artifacts/controles-geral.json', JSON.stringify({ modoInfinito: true,
            mensagemAtivaConversa: true, encerramentoGradual: true, historicoPreservado: true }, null, 4));
        console.log('Controles do Geral validados.');
    } finally { escritorio.encerrar(); janela.destroy(); app.quit(); }
}).catch((erro) => { console.error(erro); app.exit(1); });
