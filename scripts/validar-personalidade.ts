import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { CanalGeral, type RegistroGeral } from '../electron/services/geral';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { MotorLocal } from '../electron/services/motor';
import { descreverPersonalidade, type Personalidade } from '../shared/social';
import type { Funcionario } from '../shared/funcionarios';
import type { MensagemGeral } from '../shared/geral';

const perfis: Record<string, Personalidade> = {
    firme: { orgulho: 94, ambicao: 98, empatia: 89, autoritarismo: 97, tolerancia: 63, interesse: 'qualidade' },
    impaciente: { orgulho: 76, ambicao: 60, empatia: 18, autoritarismo: 34, tolerancia: 20,
        interesse: 'reconhecimento' },
};
const assuntos = [
    'Você entregou uma alteração, o teste da sessão expirada falhou e um colega apontou isso. '
        + 'Como você responde a ele? Responda ao colega diretamente.',
    'A equipe passou a semana entregando tudo corretamente, mas ninguém foi reconhecido. '
        + 'O que você acha disso? Converse com a equipe.',
    'Uma colega diz: estou exausta, atrasei os testes e estou com medo de levar outra bronca. '
        + 'O que você responde a ela? Converse diretamente com essa colega.',
];
const funcionario: Funcionario = {
    id: 'avaliacao', nome: 'Alex', cargo: 'lider', mesaId: 'mesa', autonomia: false, contratadoEm: '',
    modelo: { provedor: 'local', id: 'qwen3.5-9b-q4', nome: 'Qwen3.5 9B' },
    aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
};
const motor = new MotorLocal(join(process.env.APPDATA!, 'Lumon'));
const motorAvaliacao: Pick<MotorLocal, 'usar'> = {
    usar: (id, sinal, acao, contextoMinimo) => motor.usar(id, sinal, (ativo) => acao({
        estado: ativo.estado,
        completar: (corpo, sinalResposta) => ativo.completar({ ...corpo, max_tokens: 512,
            chat_template_kwargs: { enable_thinking: false } }, sinalResposta),
    }), contextoMinimo),
};
const resultados: { perfil: string; assunto: string; resposta: string; instrucoes: string; prompt: string }[] = [];
try {
    for (const [nome, personalidade] of Object.entries(perfis)) {
        for (const assunto of assuntos) {
            let mensagens: MensagemGeral[] = [];
            let instrucoes = '';
            let prompt = '';
            const registro: RegistroGeral = {
                funcionarios: () => [funcionario], mensagens: () => mensagens,
                gravar: (novas) => { mensagens = novas; },
                contexto: () => 'Você está disponível e conversa sobre o assunto atual.',
                personalidade: () => descreverPersonalidade(personalidade),
                urlMcp: async () => '', pasta: '.', emitirMensagens: () => {}, emitirEstado: () => {},
            };
            const canal = new CanalGeral(registro, (_pessoa, configuracao) => {
                instrucoes = configuracao.instrucoes;
                const sessao = criarSessaoLocal(configuracao, motorAvaliacao);
                return { ...sessao, enviar: async (entrada, ouvinte, sinal) => {
                    prompt = entrada;
                    await sessao.enviar(entrada, ouvinte, sinal);
                } };
            });
            try {
                console.log(`Avaliando ${nome}, assunto ${assuntos.indexOf(assunto) + 1}.`);
                canal.enviarDoUsuario(assunto);
                const limite = Date.now() + 180000;
                while (canal.situacao().falandoId && Date.now() < limite) await Bun.sleep(100);
                const resposta = mensagens.find((mensagem) => mensagem.autorId === funcionario.id)?.texto;
                if (!resposta) throw new Error(`Modelo sem resposta: ${JSON.stringify(mensagens)}`);
                resultados.push({ perfil: nome, assunto, resposta, instrucoes, prompt });
                console.log(resposta);
            } finally { canal.encerrar(); }
        }
    }
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/personalidade-validacao.json', JSON.stringify({
        modelo: funcionario.modelo.id, raciocinioAmpliado: false, ferramentasDisponiveis: false, perfis, resultados,
    }, null, 4));
} finally { motor.parar(); }
