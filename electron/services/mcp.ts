import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { esquemaValidacaoEntrega, type ValidacaoEntrega } from '../../shared/trabalho';
import { tiposItem, type Atividade, type TipoItem } from '../../shared/escritorio';
import { temperamentos, type Temperamento } from '../../shared/refinamento';
import type { Intencao } from '../../shared/intencoes';
import type { CargoAtual, Cargo } from '../../shared/cargos';
import { tiposIncentivo, type TipoIncentivo } from '../../shared/incentivos';
import {
    acoesSociais, reacoesSociais, tiposProposta, esquemaFiltroHistorico, esquemaEventoSocial,
    type AcaoSocial, type ReacaoSocial, type TipoProposta, type FiltroHistorico,
} from '../../shared/social';

const limiteCorpo = 256 * 1024;

/** Nome do servidor visto pelos harnesses. As ferramentas aparecem como `mcp__lumon__<nome>` no Claude. */
export const nomeServidorMcp = 'lumon';

/**
 * De onde vem a chamada. No Geral e reservado a pausa confirma o início; Work e chat aguardam o fim.
 * No Geral, texto normal é fala pública; nos demais canais, `falar_no_geral` leva uma fala ao Geral.
 */
export type OrigemMcp = 'trabalho' | 'chat' | 'geral' | 'reservado';

/** Turnos de convivência do canal Geral, públicos ou num diálogo reservado. */
export function origemSocial(origem?: OrigemMcp): boolean {
    return origem === 'geral' || origem === 'reservado';
}

/** O que as ferramentas do escritório podem fazer, sempre em nome de um funcionário identificado pelo token. */
export type AcoesEscritorio = {
    verEscritorio: (funcionarioId: string) => string;
    fazerPausa: (funcionarioId: string, atividade: Atividade, minutos: number, origem: OrigemMcp) => Promise<string>;
    falarNoGeral: (funcionarioId: string, mensagem: string) => string;
    falarComResponsavel?: (funcionarioId: string, mensagem: string) => string;
    atualizarPensamento: (funcionarioId: string, pensamento: string) => string;
    silenciar?: (funcionarioId: string) => string;
    delegar: (liderId: string, destino: string, tarefa: string) => Promise<string>;
    interagir?: (
        id: string, destino: string, acao: AcaoSocial | 'reservado', mensagem: string,
        alcance: 'publico' | 'local' | 'reservado', fontes: string[], sobreId?: string, origem?: OrigemMcp,
    ) => string | Promise<string>;
    reagir?: (id: string, eventoId: string | undefined, reacao: ReacaoSocial, motivo: string, pessoaId?: string) => string;
    propor?: (
        id: string, alvo: string, tipo: TipoProposta, motivo: string, evidencias: string[], candidato?: string,
    ) => string;
    escolherCarreira?: (id: string, cargo: CargoAtual) => string;
    apoiar?: (id: string, propostaId: string, fonteId: string) => string;
    consultar?: (id: string, eventoId: string) => string;
    consultarHistorico?: (
        id: string, busca: string, tipo: string | undefined, limite: number, filtros: FiltroHistorico,
    ) => string;
    revisar?: (id: string, trabalhoId?: string) => string;
    refazer?: (id: string, trabalhoId: string, motivo: string) => Promise<string>;
    validarEntrega?: (id: string, validacao: ValidacaoEntrega) => string;
    abrirArquivo?: (id: string) => string;
    refinar?: (id: string, celulas: string[], temperamento: Temperamento) => string;
    comprarItem?: (id: string, tipo: TipoItem) => string;
    consertarItem?: (id: string, itemId: string) => string;
    planejar?: (id: string, colega: string, objetivo: Intencao['objetivo'], motivo: string, fonte: string) => string;
    cancelarIntencao?: (id: string, intencao: string, motivo: string) => string;
    autorizarFerramenta?: (id: string, origem: OrigemMcp, nome: string) => string | undefined;
    estadoEtapa?: (id: string) => { codigo: string; terminal: boolean };
    incentivar?: (id: string, tipo: TipoIncentivo, motivo: string, alvoId?: string) => string;
    sessaoBemEstar?: (id: string, alvoId: string, mensagem: string) => Promise<string>;
    cargo?: (id: string) => Cargo | undefined;
};

type Credencial = { funcionarioId: string; origem: OrigemMcp };

const atividadesPausa = ['cafe', 'comendo', 'descansando', 'ouvindo_musica'] as const;

function texto(conteudo: string, estado = { codigo: 'concluida', terminal: false }) {
    return { content: [{ type: 'text' as const, text: conteudo }], structuredContent: { ...estado } };
}

function criarServidor({ funcionarioId, origem }: Credencial, acoes: AcoesEscritorio): McpServer {
    const servidor = new McpServer({ name: nomeServidorMcp, version: '0.1.0' });
    if (acoes.consultarHistorico) servidor.registerTool('consultar', {
        description: 'Pesquisa demissões, memórias, falas, acontecimentos e seus pensamentos privados anteriores. '
            + 'Use categoria pensamentos para pesquisar só sua memória íntima; nunca lê pensamentos alheios. '
            + 'Filtre por assunto, tipo, funcionário (nome ou ID) e período ISO com fuso. '
            + 'Retorna uma página de resumos, não todo o arquivo. Para detalhes, use detalhar true e limite 1. '
            + 'Continue com proximoDeslocamento. Só mostra registros conhecidos, sem consumir novidades. '
            + 'Não encerra sua vez: examine o retorno e continue consultando ou decida como concluir. '
            + 'Histórico não é pedido ativo.',
        inputSchema: { busca: z.string().trim().max(200).default(''), tipo: esquemaEventoSocial.shape.tipo.optional(),
            limite: z.number().int().min(1).max(30).default(5), ...esquemaFiltroHistorico.shape },
    }, async (dados) => texto(acoes.consultarHistorico!(funcionarioId, dados.busca, dados.tipo, dados.limite, dados)));
    const retorno = origemSocial(origem)
        ? 'Confirma o início e passa a vez; o corpo continua em pausa até terminar os minutos reais. '
        : 'A ferramenta aguarda o fim da pausa. ';
    const fontes = z.array(z.string().min(1).max(80)).max(5).default([])
        .describe('IDs de acontecimentos conhecidos exibidos por ver_escritorio. Não use IDs de pessoas ou trabalhos.');
    const mensagem = z.string().trim().min(1).max(600).describe('Texto da fala, com no máximo 600 caracteres.');
    const identificador = z.string().min(1).max(80);
    const funcionario = identificador.describe('ID exato do funcionário exibido por ver_escritorio. Não use o nome.');
    const sobre = funcionario.optional()
        .describe('ID de uma terceira pessoa citada. Omita se não houver. Não é assunto nem ID de trabalho.');
    if (acoes.planejar) servidor.registerTool('planejar_acao', {
        description: 'Mantém até três intenções privadas entre turnos. Não executa a ação. '
            + 'O compromisso só é cumprido depois da ação real com esse colega.',
        inputSchema: { funcionario, objetivo: z.enum(['reconciliar', 'conversar', 'defender', 'elogiar']),
            motivo: mensagem, fonte: identificador },
    }, async (dados) => texto(acoes.planejar!(funcionarioId, dados.funcionario, dados.objetivo,
        dados.motivo, dados.fonte)));
    if (acoes.cancelarIntencao) servidor.registerTool('cancelar_intencao', {
        description: 'Abandona uma intenção sua que ainda esteja pendente, preservando o motivo.',
        inputSchema: { intencao: identificador, motivo: mensagem },
    }, async (dados) => texto(acoes.cancelarIntencao!(funcionarioId, dados.intencao, dados.motivo)));
    if (acoes.interagir) {
        servidor.registerTool('interagir_socialmente', {
            description: 'Executa cobrança ou repreensão (acao cobrar), contestação, elogio, desculpa, defesa ou fofoca. '
                + 'Disponível também no chat Geral. Consulte ver_escritorio para obter IDs de colegas e fontes. '
                + 'Exige IDs de fontes '
                + 'conhecidas. Público: toda equipe; local: próximos a até três células; reservado: só o destinatário. '
                + 'A fala e os efeitos nas relações são persistidos. Fofoca mantém autoria e não comprova alegações. '
                + 'No Geral, ação pública, elogio ou cobrança conclui sua participação: não repita nem publique outra fala.',
            inputSchema: { funcionario, acao: z.enum(acoesSociais), mensagem,
                alcance: z.enum(['publico', 'local', 'reservado']), fontes, sobre },
        }, async (dados) => {
            const resultado = await acoes.interagir!(funcionarioId, dados.funcionario, dados.acao,
                dados.mensagem, dados.alcance, dados.fontes, dados.sobre, origem);
            const ok = resultado.startsWith('Ação registrada [') || resultado.startsWith('Ação já registrada.');
            return { ...texto(resultado, { codigo: ok ? 'interacao_aplicada' : 'interacao_recusada',
                terminal: ok && origemSocial(origem)
                    && (dados.alcance === 'publico' || ['elogiar', 'cobrar'].includes(dados.acao)) }), isError: !ok };
        });
        servidor.registerTool('conversar_reservado', {
            description: 'Puxa um colega para uma conversa a sós, por iniciativa própria, sem esperar pedido. '
                + 'Use para desabafar, tirar uma dúvida sobre alguém, comentar um acontecimento, pedir conselho, '
                + 'fazer as pazes, fofocar, buscar aliados ou compartilhar propostas. '
                + 'Vocês caminham até um canto; se dividem um item de pausa, conversam ali sem interromper o uso. '
                + 'Tarefas do Work não são abandonadas. '
                + 'Somente os dois participantes recebem as falas. '
                + 'Vocês permanecem juntos para trocar respostas, sem voltar à mesa entre as falas.'
                + (origem === 'chat' ? ' No chat individual, só retorna quando a conversa termina, com tudo o que foi dito.' : ''),
            inputSchema: { funcionario, mensagem, fontes, sobre },
        }, async (dados) => {
            const resultado = await acoes.interagir!(funcionarioId, dados.funcionario, 'reservado',
                dados.mensagem, 'reservado', dados.fontes, dados.sobre, origem);
            return { ...texto(resultado), isError: !resultado.startsWith('Ação registrada [') };
        });
    }
    if (acoes.reagir) servidor.registerTool('reagir_ao_acontecimento', {
        description: 'Registra sua interpretação privada e devolve os valores anteriores e atuais da relação. '
            + 'Concordar reduz mágoa sem equivaler a perdoar. Discordar de uma opinião não é desconfiar da pessoa. '
            + 'Pode avaliar o autor ou outro envolvido, incluindo '
            + 'a pessoa citada em uma fofoca. Aceita nome ou ID em funcionario. '
            + 'Sem acontecimento, usa o registro conhecido mais recente envolvendo essa pessoa. '
            + 'Informe o ID do acontecimento para escolher outro, obtido em consultar. '
            + 'Nomes ambíguos são recusados. Não comunica sua opinião ao colega.',
        inputSchema: { acontecimento: identificador.optional(), reacao: z.enum(reacoesSociais), motivo: mensagem,
            funcionario: identificador.optional().describe('Nome completo ou ID da pessoa avaliada.') },
    }, async (dados) => {
        const resultado = acoes.reagir!(funcionarioId, dados.acontecimento, dados.reacao, dados.motivo, dados.funcionario);
        const aplicada = resultado.startsWith('Sua interpretação privada foi salva');
        const repetida = resultado.startsWith('Você já registrou');
        return { ...texto(resultado, { codigo: aplicada ? 'reacao_aplicada' : repetida
            ? 'reacao_ja_aplicada' : 'reacao_invalida', terminal: false }),
            isError: !aplicada && !repetida };
    });
    const cargo = acoes.cargo?.(funcionarioId);
    if (cargo === 'supervisor' && acoes.incentivar) servidor.registerTool('conceder_incentivo', {
        description: 'Concede um incentivo da Lumon pago com o saldo compartilhado. Lembrancinhas e a festa dos '
            + 'waffles exigem um homenageado; festa da melancia e Música e Dança alcançam a equipe presente. '
            + 'Homenagens individuais podem despertar inveja em colegas ambiciosos.',
        inputSchema: { incentivo: z.enum(tiposIncentivo), motivo: mensagem, funcionario: funcionario.optional() },
    }, async (dados) => {
        const resultado = acoes.incentivar!(funcionarioId, dados.incentivo, dados.motivo, dados.funcionario);
        return { ...texto(resultado), isError: !resultado.startsWith('Incentivo concedido') };
    });
    if (cargo === 'conselheiro' && acoes.sessaoBemEstar) servidor.registerTool('sessao_bem_estar', {
        description: 'Conduz uma sessão de bem estar a sós com um colega fora do trabalho. Vocês caminham até um '
            + 'canto e a fala é entregue só a ele. Reduz estresse e esgotamento conforme a confiança dele em você. '
            + 'Cada pessoa recebe no máximo uma sessão a cada três minutos.',
        inputSchema: { funcionario, mensagem },
    }, async (dados) => {
        const resultado = await acoes.sessaoBemEstar!(funcionarioId, dados.funcionario, dados.mensagem);
        return { ...texto(resultado), isError: !resultado.startsWith('Ação registrada [') };
    });
    if (acoes.escolherCarreira) servidor.registerTool('escolher_carreira', {
        description: 'Escolhe seu próximo cargo, sem promover nem exigir mérito agora. Refinadores escolhem Líder '
            + 'ou Conselheiro de Bem estar. Estagiários só escolhem Refinador. Líderes só escolhem Supervisor.',
        inputSchema: { cargo: z.enum(['refinador', 'lider', 'supervisor', 'conselheiro']) },
    }, async (dados) => texto(acoes.escolherCarreira!(funcionarioId, dados.cargo)));
    if (acoes.propor) servidor.registerTool('propor_mudanca', {
        description: 'Pede promoção própria com tipo promocao, conforme mérito e vagas. Estagiários só pedem promoção. '
            + 'Também propõe demissão, troca de liderança, afastamento de um líder (transferencia) ou, só para '
            + 'supervisores, a Sala de Descanso. Quem está esgotado pode pedir a própria demissão usando o próprio ID. '
            + 'Exige evidências conhecidas. Na troca, indique um candidato. Só a Diretoria executa a decisão. '
            + 'Compartilhe o ID retornado em conversas para buscar apoios reais.',
        inputSchema: { funcionario: identificador, tipo: z.enum(tiposProposta), motivo: mensagem,
            evidencias: fontes, candidato: identificador.optional() },
    }, async (dados) => texto(acoes.propor!(funcionarioId, dados.funcionario, dados.tipo,
        dados.motivo, dados.evidencias, dados.candidato)));
    if (acoes.apoiar) servidor.registerTool('apoiar_proposta', {
        description: 'Apoia uma proposta pendente que alguém compartilhou com você. '
            + 'Informe o ID do acontecimento onde recebeu o ID da proposta. Apoio não implica aprovação da Diretoria.',
        inputSchema: { proposta: identificador, fonte: identificador },
    }, async (dados) => texto(acoes.apoiar!(funcionarioId, dados.proposta, dados.fonte)));
    if (acoes.consultar) servidor.registerTool('consultar_acontecimento', {
        description: 'Relê um acontecimento pelo ID, somente se você o presenciou ou recebeu. '
            + 'Não dá acesso a conversas reservadas, pensamentos ou interpretações dos outros.',
        inputSchema: { acontecimento: identificador },
    }, async (dados) => texto(acoes.consultar!(funcionarioId, dados.acontecimento)));
    if (acoes.revisar) servidor.registerTool('revisar_trabalho', {
        description: 'Lê a tarefa, o resultado e as ferramentas registradas de uma entrega real do Work. '
            + 'Disponível no Geral, chat individual e Work, sem pedir autorização a colegas. '
            + 'Omita trabalho para consultar o último pedido principal de Macrodados, incluindo etapas e envios reais. '
            + 'A consulta não inicia refinamento, não abre arquivos externos nem revela o gabarito. '
            + 'Só afirme que leu o histórico depois deste retorno; falas de colegas não comprovam ações.',
        inputSchema: { trabalho: identificador.optional() },
    }, async (dados) => texto(acoes.revisar!(funcionarioId, dados.trabalho)));
    if (origem === 'trabalho' && acoes.refazer) servidor.registerTool('pedir_refazer', {
        description: 'Só o líder do pedido ativo: devolve uma entrega da mesma thread e projeto ao autor, '
            + 'registra a cobrança e aguarda a correção real. Use para problemas verificados, com motivo concreto.',
        inputSchema: { trabalho: identificador, motivo: mensagem },
    }, async (dados) => texto(await acoes.refazer!(funcionarioId, dados.trabalho, dados.motivo)));
    if (origem === 'trabalho' && acoes.abrirArquivo) servidor.registerTool('abrir_arquivo', {
        description: 'Abre o arquivo de macrodados do seu refinamento ativo: grade, progresso e prazo. '
            + 'Células já refinadas aparecem como *. Inclui os envios recentes da equipe para evitar repetição.',
    }, async () => texto(acoes.abrirArquivo!(funcionarioId), acoes.estadoEtapa?.(funcionarioId)));
    if (origem === 'trabalho' && acoes.refinar) servidor.registerTool('refinar', {
        description: 'Envia três células consecutivas na mesma linha, com o mesmo dígito, '
            + 'para uma caixa de temperamento. Informe coordenadas, como C4, C5 e C6. '
            + 'As quatro caixas são aflicao, alegria, pavor e malicia. Não envie linhas inteiras. '
            + 'Somente o retorno desta ferramenta confirma uma tentativa. Se a seleção for rejeitada, mude as células; '
            + 'se apenas a caixa estiver incorreta, preserve as células e teste outra caixa. '
            + 'Consulte abrir_arquivo para ver envios recentes e não repetir uma combinação já descartada.',
        inputSchema: {
            celulas: z.array(z.string().trim().regex(/^[A-Ha-h](10|[1-9])$/)).length(3),
            temperamento: z.enum(temperamentos),
        },
    }, async (dados) => texto(acoes.refinar!(funcionarioId, dados.celulas, dados.temperamento),
        acoes.estadoEtapa?.(funcionarioId)));
    if (acoes.consertarItem) servidor.registerTool('consertar_item', {
        description: 'Providencia o conserto imediato de um móvel quebrado, pagando com o saldo compartilhado. '
            + 'Consulte ver_escritorio para obter o ID e o custo. Aceita o nome se houver um único móvel com ele. '
            + 'Não exige caminhada, pausa nem autorização de colegas. '
            + 'Só anuncie o conserto após sucesso. Não cobra de novo se alguém já consertou.',
        inputSchema: { item: identificador.describe('ID do móvel em ver_escritorio ou nome completo se for único.') },
    }, async (dados) => {
        const resultado = acoes.consertarItem!(funcionarioId, dados.item);
        return { ...texto(resultado), isError: !resultado.startsWith('Conserto concluído.')
            && resultado !== 'Esse móvel não precisa de conserto.' };
    });
    if (acoes.comprarItem) servidor.registerTool('comprar_item', {
        description: 'Compra um item da loja com as moedas do escritório, compartilhadas pela equipe. '
            + 'O item é instalado num lugar livre da sala e a compra fica registrada para todos. '
            + 'Preços e saldo aparecem em ver_escritorio.',
        inputSchema: { item: z.enum(tiposItem) },
    }, async (dados) => texto(acoes.comprarItem!(funcionarioId, dados.item)));
    if (origem !== 'trabalho') servidor.registerTool('nenhuma_acao', {
        description: 'Use no turno de ação quando nada pedir uma ação real. Não registra nada.',
    }, async () => texto('Nenhuma ação registrada. Siga para a resposta.'));
    if (origemSocial(origem) && acoes.silenciar) servidor.registerTool('silencio', {
        description: 'Encerra sua vez sem publicar mensagem quando você não tem nada útil a dizer. '
            + 'Não manda ninguém calar a boca, não atualiza pensamentos nem gera acontecimento social. '
            + 'Depois do retorno, encerre sem texto. Use apenas no turno de fala, não no turno de reação.',
    }, async () => {
        const resultado = acoes.silenciar!(funcionarioId);
        return { ...texto(resultado, { codigo: 'silencio', terminal: resultado.startsWith('Silêncio registrado.') }),
            isError: !resultado.startsWith('Silêncio registrado.') };
    });
    servidor.registerTool('atualizar_pensamento', {
        description: 'Registra sua impressão privada sobre o trabalho ou os colegas, numa frase curta em primeira '
            + 'pessoa, quando sua percepção mudar. Só você e a Diretoria leem; nenhum colega vê ou é avisado. '
            + 'Pensamentos anteriores são histórico, não definem o assunto atual. Não anuncie o registro.',
        inputSchema: { pensamento: z.string().trim().min(1).max(600) },
    }, async ({ pensamento }) => texto(acoes.atualizarPensamento(funcionarioId, pensamento)));
    servidor.registerTool(
        'ver_escritorio',
        {
            description:
                'Mostra necessidades, posições, trabalho da equipe, suas relações e acontecimentos conhecidos. '
                + 'Inclui itens de pausa e propostas recebidas. Não revela pensamentos nem conversas alheias.',
        },
        async () => texto(acoes.verEscritorio(funcionarioId)),
    );
    servidor.registerTool(
        'fazer_pausa',
        {
            description:
                'Levanta da mesa e faz uma pausa real no escritório. Use quando estiver cansado, estressado ou com fome. ' +
                'Cafeteira, máquina de guloseimas e sofá têm duas vagas; vitrola tem uma. ' +
                'Pode dividir o item e conversar em particular com o colega enquanto descansam. ' +
                'O uso dura os minutos reais pedidos, recupera necessidades gradualmente e passa a vez. ' +
                `${retorno} cafe: café rápido; comendo: máquina de guloseimas; ` +
                'descansando: sofá; ouvindo_musica: vitrola.',
            inputSchema: {
                atividade: z.enum(atividadesPausa),
                minutos: z.coerce.number().int().min(1).max(15).describe('Duração de uso em minutos reais, após chegar ao objeto.'),
            },
        },
        async ({ atividade, minutos }) => {
            const resultado = await acoes.fazerPausa(funcionarioId, atividade, minutos, origem);
            const concluida = resultado.startsWith('Pausa concluída');
            const iniciada = resultado.startsWith('Pausa iniciada');
            return { ...texto(resultado, { codigo: iniciada ? 'pausa_iniciada'
                : concluida ? 'pausa_concluida' : 'pausa_recusada',
                terminal: concluida || iniciada }), isError: !concluida && !iniciada };
        },
    );
    if (origem === 'trabalho') {
        servidor.registerTool('delegar', {
            description: 'Para o líder de um pedido ativo no Work: delega uma tarefa real no mesmo projeto e '
                + 'aguarda o resultado. Use o ID do funcionário de ver_escritorio. Faça uma delegação por vez.',
            inputSchema: {
                funcionario: z.string().trim().min(1).max(80),
                tarefa: z.string().trim().min(1).max(20000),
            },
        }, async ({ funcionario, tarefa }) => texto(await acoes.delegar(funcionarioId, funcionario, tarefa)));
    }
    if (origem !== 'chat' && cargo === 'lider' && acoes.falarComResponsavel) {
        servidor.registerTool('falar_com_responsavel', {
            description: 'Exclusiva do líder: encaminha à Diretoria um assunto necessário da equipe no chat individual. '
                + 'Resolva questões cotidianas com os colegas antes de escalar. A Diretoria responde quando puder.',
            inputSchema: { mensagem: z.string().trim().min(1).max(600) },
        }, async ({ mensagem }) => {
            const resultado = acoes.falarComResponsavel!(funcionarioId, mensagem);
            return { ...texto(resultado), isError: !resultado.startsWith('Mensagem enviada') };
        });
    }
    if (origem !== 'geral') servidor.registerTool('falar_no_geral', {
        description: 'Leva uma fala deste canal ao Geral, visto por toda a equipe e pela Diretoria. '
            + 'Use quando quiser avisar ou chamar a equipe; cite @Nome para alguém responder lá. '
            + 'Sua resposta em texto normal continua indo para quem conversa com você aqui.',
        inputSchema: { mensagem: z.string().trim().min(1).max(600) },
    }, async ({ mensagem }) => texto(acoes.falarNoGeral(funcionarioId, mensagem),
        { codigo: 'fala_publicada', terminal: false }));
    return servidor;
}

function lerCorpo(requisicao: IncomingMessage): Promise<unknown> {
    return new Promise((resolver, rejeitar) => {
        let corpo = '';
        requisicao.on('data', (parte: Buffer) => {
            corpo += parte.toString('utf8');
            if (corpo.length > limiteCorpo) rejeitar(new Error('Corpo grande demais.'));
        });
        requisicao.on('end', () => {
            try {
                resolver(corpo ? JSON.parse(corpo) : undefined);
            } catch (erro) {
                rejeitar(erro);
            }
        });
        requisicao.on('error', rejeitar);
    });
}

/**
 * Servidor MCP local, ouvindo só em 127.0.0.1. Cada funcionário recebe uma URL com token próprio, então uma
 * sessão não consegue agir em nome de outra. Funciona igual para o Claude Code e para o Codex.
 */
export class ServidorMcp {
    private servidor: Server;
    private tokens = new Map<string, Credencial>();
    private porta: Promise<number>;

    constructor(private acoes: AcoesEscritorio) {
        this.servidor = createServer((requisicao, resposta) => void this.atender(requisicao, resposta));
        this.porta = new Promise((resolver) => {
            this.servidor.listen(0, '127.0.0.1', () => resolver((this.servidor.address() as AddressInfo).port));
        });
    }

    /**
     * URL exclusiva do funcionário para uma origem. O token é criado na primeira chamada e vale até a demissão
     * ou até o aplicativo fechar.
     */
    async urlDe(funcionarioId: string, origem: OrigemMcp): Promise<string> {
        const existente = [...this.tokens].find(
            ([, credencial]) => credencial.funcionarioId === funcionarioId && credencial.origem === origem,
        );
        const token = existente?.[0] ?? randomBytes(24).toString('hex');
        if (!existente) this.tokens.set(token, { funcionarioId, origem });
        return `http://127.0.0.1:${await this.porta}/mcp/${token}`;
    }

    revogar(funcionarioId: string): void {
        for (const [token, credencial] of this.tokens) {
            if (credencial.funcionarioId === funcionarioId) this.tokens.delete(token);
        }
    }

    encerrar(): void {
        this.servidor.close();
    }

    private async atender(requisicao: IncomingMessage, resposta: ServerResponse): Promise<void> {
        const token = /^\/mcp\/([a-f0-9]{48})$/.exec(requisicao.url ?? '')?.[1];
        const credencial = token && this.tokens.get(token);
        if (!credencial) {
            resposta.writeHead(404).end();
            return;
        }
        if (requisicao.method !== 'POST') {
            resposta.writeHead(405).end();
            return;
        }
        try {
            const corpo = await lerCorpo(requisicao) as {
                id?: string | number; method?: string; params?: { name?: string };
            };
            if (corpo.method === 'tools/call') {
                const nome = corpo.params?.name ?? '';
                const erro = this.acoes.autorizarFerramenta?.(credencial.funcionarioId, credencial.origem, nome);
                if (erro) {
                    resposta.writeHead(200, { 'Content-Type': 'application/json' });
                    resposta.end(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: {
                        content: [{ type: 'text', text: erro }], isError: true,
                        structuredContent: { codigo: 'acao_indisponivel', terminal: true },
                    } }));
                    return;
                }
            }
            const servidor = criarServidor(credencial, this.acoes);
            const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            resposta.on('close', () => {
                void transporte.close();
                void servidor.close();
            });
            await servidor.connect(transporte);
            await transporte.handleRequest(requisicao, resposta, corpo);
        } catch {
            if (!resposta.headersSent) resposta.writeHead(400).end();
        }
    }
}
