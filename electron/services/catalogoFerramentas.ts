import { z } from 'zod';
import type { ValidacaoEntrega } from '../../shared/trabalho';
import { tiposItem, type Atividade, type TipoItem } from '../../shared/escritorio';
import { temperamentos, type Temperamento } from '../../shared/refinamento';
import type { Intencao } from '../../shared/intencoes';
import type { CargoAtual, Cargo } from '../../shared/cargos';
import { tiposIncentivo, type TipoIncentivo } from '../../shared/incentivos';
import {
    tiposProposta, esquemaFiltroHistorico, esquemaEventoSocial, esquemaPensamento,
    type AcaoSocial, type TipoProposta, type FiltroHistorico, type InterpretacaoPensamento,
} from '../../shared/social';


import { CatalogoFerramentas } from './ferramentas/catalogo';
import { concluirAcao, recusarAcao, normalizarResultado, type ResultadoAcao } from './ferramentas/resultado';
import type { ContextoFerramentas, OrigemFerramenta } from '../../shared/ferramentas';
type RetornoAcao = string | ResultadoAcao;

/** Nome do servidor visto pelos harnesses. As ferramentas aparecem como `mcp__lumon__<nome>` no Claude. */
export const nomeServidorMcp = 'lumon';

/**
 * De onde vem a chamada. No Geral, reservado e Work a pausa confirma o início; o chat aguarda o fim.
 * No Geral, texto normal é fala pública; nos demais canais, `falar_no_geral` leva uma fala ao Geral.
 */
export type OrigemMcp = OrigemFerramenta;

/** Turnos de convivência do canal Geral, públicos ou num diálogo reservado. */
export function origemSocial(origem?: OrigemMcp): boolean {
    return origem === 'geral' || origem === 'reservado';
}

/** O que as ferramentas do escritório podem fazer, sempre em nome de um funcionário identificado pelo token. */
export type AcoesEscritorio = {
    verEscritorio: (funcionarioId: string) => RetornoAcao;
    fazerPausa: (
        funcionarioId: string, atividade: Atividade, minutos: number, origem: OrigemMcp,
    ) => Promise<RetornoAcao>;
    falarNoGeral: (funcionarioId: string, mensagem: string) => RetornoAcao;
    falarComResponsavel?: (funcionarioId: string, mensagem: string) => RetornoAcao;
    atualizarPensamento: (
        funcionarioId: string, pensamento: string, interpretacao?: InterpretacaoPensamento,
    ) => RetornoAcao;
    silenciar?: (funcionarioId: string) => RetornoAcao;
    encerrarVez?: (funcionarioId: string) => void;
    delegar: (liderId: string, destino: string, tarefa: string) => Promise<RetornoAcao>;
    cancelarDelegacao?: (liderId: string) => RetornoAcao;
    interagir?: (
        id: string, destino: string, acao: AcaoSocial | 'reservado', mensagem: string,
        alcance: 'publico' | 'local' | 'reservado', fontes: string[], sobreId?: string, origem?: OrigemMcp,
    ) => RetornoAcao | Promise<RetornoAcao>;
    propor?: (
        id: string, alvo: string, tipo: TipoProposta, motivo: string, evidencias: string[], candidato?: string,
    ) => RetornoAcao;
    escolherCarreira?: (id: string, cargo: CargoAtual) => RetornoAcao;
    apoiar?: (id: string, propostaId: string, fonteId: string) => RetornoAcao;
    consultar?: (id: string, eventoId: string) => RetornoAcao;
    consultarHistorico?: (
        id: string, busca: string, tipo: string | undefined, limite: number, filtros: FiltroHistorico,
    ) => RetornoAcao;
    revisar?: (id: string, trabalhoId?: string) => RetornoAcao;
    refazer?: (id: string, trabalhoId: string, motivo: string) => Promise<RetornoAcao>;
    validarEntrega?: (id: string, validacao: ValidacaoEntrega) => RetornoAcao;
    abrirArquivo?: (id: string) => RetornoAcao;
    irParaWork?: (id: string, origem: OrigemMcp) => RetornoAcao;
    invocarProWork?: (liderId: string) => RetornoAcao;
    sairDoWork?: (id: string, motivo: string) => RetornoAcao;
    refinar?: (id: string, celulas: string[], temperamento: Temperamento) => RetornoAcao;
    comprarItem?: (id: string, tipo: TipoItem) => RetornoAcao;
    consertarItem?: (id: string, itemId: string) => RetornoAcao;
    planejar?: (
        id: string, colega: string, objetivo: Intencao['objetivo'], motivo: string, fonte: string,
    ) => RetornoAcao;
    cancelarIntencao?: (id: string, intencao: string, motivo: string) => RetornoAcao;
    autorizarFerramenta?: (id: string, origem: OrigemMcp, nome: string) => string | undefined;
    contextoFerramentas?: (id: string, origem: OrigemMcp) => ContextoFerramentas;
    estadoEtapa?: (id: string) => { codigo: string; terminal: boolean };
    incentivar?: (id: string, tipo: TipoIncentivo, motivo: string, alvoId?: string) => RetornoAcao;
    sessaoBemEstar?: (id: string, alvoId: string, mensagem: string) => Promise<RetornoAcao>;
    cargo?: (id: string) => Cargo | undefined;
};

type Credencial = { funcionarioId: string; origem: OrigemMcp };

const atividadesPausa = ['cafe', 'comendo', 'descansando', 'ouvindo_musica'] as const;

function texto(conteudo: RetornoAcao, estado?: { codigo: string; terminal: boolean }) {
    const resultado = normalizarResultado(conteudo);
    return { content: [{ type: 'text' as const, text: resultado.mensagem }], isError: resultado.erro,
        structuredContent: { ...resultado, ...(estado ?? {}), mensagem: undefined } };
}

export function criarCatalogo({ funcionarioId, origem }: Credencial, acoes: AcoesEscritorio): CatalogoFerramentas {
    const servidor = new CatalogoFerramentas();
    if (acoes.consultarHistorico || acoes.consultar) servidor.registrar('consultar', {
        description: 'Pesquisa demissões, memórias, falas, acontecimentos e seus pensamentos privados anteriores. '
            + 'Use categoria pensamentos para pesquisar só sua memória íntima; nunca lê pensamentos alheios. '
            + 'Filtre por assunto, tipo, funcionário (nome ou ID) e período ISO com fuso. '
            + 'Retorna uma página de resumos, não todo o arquivo. Para detalhes, use detalhar true e limite 1. '
            + 'Continue com proximoDeslocamento. Só mostra registros conhecidos, sem consumir novidades. '
            + 'Não encerra sua vez: examine o retorno e continue consultando ou decida como concluir. '
            + 'Para reler um registro exato, informe acontecimento com seu ID e omita os filtros. '
            + 'Histórico não é pedido ativo.',
        inputSchema: { busca: z.string().trim().max(200).default(''), tipo: esquemaEventoSocial.shape.tipo.optional(),
            limite: z.number().int().min(1).max(30).default(5),
            acontecimento: z.string().trim().min(1).max(80).optional(), ...esquemaFiltroHistorico.shape },
    }, async (dados) => {
        if (dados.acontecimento) {
            if (dados.busca || dados.tipo || dados.funcionario || dados.desde || dados.ate || dados.deslocamento
                || dados.categoria !== 'acontecimentos') return texto(recusarAcao('Consulte o ID sem combinar filtros.'));
            return texto(acoes.consultar?.(funcionarioId, dados.acontecimento)
                ?? recusarAcao('Consulta por ID indisponível.'));
        }
        return texto(acoes.consultarHistorico?.(funcionarioId, dados.busca, dados.tipo, dados.limite, dados)
            ?? recusarAcao('Pesquisa de histórico indisponível.'));
    });
    const retorno = origemSocial(origem) || origem === 'trabalho'
        ? 'Confirma o início e passa a vez; o corpo continua em pausa até terminar os minutos reais. '
        : 'A ferramenta aguarda o fim da pausa. ';
    const fontes = z.array(z.string().min(1).max(80)).max(5).default([])
        .describe('IDs de acontecimentos conhecidos exibidos por ver_escritorio. Não use IDs de pessoas ou trabalhos.');
    const mensagem = z.string().trim().min(1).max(600).describe('Texto da fala, com no máximo 600 caracteres.');
    const identificador = z.string().min(1).max(80);
    const funcionario = identificador.describe('ID exato do funcionário exibido por ver_escritorio. Não use o nome.');
    const sobre = funcionario.optional()
        .describe('ID de uma terceira pessoa citada. Omita se não houver. Não é assunto nem ID de trabalho.');
    if (acoes.interagir) {
        const descricoes = {
            cobrar: 'Cobra ou repreende um colega por uma falha ou suspeita concreta, com fontes conhecidas. '
                + 'Não cobre ócio, pausa ou discordância sem prejuízo real.',
            contestar: 'Contesta uma fala, opinião ou cobrança de um colega, com fontes conhecidas. '
                + 'Explique a divergência sem tratar uma opinião como falha comprovada.',
            elogiar: 'Elogia um colega por um acontecimento conhecido. '
                + 'Reconheça algo concreto, sem repetir elogios nem usar elogios como única evidência.',
            desculpar: 'Pede desculpas a um colega por algo que você fez ou disse, com fontes conhecidas. '
                + 'A reparação fica registrada; o colega decide se perdoa.',
            defender: 'Defende um colega diante de uma acusação ou cobrança, com fontes conhecidas. '
                + 'Use sobre para identificar uma terceira pessoa envolvida, quando houver.',
            fofocar: 'Compartilha com um colega uma versão ou comentário sobre alguém, com fontes conhecidas. '
                + 'Use sobre para identificar a pessoa comentada. A fofoca preserva sua autoria e não comprova alegações.',
        } as const satisfies Record<AcaoSocial, string>;
        for (const acao of Object.keys(descricoes) as (keyof typeof descricoes)[]) {
            servidor.registrar(acao, {
                description: descricoes[acao] + ' Consulte ver_escritorio para obter IDs de colegas e fontes. '
                    + 'Público: toda equipe; local: próximos a até três células; reservado: só o destinatário. '
                    + 'A fala e os efeitos nas relações são persistidos. '
                    + (['elogiar', 'cobrar'].includes(acao)
                        ? 'No Geral, esta ação conclui sua participação: não repita nem publique outra fala.'
                        : 'No Geral, uma ação pública conclui sua participação: não repita nem publique outra fala.'),
                inputSchema: { funcionario, mensagem, alcance: z.enum(['publico', 'local', 'reservado']), fontes, sobre },
            }, async (dados) => {
                const resultado = await acoes.interagir!(funcionarioId, dados.funcionario, acao,
                    dados.mensagem, dados.alcance, dados.fontes, dados.sobre, origem);
                const normalizado = normalizarResultado(resultado);
                return texto(resultado, { codigo: normalizado.erro ? normalizado.codigo : 'interacao_aplicada',
                    terminal: !normalizado.erro && origemSocial(origem)
                        && (dados.alcance === 'publico' || ['elogiar', 'cobrar'].includes(acao)) });
            });
        }
        servidor.registrar('conversar_reservado', {
            description: 'Puxa um colega para uma conversa a sós, por iniciativa própria, sem esperar pedido. '
                + 'Use para desabafar, tirar uma dúvida sobre alguém, comentar um acontecimento, pedir conselho, '
                + 'fazer as pazes, fofocar, buscar aliados ou compartilhar propostas. '
                + 'Vocês caminham até um canto; se dividem um item de pausa, conversam ali sem interromper o uso. '
                + 'Tarefas do Work não são abandonadas. '
                + 'Somente os dois participantes recebem as falas. '
                + 'Vocês permanecem juntos para trocar respostas, sem voltar à mesa entre as falas.',
            inputSchema: { funcionario, mensagem, fontes, sobre },
        }, async (dados) => {
            const resultado = await acoes.interagir!(funcionarioId, dados.funcionario, 'reservado',
                dados.mensagem, 'reservado', dados.fontes, dados.sobre, origem);
            return texto(resultado);
        });
    }
    if (acoes.incentivar) servidor.registrar('conceder_incentivo', {
        description: 'Concede um incentivo da Lumon pago com o saldo compartilhado. Lembrancinhas e a festa dos '
            + 'waffles exigem um homenageado; festa da melancia e Música e Dança alcançam a equipe presente. '
            + 'Homenagens individuais podem despertar inveja em colegas ambiciosos.',
        inputSchema: { incentivo: z.enum(tiposIncentivo), motivo: mensagem, funcionario: funcionario.optional() },
    }, async (dados) => {
        const resultado = acoes.incentivar!(funcionarioId, dados.incentivo, dados.motivo, dados.funcionario);
        return texto(resultado);
    });
    if (acoes.sessaoBemEstar) servidor.registrar('sessao_bem_estar', {
        description: 'Conduz uma sessão de bem estar a sós com um colega fora do trabalho. Vocês caminham até um '
            + 'canto e a fala é entregue só a ele. Reduz estresse e esgotamento conforme a confiança dele em você. '
            + 'Cada pessoa recebe no máximo uma sessão a cada três minutos.',
        inputSchema: { funcionario, mensagem },
    }, async (dados) => {
        const resultado = await acoes.sessaoBemEstar!(funcionarioId, dados.funcionario, dados.mensagem);
        return texto(resultado);
    });
    if (acoes.escolherCarreira) servidor.registrar('escolher_carreira', {
        description: 'Escolhe seu próximo cargo, sem promover nem exigir mérito agora. Refinadores escolhem Líder '
            + 'ou Conselheiro de Bem estar. Estagiários só escolhem Refinador. Líderes só escolhem Supervisor.',
        inputSchema: { cargo: z.enum(['refinador', 'lider', 'supervisor', 'conselheiro']) },
    }, async (dados) => texto(acoes.escolherCarreira!(funcionarioId, dados.cargo)));
    if (acoes.propor) servidor.registrar('propor_mudanca', {
        description: 'Solicita à Diretoria sua promoção com tipo promocao, conforme mérito e vagas; '
            + 'não promove você automaticamente. Para promoção própria, omita funcionario: sua identidade vem '
            + 'da sessão. Estagiários só pedem promoção. '
            + 'Também propõe demissão, troca de liderança, afastamento de um líder (transferencia) ou, só para '
            + 'supervisores, a Sala de Descanso. Quem está esgotado pode pedir a própria demissão usando o próprio ID. '
            + 'Inclua de um a cinco IDs de acontecimentos conhecidos em evidencias; consulte ver_escritorio '
            + 'ou consultar para obtê los. Para outras mudanças, informe o ID exato do alvo em funcionario. '
            + 'Na troca, indique um candidato. Só a Diretoria executa a decisão. '
            + 'Compartilhe o ID retornado em conversas para buscar apoios reais.',
        inputSchema: { funcionario: funcionario.optional()
            .describe('Na promoção própria, omita este campo. Nas outras propostas, informe o ID exato do alvo.'),
            tipo: z.enum(tiposProposta), motivo: mensagem,
            evidencias: fontes, candidato: identificador.optional() },
    }, async (dados) => {
        const alvoId = dados.funcionario ?? (dados.tipo === 'promocao' ? funcionarioId : undefined);
        if (!alvoId) return texto(recusarAcao('Informe o ID do funcionário alvo desta proposta.'));
        return texto(acoes.propor!(funcionarioId, alvoId, dados.tipo,
            dados.motivo, dados.evidencias, dados.candidato));
    });
    if (acoes.apoiar) servidor.registrar('apoiar_proposta', {
        description: 'Apoia uma proposta pendente que alguém compartilhou com você. '
            + 'Informe o ID do acontecimento onde recebeu o ID da proposta. Apoio não implica aprovação da Diretoria.',
        inputSchema: { proposta: identificador, fonte: identificador },
    }, async (dados) => texto(acoes.apoiar!(funcionarioId, dados.proposta, dados.fonte)));
    if (acoes.revisar) servidor.registrar('revisar_trabalho', {
        description: 'Consulte para saber como foi a última thread do Work e decidir o que fazer a partir dos '
            + 'resultados reais. Sem trabalho, mostra o último pedido principal de Macrodados: estado, progresso '
            + 'do arquivo, etapas de cada participante, resultados, envios e avaliação da Diretoria. '
            + 'Inclui a cota atual do departamento, arquivos em andamento e o arquivo disponível para retomar. '
            + 'Informe trabalho para revisar um pedido específico. Falas de colegas não comprovam ações. '
            + 'A consulta não inicia refinamento nem revela o gabarito.',
        inputSchema: { trabalho: identificador.optional() },
    }, async (dados) => texto(acoes.revisar!(funcionarioId, dados.trabalho)));
    if (acoes.refazer) servidor.registrar('pedir_refazer', {
        description: 'Só o líder do pedido ativo: devolve uma entrega da mesma thread e projeto ao autor, '
            + 'registra a cobrança e aguarda a correção real. Use para problemas verificados, com motivo concreto.',
        inputSchema: { trabalho: identificador, motivo: mensagem },
    }, async (dados) => texto(await acoes.refazer!(funcionarioId, dados.trabalho, dados.motivo)));
    if (acoes.irParaWork) servidor.registrar('ir_para_work', {
        description: 'Decide entrar ou voltar ao Work para refinar o arquivo disponível. Não cria outro arquivo. '
            + 'O contador pessoal recomeça a cada retorno. A chegada de um arquivo não obriga você a trabalhar. '
            + 'Encerra sua participação social; o refinamento começa depois deste turno. '
            + 'Indisponível durante pausas, ausências ou outra tarefa.',
    }, async () => texto(acoes.irParaWork!(funcionarioId, origem)));
    if (acoes.invocarProWork) servidor.registrar('invocar_pro_work', {
        description: 'Coloca todos os colegas livres que refinam Macrodados para trabalhar '
            + 'junto com você no mesmo arquivo, em paralelo, com períodos próprios. '
            + 'Respeita pausas, ausências, tarefas em andamento e transferências aprovadas. '
            + 'Retorna os nomes de quem entrou; não aguarda a conclusão nem aprova o arquivo.',
        inputSchema: {},
    }, async () => texto(acoes.invocarProWork!(funcionarioId)));
    if (acoes.sairDoWork) servidor.registrar('sair_do_work', {
        description: 'Sai do Work para conversar no Geral ou ficar livre, preservando o arquivo e todos os envios. '
            + 'Pode sair antes do contador acabar e voltar quando decidir, usando ir_para_work no canal social. '
            + 'Para descansar num móvel, use fazer_pausa. Não encerra o arquivo nem o trabalho dos colegas.',
        inputSchema: { motivo: z.string().trim().min(1).max(300) },
    }, async ({ motivo }) => texto(acoes.sairDoWork!(funcionarioId, motivo)));
    if (acoes.abrirArquivo) servidor.registrar('abrir_arquivo', {
        description: 'Abre o arquivo de macrodados do seu refinamento ativo: grade, progresso e prazo. '
            + 'Células já refinadas aparecem como *. Inclui os envios recentes da equipe para evitar repetição.',
    }, async () => texto(acoes.abrirArquivo!(funcionarioId), acoes.estadoEtapa?.(funcionarioId)));
    if (acoes.refinar) servidor.registrar('refinar', {
        description: 'Envia três células consecutivas na mesma linha, com o mesmo dígito, '
            + 'para uma caixa de temperamento. Letras são colunas de A a J; números são linhas de 1 a 8. '
            + 'Informe coordenadas horizontais, como C4, D4 e E4. '
            + 'As quatro caixas são aflicao, alegria, pavor e malicia. Não envie linhas inteiras. '
            + 'Somente o retorno desta ferramenta confirma uma tentativa. Se a seleção for rejeitada, mude as células; '
            + 'se apenas a caixa estiver incorreta, preserve as células e teste outra caixa. '
            + 'Consulte abrir_arquivo para ver envios recentes e não repetir uma combinação já descartada.',
        inputSchema: {
            celulas: z.array(z.string().trim().regex(/^[A-Ja-j][1-8]$/)).length(3),
            temperamento: z.enum(temperamentos),
        },
    }, async (dados) => {
        const resultado = acoes.refinar!(funcionarioId, dados.celulas, dados.temperamento);
        return texto(resultado, acoes.estadoEtapa?.(funcionarioId));
    });
    if (acoes.consertarItem) servidor.registrar('consertar_item', {
        description: 'Providencia o conserto imediato de um móvel quebrado, pagando com o saldo compartilhado. '
            + 'Consulte ver_escritorio para obter o ID e o custo. Aceita o nome se houver um único móvel com ele. '
            + 'Não exige caminhada, pausa nem autorização de colegas. '
            + 'Só anuncie o conserto após sucesso. Não cobra de novo se alguém já consertou.',
        inputSchema: { item: identificador.describe('ID do móvel em ver_escritorio ou nome completo se for único.') },
    }, async (dados) => {
        const resultado = acoes.consertarItem!(funcionarioId, dados.item);
        return texto(resultado);
    });
    if (acoes.comprarItem) servidor.registrar('comprar_item', {
        description: 'Compra um item da loja com as moedas do escritório, compartilhadas pela equipe. '
            + 'O item é instalado num lugar livre da sala e a compra fica registrada para todos. '
            + 'Preços e saldo aparecem em ver_escritorio.',
        inputSchema: { item: z.enum(tiposItem) },
    }, async (dados) => texto(acoes.comprarItem!(funcionarioId, dados.item)));
    servidor.registrar('nenhuma_acao', {
        description: 'Encerra sua participação e passa a vez ao próximo agente, sem fala ou ação social. '
            + 'Também cancela sua resposta pendente após uma reação. Depois do '
                + 'retorno, não escreva nem use ferramentas.',
    }, async () => {
        if (origemSocial(origem)) {
            if (acoes.encerrarVez) acoes.encerrarVez(funcionarioId);
            else acoes.silenciar?.(funcionarioId);
        }
        return texto('Vez encerrada sem ação.', { codigo: 'vez_encerrada', terminal: true });
    });
    servidor.registrar('atualizar_pensamento', {
        description: 'Registra sua impressão privada sobre o trabalho ou os colegas, numa frase curta em primeira '
            + 'pessoa, quando sua percepção mudar. Nenhum colega vê ou é avisado. '
            + 'Para mudar sua relação com alguém, inclua reacao (concordar, discordar, perdoar ou desconfiar) '
            + 'e acontecimento ou funcionario. O próprio pensamento explica sua interpretação. '
            + 'Aceita nome completo ou ID em funcionario. Sem acontecimento, usa o registro conhecido mais recente '
            + 'envolvendo essa pessoa; consulte outro ID em consultar. Nomes ambíguos são recusados. '
            + 'Concordar reduz mágoa sem equivaler a perdoar. Discordar de uma opinião não é desconfiar da pessoa. '
            + 'Sem reacao, apenas guarda o pensamento. Pensamentos anteriores são histórico, '
            + 'não definem o assunto atual. Para comunicar algo ao colega, use a ferramenta social correspondente. '
            + 'Não anuncie o registro.',
        inputSchema: esquemaPensamento.shape,
    }, async (entrada) => {
        const dados = esquemaPensamento.safeParse(entrada);
        if (!dados.success) return texto(recusarAcao(dados.error.issues[0]!.message, 'pensamento_invalido'));
        const { pensamento, ...interpretacao } = dados.data;
        return texto(acoes.atualizarPensamento(funcionarioId, pensamento, interpretacao));
    });
    servidor.registrar(
        'ver_escritorio',
        {
            description:
                'Consulta o estado atual do escritório: suas necessidades; nomes, IDs, cargos, humor e situação dos '
                + 'colegas; posições na sala; itens de pausa; saldo compartilhado; móveis quebrados e custos de '
                + 'conserto; terminais; arquivo disponível e trabalhos em andamento. Inclui cota, carreira, '
                + 'relações, acontecimentos conhecidos e propostas acessíveis a você. Use os IDs retornados nas '
                + 'ações. A consulta não consome novidades nem revela pensamentos ou conversas privadas alheias.',
        },
        async () => texto(acoes.verEscritorio(funcionarioId)),
    );
    servidor.registrar(
        'fazer_pausa',
        {
            description:
                'Levanta da mesa e faz uma pausa real no escritório. Use quando '
                    + 'estiver cansado, estressado ou com fome. ' +
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
            return texto(resultado);
        },
    );
    {
        servidor.registrar('delegar', {
            description: 'Para o líder de um pedido ativo no Work: delega uma tarefa real no mesmo projeto e '
                + 'aguarda o resultado. Use o ID do funcionário de ver_escritorio. Faça uma delegação por vez. '
                + 'Em Macrodados, informe na tarefa as três células conferidas na grade, como C4, D4 e E4.',
            inputSchema: {
                funcionario: z.string().trim().min(1).max(80),
                tarefa: z.string().trim().min(1).max(20000),
            },
        }, async ({ funcionario, tarefa }) => {
            const resultado = await acoes.delegar(funcionarioId, funcionario, tarefa);
            return texto(resultado);
        });
        if (acoes.cancelarDelegacao) servidor.registrar('cancelar_delegacao', {
            description: 'Para o líder: interrompe a etapa delegada que travou ou demora demais, para seguir com '
                + 'outro colega ou refinar você mesmo.',
            inputSchema: {},
        }, async () => texto(acoes.cancelarDelegacao!(funcionarioId)));
    }
    servidor.registrar('falar_no_geral', {
        description: 'Leva uma fala deste canal ao Geral, visto por toda a equipe e pela Diretoria. '
            + 'Use quando quiser avisar ou chamar a equipe; cite @Nome para alguém responder lá. '
            + 'Sua resposta em texto normal continua indo para quem conversa com você aqui.',
        inputSchema: { mensagem: z.string().trim().min(1).max(600) },
    }, async ({ mensagem }) => texto(acoes.falarNoGeral(funcionarioId, mensagem)));
    return servidor;
}
