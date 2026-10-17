import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CanalGeral } from '../electron/services/geral';
import { criarSessaoLocal } from '../electron/services/harness/local';
import { MotorLocal } from '../electron/services/motor';
import { ServidorMcp } from '../electron/services/mcp';
import type { Funcionario } from '../shared/funcionarios';
import type { MensagemGeral } from '../shared/geral';

const motor = new MotorLocal(join(process.env.APPDATA ?? homedir(), 'Lumon'));
const aparencia = { pele: '#c68e64', cabelo: '#9a9a96', estiloCabelo: 'curto' as const, gravata: '#121212' };
const equipe: Funcionario[] = [
    { id: 'claudio', nome: 'Cláudio', cargo: 'lider', mesaId: 'mesa1', autonomia: false,
        modelo: { provedor: 'local', id: 'qwen3.5-4b-q4', nome: 'Qwen3.5 4B' }, aparencia, contratadoEm: '' },
    { id: 'gepeto', nome: 'Gepeto', cargo: 'desenvolvedor', mesaId: 'mesa2', autonomia: false,
        modelo: { provedor: 'local', id: 'qwen3.5-2b-q4', nome: 'Qwen3.5 2B' }, aparencia, contratadoEm: '' },
];
let mensagens: MensagemGeral[] = [
    { id: 'anterior1', autorId: 'usuario', texto: 'Bom dia rapaziada', criadaEm: '', ferramentas: [] },
    { id: 'anterior2', autorId: 'claudio', texto: 'Bom dia. @Gepeto, bom dia também.',
        criadaEm: '', ferramentas: [] },
    { id: 'anterior3', autorId: 'gepeto', texto: 'Já tentei cobrar, mas o ID do Cláudio não apareceu.',
        criadaEm: '', ferramentas: [] },
];
let inferencias = 0;
let falas = 0;
let falasPorFerramenta = 0;
const ferramentas: string[] = [];
let concluir!: () => void;
let falhar!: (erro: unknown) => void;
const concluido = new Promise<void>((resolver, rejeitar) => { concluir = resolver; falhar = rejeitar; });
const servidor = new ServidorMcp({
    verEscritorio: () => 'Colegas: Gepeto [ID gepeto] (Desenvolvedor). A equipe ainda não recebeu tarefas hoje.',
    fazerPausa: async () => 'Não há itens de pausa neste cenário.',
    falarNoGeral: (id, texto) => { falasPorFerramenta++; return canal.falarDoAgente(id, texto); },
    atualizarPensamento: () => 'Pensamento salvo.',
    delegar: async () => 'Delegação indisponível no Geral.',
    interagir: () => 'Consulte os acontecimentos antes de cobrar um colega. Não há trabalho pendente.',
});
const canal = new CanalGeral({
    funcionarios: () => equipe, mensagens: () => mensagens, gravar: (novas) => { mensagens = novas; }, disponivel: (id) => id === 'claudio',
    contexto: () => 'Você está no Geral. Nenhum trabalho está em andamento.',
    registrarFala: () => { falas++; },
    urlMcp: (id) => servidor.urlDe(id, 'geral'), pasta: process.cwd(),
    emitirMensagens: () => {}, emitirEstado: () => {},
}, (_funcionario, configuracao) => {
    const sessao = criarSessaoLocal(configuracao, { usar: (id, sinal, acao) => motor.usar(id, sinal, (ativo) => acao({
        estado: ativo.estado,
        completar: (corpo, sinalInferencia) => {
            inferencias++;
            return ativo.completar(corpo, sinalInferencia);
        },
    })) });
    return { encerrar: sessao.encerrar, enviar: async (prompt, ouvinte, sinal) => {
        try {
            await sessao.enviar(prompt, { ...ouvinte, iniciarFerramenta: (id, resumo, entrada) => {
                ferramentas.push(resumo);
                ouvinte.iniciarFerramenta(id, resumo, entrada);
            } }, AbortSignal.any([sinal, AbortSignal.timeout(180000)]));
            concluir();
        } catch (erro) { falhar(erro); throw erro; }
    } };
});

try {
    canal.enviarDoUsuario('@claudio c vai deixar teu funcionario se comportar assim?');
    await concluido;
    await Bun.sleep(0);
    if (falas !== 1) throw new Error(`Esperada uma fala pública, recebidas ${falas}.`);
    const publicadas = mensagens.slice(4).filter((mensagem) => mensagem.autorId === 'claudio');
    if (publicadas.length !== 1) throw new Error('A conversa publicou respostas adicionais.');
    const relatorio = { modelo: equipe[0]!.modelo.id, backend: motor.estado.backend, inferencias,
        falas, falasPorFerramenta, ferramentas, resposta: publicadas[0]!.texto };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/conversa-local-validacao.json', JSON.stringify(relatorio, null, 4));
    console.log(JSON.stringify(relatorio, null, 4));
} finally {
    canal.encerrar();
    servidor.encerrar();
    motor.parar();
}
