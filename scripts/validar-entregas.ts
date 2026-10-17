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
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-validacao-entregas-'));
    app.setPath('userData', pasta);
    const persistencia = new Persistencia(pasta);
    const estado = estadoInicial();
    const liderId = randomUUID();
    const projetoId = randomUUID();
    estado.funcionarios = [{ id: liderId, nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa',
        contratadoEm: new Date().toISOString(), autonomia: false,
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo controlado' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }];
    estado.sala.itens = [{ id: 'mesa', tipo: 'mesa', celula: { x: 6, z: 5 }, rotacao: 0 }];
    estado.projetos = [{ id: projetoId, nome: 'Jardim de teste', pasta }];
    const janela = new BrowserWindow({
        show: false, width: 1440, height: 1000, backgroundColor: '#101c20',
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'),
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            offscreen: true, backgroundThrottling: false },
    });
    const erros: string[] = [];
    janela.webContents.on('console-message', (evento) => {
        if (evento.level === 'error') erros.push(evento.message);
    });
    const escritorio = new Escritorio(estado, (atual) => persistencia.salvar(atual),
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    let rodada = 0;
    escritorio['expediente']['abrirSessao'] = () => ({
        enviar: async (_prompt, ouvinte) => {
            rodada++;
            escritorio['orquestracao'].registrarValidacao(liderId, {
                resumo: rodada === 1 ? 'Falta validar a aparência.' : 'Critérios de teste atendidos.',
                criterios: [
                    { criterio: 'Fluxo principal', tipo: 'funcional', estado: 'verificado',
                        evidencia: 'Resultado controlado para validar o fluxo de aprovação.' },
                    { criterio: 'Visual em tela', tipo: 'visual', estado: rodada === 1 ? 'pendente' : 'verificado',
                        evidencia: rodada === 1 ? 'Navegador indisponível no cenário inicial.'
                            : 'Evidência simulada pelo harness controlado, sem avaliar projeto externo.' },
                ],
            });
            ouvinte.texto(rodada === 1 ? 'A execução terminou, mas a validação visual está pendente.'
                : 'Correção entregue com critérios registrados para sua avaliação.');
        }, encerrar: () => {},
    });
    registrarIpc(escritorio, () => janela);
    const executar = (codigo: string) => janela.webContents.executeJavaScript(codigo);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 100));
    const garantir = (condicao: unknown, mensagem: string) => {
        if (!condicao) throw new Error(mensagem);
    };
    const clicar = async (nome: string) => {
        await executar(`(() => {
            const botao = [...document.querySelectorAll('button')].find((item) =>
                item.textContent.trim() === ${JSON.stringify(nome)}
                || item.getAttribute('aria-label') === ${JSON.stringify(nome)});
            if (!botao || botao.disabled) throw new Error('Botão indisponível: ' + ${JSON.stringify(nome)});
            botao.click();
        })()`);
        await esperar();
    };
    const preencher = async (seletor: string, texto: string, tag = 'textarea') => {
        await executar(`(() => {
            const campo = document.querySelector(${JSON.stringify(seletor)});
            if (!campo) throw new Error('Campo ausente');
            const prototipo = ${tag === 'input' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}.prototype;
            Object.getOwnPropertyDescriptor(prototipo, 'value').set.call(campo, ${JSON.stringify(texto)});
            campo.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await esperar();
    };
    const aguardarTexto = async (texto: string) => {
        for (let tentativa = 0; tentativa < 40; tentativa++) {
            if (await executar(`document.body.textContent.includes(${JSON.stringify(texto)})`)) return;
            await esperar();
        }
        throw new Error(`Texto não exibido: ${texto}`);
    };
    const capturar = async (nome: string) =>
        writeFile(join('artifacts', nome), (await janela.webContents.capturePage()).toPNG());
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await aguardarTexto('Cláudio');
        await clicar('Geral');
        await clicar('Work');
        await preencher('aside textarea', 'Crie o visual do jardim');
        await clicar('Enviar trabalho');
        await aguardarTexto('Validação pendente');
        garantir(await executar("[...document.querySelectorAll('button')].find((b) => "
            + "b.textContent.trim() === 'Aprovar entrega').disabled"), 'Aprovação pendente não foi bloqueada.');
        const primeira = escritorio.publico().trabalhos[0]!;
        const negada = await executar(`window.lumon.aprovarEntrega(${JSON.stringify(primeira.id)})`);
        garantir(!negada.ok && escritorio.publico().moedas === estadoInicial().moedas,
            'Entrega pendente gerou recompensa.');
        await capturar('entregas-pendente.png');
        await clicar('Pedir correção');
        await preencher('textarea[aria-label="O que precisa ser corrigido"]', 'Valide a aparência em tela.');
        await clicar('Enviar correção');
        await aguardarTexto('Aguardando sua aprovação');
        await executar("[...document.querySelectorAll('details')].find((item) => "
            + "item.textContent.includes('Critérios e evidências') && item.textContent.includes('Critérios de teste'))"
            + ".open = true");
        await esperar();
        await executar("[...document.querySelectorAll('details[open]')].at(-1).scrollIntoView({ block: 'center' })");
        await esperar();
        await capturar('entregas-validada.png');
        await clicar('Aprovar entrega');
        await aguardarTexto('Entrega aprovada: 35 moedas');
        const corrigida = escritorio.publico().trabalhos.at(-1)!;
        garantir(corrigida.origemCorrecaoId === primeira.id, 'Vínculo da correção ausente.');
        await executar(`window.lumon.aprovarEntrega(${JSON.stringify(corrigida.id)})`);
        garantir(escritorio.publico().moedas === estadoInicial().moedas + 35, 'Recompensa duplicada.');
        await capturar('entregas-aprovada.png');
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        garantir(!('identidade' in salvo), 'Identidade pessoal antiga não foi descartada.');
        garantir(salvo.trabalhos.at(-1)?.avaliacao?.estado === 'aprovada', 'Aprovação não persistida.');
        garantir(erros.length === 0, `Erros na interface: ${erros.join('; ')}`);
        await writeFile('artifacts/entregas-validacao.json', JSON.stringify({
            pasta, ipc: true, preferencias: true, pendencia: true, correcao: true,
            aprovacao: true, recompensaUnica: true, persistencia: true, agentesReais: false, erros,
        }, null, 4));
        console.log('Entregas validadas no Electron com IPC real, persistência e harness controlado.');
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
