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

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-validar-historico-'));
    app.setPath('userData', pasta);
    const estado = estadoInicial();
    const id = randomUUID();
    estado.funcionarios = [{ id, nome: 'Ana', cargo: 'lider', mesaId: 'mesa', autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo de validação' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' } }];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 }];
    estado.demissoes = [{ id: randomUUID(), funcionario: { ...estado.funcionarios[0]!, id: randomUUID(),
        nome: 'Gepeto' }, motivo: 'Registro público da saída da equipe.', demitidoPor: 'Diretoria',
    data: new Date().toISOString(), evidencias: [], historicoSocial: [] }];
    estado.conversas[id] = [{ id: randomUUID(), autor: 'usuario', texto: 'Como foi o expediente?',
        criadaEm: new Date().toISOString(), ferramentas: [] }];
    const persistencia = new Persistencia(pasta);
    const janela = new BrowserWindow({ show: false, width: 1280, height: 900,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: true } });
    const escritorio = new Escritorio(estado, (atual) => persistencia.salvar(atual),
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    escritorio['agenda'].encerrar();
    const social = escritorio['social'];
    social.registrar({ tipo: 'sala', autorId: 'diretoria', texto: 'A sala recebeu uma nova cafeteira.',
        alcance: 'publico', ouvintes: [], fontes: [] }, false);
    const comunicado = social.registrar({ tipo: 'comunicado', autorId: 'diretoria',
        texto: 'A visita da Diretoria terminou.', alcance: 'publico', ouvintes: [], fontes: [] }, false);
    escritorio.atualizarPensamento(id, 'Estou satisfeita com a organização da sala.');
    registrarIpc(escritorio, () => janela);
    const executar = <T = unknown>(codigo: string): Promise<T> => janela.webContents.executeJavaScript(codigo);
    const esperar = async (condicao: () => Promise<boolean>) => {
        for (let tentativa = 0; tentativa < 80; tentativa++) {
            if (await condicao()) return;
            await new Promise((resolver) => setTimeout(resolver, 100));
        }
        throw new Error('A interface não atingiu o estado esperado.');
    };
    const clicar = (nome: string) => executar(`(() => {
        const botao = [...document.querySelectorAll('button')].find((item) =>
            item.getAttribute('aria-label') === ${JSON.stringify(nome)}
                || item.textContent.trim().startsWith(${JSON.stringify(nome)}));
        if (!botao) throw new Error('Botão indisponível');
        botao.click();
    })()`);
    const selecionar = (categoria: string) => executar(`(() => {
        const seletor = document.querySelector('[aria-label="Categoria do histórico"]');
        seletor.value = ${JSON.stringify(categoria)};
        seletor.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const visivel = (texto: string) => executar<boolean>(`document.body.innerText.includes(${JSON.stringify(texto)})`);
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await esperar(() => visivel('Ana'));
        await clicar('Histórico');
        await esperar(() => visivel('Demissão de Gepeto'));
        if (await visivel('Conversa com Gepeto')) throw new Error('Diálogo apagado reapareceu na interface.');
        await new Promise((resolver) => setTimeout(resolver, 200));
        await writeFile('artifacts/historico-geral.png', (await janela.webContents.capturePage()).toPNG());
        await selecionar('comunicados');
        await esperar(() => visivel('A visita da Diretoria terminou.'));
        await clicar('Excluir registro');
        await esperar(() => visivel('Excluir definitivamente este registro'));
        await clicar('Excluir definitivamente');
        await esperar(() => visivel('Nenhum registro encontrado.'));
        await persistencia.esquecerRevisoes();
        const salvo = await persistencia.carregar();
        if ([...salvo.social.eventos, ...salvo.social.historico, ...salvo.social.lembrancas]
            .some((evento) => evento.id === comunicado.id)) throw new Error('Exclusão não persistida.');
        await selecionar('conversas');
        await esperar(() => visivel('Conversa com Ana'));
        await esperar(() => visivel('Como foi o expediente?'));
        janela.setSize(760, 700);
        await selecionar('equipe');
        await esperar(() => visivel('Demissão de Gepeto'));
        await new Promise((resolver) => setTimeout(resolver, 500));
        await writeFile('artifacts/historico-estreito.png', (await janela.webContents.capturePage()).toPNG());
        await writeFile('artifacts/historico-validacao.json', JSON.stringify({
            categorias: true, exclusaoPorIpc: true, persistencia: true, conversaSeparada: true,
            conversaGepetoAusente: true, dadosTemporarios: true,
        }, null, 4));
        console.log('Histórico validado no Electron com categorias, exclusão, persistência e conversa separada.');
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
