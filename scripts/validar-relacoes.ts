import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lerJson } from '../electron/services/arquivosEstado';
import { CanalGeral } from '../electron/services/geral';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { contextoDoServidor } from '../electron/services/limitesMotor';
import { FilaMotor, type MotorLocal } from '../electron/services/motor';
import { Persistencia } from '../electron/services/persistencia';
import { DinamicaSocial } from '../electron/services/social';
import type { MensagemGeral } from '../shared/geral';
import { esquemaCatalogoEscritorios } from '../shared/partidas';
import { esquemaSocial } from '../shared/social';

const pastaDados = join(process.env.APPDATA!, 'lumon');
const catalogo = esquemaCatalogoEscritorios.parse(await lerJson(join(pastaDados, 'escritorios.json')));
const salvo = await new Persistencia(join(pastaDados, 'escritorios', catalogo.ativoId)).carregar(false);
const autor = salvo.funcionarios.find((pessoa) => pessoa.nome === 'Jamal');
const colega = salvo.funcionarios.find((pessoa) => pessoa.nome === 'Cláudio');
if (!autor || !colega) throw new Error('Jamal e Cláudio precisam existir na partida para esta avaliação.');
const relacao = salvo.social.relacoes.find((item) => item.autorId === autor.id && item.colegaId === colega.id);
if (!relacao) throw new Error('A relação de Jamal com Cláudio não foi encontrada.');
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
        if (minimo > contexto) throw new Error('O motor carregado não tem contexto suficiente.');
        return acao({ estado: { fase: 'pronto', detalhe: 'Avaliação isolada de relações', contexto },
            completar: (corpo, sinalResposta) => fetch(`${endereco}/v1/chat/completions`, {
                method: 'POST', headers: cabecalhos,
                body: JSON.stringify({ ...corpo, max_tokens: 512, temperature: 0.3, seed: 42 }),
                signal: sinalResposta,
            }) });
    }),
};
const cenarios = {
    atual: relacao,
    proxima: { ...relacao, afinidade: 90, confianca: 85, respeito: 80, ressentimento: 0 },
};
const assuntos = ['Jamal, o que achou da conversa de hoje?',
    'Jamal, você está exagerando. Não precisa transformar toda discordância em um problema pessoal.'];
const resultados = [];
for (const [cenario, visao] of Object.entries(cenarios)) {
    for (const assunto of assuntos) {
        let social = esquemaSocial.parse({ personalidades: salvo.social.personalidades, relacoes: [visao] });
        const dinamica = new DinamicaSocial({
            estado: () => social, funcionarios: () => [autor, colega], agentes: () => [],
            gravar: (estado) => { social = estado; }, notificar: () => {}, estressar: () => {},
            decidir: () => ({ ok: true }),
        });
        let mensagens: MensagemGeral[] = [{ id: 'fala-colega', autorId: colega.id,
            texto: assunto, criadaEm: new Date().toISOString(), ferramentas: [] }];
        let prompt = '';
        const canal = new CanalGeral({
            funcionarios: () => [autor, colega], mensagens: () => mensagens,
            gravar: (novas) => { mensagens = novas; },
            contexto: (id) => dinamica.contexto(id, 'social', false),
            personalidade: (id) => dinamica.personalidade(id),
            disponivel: (id) => id === autor.id, urlMcp: async () => '', pasta: '.',
            emitirMensagens: () => {}, emitirEstado: () => {},
        }, (_pessoa, configuracao) => {
            const sessao = criarSessaoLocal(configuracao, motor);
            return { ...sessao, enviar: async (entrada, ouvinte, sinal, opcoes) => {
                prompt = entrada;
                await sessao.enviar(entrada, ouvinte, sinal, opcoes);
            } };
        });
        try {
            console.log(`Avaliando ${cenario}: ${assunto}`);
            canal.notificar([autor.id], `${colega.nome} disse a você: ${assunto}`);
            await Bun.sleep(10);
            const prazo = Date.now() + 180000;
            while (canal.situacao().falandoId && Date.now() < prazo) await Bun.sleep(100);
            const fala = mensagens.find((mensagem) => mensagem.autorId === autor.id)?.texto;
            const erro = mensagens.find((mensagem) => mensagem.autorId === 'sistema')?.texto;
            if (!fala) throw new Error(erro ?? 'O modelo não publicou uma fala neste cenário.');
            resultados.push({ cenario, relacao: visao, assunto, fala, prompt });
            console.log(fala);
        } finally { canal.encerrar(); }
    }
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/relacoes-validacao.json', JSON.stringify({
    modelo: autor.modelo.id, personalidade: salvo.social.personalidades[autor.id],
    estadoDoUsuarioAlterado: false, resultados,
}, null, 4));
