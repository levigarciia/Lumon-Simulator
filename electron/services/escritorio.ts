import { preservarLembrancas } from '../../shared/memoria';
import {
    apagarConversaHistorica, excluirArquivosWork, excluirHistoricoCompleto, excluirRegistros, listarHistorico,
} from './historico';
import type { RegistroHistorico } from '../../shared/historico';
import { randomUUID } from 'node:crypto';
import { cotaAtual, creditarArquivo, comunicadoDiretoria, metaDiaria, bonusCotaDiaria } from '../../shared/departamento';
import { custoConserto, registrarUso, repararItem } from '../../shared/manutencao';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { gerarArquivo, descreverGrade, refinar, problemaSelecao, progressoRefinamento, recompensaRefinamento,
    nomeProjetoMacrodados, orientarRefinamento, descreverEnvios, formatarPrazo, type Temperamento } from '../../shared/refinamento';
import {
    catalogo,
    comItem,
    sanearSala,
    semItem,
    validarSala,
    type Atividade,
    type Celula,
    type Rotacao,
    type Sala,
    type TipoItem,
} from '../../shared/escritorio';
import { fracaoRevenda, recompensaEntrega, type EstadoPublico, type EstadoSalvo } from '../../shared/estado';
import { contextoDiretoria, migrarAutoriaDiretoria } from '../../shared/diretoria';
import {
    cargos, nomeCargo, cargoAtual, refina, type Contratacao, type Funcionario, type Mensagem, type StatusFuncionario,
} from '../../shared/funcionarios';
import { limiteEnviosEtapa, type CargoAtual } from '../../shared/cargos';
import { liberarNecessidades } from '../../shared/acolhimento';
import { estagioEsgotamento, nomesEstagio, recusaTrabalho } from '../../shared/esgotamento';
import { conversaDuranteAusencia, nomesAusencia } from '../../shared/ausencias';
import type { TipoIncentivo } from '../../shared/incentivos';
import { DepartamentoPessoal } from './pessoal';
import { AgendaDepartamento } from './agendaDepartamento';
import { duracaoArquivoDiretoriaMinutos } from '../../shared/eventosDepartamento';
import { capacidadeItem } from '../../shared/escritorio';
import {
    aplicarMerito, caminhosCarreira, meritoParaCargo, fracaoMeritoAposPromocao, ganhosMerito,
    meritoDoEvento, orientacaoCarreira, proximoCargo,
    situacaoCarreira,
} from '../../shared/carreira';
import type { MensagemGeral } from '../../shared/geral';
import { reconciliarMesas } from '../../shared/mesas';
import { disposicaoAtual, humor, pedidosDoCorpo, resumirNecessidades } from '../../shared/necessidades';
import type { EventoLumon, Resultado } from '../../shared/ponte';
import { Expediente } from './expediente';
import { CanalGeral } from './geral';
import { ServidorMcp, origemSocial, type OrigemMcp } from './mcp';
import { SimulacaoEscritorio } from './simulacao';
import { Orquestracao } from './orquestracao';
import { DinamicaSocial } from './social';
import {
    criarPersonalidade, esquemaSocial, ferramentasConversaNaPausa, podeConhecer,
    type EventoSocial, type PropostaPolitica,
} from '../../shared/social';
import type { RegistroTrabalho } from '../../shared/trabalho';

import { esquemaThread, threadPrincipal, type Thread } from '../../shared/threads';

const sucesso: Resultado = { ok: true };
const intervaloIniciativaMs = 120000;
const limiteSelecoesRecusadasDelegado = 3;
const limiteSelecoesRecusadasLider = 6;
const ferramentasDoRefinamento = [
    'delegar', 'cancelar_delegacao', 'abrir_arquivo', 'refinar', 'falar_com_responsavel', 'revisar_trabalho',
    'pedir_refazer',
];
const prefixoRelatoChat ='Relato da Diretoria no chat individual, não verificado: ';

const rotulosStatus: Record<StatusFuncionario, string> = {
    ocioso: 'livre',
    trabalhando: 'trabalhando',
    bloqueado: 'esperando aprovação da Diretoria',
    erro: 'serviço de IA indisponível',
    em_pausa: 'em pausa',
    conversando: 'conversando',
};

function falha(erro: string): Resultado {
    return { ok: false, erro };
}

/**
 * Dono do estado do jogo no processo principal: sala, moedas, equipe, projetos, histórico, relógio e canal Geral.
 * Toda mudança passa por aqui, é validada, salva e publicada para a interface.
 */
export class Escritorio {
    private expediente: Expediente;
    private simulacao: SimulacaoEscritorio;
    private geral: CanalGeral;
    private mcp: ServidorMcp;
    private orquestracao: Orquestracao;
    private social: DinamicaSocial;
    private pessoal: DepartamentoPessoal;
    private agenda: AgendaDepartamento;
    private ultimasIniciativas = new Map<string, number>();
    private selecoesRecusadas = new Map<string, number>();

    constructor(
        private estado: EstadoSalvo,
        private salvar: (estado: EstadoSalvo) => void,
        private emitir: (evento: EventoLumon) => void,
        private pastaGeral: string,
    ) {
        estado = migrarAutoriaDiretoria(estado);
        const mesasComDono = new Set(estado.funcionarios.map((funcionario) => funcionario.mesaId));
        this.estado = { ...estado, sala: sanearSala(estado.sala, mesasComDono) };
        this.estado.funcionarios = reconciliarMesas(estado.funcionarios, this.estado.sala)
            .map((pessoa) => ({ ...pessoa, cargo: cargoAtual(pessoa.cargo), autonomia: false }));
        this.estado.refinamentos = estado.refinamentos ?? {};
        this.estado.cota = cotaAtual(estado.cota);
        this.estado.necessidadesLiberadas = liberarNecessidades(estado.necessidadesLiberadas ?? [], this.estado.sala);
        this.estado.threads = estado.threads ?? [];
        this.estado.leiturasGeral = estado.leiturasGeral ?? {};
        if (!Object.keys(this.estado.leiturasGeral).length && estado.geral?.length) {
            const ultima = estado.geral.at(-1)!;
            this.estado.leiturasGeral = Object.fromEntries(estado.funcionarios.map((pessoa) => [pessoa.id, ultima.id]));
        }
        this.estado.pensamentos = estado.pensamentos ?? {};
        this.estado.historicoPensamentos = estado.historicoPensamentos ?? {};
        for (const pensamento of [...Object.values(this.estado.pensamentos),
            ...Object.values(this.estado.historicoPensamentos).flat()]) pensamento.id ??= randomUUID();
        const recuperarFerramenta = (ferramenta: Mensagem['ferramentas'][number]) =>
            ferramenta.estado === 'rodando' ? { ...ferramenta, estado: 'recusada' as const,
                concluidaEm: new Date().toISOString(), saida: 'O aplicativo foi encerrado durante esta ação.' }
                : ferramenta;
        this.estado.conversas = Object.fromEntries(Object.entries(this.estado.conversas ?? {}).map(([id, mensagens]) => [
            id,
            mensagens.map((mensagem) => {
                if (!mensagem.ferramentas.some((ferramenta) => ferramenta.estado === 'rodando')) return mensagem;
                return { ...mensagem, erro: mensagem.erro ?? 'Tarefa interrompida.',
                    ferramentas: mensagem.ferramentas.map(recuperarFerramenta),
                    partes: mensagem.partes?.map((parte) => parte.tipo === 'ferramenta'
                        ? { ...parte, ferramenta: recuperarFerramenta(parte.ferramenta) } : parte),
                };
            }),
        ]));
        this.estado.social = estado.social ?? esquemaSocial.parse({});
        this.estado.trabalhos = (estado.trabalhos ?? []).map((item) => item.estado === 'trabalhando'
            ? { ...item, estado: 'interrompido', resultado: 'O aplicativo foi encerrado durante este trabalho.',
                eventos: item.eventos?.map((evento) => evento.parte.tipo === 'ferramenta'
                    && evento.parte.ferramenta.estado === 'rodando' ? {
                        ...evento, parte: { ...evento.parte,
                            ferramenta: { ...evento.parte.ferramenta, estado: 'recusada' as const } },
                    } : evento),
            } : item);
        if (JSON.stringify(this.estado) !== JSON.stringify(estado)) this.salvar(this.estado);
        this.mcp = new ServidorMcp({
            estadoEtapa: (id) => this.estadoEtapa(id),
            autorizarFerramenta: (id, origem, nome) => {
                if (!this.buscarFuncionario(id)) return 'Funcionário ausente.';
                if (origemSocial(origem) && this.simulacao.emPausaNoItem(id)) {
                    const conversaNaPausa = origem === 'reservado' && !!this.simulacao.parceiroDePausa(id);
                    if (!conversaNaPausa || !ferramentasConversaNaPausa.includes(nome)) {
                        return 'Durante a pausa, só é permitido conversar em particular com quem divide o item.';
                    }
                }
                const ausencia = this.simulacao.ausenciaDe(id);
                if (ausencia && !conversaDuranteAusencia(ausencia.motivo)) return `Você está fora da sala (${nomesAusencia[ausencia.motivo].toLowerCase()}).`;
                if (origem === 'trabalho' && !['revisar_trabalho', 'ver_escritorio', 'consultar'].includes(nome)
                    && !this.arquivoAtivo(id)) return 'Nenhum refinamento ativo.';
                const refinando = !!this.arquivoAtivo(id);
                if (origem === 'trabalho' && refinando && !ferramentasDoRefinamento.includes(nome)) {
                    return 'Durante o refinamento, use apenas as ferramentas do Work.';
                }
                if (origemSocial(origem) && refinando) {
                    return 'Você está refinando no Work. Conclua a etapa antes de outras ações.';
                }
                if (origem === 'trabalho' && this.estadoEtapa(id).terminal
                    && !['abrir_arquivo', 'refinar', 'ver_escritorio', 'revisar_trabalho', 'consultar']
                        .includes(nome)) {
                    return 'Etapa encerrada. Resuma os resultados sem novas ações.';
                }
                if (origemSocial(origem) && this.geral.participacaoEncerrada(id)) {
                    return 'Sua ação já encerrou a participação neste turno.';
                }
                if (origemSocial(origem) && this.geral.emReflexao(id) && !this.geral.atendeDiretoria(id)
                    && !['ver_escritorio', 'consultar_acontecimento', 'consultar', 'atualizar_pensamento',
                        'reagir_ao_acontecimento', 'conversar_reservado', 'nenhuma_acao', 'interagir_socialmente',
                        'propor_mudanca', 'escolher_carreira'].includes(nome)) {
                    return 'Essa ação não está disponível no turno de reação.';
                }
            },
            consertarItem: (id, itemId) => this.consertarItem(id, itemId),
            abrirArquivo: (id) => this.abrirArquivo(id),
            refinar: (id, celulas, temperamento) => this.refinarArquivo(id, celulas, temperamento),
            verEscritorio: (id) => this.descreverEscritorio(id),
            fazerPausa: (id, atividade, minutos, origem) => this.fazerPausa(id, atividade, minutos, origem),
            falarNoGeral: (id, mensagem) => {
                if (!this.buscarFuncionario(id)) return 'Funcionário não encontrado.';
                return this.geral.falarDoAgente(id, mensagem);
            },
            falarComResponsavel: (id, mensagem) => this.falarComResponsavel(id, mensagem),
            atualizarPensamento: (id, pensamento) => this.atualizarPensamento(id, pensamento),
            silenciar: (id) => this.geral.guardarSilencio(id),
            delegar: async (id, destino, tarefa) => {
                const problema = this.problemaNaTarefaDelegada(id, tarefa);
                if (problema) return `Delegação recusada: ${problema} Confira a grade em abrir_arquivo.`;
                return this.orquestracao.delegar(id, destino, tarefa);
            },
            cancelarDelegacao: (id) => this.orquestracao.cancelarDelegacao(id),
            interagir: async (id, referencia, acao, mensagem, alcance, fontes, sobreId, origem) => {
                const destino = this.social.idDe(referencia);
                if (this.simulacao.emPausaNoItem(destino) && alcance !== 'reservado') {
                    return 'O colega está em pausa e indisponível no Geral. Converse somente em particular.';
                }
                const companhia = this.simulacao.parceiroDePausa(id);
                if (companhia && (destino !== companhia || alcance !== 'reservado')) {
                    return 'Durante a pausa, converse em particular somente com quem divide o item.';
                }
                if (origemSocial(origem) && this.geral.participacaoEncerrada(id)) {
                    return 'Sua ação já encerrou a participação neste turno. Aguarde uma nova mensagem.';
                }
                if (origemSocial(origem) && this.geral.emReflexao(id) && acao === 'cobrar'
                    && !this.geral.atendeDiretoria(id) && !this.disciplina(id)) {
                    return 'Cobranças no turno de reação cabem à liderança. Você pode contestar ou dialogar com o colega.';
                }
                const resultado = origem === 'chat' && acao === 'reservado'
                    ? await this.social.conversarAguardando(id, destino, mensagem, fontes, sobreId)
                    : await this.social.interagirComEncontro(id, destino, acao, mensagem, alcance, fontes, sobreId);
                if (resultado.startsWith('Ação registrada [')) {
                    this.geral.registrarAcao(id, origemSocial(origem)
                        && (alcance === 'publico' || acao === 'cobrar' || acao === 'elogiar'));
                }
                return resultado;
            },
            reagir: (id, evento, reacao, motivo, pessoaId) => this.social.reagir(id, evento, reacao, motivo, pessoaId),
            escolherCarreira: (id, cargo) => this.escolherCarreira(id, cargo),
            propor: (id, alvo, tipo, motivo, evidencias, candidato) =>
                this.social.propor(id, alvo, tipo, motivo, evidencias, candidato),
            apoiar: (id, proposta, fonte) => this.social.apoiar(id, proposta, fonte),
            planejar: (id, colega, objetivo, motivo, fonte) => this.social.planejar(id, colega, objetivo, motivo, fonte),
            cancelarIntencao: (id, intencao, motivo) => this.social.cancelarIntencao(id, intencao, motivo),
            consultar: (id, eventoId) => {
                const evento = this.social.acontecimentos().find((item) =>
                    item.id === eventoId && podeConhecer(item, id));
                return evento ? JSON.stringify(evento, (chave, valor: unknown) =>
                    chave === 'impactosRelacao' ? undefined : valor) : 'Acontecimento não disponível para você.';
            },
            consultarHistorico: (id, busca, tipo, limite, filtros) =>
                this.social.consultarHistorico(id, busca, tipo, limite, filtros),
            revisar: (_id, trabalhoId) => this.revisarTrabalho(trabalhoId),
            validarEntrega: (id, validacao) => this.orquestracao.registrarValidacao(id, validacao),
            refazer: (id, trabalho, motivo) => this.orquestracao.pedirRefazer(id, trabalho, motivo),
            incentivar: (id, tipo, motivo, alvo) => {
                if (this.buscarFuncionario(id)?.cargo !== 'supervisor') return 'Somente o supervisor concede incentivos.';
                const resultado = this.pessoal.concederIncentivo(id, tipo, motivo, alvo);
                return resultado.ok ? 'Incentivo concedido e anunciado à equipe.' : resultado.erro;
            },
            sessaoBemEstar: (id, alvo, mensagem) => this.pessoal.sessaoBemEstar(id, alvo, mensagem),
            cargo: (id) => this.buscarFuncionario(id)?.cargo,
        });
        this.expediente = new Expediente({
            conversa: (id) => this.estado.conversas[id] ?? [],
            gravarConversa: (id, mensagens) => {
                this.estado = { ...this.estado, conversas: { ...this.estado.conversas, [id]: mensagens } };
                this.salvar(this.estado);
            },
            emitirConversa: (id) => this.emitir({ tipo: 'conversa', funcionarioId: id, mensagens: this.conversa(id) }),
            emitirEstado: () => this.publicar(),
            contextoTurno: (id) => this.contextoTurno(id),
            confirmarPercepcao: (id, canal) => this.social.confirmarLeitura(id, canal),
            personalidade: (id) => this.social.personalidade(id),
            ferramentasTrabalho: (id) => this.arquivoAtivo(id) ? [...ferramentasDoRefinamento] : undefined,
            urlMcp: (id, origem) => this.mcp.urlDe(id, origem),
            acontecer: (id, acontecimento) => this.simulacao.registrar(id, acontecimento),
            conversaEncerrada: (id) => this.liberarEncontroOcioso(id),
            pastaConversa: pastaGeral,
        });
        this.orquestracao = new Orquestracao({
            funcionarios: () => this.estado.funcionarios,
            projetos: () => this.estado.projetos,
            trabalhos: () => this.estado.trabalhos,
            gravar: (trabalhos) => this.atualizar({ trabalhos }),
            status: (id) => this.simulacao?.emPausa(id) ? 'em_pausa' : this.expediente.statusDe(id),
            executar: (funcionario, projeto, tarefa, threadId, observar) => {
                this.geral.dispensar(funcionario.id);
                this.simulacao.cancelarEncontro(funcionario.id);
                return this.expediente.enviarEAguardar(funcionario, projeto, tarefa, threadId, observar);
            },
            interromper: (id) => this.expediente.interromper(id),
            adequacao: (liderId, id) => {
                const relacao = this.estado.social.relacoes.find((item) => item.autorId === liderId
                    && item.colegaId === id);
                const necessidades = this.simulacao.necessidadesDe(id);
                return necessidades.energia - necessidades.estresse - necessidades.fome / 2
                    - (necessidades.esgotamento ?? 0) / 2 + (relacao?.confianca ?? 50) / 5;
            },
            afastado: (id, liderId) => this.estado.social.afastamentos[id]?.includes(liderId) ?? false,
            impedimento: (id) => this.impedimentoTrabalho(id),
            acontecer: (trabalho, tipo) => this.registrarTrabalhoSocial(trabalho, tipo),
            cobrar: (id, trabalho, motivo) => {
                const fonte = this.estado.social.eventos.findLast((item) => item.trabalhoId === trabalho.id);
                return this.social.interagir(id, trabalho.funcionarioId, 'cobrar', motivo,
                    'publico', fonte ? [fonte.id] : [], trabalho.id);
            },
            aprovar: (trabalhoId) => {
                const trabalho = this.estado.trabalhos.find((item) => item.id === trabalhoId);
                if (!trabalho?.avaliacao) return falha('Entrega não encontrada.');
                const arquivo = trabalho.arquivoId ? this.estado.refinamentos[trabalho.arquivoId] : undefined;
                if (!arquivo && !trabalho.avaliacao.validacao) return falha('Validação não encontrada.');
                if (arquivo && this.estado.trabalhos.some((item) => item.arquivoId === arquivo.id
                    && item.avaliacao?.estado === 'aprovada')) return falha('Arquivo já recompensado.');
                if (this.estado.trabalhos.some((item) => item.pedidoId === trabalho.pedidoId
                    && item.avaliacao?.estado === 'aprovada')) return sucesso;
                const cotaAnterior = cotaAtual(this.estado.cota);
                const cota = arquivo ? creditarArquivo(cotaAnterior, arquivo) : cotaAnterior;
                const cumpriuCota = cotaAnterior.grupos < metaDiaria && cota.grupos >= metaDiaria;
                const bonusCota = cumpriuCota ? bonusCotaDiaria : 0;
                const recompensa = (arquivo ? recompensaRefinamento(arquivo)
                    : recompensaEntrega(trabalho.avaliacao.validacao!)) + bonusCota;
                const participantes = new Set(this.estado.trabalhos.filter((item) =>
                    item.pedidoId === trabalho.pedidoId).map((item) => item.funcionarioId));
                for (const id of participantes) this.ajustarMerito(id, ganhosMerito.entregaAprovada);
                this.atualizar({ moedas: this.estado.moedas + recompensa, cota,
                    trabalhos: this.estado.trabalhos.map((item) => item.id === trabalhoId ? {
                        ...item, avaliacao: { ...trabalho.avaliacao!, estado: 'aprovada',
                            recompensa, avaliadaEm: new Date().toISOString(), motivo: undefined },
                    } : item),
                });
                this.social.registrar({ tipo: 'decisao', autorId: 'diretoria', trabalhoId,
                    alvoId: trabalho.funcionarioId, texto: `Entrega aprovada: ${trabalho.tarefa.slice(0, 400)}. `
                        + `Recompensa do pedido: ${recompensa} moedas.`,
                    alcance: 'publico', ouvintes: [], fontes: [] });
                if (cumpriuCota) {
                    this.social.registrar({ tipo: 'decisao', autorId: 'diretoria', trabalhoId,
                        texto: `${comunicadoDiretoria(cota, false)} Bônus pela cota diária: ${bonusCota} moedas.`,
                        alcance: 'publico', ouvintes: [], fontes: [] });
                }
                return sucesso;
            },
            prepararCorrecao: (arquivoId, motivo) => {
                const arquivo = this.estado.refinamentos[arquivoId];
                if (!arquivo) return falha('Arquivo não encontrado.');
                if (this.estado.trabalhos.some((item) => item.arquivoId === arquivoId
                    && item.avaliacao?.estado === 'aprovada')) return falha('Arquivo já aprovado.');
                const prazo = new Date(Date.now() + arquivo.duracaoMinutos * 60000).toISOString();
                this.atualizar({ refinamentos: { ...this.estado.refinamentos, [arquivoId]: {
                    ...arquivo, prazo, rodadas: [...arquivo.rodadas,
                        { prazo, motivo, iniciadaEm: new Date().toISOString() }],
                } } });
                return sucesso;
            },
            rejeitar: (trabalhoId, motivo) => {
                const trabalho = this.estado.trabalhos.find((item) => item.id === trabalhoId);
                if (!trabalho?.avaliacao) return falha('Trabalho não encontrado.');
                const participantes = new Set(this.estado.trabalhos.filter((item) =>
                    item.pedidoId === trabalho.pedidoId).map((item) => item.funcionarioId));
                for (const id of participantes) {
                    this.simulacao.registrar(id, 'entrega_rejeitada');
                    this.ajustarMerito(id, ganhosMerito.entregaRejeitada);
                }
                this.atualizar({ necessidades: this.simulacao.todasNecessidades(),
                    trabalhos: this.estado.trabalhos.map((item) => item.id === trabalhoId ? {
                        ...item, avaliacao: { ...trabalho.avaliacao!, estado: 'reprovada', motivo,
                            recompensa: 0, avaliadaEm: new Date().toISOString() },
                    } : item),
                });
                this.social.registrar({ tipo: 'falha', autorId: 'diretoria', trabalhoId,
                    alvoId: trabalho.funcionarioId, texto: `A entrega da equipe foi rejeitada. Motivo: ${motivo}. `
                        + `Trabalho: ${trabalho.tarefa.slice(0, 350)}. A avaliação foi encerrada sem recompensa.`,
                    alcance: 'publico', ouvintes: [], fontes: [] });
                return sucesso;
            },
        });
        this.simulacao = new SimulacaoEscritorio({
            registrarPausa: (pausa) => {
                const atividades: Partial<Record<Atividade, string>> = {
                    cafe: 'tomar café', comendo: 'comer', descansando: 'descansar',
                    ouvindo_musica: 'ouvir música',
                };
                const nome = this.buscarFuncionario(pausa.funcionarioId)?.nome ?? 'Funcionário';
                const origem = 'por decisão própria, via ferramenta';
                const acao = pausa.fase === 'inicio' ? 'Saiu para' : pausa.fase === 'conclusao'
                    ? 'Concluiu a pausa para' : 'Não conseguiu concluir a pausa para';
                this.social.registrar({ tipo: 'pausa', autorId: pausa.funcionarioId,
                    texto: `${nome}: ${acao.toLowerCase()} ${atividades[pausa.atividade]} ${origem}.`
                        + (pausa.motivo ? ` Motivo: ${pausa.motivo}` : ''),
                    alcance: 'publico', ouvintes: [], fontes: [] }, false);
                if (pausa.fase === 'conclusao') this.desgastarItem(pausa.itemId, pausa.funcionarioId);
            },
            aoCompartilharPausa: (id, colegaId, itemId) => {
                const item = this.estado.sala.itens.find((movel) => movel.id === itemId);
                const colega = this.buscarFuncionario(colegaId);
                if (!item || !colega) return;
                this.geral.notificarReservado(id, colegaId,
                    `Vocês dividem ${catalogo[item.tipo].nome} durante a pausa. `
                    + `Oportunidade de conversa à toa com ${colega.nome}: comente algo leve ou faça uma pergunta pessoal. `
                    + 'Considere sua relação com esse colega. Não cobre trabalho nem relate necessidades. '
                    + 'A conversa é opcional e fica entre vocês, no próprio item, com a recuperação e o prazo mantidos.');
            },
            aoEncerrarCompanhia: (id, colegaId) => this.geral.encerrarReservado(id, colegaId),
            sala: () => this.estado.sala,
            necessidadesLiberadas: () => this.estado.necessidadesLiberadas,
            funcionarios: () => this.estado.funcionarios,
            statusTrabalho: (id) => this.expediente.statusDe(id),
            emConversa: (id) => this.expediente.emConversa(id),
            emTurnoSocial: (id) => this.geral?.emExecucao(id) ?? false,
            aoOcioso: (id) => {
                if (this.social && !this.expediente.emConversa(id) && !this.geral?.emExecucao(id)) {
                    this.geral.avisarEstado(id);
                    this.social.retomarIntencao(id);
                }
            },
            relogioInicial: this.estado.relogio,
            necessidadesIniciais: this.estado.necessidades,
            pausasIniciais: this.estado.pausas,
            gravar: (relogio, necessidades) => {
                this.estado = { ...this.estado, relogio, necessidades: { ...necessidades } };
                this.salvar(this.estado);
            },
            gravarPausas: (pausas) => this.atualizar({ pausas }),
            aoInterromperEncontro: (id, colegaId, preservarTurno) =>
                this.geral.encerrarReservado(id, colegaId, preservarTurno ? id : undefined),
            emitirQuadro: (quadro) => this.emitir({ tipo: 'simulacao', quadro }),
            emitirEstado: () => this.publicar(),
            ausenciasIniciais: this.estado.ausencias,
            gravarAusencias: (ausencias) => this.atualizar({ ausencias }),
            aoRetornar: (id, ausencia) => this.pessoal.retornou(id, ausencia),
        });
        this.social = new DinamicaSocial({
            estado: () => this.estado.social,
            funcionarios: () => this.estado.funcionarios,
            demissoes: () => this.estado.demissoes,
            agentes: () => this.simulacao.agentes(),
            encontrar: (id, alvoId) => {
                const retorno = this.simulacao.encontrarColega(id, alvoId);
                if (this.simulacao.emPausa(id) && this.simulacao.parceiroDePausa(id) !== alvoId) {
                    this.geral.pausaIniciada(id);
                }
                return retorno;
            },
            gravar: (social) => this.atualizar({ social }),
            pensamentos: (id) => [...(this.estado.historicoPensamentos[id] ?? []),
                ...(this.estado.pensamentos[id] ? [this.estado.pensamentos[id]!] : [])],
            notificar: (ids, motivo) => this.geral.notificar(ids, motivo),
            notificarReservado: (id, autorId, motivo) => this.geral.notificarReservado(id, autorId, motivo),
            manterEncontro: (id, alvoId) => this.simulacao.manterEncontro(id, alvoId),
            estressar: (id, delta) => this.simulacao.ajustarEstresse(id, delta),
            esgotar: (id, delta) => this.simulacao.ajustarEsgotamento(id, delta),
            esgotado: (id) => recusaTrabalho(this.simulacao.necessidadesDe(id).esgotamento ?? 0),
            bloqueioPromocao: (id) => this.bloqueioPromocao(id),
            objetivoCarreira: (id) => {
                const pessoa = this.buscarFuncionario(id);
                return pessoa ? proximoCargo(pessoa.cargo, this.estado.carreira[id]?.objetivo) : undefined;
            },
            bloqueioTroca: (id, cargo) => this.bloqueioTroca(id, cargo),
            aoRegistrar: (evento) => {
                for (const [id, delta] of meritoDoEvento(evento)) this.ajustarMerito(id, delta);
            },
            decidir: (proposta) => this.executarProposta(proposta),
            nomeResponsavel: () => 'Diretoria',
        });
        this.pessoal = new DepartamentoPessoal({
            funcionarios: () => this.estado.funcionarios,
            moedas: () => this.estado.moedas,
            debitar: (valor) => this.atualizar({ moedas: this.estado.moedas - valor }),
            status: (id) => this.expediente.statusDe(id),
            necessidades: (id) => this.simulacao.necessidadesDe(id),
            personalidade: (id) => this.estado.social.personalidades[id] ?? criarPersonalidade(id),
            confianca: (autorId, colegaId) => this.social.confianca(autorId, colegaId),
            afastar: (id, ausencia, segundos) => this.simulacao.afastar(id, ausencia, segundos),
            validarAfastamento: (ids, motivo) => this.simulacao.validarAfastamento(ids, motivo),
            aguardarChegadaAnexos: (ids) => this.simulacao.aguardarChegadaAnexos(ids),
            ausencia: (id) => this.simulacao.ausenciaDe(id),
            dispensar: (id) => {
                this.expediente.dispensar(id);
                this.geral.dispensar(id);
            },
            estressar: (id, delta) => this.simulacao.ajustarEstresse(id, delta),
            esgotar: (id, delta) => this.simulacao.ajustarEsgotamento(id, delta),
            registrar: (evento, notificar) => this.social.registrar(evento, notificar),
            ajustarRelacao: (autorId, colegaId, eventoId, delta) =>
                this.social.ajustarRelacao(autorId, colegaId, eventoId, delta),
            conversarReservado: async (autorId, alvoId, texto) => this.social.interagir(autorId, alvoId,
                'reservado', texto.slice(0, 600), 'reservado', []),
        });
        this.agenda = new AgendaDepartamento({
            primeiraMetaCumprida: () => !!this.estado.cota.primeiraMetaEm,
            funcionarios: () => this.estado.funcionarios,
            arquivos: () => Object.values(this.estado.refinamentos),
            eventos: () => [...this.estado.social.historico, ...this.estado.social.eventos],
            podeReceberArquivo: () => !this.estado.trabalhos.some((item) => item.estado === 'trabalhando'
                || item.avaliacao?.estado === 'aguardando_aprovacao')
                && this.estado.funcionarios.some((pessoa) => pessoa.cargo === 'lider'
                    && !this.impedimentoTrabalho(pessoa.id)
                    && !this.simulacao.emPausa(pessoa.id)
                    && !['trabalhando', 'bloqueado'].includes(this.expediente.statusDe(pessoa.id))),
            entregarArquivo: () => {
                const resultado = this.iniciarRefinamento(duracaoArquivoDiretoriaMinutos);
                if (!resultado.ok) return resultado;
                const arquivo = Object.values(this.estado.refinamentos).at(-1)!;
                return { ok: true, arquivoId: arquivo.id, nome: arquivo.nome, prazo: arquivo.prazo };
            },
            disponivel: (id) => !this.simulacao.ausenciaDe(id),
            estressar: (id, delta) => this.simulacao.ajustarEstresse(id, delta),
            registrar: (evento) => this.social.registrar(evento),
            emitirEstado: () => this.publicar(),
        });
        this.geral = new CanalGeral({
            funcionarios: () => this.estado.funcionarios,
            mensagens: () => this.estado.geral,
            gravar: (mensagens) => {
                this.estado = { ...this.estado, geral: mensagens };
                this.salvar(this.estado);
            },
            contexto: (id) => this.contextoGeral(id),
            confirmarPercepcao: (id) => this.social.confirmarLeitura(id, 'social'),
            personalidade: (id) => this.social.personalidade(id),
            contextoReservado: (id, colegaId) => this.simulacao.conversaNaPausa(id, colegaId),
            historicoReservado: (id, colegaId) => this.estado.social.eventos.filter((evento) =>
                evento.criadoEm >= (this.simulacao.conversaNaPausa(id, colegaId)?.desde ?? '') &&
                evento.alcance === 'reservado' && evento.ouvintes.length === 2
                    && evento.ouvintes.includes(id) && evento.ouvintes.includes(colegaId))
                .slice(-20).map((evento) => `${evento.autorNome}: ${evento.texto}`).join('\n'),
            responderReservado: (id, colegaId, texto) =>
                this.social.interagirComEncontro(id, colegaId, 'reservado', texto.slice(0, 600), 'reservado', []),
            reservadoSemResposta: (id, colegaId) => this.social.respostaAusente(id, colegaId),
            conversaReservadaEncerrada: (id, colegaId) => {
                if (this.simulacao.parceiroEncontro(id) === colegaId) this.simulacao.cancelarEncontro(id);
            },
            leitura: (id) => this.estado.leiturasGeral[id],
            gravarLeitura: (id, mensagemId) => this.atualizar({
                leiturasGeral: { ...this.estado.leiturasGeral, [id]: mensagemId },
            }),
            limparLeituras: () => this.atualizar({ leiturasGeral: {} }),
            nomeResponsavel: () => 'Diretoria',
            registrarFala: (id, texto) => this.social.registrar({ tipo: 'fala', autorId: id, texto,
                alcance: 'publico', ouvintes: [], fontes: [] }, false).id,
            urlMcp: (id, reservado) => this.mcp.urlDe(id, reservado ? 'reservado' : 'geral'),
            ferramentasReservadas: (id) => this.simulacao.emPausaNoItem(id)
                ? ferramentasConversaNaPausa.slice() : undefined,
            emPausa: (id) => this.simulacao.emPausaNoItem(id),
            pasta: pastaGeral,
            emitirMensagens: () => this.emitir({ tipo: 'geral', mensagens: this.estado.geral }),
            emitirEstado: () => this.publicar(),
            disponivel: (id, reservadoCom, citado) => (citado || !!reservadoCom
                    || !['trabalhando', 'bloqueado'].includes(this.expediente.statusDe(id)))
                && this.simulacao.podeResponderSocialmente(id, reservadoCom)
                && (!this.simulacao.parceiroEncontro(id) || this.simulacao.parceiroEncontro(id) === reservadoCom),
        });
        this.podarEventosOrfaos();
    }

    publico(): EstadoPublico {
        const { moedas, sala, funcionarios, projetos, demissoes } = this.estado;
        const { status, aprovacoes } = this.expediente.situacao(funcionarios);
        const conversandoIds = funcionarios.filter((pessoa) => this.expediente.emConversa(pessoa.id))
            .map((pessoa) => pessoa.id);
        for (const id of conversandoIds) {
            if (status[id] === 'trabalhando') status[id] = 'ocioso';
        }
        for (const funcionario of funcionarios) {
            if (!this.estado.ausencias[funcionario.id] && this.simulacao?.parceiroEncontro(funcionario.id)) {
                status[funcionario.id] = 'conversando';
            } else if (this.simulacao?.emPausa(funcionario.id)) status[funcionario.id] = 'em_pausa';
        }
        return {
            moedas,
            sala,
            funcionarios,
            projetos,
            demissoes,
            status,
            conversandoIds,
            aprovacoes,
            refinamentos: this.estado.refinamentos,
            cota: cotaAtual(this.estado.cota),
            naoLidas: this.estado.naoLidas ?? {},
            ausencias: this.simulacao?.todasAusencias() ?? this.estado.ausencias,
            carreira: this.estado.carreira,
            pensamentos: this.estado.pensamentos,
            trabalhos: this.estado.trabalhos,
            threads: this.estado.threads,
            social: this.estado.social,
            necessidades: this.simulacao?.todasNecessidades() ?? this.estado.necessidades,
            geral: this.geral?.situacao() ?? {
                falandoId: null, conversaLivre: false, conversaAtiva: false, encerrando: false,
                semLimite: false, falasRestantes: 0,
            },
        };
    }

    conversa(funcionarioId: string): Mensagem[] {
        return this.estado.conversas[funcionarioId] ?? [];
    }

    mensagensGeral(): MensagemGeral[] {
        return this.estado.geral;
    }

    /** Inicia um arquivo de macrodados em uma pasta exclusiva do escritório. */
    iniciarRefinamento(minutos: number): Resultado {
        if (!Number.isInteger(minutos) || minutos < 1 || minutos > 60) return falha('Escolha de 1 a 60 minutos.');
        const pasta = join(this.pastaGeral, 'macrodados');
        mkdirSync(pasta, { recursive: true });
        let projeto = this.estado.projetos.find((item) => item.pasta === pasta);
        if (!projeto) {
            projeto = { id: randomUUID(), nome: nomeProjetoMacrodados, pasta };
            this.atualizar({ projetos: [...this.estado.projetos, projeto] });
        }
        const arquivo = { ...gerarArquivo(Date.now(), new Date(Date.now() + minutos * 60000)),
            duracaoMinutos: minutos };
        this.atualizar({ refinamentos: { ...this.estado.refinamentos, [arquivo.id]: arquivo } });
        const resultado = this.orquestracao.enviar(projeto.id,
            `Refine o arquivo ${arquivo.nome}. Prazo: ${formatarPrazo(arquivo)}.`,
            threadPrincipal, undefined, arquivo.id);
        if (!resultado.ok) {
            const refinamentos = { ...this.estado.refinamentos };
            delete refinamentos[arquivo.id];
            this.atualizar({ refinamentos });
        }
        return resultado;
    }

    private arquivoAtivo(funcionarioId: string) {
        const trabalho = this.estado.trabalhos.findLast((item) => item.funcionarioId === funcionarioId
            && item.estado === 'trabalhando');
        return trabalho?.arquivoId ? this.estado.refinamentos[trabalho.arquivoId] : undefined;
    }

    private estadoEtapa(id: string): { codigo: string; terminal: boolean } {
        const arquivo = this.arquivoAtivo(id);
        if (!arquivo) return { codigo: 'sem_arquivo', terminal: true };
        if (Date.now() >= Date.parse(arquivo.prazo)) return { codigo: 'prazo_encerrado', terminal: true };
        if (progressoRefinamento(arquivo) === 100) return { codigo: 'arquivo_concluido', terminal: true };
        const trabalho = this.estado.trabalhos.findLast((item) => item.funcionarioId === id
            && item.estado === 'trabalhando');
        if (trabalho && this.esgotouSelecoes(trabalho)) return { codigo: 'tentativas_esgotadas', terminal: true };
        const envios = arquivo.envios.filter((item) => item.trabalhoId === trabalho?.id);
        const terminou = !!trabalho?.solicitante?.id && (envios.length >= this.limiteEnvios(id)
            || envios.some((item) => item.resultado === 'aceito'));
        return { codigo: terminou ? 'etapa_encerrada' : 'etapa_ativa', terminal: terminou };
    }

    private esgotouSelecoes(trabalho: RegistroTrabalho): boolean {
        const limite = trabalho.solicitante?.id ? limiteSelecoesRecusadasDelegado : limiteSelecoesRecusadasLider;
        return (this.selecoesRecusadas.get(trabalho.id) ?? 0) >= limite;
    }

    private recusarSelecao(trabalho: RegistroTrabalho, motivo: string): string {
        this.selecoesRecusadas.set(trabalho.id, (this.selecoesRecusadas.get(trabalho.id) ?? 0) + 1);
        if (!this.esgotouSelecoes(trabalho)) return `Envio não registrado: ${motivo}`;
        return `Envio não registrado: ${motivo} Você insistiu em seleções inválidas e sua etapa foi encerrada. `
            + (trabalho.solicitante?.id ? 'Devolva ao líder o que foi testado.' : 'Resuma a entrega à Diretoria.');
    }

    private limiteEnvios(funcionarioId: string): number {
        const funcionario = this.buscarFuncionario(funcionarioId);
        return funcionario ? limiteEnviosEtapa(funcionario.cargo) : 4;
    }

    private abrirArquivo(funcionarioId: string): string {
        const arquivo = this.arquivoAtivo(funcionarioId);
        if (!arquivo) return 'Nenhum arquivo ativo neste turno.';
        if (Date.now() >= Date.parse(arquivo.prazo)) return 'Prazo encerrado. Resuma a entrega.';
        return `Arquivo ${arquivo.nome}. Prazo: ${formatarPrazo(arquivo)}. Progresso: ${progressoRefinamento(arquivo)}%.\n`
            + this.descreverCota() + '\n'
            + (progressoRefinamento(arquivo) === 100 ? 'Arquivo concluído. Resuma a entrega.\n' : '')
            + descreverGrade(arquivo) + '\nEnvios recentes da equipe:\n' + descreverEnvios(arquivo);
    }

    /**
     * Histórico legível de um pedido de Macrodados para `revisar_trabalho`. Sem ID válido, mostra o último pedido
     * principal e avisa quando não há nada em andamento, para o agente não procurar trabalho inexistente.
     */
    private revisarTrabalho(trabalhoId?: string): string {
        const principais = this.estado.trabalhos.filter((item) => item.arquivoId && !item.solicitante?.id);
        const pedido = trabalhoId ? this.estado.trabalhos.find((item) => item.id === trabalhoId) : undefined;
        const trabalho = pedido ?? principais.at(-1);
        const aviso = trabalhoId && !pedido
            ? `"${trabalhoId}" não é um ID de trabalho. Mostrando o último pedido de Macrodados.\n` : '';
        if (!trabalho) return `${aviso}Nenhum arquivo de Macrodados foi iniciado ainda. ${this.situacaoTrabalho()}`;
        const arquivo = trabalho.arquivoId ? this.estado.refinamentos[trabalho.arquivoId] : undefined;
        const etapas = this.estado.trabalhos.filter((item) => item.pedidoId === trabalho.pedidoId).map((item) =>
            `* ${item.nome} [${item.id}], ${item.estado}: ${item.tarefa.slice(0, 200)}`
                + (item.resultado ? `\n  Resultado: ${item.resultado.slice(0, 400)}` : ''));
        const avaliacao = trabalho.avaliacao;
        const anteriores = principais.filter((item) => item.pedidoId !== trabalho.pedidoId).slice(-3)
            .map((item) => `[${item.id}] ${item.criadoEm}, ${item.avaliacao?.estado ?? item.estado}`);
        return [
            aviso + `Pedido [${trabalho.id}] de ${trabalho.criadoEm}: ${trabalho.estado}.`,
            ...(arquivo ? [`Arquivo ${arquivo.nome}, progresso ${progressoRefinamento(arquivo)}%.`] : []),
            `Avaliação da Diretoria: ${avaliacao ? avaliacao.estado : 'não registrada'}`
                + `${avaliacao?.motivo ? `. Motivo: ${avaliacao.motivo}` : ''}.`,
            `Etapas:\n${etapas.join('\n')}`,
            ...(arquivo ? [`Envios:\n${descreverEnvios(arquivo)}`] : []),
            ...(anteriores.length ? [`Pedidos anteriores: ${anteriores.join('; ')}.`] : []),
            this.situacaoTrabalho(),
        ].join('\n');
    }

    /** Frase objetiva sobre o trabalho atual, repetida nas consultas para impedir cobranças sem arquivo. */
    private situacaoTrabalho(): string {
        const ativos = this.estado.trabalhos.filter((item) => item.estado === 'trabalhando');
        if (ativos.length) {
            return `Em andamento agora: ${ativos.map((item) => `${item.nome} [${item.id}]`).join(', ')}.`;
        }
        return 'Nenhum arquivo em andamento agora. Só a Diretoria inicia o próximo pelo Work; até lá não há '
            + 'etapa para assumir, distribuir, cobrar ou revisar.';
    }

    private descreverCota(): string {
        const cota = cotaAtual(this.estado.cota);
        return `Cota do departamento: ${cota.grupos}/${metaDiaria} grupos aprovados hoje. `
            + comunicadoDiretoria(cota, true);
    }

    private problemaNaTarefaDelegada(liderId: string, tarefa: string): string | undefined {
        const arquivo = this.arquivoAtivo(liderId);
        const celulas = tarefa.toUpperCase().match(/\b[A-H](?:10|[1-9])\b/g) ?? [];
        if (!arquivo || celulas.length !== 3) return undefined;
        return problemaSelecao(arquivo, celulas);
    }

    private refinarArquivo(funcionarioId: string, celulas: string[], temperamento: Temperamento): string {
        const arquivo = this.arquivoAtivo(funcionarioId);
        if (!arquivo) return 'Nenhum arquivo ativo neste turno.';
        if (Date.now() >= Date.parse(arquivo.prazo)) return 'Prazo encerrado. Resuma a entrega.';
        const trabalho = this.estado.trabalhos.findLast((item) => item.funcionarioId === funcionarioId
            && item.estado === 'trabalhando');
        if (!trabalho) return 'Nenhum trabalho ativo neste turno.';
        const anteriores = (arquivo.envios ?? []).filter((item) => item.trabalhoId === trabalho.id);
        const limite = this.limiteEnvios(funcionarioId);
        if (trabalho.solicitante?.id && (anteriores.length >= limite
            || anteriores.some((item) => item.resultado === 'aceito'))) {
            return 'Sua etapa terminou. Devolva agora ao líder as células testadas, os resultados e as pendências.';
        }
        if (this.esgotouSelecoes(trabalho)) return 'Sua etapa foi encerrada por seleções inválidas. Resuma o resultado.';
        const problema = problemaSelecao(arquivo, celulas);
        if (problema) return this.recusarSelecao(trabalho, problema);
        const envio = refinar(arquivo, funcionarioId, celulas, temperamento, trabalho.id);
        if (envio.repetida) {
            return this.recusarSelecao(trabalho, envio.repetida === 'aceita'
                ? 'esse grupo já foi aceito. Escolha outra região.'
                : 'essas células já foram rejeitadas. Escolha uma seleção diferente.');
        }
        this.atualizar({ refinamentos: { ...this.estado.refinamentos, [arquivo.id]: envio.arquivo } });
        if (envio.resultado === 'aceito') this.ajustarMerito(funcionarioId, ganhosMerito.grupoAceito);
        const enviosDaEtapa = envio.arquivo.envios.filter((item) => item.trabalhoId === trabalho.id).length;
        const etapaTerminou = trabalho.solicitante?.id
            && (enviosDaEtapa >= limite || envio.resultado === 'aceito');
        return `Envio: ${envio.resultado}. Progresso: ${progressoRefinamento(envio.arquivo)}%. `
            + orientarRefinamento(envio.resultado)
            + (progressoRefinamento(envio.arquivo) === 100 ? ' Arquivo concluído. Resuma a entrega.'
                : etapaTerminou ? ' Sua etapa terminou. Resuma e devolva ao líder para o próximo colega continuar.' : '');
    }

    adicionarProjeto(pasta: string): Resultado {
        return falha('Projetos externos são somente histórico. Inicie Macrodados pelo Work.');
    }

    contratar(dados: Contratacao): Resultado {
        const mesasOcupadas = new Set(this.estado.funcionarios.map((funcionario) => funcionario.mesaId));
        const mesa = this.estado.sala.itens.find((item) => item.tipo === 'mesa' && !mesasOcupadas.has(item.id));
        if (!mesa) return falha('Compre uma mesa livre antes de contratar.');
        const funcionario: Funcionario = {
            ...dados,
            id: randomUUID(),
            mesaId: mesa.id,
            contratadoEm: new Date().toISOString(),
        };
        this.atualizar({ funcionarios: [...this.estado.funcionarios, funcionario], social: {
            ...this.estado.social, personalidades: { ...this.estado.social.personalidades,
                [funcionario.id]: criarPersonalidade(funcionario.id) },
        } });
        this.social.registrar({ tipo: 'contratacao', autorId: 'diretoria', alvoId: funcionario.id,
            texto: `${funcionario.nome} entrou na equipe como ${nomeCargo(funcionario.cargo)}.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
        return sucesso;
    }

    /**
     * Troca nome, cargo, modelo, aparência ou autonomia. Recusa durante uma tarefa e encerra as sessões do
     * harness, para que o próximo turno já use a configuração nova. Mesa, necessidades e histórico ficam.
     */
    editar(funcionarioId: string, dados: Contratacao): Resultado {
        const atual = this.buscarFuncionario(funcionarioId);
        if (!atual) return falha('Funcionário não encontrado.');
        const status = this.expediente.statusDe(funcionarioId);
        if (status === 'trabalhando' || status === 'bloqueado' || this.simulacao.emPausa(funcionarioId)) {
            return falha(`Espere ${atual.nome} terminar a tarefa atual para editar.`);
        }
        this.expediente.dispensar(funcionarioId);
        this.geral.dispensar(funcionarioId);
        const editado: Funcionario = { ...atual, ...dados, cargo: cargoAtual(dados.cargo), autonomia: false };
        this.atualizar({
            funcionarios: this.estado.funcionarios.map((funcionario) => (funcionario.id === funcionarioId ? editado : funcionario)),
        });
        return sucesso;
    }

    demitir(funcionarioId: string, motivo: string, autor = 'Diretoria', evidencias: string[] = []): Resultado {
        const funcionario = this.buscarFuncionario(funcionarioId);
        if (!funcionario) return falha('Funcionário não encontrado.');
        this.orquestracao.interromperSeLider(funcionarioId);
        this.expediente.dispensar(funcionarioId);
        this.geral.dispensar(funcionarioId);
        this.mcp.revogar(funcionarioId);
        this.simulacao.cancelarEncontro(funcionarioId);
        const demissao = {
            id: randomUUID(),
            funcionario,
            motivo,
            demitidoPor: autor,
            evidencias,
            historicoSocial: this.estado.social.eventos.filter((evento) => evidencias.includes(evento.id)),
            data: new Date().toISOString(),
        };
        this.atualizar({
            funcionarios: this.estado.funcionarios.filter((existente) => existente.id !== funcionarioId),
            demissoes: [demissao, ...this.estado.demissoes],
            social: { ...this.estado.social,
                intencoes: this.estado.social.intencoes.map((item) => item.estado === 'pendente'
                    && (item.autorId === funcionarioId || item.colegaId === funcionarioId)
                    ? { ...item, estado: 'cancelada' as const, motivo: 'Um dos envolvidos saiu da equipe.',
                        concluidaEm: new Date().toISOString() } : item),
                propostas: this.estado.social.propostas.map((item) =>
                item.estado === 'pendente' && (item.autorId === funcionarioId || item.alvoId === funcionarioId
                    || item.candidatoId === funcionarioId) ? { ...item, estado: 'cancelada' } : item) },
        });
        this.social.registrar({ tipo: 'demissao', autorId: 'diretoria', alvoId: funcionarioId,
            alvoNome: funcionario.nome,
            texto: `${funcionario.nome} foi demitido. Solicitante: ${autor}. Motivo: ${motivo}`,
            alcance: 'publico', ouvintes: [], fontes: evidencias });
        return sucesso;
    }

    /** Abre uma conversa independente para um funcionário ou projeto existente. */
    criarThread(dados: Thread): Resultado {
        const validacao = esquemaThread.safeParse(dados);
        if (!validacao.success) return falha('Dados da thread inválidos.');
        const thread = validacao.data;
        if (this.estado.threads.some((item) => item.id === thread.id)) return falha('Essa thread já existe.');
        const destinoExiste = thread.tipo === 'work'
            ? this.estado.projetos.some((projeto) => projeto.id === thread.destinoId)
            : !!this.buscarFuncionario(thread.destinoId);
        if (!destinoExiste) return falha('Destino da thread não encontrado.');
        this.atualizar({ threads: [...this.estado.threads, thread] });
        return sucesso;
    }

    /** Altera o título usado para localizar uma conversa sem mudar seu histórico. */
    renomearThread(threadId: string, titulo: string): Resultado {
        if (!titulo.trim() || titulo.trim().length > 80) return falha('Use um título entre 1 e 80 caracteres.');
        if (!this.estado.threads.some((item) => item.id === threadId)) return falha('Thread não encontrada.');
        this.atualizar({ threads: this.estado.threads.map((item) =>
            item.id === threadId ? { ...item, titulo: titulo.trim() } : item) });
        return sucesso;
    }

    /** Apaga a thread e todo o seu histórico. A conversa principal só pode ser limpa. */
    excluirThread(threadId: string): Resultado {
        const thread = this.estado.threads.find((item) => item.id === threadId);
        if (!thread) return falha('Thread não encontrada.');
        const limpeza = thread.tipo === 'work' ? this.limparTrabalhos(threadId, thread.destinoId)
            : this.limparConversa(thread.destinoId, threadId);
        if (!limpeza.ok) return limpeza;
        this.atualizar({ threads: this.estado.threads.filter((item) => item.id !== threadId) });
        return sucesso;
    }

    private threadValida(threadId: string, tipo: Thread['tipo'], destinoId: string): boolean {
        return threadId === threadPrincipal || this.estado.threads.some((item) =>
            item.id === threadId && item.tipo === tipo && item.destinoId === destinoId);
    }

    enviar(funcionarioId: string, texto: string, threadId = threadPrincipal): Resultado {
        if (!this.threadValida(threadId, 'conversa', funcionarioId)) return falha('Thread não encontrada.');
        const funcionario = this.buscarFuncionario(funcionarioId);
        if (!funcionario) return falha('Funcionário não encontrado.');
        this.geral.dispensar(funcionarioId);
        this.simulacao.cancelarEncontro(funcionarioId);
        const resultado = this.expediente.enviar(funcionario, undefined, texto, threadId);
        if (resultado.ok) this.social.registrar({
            tipo: 'fala', autorId: 'diretoria', alvoId: funcionarioId,
            texto: `${prefixoRelatoChat}${texto}`,
            alcance: 'reservado', ouvintes: [funcionarioId], fontes: [],
        }, false);
        return resultado;
    }

    enviarGeral(texto: string): Resultado {
        const resultado = this.geral.enviarDoUsuario(texto);
        if (resultado.ok) this.social.registrar({ tipo: 'fala', autorId: 'diretoria', texto,
            alcance: 'publico', ouvintes: [], fontes: [] }, false);
        return resultado;
    }

    /** Aprova a entrega pelo fluxo exclusivo da interface da Diretoria. */
    aprovarEntrega(trabalhoId: string): Resultado {
        return this.orquestracao.aprovarEntrega(trabalhoId);
    }

    /** Rejeita a entrega com motivo e registra o fracasso para os participantes. */
    rejeitarEntrega(trabalhoId: string, motivo: string): Resultado {
        return this.orquestracao.rejeitarEntrega(trabalhoId, motivo);
    }

    /** Encaminha o retorno da Diretoria como correção vinculada à entrega. */
    corrigirEntrega(trabalhoId: string, motivo: string): Resultado {
        return this.orquestracao.corrigirEntrega(trabalhoId, motivo);
    }

    enviarTrabalho(projetoId: string, texto: string, threadId = threadPrincipal): Resultado {
        return falha('Pedidos livres estáo desativados. Inicie um arquivo de Macrodados.');
    }

    limparTrabalhos(threadId?: string, projetoId?: string): Resultado {
        const resultado = this.orquestracao.limpar(threadId, projetoId);
        if (!resultado.ok) return resultado;
        this.expediente.limparContextoWork(threadId, projetoId);
        const conversas = Object.fromEntries(Object.entries(this.estado.conversas).map(([id, mensagens]) => [
            id, mensagens.filter((mensagem) => mensagem.canal !== 'work'
                || (threadId !== undefined && (mensagem.threadId ?? threadPrincipal) !== threadId)
                || (projetoId !== undefined && mensagem.projetoId !== projetoId)),
        ]));
        this.atualizar({ conversas });
        this.podarEventosOrfaos();
        for (const [id, mensagens] of Object.entries(conversas)) {
            this.emitir({ tipo: 'conversa', funcionarioId: id, mensagens });
        }
        return sucesso;
    }

    interromperTrabalho(threadId?: string, projetoId?: string): void {
        this.orquestracao.interromper(threadId, projetoId);
    }

    /** Entrega uma iniciativa do líder à Diretoria, no máximo uma a cada dois minutos. */
    private falarComResponsavel(funcionarioId: string, texto: string): string {
        const funcionario = this.buscarFuncionario(funcionarioId);
        if (!funcionario) return 'Funcionário não encontrado.';
        if (funcionario.cargo !== 'lider') {
            return 'Somente o líder pode procurar a Diretoria. Encaminhe o assunto ao líder por conversar_reservado.';
        }
        const agora = Date.now();
        if (agora - (this.ultimasIniciativas.get(funcionarioId) ?? 0) < intervaloIniciativaMs) {
            return 'Você acabou de escrever para a Diretoria. Aguarde a resposta antes de insistir.';
        }
        this.ultimasIniciativas.set(funcionarioId, agora);
        this.expediente.registrarIniciativa(funcionarioId, texto.trim());
        const naoLidas = this.estado.naoLidas ?? {};
        this.atualizar({ naoLidas: { ...naoLidas, [funcionarioId]: (naoLidas[funcionarioId] ?? 0) + 1 } });
        return 'Mensagem enviada à Diretoria no chat individual.';
    }

    /** Zera o indicador de mensagens por iniciativa quando a Diretoria abre o chat individual. */
    marcarConversaLida(funcionarioId: string): Resultado {
        const naoLidas = { ...this.estado.naoLidas };
        if (!naoLidas[funcionarioId]) return sucesso;
        delete naoLidas[funcionarioId];
        this.atualizar({ naoLidas });
        return sucesso;
    }

    /** Guarda a impressão privada do funcionário para ele e para a ficha consultada pela Diretoria. */
    atualizarPensamento(funcionarioId: string, texto: string): string {
        if (!this.buscarFuncionario(funcionarioId)) return 'Funcionário não encontrado.';
        const pensamento = texto.trim();
        if (!pensamento || pensamento.length > 600) return 'Use um pensamento entre 1 e 600 caracteres.';
        const anterior = this.estado.pensamentos[funcionarioId];
        const historico = this.estado.historicoPensamentos[funcionarioId] ?? [];
        this.atualizar({ historicoPensamentos: { ...this.estado.historicoPensamentos,
            [funcionarioId]: anterior ? [...historico, anterior] : historico }, pensamentos: {
            ...this.estado.pensamentos,
            [funcionarioId]: { id: randomUUID(), texto: pensamento, atualizadoEm: new Date().toISOString() },
        } });
        return 'Pensamento privado salvo. Os colegas não recebem este registro. Não anuncie a atualização no Geral.';
    }

    limparGeral(): Resultado {
        const resultado = this.geral.limpar();
        for (const pessoa of this.estado.funcionarios) this.simulacao.cancelarEncontro(pessoa.id);
        const social = this.estado.social;
        const tiposFala = ['fala', 'reservado', 'cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar',
            'pausa', 'quebra', 'conserto', 'comunicado', 'proposta'];
        const arquivados = social.eventos.filter((evento) => tiposFala.includes(evento.tipo)
            && !this.comunicadoAtivo(evento));
        const idsArquivados = new Set(arquivados.map((evento) => evento.id));
        this.atualizar({ social: { ...social,
            eventos: social.eventos.filter((evento) => !idsArquivados.has(evento.id)),
            historico: [...new Map([...social.historico, ...arquivados].map((evento) => [evento.id, evento])).values()],
            lembrancas: preservarLembrancas(social.eventos, social.lembrancas)
                .filter((evento) => evento.tipo !== 'proposta' || !idsArquivados.has(evento.id)),
            leituras: Object.fromEntries(Object.keys(social.leituras).map((chave) => [chave, social.sequencia])),
        } });
        return resultado;
    }

    /** Fornece o arquivo completo à Diretoria, sem acrescentá-lo aos prompts dos funcionários. */
    obterHistorico(): RegistroHistorico[] {
        return listarHistorico(this.estado);
    }

    /** Remove um registro e suas cópias de consulta, descartando sessões que poderiam reintroduzi-lo. */
    excluirRegistroHistorico(registroId: string): Resultado {
        const registro = this.obterHistorico().find((item) => item.id === registroId);
        if (!registro) return falha('Registro não encontrado.');
        return this.aplicarExclusaoHistorico(registro.categoria === 'conversas' && registro.funcionarioId
            ? (estado) => apagarConversaHistorica(estado, registro.funcionarioId!)
            : (estado) => excluirRegistros(estado, new Set([registroId])));
    }

    /** Remove todos os registros do arquivo da Diretoria, com as mesmas garantias da exclusão individual. */
    excluirHistoricoCompleto(): Resultado {
        return this.aplicarExclusaoHistorico(excluirHistoricoCompleto);
    }

    /** Apaga do Work um arquivo de Macrodados, ou todos sem ID, com acontecimentos e sessões ligados a ele. */
    excluirArquivoWork(arquivoId?: string): Resultado {
        if (arquivoId && !this.estado.trabalhos.some((item) => item.arquivoId === arquivoId)) {
            return falha('Arquivo não encontrado no Work.');
        }
        if (this.estado.trabalhos.some((item) => item.estado === 'trabalhando'
            && (!arquivoId || item.arquivoId === arquivoId))) {
            return falha('Interrompa o refinamento antes de excluir o arquivo.');
        }
        return this.aplicarExclusaoHistorico((estado) =>
            excluirArquivosWork(estado, arquivoId ? new Set([arquivoId]) : undefined));
    }

    private aplicarExclusaoHistorico(excluir: (estado: EstadoSalvo) => EstadoSalvo): Resultado {
        if (this.estado.funcionarios.some((pessoa) =>
            ['trabalhando', 'bloqueado'].includes(this.expediente.statusDe(pessoa.id)))) {
            return falha('Aguarde ou interrompa os turnos em andamento antes de excluir registros.');
        }
        this.geral.renovarContexto();
        for (const pessoa of this.estado.funcionarios) this.expediente.interromper(pessoa.id);
        this.expediente.limparContextoWork();
        const anteriores = Object.keys(this.estado.conversas);
        this.atualizar(excluir(this.estado));
        this.emitir({ tipo: 'geral', mensagens: this.estado.geral });
        for (const funcionarioId of anteriores) this.emitir({ tipo: 'conversa', funcionarioId,
            mensagens: this.conversa(funcionarioId) });
        return sucesso;
    }

    private comunicadoAtivo(evento: EventoSocial): boolean {
        if (this.agenda.comunicadoAtivo(evento)) return true;
        if (evento.tipo !== 'comunicado') return false;
        return this.estado.trabalhos.some((trabalho) => {
            if (trabalho.estado !== 'trabalhando') return false;
            if (evento.trabalhoId === trabalho.id) return true;
            const arquivo = trabalho.arquivoId ? this.estado.refinamentos[trabalho.arquivoId] : undefined;
            return !!arquivo && evento.texto.startsWith(`A Diretoria entregou o arquivo ${arquivo.nome} `)
                && evento.texto.includes(`Prazo: ${formatarPrazo(arquivo)}.`);
        });
    }

    limparConversa(funcionarioId: string, threadId?: string): Resultado {
        if (!this.estado.funcionarios.some((funcionario) => funcionario.id === funcionarioId)) {
            return { ok: false, erro: 'Funcionário não encontrado.' };
        }
        const resultado = this.expediente.limparConversa(funcionarioId, threadId);
        if (resultado.ok) this.podarEventosOrfaos();
        if (resultado.ok && (threadId ?? threadPrincipal) === threadPrincipal) this.marcarConversaLida(funcionarioId);
        return resultado;
    }

    /**
     * Remove da memória social os acontecimentos cujo registro de origem foi apagado: eventos de trabalhos
     * excluídos e relatos de mensagens do chat individual que não existem mais. Evidências de propostas
     * pendentes são preservadas.
     */
    private podarEventosOrfaos(): void {
        const social = this.estado.social;
        const trabalhos = new Set(this.estado.trabalhos.map((item) => item.id));
        const protegidos = new Set(social.propostas.filter((item) => item.estado === 'pendente')
            .flatMap((item) => item.evidencias));
        const relatoExiste = (evento: EventoSocial) => (this.estado.conversas[evento.alvoId ?? ''] ?? [])
            .some((mensagem) => mensagem.autor === 'usuario'
                && `${prefixoRelatoChat}${mensagem.texto}`.slice(0, 2000) === evento.texto);
        const orfao = (evento: EventoSocial) => {
            if (evento.trabalhoId && !trabalhos.has(evento.trabalhoId)) return true;
            return evento.autorId === 'diretoria' && evento.texto.startsWith(prefixoRelatoChat) && !relatoExiste(evento);
        };
        const eventos = social.eventos.filter((evento) => protegidos.has(evento.id) || !orfao(evento));
        if (eventos.length !== social.eventos.length) this.atualizar({ social: { ...social, eventos,
            lembrancas: preservarLembrancas(social.eventos, social.lembrancas) } });
    }

    alternarConversaLivre(ativa: boolean): Resultado {
        return this.geral.alternarConversaLivre(ativa);
    }

    /** Permite remover ou restaurar o limite de falas da conversa atual pelo painel Geral. */
    alternarConversaSemLimite(ativa: boolean): Resultado {
        return this.geral.alternarConversaSemLimite(ativa);
    }

    /** Encerra pela interface uma conversa privada, devolvendo os dois às mesas e liberando o chat individual. */
    encerrarReservado(funcionarioId: string, colegaId: string): Resultado {
        if (!this.buscarFuncionario(funcionarioId) || !this.buscarFuncionario(colegaId)) {
            return falha('Funcionário não encontrado.');
        }
        this.geral.encerrarReservado(funcionarioId, colegaId);
        this.social.respostaAusente(funcionarioId, colegaId);
        if (this.simulacao.parceiroEncontro(funcionarioId) === colegaId) this.simulacao.cancelarEncontro(funcionarioId);
        return sucesso;
    }

    interromper(funcionarioId: string): void {
        this.simulacao.cancelarEncontro(funcionarioId);
        this.orquestracao.interromperSeLider(funcionarioId);
        this.expediente.interromper(funcionarioId);
    }

    responderAprovacao(aprovacaoId: string, aprovada: boolean): void {
        this.expediente.responder(aprovacaoId, aprovada);
    }

    comprar(tipo: TipoItem, celula: Celula, rotacao: Rotacao): Resultado {
        const { preco } = catalogo[tipo];
        if (preco > this.estado.moedas) return falha('Moedas insuficientes.');
        const item = { id: `${tipo}_${randomUUID().slice(0, 8)}`, tipo, celula, rotacao };
        const sala = comItem(this.estado.sala, item);
        return this.trocarSala(sala, { moedas: this.estado.moedas - preco,
            necessidadesLiberadas: liberarNecessidades(this.estado.necessidadesLiberadas, sala) });
    }

    private desgastarItem(itemId: string, funcionarioId: string): void {
        const item = this.estado.sala.itens.find((existente) => existente.id === itemId);
        if (!item) return;
        const proximo = registrarUso(item, funcionarioId, Math.random());
        if (proximo === item) return;
        this.atualizar({ sala: comItem(this.estado.sala, proximo) });
        if (!proximo.quebrado) return;
        this.simulacao.interromperPausasDoItem(itemId,
            `${catalogo[item.tipo].nome} quebrou e precisa de conserto.`);
        this.social.registrar({ tipo: 'quebra', autorId: 'sistema',
            texto: `${catalogo[item.tipo].nome} [${item.id}] quebrou. O móvel está indisponível. `
                + `Conserto: ${custoConserto(item)} moedas do saldo compartilhado.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
    }

    /** Permite que um funcionário providencie o reparo sem cobrar novamente por um móvel já recuperado. */
    consertarItem(funcionarioId: string, itemId: string): string {
        if (!this.buscarFuncionario(funcionarioId)) return 'Funcionário não encontrado.';
        const normalizar = (valor: string) => valor.normalize('NFD').replace(/\p{M}/gu, '')
            .trim().replace(/\s+/g, ' ').toLowerCase();
        const referencia = normalizar(itemId);
        const porId = this.estado.sala.itens.find((existente) => existente.id === itemId);
        const candidatos = porId ? [porId] : this.estado.sala.itens.filter((existente) =>
            normalizar(catalogo[existente.tipo].nome) === referencia || existente.tipo === referencia);
        if (candidatos.length > 1) {
            return `Há mais de um móvel com esse nome. Use o ID: ${candidatos.map((item) => item.id).join(', ')}.`;
        }
        const item = candidatos[0];
        if (!item) return 'Móvel não encontrado. Consulte ver_escritorio e use o ID de um conserto pendente.';
        if (!item.quebrado) return 'Esse móvel não precisa de conserto.';
        const custo = custoConserto(item);
        if (this.estado.moedas < custo) return `Moedas insuficientes. O conserto custa ${custo} moedas.`;
        this.atualizar({ moedas: this.estado.moedas - custo, sala: comItem(this.estado.sala, repararItem(item)) });
        this.social.registrar({ tipo: 'conserto', autorId: funcionarioId,
            texto: `${catalogo[item.tipo].nome} [${item.id}]: conserto providenciado por `
                + `${this.buscarFuncionario(funcionarioId)!.nome}. Custo: ${custo} moedas do saldo compartilhado.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
        return `Conserto concluído. Foram pagas ${custo} moedas do escritório. O móvel está disponível.`;
    }

    private itensQuebrados(): string {
        return this.estado.sala.itens.filter((item) => item.quebrado).map((item) =>
            `${catalogo[item.tipo].nome} [ID ${item.id}], custo ${custoConserto(item)} moedas`).join('; ');
    }

    private contextoManutencao(funcionarioId: string): string[] {
        const pendentes = this.itensQuebrados();
        return [
            this.agenda.contextoTerminais(),
            `Consertos pendentes: ${pendentes || 'nenhum. Todos os móveis estão funcionando'}.`,
            ...(pendentes ? [`Moedas do escritório: ${this.estado.moedas}.`] : []),
            ...this.estado.sala.itens.filter((item) => item.quebrado && item.ultimoUsuarioId === funcionarioId)
                .map((item) => `Informação privada, só você sabe: ${catalogo[item.tipo].nome} quebrou no seu uso. `
                    + 'Provavelmente foi você quem causou a quebra, mas isso é uma suspeita, não uma certeza. '
                    + 'Os colegas sabem apenas que o item quebrou. Você decide se conta sua participação ou a omite.'),
        ];
    }

    mover(itemId: string, celula: Celula, rotacao: Rotacao): Resultado {
        const item = this.estado.sala.itens.find((existente) => existente.id === itemId);
        if (!item) return falha('Item não encontrado.');
        return this.trocarSala(comItem(this.estado.sala, { ...item, celula, rotacao }));
    }

    vender(itemId: string): Resultado {
        const item = this.estado.sala.itens.find((existente) => existente.id === itemId);
        if (!item) return falha('Item não encontrado.');
        const dono = this.estado.funcionarios.find((funcionario) => funcionario.mesaId === itemId);
        if (dono) return falha(`Essa mesa pertence a ${dono.nome}.`);
        const devolucao = Math.floor(catalogo[item.tipo].preco * fracaoRevenda);
        return this.trocarSala(semItem(this.estado.sala, itemId), { moedas: this.estado.moedas + devolucao });
    }

    /** Interrompe execuções, conversas e o relógio. Chamado ao fechar o aplicativo. */
    encerrar(): void {
        this.orquestracao.interromper();
        for (const funcionario of this.estado.funcionarios) this.expediente.dispensar(funcionario.id);
        this.geral.encerrar();
        this.simulacao.encerrar();
        this.agenda.encerrar();
        this.mcp.encerrar();
    }

    /**
     * Pausa pedida pela ferramenta. A resposta sempre espera a volta, para o agente só comentar a pausa depois
     * de fazê-la. No Geral, quem está no meio de uma tarefa precisa terminá-la antes.
     */
    /**
     * Desfaz o encontro aberto por um turno do chat individual que terminou sem conversa reservada em andamento,
     * para que os dois não fiquem parados no canto nem bloqueiem o chat da Diretoria.
     */
    private liberarEncontroOcioso(id: string): void {
        const parceiro = this.simulacao.parceiroEncontro(id);
        if (!parceiro || this.geral.emExecucao(id) || this.geral.emExecucao(parceiro)) return;
        this.simulacao.cancelarEncontro(id);
    }

    private async fazerPausa(id: string, atividade: Atividade, minutos: number, origem: OrigemMcp): Promise<string> {
        if (!origemSocial(origem)) return this.simulacao.pedirPausa(id, atividade, minutos);
        const status = this.expediente.statusDe(id);
        if ((status === 'trabalhando' && !this.expediente.emConversa(id)) || status === 'bloqueado') {
            return 'Você está no meio de uma tarefa. Faça a pausa quando terminar, pelo próprio trabalho.';
        }
        if (this.simulacao.emPausaNoItem(id) || this.simulacao.ausenciaDe(id)) {
            return 'Você já está em pausa.';
        }
        if (this.simulacao.emPausa(id) && !this.simulacao.parceiroEncontro(id)) {
            return 'Você já está em pausa.';
        }
        const retorno = this.simulacao.pedirPausa(id, atividade, minutos, origem === 'reservado');
        if (!this.simulacao.emPausa(id)) return retorno;
        this.geral.pausaIniciada(id);
        void retorno;
        return `Pausa iniciada por ${minutos} minutos reais após chegar ao item. Sua vez terminou. `
            + 'Você fica indisponível, exceto para conversar em particular com quem dividir o mesmo item.';
    }

    /** Itens de pausa da sala com quantos estão livres e quem usa os demais, para ninguém imaginar fila. */
    private itensDePausa(): string {
        const ocupantes = this.simulacao.ocupantes();
        const grupos = new Map<string, { total: number; usando: string[] }>();
        for (const item of this.estado.sala.itens) {
            const atividade = catalogo[item.tipo].uso?.atividade;
            if (item.quebrado || !atividade || atividade === 'trabalhando') continue;
            const rotulo = `${catalogo[item.tipo].nome} (${atividade})`;
            const grupo = grupos.get(rotulo) ?? { total: 0, usando: [] };
            grupo.total += capacidadeItem(item);
            for (const ocupante of ocupantes.get(item.id) ?? []) {
                grupo.usando.push(this.buscarFuncionario(ocupante)?.nome ?? 'alguém');
            }
            grupos.set(rotulo, grupo);
        }
        return [...grupos]
            .map(([rotulo, { total, usando }]) => {
                const livres = `${total - usando.length} de ${total} vagas livres`;
                return `${rotulo}: ${livres}${usando.length ? `, em uso por ${usando.join(' e ')}` : ''}`;
            })
            .join('; ');
    }

    /** Dados variáveis do turno de trabalho. Relações, posições e itens ficam disponíveis em `ver_escritorio`. */
    private contextoTurno(funcionarioId: string): string {
        const emConversa = this.expediente.emConversa(funcionarioId);
        const pensamento = this.estado.pensamentos[funcionarioId]?.texto;
        const necessidades = this.simulacao.necessidadesDe(funcionarioId);
        const pedidos = pedidosDoCorpo(necessidades);
        return [
            contextoDiretoria,
            orientacaoCarreira(funcionarioId, this.estado.funcionarios, this.estado.carreira),
            `Seu estado: ${resumirNecessidades(necessidades)}.`,
            disposicaoAtual(necessidades),
            ...this.contextoManutencao(funcionarioId),
            ...(pedidos.length ? [`Seu corpo pede pausa: ${pedidos.join('; ')}. `
                + `Itens de pausa: ${this.itensDePausa() || 'nenhum'}.`] : []),
            ...(!emConversa && pensamento ? [`Seu pensamento privado anterior, só histórico: ${pensamento}`] : []),
            `Colegas: ${this.listarColegas(funcionarioId) || 'nenhum'}.`,
            ...(emConversa ? ['Falas recentes no Geral, que você presenciou. São contexto, não um pedido:',
                this.geral.falasRecentes() || '(nenhuma)'] : []),
            this.contextoIntencoes(funcionarioId),
            this.social.contexto(funcionarioId, emConversa ? 'chat' : 'trabalho', true, undefined, false),
        ].join('\n');
    }

    private contextoGeral(funcionarioId: string): string {
        const necessidades = this.simulacao.necessidadesDe(funcionarioId);
        const pensamento = this.estado.pensamentos[funcionarioId]?.texto;
        const pedidos = pedidosDoCorpo(necessidades);
        const emPausa = this.simulacao.emPausaNoItem(funcionarioId);
        return [
            contextoDiretoria,
            `Seu estado: ${resumirNecessidades(necessidades)}.`,
            emPausa ? this.simulacao.contextoPausa(funcionarioId) : disposicaoAtual(necessidades),
            ...this.contextoManutencao(funcionarioId),
            ...(!emPausa && pedidos.length ? [`Seu corpo pede pausa: ${pedidos.join('; ')}.`] : []),
            ...(pensamento ? [`Seu último pensamento privado, só contexto: ${pensamento}`] : []),
            `Colegas: ${this.listarColegas(funcionarioId) || 'nenhum'}.`,
            `Itens de pausa: ${this.itensDePausa() || 'nenhum'}.`,
            this.contextoEquipe(funcionarioId),
            this.contextoIntencoes(funcionarioId),
        ].join('\n');
    }

    private contextoIntencoes(id: string): string {
        const intencoes = this.estado.social.intencoes.filter((item) => item.autorId === id && item.estado === 'pendente');
        return intencoes.length ? 'Seus compromissos privados, cumpra quando houver oportunidade:\n'
            + intencoes.map((item) => '[' + item.id + '] ' + item.objetivo + ' com '
                + (this.buscarFuncionario(item.colegaId)?.nome ?? 'colega ausente') + ': ' + item.motivo).join('\n') : '';
    }

    private listarColegas(funcionarioId: string): string {
        const { status } = this.publico();
        return this.estado.funcionarios.filter((colega) => colega.id !== funcionarioId)
            .map((colega) => `${colega.nome} [ID ${colega.id}] (${nomeCargo(colega.cargo)}, `
                + `${this.rotuloSituacao(colega.id, status)})`)
            .join('; ');
    }

    /** Situação legível para os agentes, distinguindo conversa privada de pausa em item. */
    private rotuloSituacao(id: string, status: Record<string, StatusFuncionario>): string {
        const ausencia = this.simulacao.ausenciaDe(id);
        if (ausencia) return `${nomesAusencia[ausencia.motivo].toLowerCase()}, fora da sala`;
        const parceiro = this.simulacao.parceiroEncontro(id);
        if (parceiro) return `em conversa reservada com ${this.buscarFuncionario(parceiro)?.nome ?? 'um colega'}`;
        const estagio = estagioEsgotamento(this.simulacao.necessidadesDe(id).esgotamento ?? 0);
        const sinal = estagio === 'estavel' ? '' : `, parece ${nomesEstagio[estagio].toLowerCase()}`;
        return rotulosStatus[status[id] ?? 'ocioso'] + sinal;
    }

    private descreverEscritorio(funcionarioId: string): string {
        const { status } = this.publico();
        const funcionario = this.buscarFuncionario(funcionarioId);
        const colegas = this.estado.funcionarios
            .filter((funcionario) => funcionario.id !== funcionarioId)
            .map((funcionario) => {
                const necessidades = this.simulacao.necessidadesDe(funcionario.id);
                return `${funcionario.nome} [ID ${funcionario.id}] (${nomeCargo(funcionario.cargo)}): `
                    + `${this.rotuloSituacao(funcionario.id, status)}, humor ${humor(necessidades)}`;
            });
        return [
            `Você: ${funcionario?.nome ?? funcionarioId} [ID ${funcionarioId}], `
                + `${this.rotuloSituacao(funcionarioId, status)}.`,
            `Necessidades: ${resumirNecessidades(this.simulacao.necessidadesDe(funcionarioId))}.`,
            `Colegas: ${colegas.join('; ') || 'nenhum'}.`,
            `Itens de pausa: ${this.itensDePausa() || 'nenhum. Peça à Diretoria para comprar.'}`,
            `Moedas do escritório: ${this.estado.moedas}.`,
            `Consertos pendentes: ${this.itensQuebrados() || 'nenhum'}.`,
            this.agenda.contextoTerminais(),
            'Trabalho do departamento: exclusivamente refinamento de Macrodados. Arquivos são iniciados pelo Work.',
            this.contextoEquipe(funcionarioId, false),
            `Posições na sala:\n${this.listarPosicoes()}`,
        ].join('\n');
    }

    private listarPosicoes(): string {
        return this.simulacao.agentes().map((agente) => {
            const atividade = agente.atividade === 'trabalhando' ? 'sentado à mesa' : agente.atividade;
            return `${this.buscarFuncionario(agente.id)?.nome ?? agente.id} [${agente.id}]: ${atividade}, `
                + `posição (${agente.posicao.x.toFixed(1)}, ${agente.posicao.z.toFixed(1)})`;
        }).join('\n');
    }

    private trocarSala(sala: Sala, extra: Partial<EstadoSalvo> = {}): Resultado {
        const erro = validarSala(sala);
        if (erro) return falha(erro);
        const funcionarios = reconciliarMesas(this.estado.funcionarios, sala);
        this.atualizar({ ...extra, sala, funcionarios });
        this.social.registrar({ tipo: 'sala', autorId: 'diretoria', texto:
            `A sala mudou. Itens disponíveis: ${sala.itens.map((item) => catalogo[item.tipo].nome).join(', ')}.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
        return sucesso;
    }

    private buscarFuncionario(id: string): Funcionario | undefined {
        return this.estado.funcionarios.find((funcionario) => funcionario.id === id);
    }

    /** Concede folga pela ficha do funcionário. */
    concederFolga(funcionarioId: string): Resultado {
        return this.pessoal.concederFolga(funcionarioId);
    }

    /** Envia à Sala de Descanso pela ficha, como decisão direta da Diretoria. */
    enviarSalaDescanso(funcionarioId: string, motivo: string): Resultado {
        return this.pessoal.enviarSalaDescanso(funcionarioId, motivo);
    }

    /** Concede um incentivo da Diretoria, individual ou coletivo, pago com o saldo compartilhado. */
    concederIncentivo(tipo: TipoIncentivo, motivo: string, alvoId?: string): Resultado {
        return this.pessoal.concederIncentivo('diretoria', tipo, motivo, alvoId);
    }

    private ajustarMerito(id: string, delta: number): void {
        if (!this.buscarFuncionario(id)) return;
        const atual = this.estado.carreira[id];
        this.atualizar({ carreira: { ...this.estado.carreira,
            [id]: { ...atual, merito: aplicarMerito(atual?.merito ?? 0, delta) } } });
    }

    private escolherCarreira(id: string, cargo: CargoAtual): string {
        const pessoa = this.buscarFuncionario(id);
        if (!pessoa || cargo === 'estagiario' || !caminhosCarreira(pessoa.cargo).includes(cargo)) {
            return 'Escolha um cargo imediatamente acessível a partir da sua função atual.';
        }
        if (this.estado.social.propostas.some((item) => item.estado === 'pendente'
            && ((item.alvoId === id && item.tipo === 'promocao') || item.candidatoId === id))) {
            return 'Aguarde a decisão da proposta de carreira pendente antes de mudar seu objetivo.';
        }
        const atual = this.estado.carreira[id];
        this.atualizar({ carreira: { ...this.estado.carreira,
            [id]: { ...atual, merito: atual?.merito ?? 0, objetivo: cargo } } });
        return `Objetivo de carreira salvo: ${nomeCargo(cargo)}. A promoção exige mérito, vaga e decisão da Diretoria.`;
    }

    private bloqueioTroca(id: string, cargo: CargoAtual): string | undefined {
        const pessoa = this.buscarFuncionario(id);
        if (!pessoa || !caminhosCarreira(pessoa.cargo).includes(cargo)) {
            return 'A disputa só permite o próximo cargo da carreira, sem saltar etapas.';
        }
        if (proximoCargo(pessoa.cargo, this.estado.carreira[id]?.objetivo) !== cargo) {
            return 'Escolha esse objetivo de carreira antes de disputar o cargo.';
        }
        const exigido = meritoParaCargo[cargo as keyof typeof meritoParaCargo];
        if ((this.estado.carreira[id]?.merito ?? 0) < exigido) return 'Mérito insuficiente para disputar esse cargo.';
    }

    private bloqueioPromocao(id: string): string | undefined {
        const situacao = situacaoCarreira(id, this.estado.funcionarios, this.estado.carreira);
        if (situacao.tipo === 'elegivel') return undefined;
        if (situacao.tipo === 'fora_da_escada') return 'Seu cargo não faz parte da escada de promoções.';
        if (situacao.tipo === 'topo') return 'Você já ocupa o cargo mais alto do departamento.';
        if (situacao.tipo === 'insuficiente') return `Faltam ${situacao.falta} pontos de mérito para pedir a promoção.`;
        return `Não há vaga de ${nomeCargo(situacao.proximo)}. Para disputar o cargo, proponha troca_lideranca `
            + `contra ${situacao.ocupantes.map((item) => `${item.nome} [${item.id}]`).join(' ou ')}.`;
    }

    /** Sobe o funcionário um degrau, mantendo parte do mérito, e anuncia à equipe. */
    private promover(id: string, esperado?: CargoAtual): Resultado {
        const pessoa = this.buscarFuncionario(id);
        if (!pessoa) return falha('Funcionário não encontrado.');
        const bloqueio = this.bloqueioPromocao(id);
        if (bloqueio) return falha(bloqueio);
        if (['trabalhando', 'bloqueado'].includes(this.expediente.statusDe(id)) || this.simulacao.emPausa(id)) {
            return falha(`Espere ${pessoa.nome} terminar a tarefa atual.`);
        }
        const cargo = proximoCargo(pessoa.cargo, this.estado.carreira[id]?.objetivo)!;
        if (esperado && esperado !== cargo) return falha('O objetivo de carreira mudou. Apresente uma nova proposta.');
        this.expediente.dispensar(id);
        this.geral.dispensar(id);
        const merito = (this.estado.carreira[id]?.merito ?? 0) * fracaoMeritoAposPromocao;
        this.atualizar({
            funcionarios: this.estado.funcionarios.map((item) => item.id === id ? { ...item, cargo } : item),
            carreira: { ...this.estado.carreira,
                [id]: { merito: aplicarMerito(merito, 0), promovidoEm: new Date().toISOString() } },
        });
        this.social.registrar({ tipo: 'promocao', autorId: 'diretoria', alvoId: id, alcance: 'publico',
            ouvintes: [], fontes: [], texto: `${pessoa.nome} foi promovido de ${nomeCargo(pessoa.cargo)} `
                + `a ${nomeCargo(cargo)} pela Diretoria.` });
        return sucesso;
    }

    /** Líderes e supervisores podem cobrar e propor mudanças também no turno de reação. */
    private disciplina(id: string): boolean {
        const cargo = this.buscarFuncionario(id)?.cargo;
        return cargo === 'lider' || cargo === 'supervisor';
    }

    /** Motivo legível que impede o funcionário de receber trabalho de Macrodados. */
    private impedimentoTrabalho(id: string): string | undefined {
        const funcionario = this.buscarFuncionario(id);
        if (!funcionario) return 'fora da equipe';
        if (!refina(funcionario.cargo)) return `${nomeCargo(funcionario.cargo).toLowerCase()}, não refina`;
        const ausencia = this.simulacao.ausenciaDe(id);
        if (ausencia) return nomesAusencia[ausencia.motivo].toLowerCase();
        if (this.agenda.avariado(id)) return 'terminal avariado';
        if (recusaTrabalho(this.simulacao.necessidadesDe(id).esgotamento ?? 0)) return 'esgotado';
    }

    /** Resolve propostas apresentadas na atividade do escritório sem conceder esse poder ao harness. */
    decidirProposta(id: string, aprovar: boolean): Resultado {
        return this.social.decidir(id, aprovar);
    }

    private executarProposta(proposta: PropostaPolitica): Resultado {
        const autor = this.buscarFuncionario(proposta.autorId);
        const alvo = this.buscarFuncionario(proposta.alvoId);
        if (!autor || !alvo) return falha('Um dos envolvidos já saiu da equipe.');
        if (proposta.tipo === 'demissao') {
            const pedido = autor.id === alvo.id;
            return this.demitir(alvo.id, proposta.motivo, pedido ? `${autor.nome}, a pedido próprio, com aprovação `
                + 'da Diretoria' : `${autor.nome}, com aprovação da Diretoria`, proposta.evidencias);
        }
        if (proposta.tipo === 'sala_descanso') {
            return this.pessoal.enviarSalaDescanso(alvo.id, proposta.motivo, autor.id, proposta.evidencias);
        }
        if (proposta.tipo === 'transferencia') {
            if (alvo.cargo !== 'lider') return falha('Esse funcionário já não é líder.');
            const afastamentos = this.estado.social.afastamentos;
            this.atualizar({ social: { ...this.estado.social, afastamentos: {
                ...afastamentos, [autor.id]: [...new Set([...(afastamentos[autor.id] ?? []), alvo.id])],
            } } });
            return sucesso;
        }
        if (proposta.tipo === 'promocao') return this.promover(alvo.id, proposta.cargo);
        const candidato = this.buscarFuncionario(proposta.candidatoId ?? '');
        if (!['lider', 'supervisor'].includes(alvo.cargo) || !candidato
            || !caminhosCarreira(candidato.cargo).includes(alvo.cargo as CargoAtual)) {
            return falha('A troca exige um líder ou supervisor atual e um candidato de cargo inferior.');
        }
        const bloqueio = this.bloqueioTroca(candidato.id, alvo.cargo as CargoAtual);
        if (bloqueio) return falha(bloqueio);
        for (const pessoa of [alvo, candidato]) {
            if (['trabalhando', 'bloqueado'].includes(this.expediente.statusDe(pessoa.id))
                || this.simulacao.emPausa(pessoa.id)) {
                return falha('Aguarde os envolvidos terminarem o trabalho e a pausa.');
            }
        }
        for (const pessoa of [alvo, candidato]) {
            this.expediente.dispensar(pessoa.id);
            this.geral.dispensar(pessoa.id);
        }
        const merito = (this.estado.carreira[candidato.id]?.merito ?? 0) * fracaoMeritoAposPromocao;
        this.atualizar({ carreira: { ...this.estado.carreira,
            [candidato.id]: { merito: aplicarMerito(merito, 0), promovidoEm: new Date().toISOString() },
            [alvo.id]: { ...this.estado.carreira[alvo.id],
                merito: this.estado.carreira[alvo.id]?.merito ?? 0, objetivo: undefined },
        }, funcionarios: this.estado.funcionarios.map((pessoa) => {
            if (pessoa.id === candidato.id) return { ...pessoa, cargo: alvo.cargo };
            if (pessoa.id === alvo.id) return { ...pessoa, cargo: candidato.cargo };
            return pessoa;
        }) });
        this.social.registrar({ tipo: 'promocao', autorId: 'diretoria', alvoId: candidato.id, sobreId: alvo.id,
            alcance: 'publico', ouvintes: [], fontes: proposta.evidencias, texto: `${candidato.nome} assumiu o cargo `
                + `de ${nomeCargo(alvo.cargo)} no lugar de ${alvo.nome}, que passa a ${nomeCargo(candidato.cargo)}.` });
        return sucesso;
    }

    /** Percepção social com os trabalhos em andamento, sem expor tarefas encerradas como assunto atual. */
    private contextoEquipe(id: string, consumir = true): string {
        const emAndamento = this.estado.trabalhos.filter((item) => item.estado === 'trabalhando');
        const trabalhos = emAndamento.map((item) => `[${item.id}] ${item.nome}: ${item.tarefa.slice(0, 200)}`);
        const afastados = this.estado.social.afastamentos[id] ?? [];
        const ativos = new Set(emAndamento.map((item) => item.id));
        return [
            this.contextoDisponibilidade(),
            orientacaoCarreira(id, this.estado.funcionarios, this.estado.carreira),
            this.social.contexto(id, 'social', consumir, ativos),
            `Trabalhos em andamento:\n${trabalhos.join('\n') || this.situacaoTrabalho()}`,
            `${this.descreverCota()} Este número é o atual e prevalece sobre valores citados antes.`,
            ...(afastados.length ? [`Líderes afastados de você por transferência: ${afastados.join(', ')}.`] : []),
        ].join('\n\n');
    }

    private contextoDisponibilidade(): string {
        const emPausa = this.estado.funcionarios.filter((pessoa) => this.simulacao.emPausaNoItem(pessoa.id));
        if (!emPausa.length) return 'Disponibilidade atual: ninguém está em pausa.';
        return 'Indisponíveis no Geral por pausa: '
            + emPausa.map((pessoa) => `${pessoa.nome} [ID ${pessoa.id}]`).join(', ')
            + '. Não dirija falas, perguntas nem menções a essas pessoas no Geral, mesmo sem @. '
            + 'Contato durante a pausa é somente privado, por conversar_reservado. '
            + 'Este estado atual prevalece sobre mensagens anteriores.';
    }

    private registrarTrabalhoSocial(trabalho: RegistroTrabalho, tipo: 'delegacao' | 'entrega' | 'falha'): void {
        const delegacao = tipo === 'delegacao';
        const salvo = this.estado.trabalhos.find((item) => item.id === trabalho.id);
        const autorId = delegacao ? trabalho.solicitante?.id ?? 'diretoria' : trabalho.funcionarioId;
        const alvoId = delegacao ? trabalho.funcionarioId : trabalho.solicitante?.id;
        this.social.registrar({ tipo, autorId, alvoId, trabalhoId: trabalho.id,
            texto: `[Trabalho ${trabalho.id}] ${trabalho.nome}: ${trabalho.tarefa.slice(0, 350)}. `
                + (delegacao ? 'Tarefa recebida.' : tipo === 'falha' ? 'Execução terminou com falha.'
                    : `Execução encerrada. Avaliação: ${salvo?.avaliacao?.estado ?? 'não registrada'}. `
                        + `${salvo?.avaliacao?.motivo ?? 'Resultado disponível para revisão.'} `
                        + 'Não há aprovação automática de qualidade.'),
            alcance: 'publico', ouvintes: [], fontes: [] }, !delegacao && !trabalho.solicitante?.id);
    }

    private atualizar(mudanca: Partial<EstadoSalvo>): void {
        this.estado = { ...this.estado, ...mudanca };
        this.salvar(this.estado);
        this.publicar();
    }

    private publicar(): void {
        this.emitir({ tipo: 'estado', estado: this.publico() });
    }
}
