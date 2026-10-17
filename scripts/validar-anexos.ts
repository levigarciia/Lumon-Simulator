import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarIpc } from '../electron/ipc';
import { Escritorio } from '../electron/services/escritorio';
import { Persistencia } from '../electron/services/persistencia';
import { estadoInicial } from '../shared/estado';
import { canalEventos } from '../shared/ponte';

function garantir(condicao: unknown, mensagem: string): asserts condicao {
    if (!condicao) throw new Error(mensagem);
}

app.whenReady().then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-anexos-'));
    app.setPath('userData', pasta);
    await mkdir('artifacts', { recursive: true });
    const estado = estadoInicial();
    estado.funcionarios = ['Helena', 'Pedro', 'Lia', 'Caio'].map((nome, indice) => ({
        id: randomUUID(), nome, cargo: indice === 3 ? 'conselheiro' : 'refinador',
        mesaId: `mesa${indice}`, contratadoEm: new Date().toISOString(), autonomia: false,
        modelo: { provedor: 'codex', id: 'controlado', nome: 'Validação controlada' },
        aparencia: { pele: '#e3b48f', cabelo: '#3b2a1e', estiloCabelo: 'curto', gravata: '#24364f' },
    }));
    estado.sala.itens = estado.funcionarios.map((pessoa, indice) => ({
        id: pessoa.mesaId, tipo: 'mesa', celula: { x: 1 + indice * 3, z: 4 }, rotacao: 0,
    }));
    const janela = new BrowserWindow({ show: false, width: 1800, height: 1100,
        webPreferences: { preload: join(process.cwd(), 'dist-electron/preload.cjs'), contextIsolation: true,
            sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    const erros: string[] = [];
    janela.webContents.on('console-message', (evento) => {
        if (evento.level === 'error') erros.push(evento.message);
    });
    const persistencia = new Persistencia(pasta);
    const escritorio = new Escritorio(estado, (atual) => persistencia.salvar(atual),
        (evento) => janela.webContents.send(canalEventos, evento), pasta);
    const simulacao = escritorio['simulacao'];
    simulacao.encerrar();
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    registrarIpc(escritorio, () => janela);
    const esperar = () => new Promise((resolver) => setTimeout(resolver, 500));
    const publicar = () => {
        janela.webContents.send(canalEventos, { tipo: 'estado', estado: escritorio.publico() });
        janela.webContents.send(canalEventos, { tipo: 'simulacao', quadro: {
            segundos: simulacao.segundosAtuais(), agentes: simulacao.agentes(),
        } });
    };
    const capturar = async (nome: string) => {
        publicar();
        await esperar();
        await writeFile(join('artifacts', nome), (await janela.webContents.capturePage()).toPNG());
    };
    try {
        await janela.loadFile(join(process.cwd(), 'dist/index.html'));
        await esperar();
        const [helena, pedro, lia, caio] = estado.funcionarios;
        garantir(helena && pedro && lia && caio, 'Equipe incompleta.');
        garantir(escritorio['pessoal'].enviarSalaDescanso(helena.id, 'Validação da caminhada.').ok,
            'Afastamento recusado.');
        let noCorredor = false;
        for (let passo = 0; passo < 1000; passo++) {
            simulacao.avancar(0.1);
            const agente = simulacao.agentes().find((pessoa) => pessoa.id === helena.id)!;
            if (agente.posicao.x > estado.sala.largura + 1 && agente.posicao.x < estado.sala.largura + 2) {
                noCorredor = true;
                break;
            }
        }
        garantir(noCorredor, 'Funcionária não percorreu o corredor.');
        await capturar('anexos-corredor.png');
        const sessao = escritorio['pessoal'].sessaoBemEstar(caio.id, lia.id, 'Como está seu dia?');
        for (let passo = 0; passo < 500; passo++) simulacao.avancar(0.1);
        garantir((await sessao).startsWith('Ação registrada ['), 'Sessão não foi entregue após a chegada.');
        garantir(simulacao.agentes().filter((pessoa) => pessoa.anexo === 'bem_estar').length === 2,
            'Os dois participantes precisam estar no cômodo.');
        garantir(simulacao.agentes().some((pessoa) => pessoa.anexo === 'sala_descanso'),
            'Funcionária não chegou à Sala de Descanso.');
        await capturar('anexos-ocupados.png');
        await persistencia.descarregar();
        const salvo = await persistencia.carregar();
        garantir(salvo.ausencias[lia.id]?.lugar !== salvo.ausencias[caio.id]?.lugar,
            'A sessão reservou o mesmo assento para duas pessoas.');
        for (let passo = 0; passo < 2500; passo++) simulacao.avancar(0.1);
        garantir(Object.keys(simulacao.todasAusencias()).length === 0, 'Retorno às mesas não foi concluído.');
        await capturar('anexos-retorno.png');
        garantir(erros.length === 0, `Erros de renderização: ${erros.join('; ')}`);
        await writeFile('artifacts/anexos-validacao.json', JSON.stringify({
            corredor: true, sessaoAposChegada: true, assentosDistintos: true, retorno: true,
            persistencia: true, dadosTemporarios: true, modelosReais: false, erros,
        }, null, 4));
        console.log('Anexos validados com Electron e estado temporário.');
    } finally {
        escritorio.encerrar();
        await persistencia.descarregar();
        janela.destroy();
        app.quit();
    }
}).catch((erro: unknown) => { console.error(erro); app.exit(1); });
