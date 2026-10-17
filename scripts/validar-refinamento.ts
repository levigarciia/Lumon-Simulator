import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Escritorio } from '../electron/services/escritorio';
import { registrarIpc } from '../electron/ipc';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-refinamento-'));
    app.setPath('userData', pasta);
    const estado = estadoInicial();
    estado.projetos = [{ id: 'projeto-antigo', nome: 'Projeto externo', pasta: join(pasta, 'externo') }];
    estado.trabalhos = [{
        id: 'trabalho-antigo', pedidoId: 'pedido-antigo', funcionarioId: 'funcionario-antigo',
        nome: 'Antigo', projetoId: 'projeto-antigo', tarefa: 'Pedido real preservado',
        resultado: 'Resultado antigo', estado: 'concluido', criadoEm: new Date().toISOString(),
    }];
    estado.funcionarios = [{
        id: randomUUID(), nome: 'Helena', cargo: 'lider', mesaId: 'mesa', autonomia: false,
        contratadoEm: new Date().toISOString(), modelo: { provedor: 'codex', id: 'teste', nome: 'Teste' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 }];
    const janela = new BrowserWindow({ show: false, width: 1440, height: 900,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, offscreen: true } });
    const escritorio = new Escritorio(estado, () => {},
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    escritorio['expediente']['abrirSessao'] = (pessoa) => ({
        enviar: async (_prompt, ouvinte) => {
            const arquivo = escritorio['arquivoAtivo'](pessoa.id)!;
            await new Promise((resolver) => setTimeout(resolver, 500));
            const grupo = arquivo.grupos[0]!;
            escritorio['refinarArquivo'](pessoa.id, grupo.celulas, grupo.temperamento);
            await new Promise((resolver) => setTimeout(resolver, 500));
            ouvinte.texto('Arquivo recebido para refinamento.');
        },
        encerrar: () => {},
    });
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const clicar = async (texto: string) => executar(`(() => {
        const botao = [...document.querySelectorAll('button')].find((item) =>
            item.textContent.trim() === ${JSON.stringify(texto)}
                || item.getAttribute('title') === ${JSON.stringify(texto)});
        if (!botao) throw new Error('Controle ausente: ' + ${JSON.stringify(texto)});
        botao.click();
    })()`);
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await new Promise((resolver) => setTimeout(resolver, 1500));
        await clicar('Geral');
        await clicar('Work');
        const conferirInterface = async () => {
            if (await executar(`Boolean(document.querySelector('select[aria-label="Projeto"]')
                || document.querySelector('button[aria-label="Adicionar projeto"]')
                || document.querySelector('[aria-label="Threads"]')
                || document.querySelector('textarea[placeholder="O que a equipe precisa fazer?"]'))`)) {
                throw new Error('O Work ainda oferece controles de trabalho externo.');
            }
            if (await executar("document.querySelector('aside').textContent.includes('Pedido real preservado')")) {
                throw new Error('O histórico externo apareceu no refinamento.');
            }
        };
        await conferirInterface();
        await mkdir('artifacts', { recursive: true });
        await writeFile('artifacts/refinamento-vazio.png', (await janela.webContents.capturePage()).toPNG());
        await clicar('Iniciar macrodados');
        await new Promise((resolver) => setTimeout(resolver, 100));
        if (!await executar(`Boolean(document.querySelector('select[aria-label="Duração do refinamento"]').disabled)
            && [...document.querySelectorAll('button')].some((item) =>
                item.textContent.trim() === 'Interromper refinamento')`)) {
            throw new Error('O refinamento ativo não bloqueou o início nem ofereceu interrupção.');
        }
        await new Promise((resolver) => setTimeout(resolver, 1100));
        await conferirInterface();
        if (!await executar(`document.querySelectorAll('[data-celula]').length === 80
            && document.querySelectorAll('[data-refinada="true"]').length === 3
            && document.querySelectorAll('[data-selecionada="true"][data-celula]').length === 3
            && document.querySelector('[aria-label="Progresso do arquivo"]').value === 1`)) {
            throw new Error('O terminal não acompanha os grupos aceitos pela equipe.');
        }
        if (escritorio.publico().cota.grupos !== 0) throw new Error('Cota creditada antes da aprovação.');
        await writeFile('artifacts/refinamento-terminal.png', (await janela.webContents.capturePage()).toPNG());
        await clicar('Histórico');
        if (!await executar("document.querySelector('aside').textContent.includes('Arquivo recebido')")) {
            throw new Error('O pedido iniciado não apareceu no Work.');
        }
        await mkdir('artifacts', { recursive: true });
        await writeFile('artifacts/refinamento-work.png', (await janela.webContents.capturePage()).toPNG());
        await clicar('Rejeitar trabalho');
        await executar(`(() => {
            const campo = document.querySelector('textarea[aria-label="Motivo da rejeição"]');
            if (!campo) throw new Error('Motivo da rejeição ausente.');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
                campo, 'A Diretoria não estava satisfeita');
            campo.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await new Promise((resolver) => setTimeout(resolver, 150));
        await executar("document.querySelector('textarea[aria-label=\"Motivo da rejeição\"]').scrollIntoView()");
        await new Promise((resolver) => setTimeout(resolver, 150));
        await writeFile('artifacts/refinamento-rejeitar.png', (await janela.webContents.capturePage()).toPNG());
        await clicar('Confirmar rejeição');
        await new Promise((resolver) => setTimeout(resolver, 300));
        const rejeitado = escritorio.publico().trabalhos.find((item) => item.arquivoId);
        if (rejeitado?.avaliacao?.estado !== 'reprovada'
            || rejeitado.avaliacao.motivo !== 'A Diretoria não estava satisfeita') {
            throw new Error('A rejeição pela interface não chegou ao estado do escritório.');
        }
        if (escritorio.publico().cota.grupos !== 0) throw new Error('A rejeição creditou a cota.');
        await writeFile('artifacts/refinamento-rejeitado.png', (await janela.webContents.capturePage()).toPNG());
        if (!escritorio.publico().trabalhos.some((item) => item.id === 'trabalho-antigo')) {
            throw new Error('O histórico externo não foi preservado.');
        }
        await clicar('Iniciar macrodados');
        await new Promise((resolver) => setTimeout(resolver, 100));
        await clicar('Interromper refinamento');
        await new Promise((resolver) => setTimeout(resolver, 1100));
        if (escritorio.publico().trabalhos.some((item) => item.arquivoId && item.estado === 'trabalhando')) {
            throw new Error('A interrupção pela interface não encerrou o refinamento.');
        }
        await clicar('Iniciar macrodados');
        await new Promise((resolver) => setTimeout(resolver, 1200));
        await clicar('Histórico');
        await executar(`(() => {
            const botoes = [...document.querySelectorAll('button')].filter((item) =>
                item.textContent.trim() === 'Aprovar entrega' && !item.disabled);
            botoes.at(-1).click();
        })()`);
        await new Promise((resolver) => setTimeout(resolver, 200));
        if (escritorio.publico().cota.grupos !== 1) throw new Error('A aprovação não creditou um grupo na cota.');
        await clicar('Terminal');
        if (!await executar(`document.querySelector('[aria-label="Progresso da cota diária"]').value === 1`)) {
            throw new Error('A cota aprovada não apareceu na interface.');
        }
        await new Promise((resolver) => setTimeout(resolver, 200));
        await writeFile('artifacts/refinamento-cota.png', (await janela.webContents.capturePage()).toPNG());
        await executar(`(() => {
            const comunicado = document.querySelector('[aria-label="Comunicado da Diretoria"]');
            if (!comunicado.textContent.includes('A Diretoria reconhece seu progresso')) {
                throw new Error('O comunicado não reagiu à cota aprovada.');
            }
            comunicado.querySelector('details').open = true;
            comunicado.scrollIntoView({ block: 'end' });
        })()`);
        await new Promise((resolver) => setTimeout(resolver, 200));
        await writeFile('artifacts/refinamento-doutrina.png', (await janela.webContents.capturePage()).toPNG());
        await janela.setSize(390, 760);
        await new Promise((resolver) => setTimeout(resolver, 200));
        if (!await executar(`(() => {
            const painel = document.querySelector('aside');
            return painel.scrollWidth <= painel.clientWidth;
        })()`)) throw new Error('O painel estreito tem transbordamento horizontal.');
        await writeFile('artifacts/refinamento-estreito.png', (await janela.webContents.capturePage()).toPNG());
        console.log('Refinamento validado pelo controle da interface e IPC real em estado temporário.');
    } finally {
        escritorio.encerrar();
        janela.destroy();
        app.quit();
    }
}).catch((erro) => { console.error(erro); app.exit(1); });
