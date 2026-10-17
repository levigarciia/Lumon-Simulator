import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Escritorio } from '../electron/services/escritorio';
import { FilaMotor, type MotorLocal } from '../electron/services/motor';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { contextoDoServidor } from '../electron/services/limitesMotor';
import { estadoInicial } from '../shared/estado';
import { esquemaCatalogoEscritorios } from '../shared/partidas';
import { Persistencia } from '../electron/services/persistencia';
import { lerJson } from '../electron/services/arquivosEstado';
import { progressoRefinamento } from '../shared/refinamento';

const pastaDados = join(process.env.APPDATA!, 'lumon');
const catalogo = await lerJson(join(pastaDados, 'escritorios.json'));
const pastaSalva = catalogo ? join(pastaDados, 'escritorios', esquemaCatalogoEscritorios.parse(catalogo).ativoId)
    : pastaDados;
const salvo = await new Persistencia(pastaSalva).carregar(false);
const original = Object.values(salvo.refinamentos).at(-1);
if (!original) throw new Error('Nenhum arquivo salvo para reproduzir.');
const comando = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-CimInstance Win32_Process -Filter \"Name = 'llama-server.exe'\" | Select-Object -First 1).CommandLine"],
{ encoding: 'utf8' });
const porta = comando.match(/--port\s+(\d+)/)?.[1];
const chave = comando.match(/--api-key\s+(\S+)/)?.[1];
if (!porta || !chave) throw new Error('Motor local já carregado não encontrado.');
const endereco = `http://127.0.0.1:${porta}`;
const cabecalhos = { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };
const resposta = await fetch(`${endereco}/props`, { headers: cabecalhos });
if (!resposta.ok) throw new Error('Não foi possível consultar o motor carregado.');
const contexto = contextoDoServidor(await resposta.json());
const fila = new FilaMotor();
const motor: Pick<MotorLocal, 'usar'> = {
    usar: (_modelo, sinal, acao, minimo = 2048) => fila.executar(sinal, () => {
        if (minimo > contexto) throw new Error('Motor carregado sem contexto suficiente para esta avaliação.');
        return acao({ estado: { fase: 'pronto', detalhe: 'Avaliação isolada', contexto },
            completar: (corpo, signal) => fetch(`${endereco}/v1/chat/completions`, {
                method: 'POST', headers: cabecalhos, body: JSON.stringify(corpo), signal,
            }) });
    }),
};
const pasta = await mkdtemp(join(tmpdir(), 'lumon-refinamento-local-'));
const somenteEtapas = process.argv.includes('--etapas');
const inicio = Date.now();
const estado = estadoInicial();
estado.funcionarios = salvo.funcionarios;
estado.sala = salvo.sala;
estado.social.personalidades = salvo.social.personalidades;
const projeto = { id: crypto.randomUUID(), nome: 'Macrodados', pasta };
estado.projetos = [projeto];
const arquivo = { ...original, grupos: original.grupos.map(({ celulas, temperamento }) => ({ celulas, temperamento })),
    tentativas: {}, envios: [], prazo: new Date(Date.now() + 5 * 60000).toISOString() };
estado.refinamentos = { [arquivo.id]: arquivo };
const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
escritorio['expediente']['abrirSessao'] = (_pessoa, configuracao) => criarSessaoLocal(configuracao, motor);
escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
try {
    const resultado = escritorio['orquestracao'].enviar(projeto.id,
        `Refine o arquivo ${arquivo.nome}. Prazo: ${arquivo.prazo}.`, 'principal', undefined, arquivo.id);
    if (!resultado.ok) throw new Error(resultado.erro);
    const limite = Date.now() + 6 * 60000;
    let ultimaOrdem = 0;
    while (Date.now() < limite) {
        await Bun.sleep(500);
        const trabalhos = escritorio.publico().trabalhos;
        for (const trabalho of trabalhos) {
            for (const evento of trabalho.eventos ?? []) {
                if (evento.ordem <= ultimaOrdem || evento.parte.tipo !== 'ferramenta'
                    || evento.parte.ferramenta.estado === 'rodando') continue;
                ultimaOrdem = Math.max(ultimaOrdem, evento.ordem);
                console.log(`${trabalho.nome}: ${evento.parte.ferramenta.resumo}`);
            }
        }
        if (!trabalhos.some((item) => item.estado === 'trabalhando')) break;
        const colegas = estado.funcionarios.filter((item) => item.cargo !== 'lider');
        if (somenteEtapas && colegas.every((pessoa) => trabalhos.some((item) =>
            item.funcionarioId === pessoa.id && item.estado !== 'trabalhando'))
            && progressoRefinamento(escritorio.publico().refinamentos[arquivo.id]!) > 0) break;
    }
    escritorio.interromperTrabalho();
    await Bun.sleep(500);
    const atual = escritorio.publico();
    const final = atual.refinamentos[arquivo.id]!;
    const relatorio = { modelo: estado.funcionarios[0]?.modelo.id, arquivo: arquivo.nome,
        duracaoMs: Date.now() - inicio, somenteEtapas,
        estadoIsolado: true, motorJaCarregado: true, progresso: progressoRefinamento(final),
        tentativas: final.tentativas, envios: final.envios,
        trabalhos: atual.trabalhos.map((item) => ({ nome: item.nome, estado: item.estado,
            solicitante: item.solicitante, resultado: item.resultado, eventos: item.eventos })),
    };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/refinamento-local.json', JSON.stringify(relatorio, null, 4));
    console.log(JSON.stringify({ progresso: relatorio.progresso,
        participantes: relatorio.trabalhos.map((item) => item.nome), tentativas: final.tentativas }));
} finally { escritorio.encerrar(); }
