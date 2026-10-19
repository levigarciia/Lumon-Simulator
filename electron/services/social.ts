import { concluirAcao, recusarAcao, normalizarResultado, type ResultadoAcao } from './ferramentas/resultado';
import { randomUUID } from 'node:crypto';
import { migrarEventoDiretoria } from '../../shared/diretoria';
import type { Agente } from '../../shared/agentes';
import { nomeDoFuncionario, type Demissao, type Funcionario } from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import type { Pensamento } from '../../shared/trabalho';
import { preservarLembrancas, recuperarLembrancas } from '../../shared/memoria';
import { acaoDaIntencao, type Intencao } from '../../shared/intencoes';
import { diaDoExpediente } from '../../shared/departamento';
import { impactosEsgotamento } from '../../shared/esgotamento';
import { caminhosCarreira, type CargoDestino } from '../../shared/carreira';
import type { CargoAtual } from '../../shared/cargos';
import { repeteFala } from '../../shared/geral';
import {
    aplicarReacao, descreverCondutaRelacional, registrarImpactoRelacao, resumirRelacao,
} from '../../shared/relacoes';
import {
    aplicarInteracao, colegasProximos, criarPersonalidade, descreverPersonalidade, nomesProposta,
    podeConhecer, relacaoInicial, esquemaFiltroHistorico,
    type AcaoSocial, type EstadoSocial, type EventoSocial, type PropostaPolitica, type ReacaoSocial,
    type TipoProposta, type ImpactoRelacao, type FiltroHistorico,
} from '../../shared/social';

type RegistroSocial = {
    estado: () => EstadoSocial;
    funcionarios: () => Funcionario[];
    demissoes?: () => Demissao[];
    pensamentos?: (id: string) => Pensamento[];
    agentes: () => Agente[];
    gravar: (estado: EstadoSocial) => void;
    notificar: (ids: string[], motivo?: string) => void;
    estressar: (id: string, delta: number) => void;
    esgotar?: (id: string, delta: number) => void;
    esgotado?: (id: string) => boolean;
    /** Motivo que impede o pedido de promoção, ou `undefined` quando o funcionário é elegível. */
    bloqueioPromocao?: (id: string) => string | undefined;
    objetivoCarreira?: (id: string) => CargoDestino | undefined;
    bloqueioTroca?: (id: string, cargo: CargoAtual) => string | undefined;
    /** Chamado depois de cada acontecimento registrado, para consequências calculadas por regra. */
    aoRegistrar?: (evento: EventoSocial) => void;
    decidir: (proposta: PropostaPolitica) => Resultado;
    nomeResponsavel?: () => string;
    encontrar?: (id: string, alvoId: string) => Promise<string | ResultadoAcao>;
    manterEncontro?: (id: string, alvoId: string) => void;
    notificarReservado?: (id: string, autorId: string, motivo: string) => void;
};

type NovoEvento = Omit<EventoSocial, 'id' | 'sequencia' | 'criadoEm'>;
type EsperaResposta = { alvoId: string; concluir: () => void; renovar: () => void };
const limiteEventos = 800;
const limiteAcoesPorMinuto = 8;
const esperaMaximaResposta = 120000;

/** Memória social individual, audiência espacial e propostas que só a Diretoria pode executar. */
export class DinamicaSocial {
    private acoes = new Map<string, number[]>();
    private esperas = new Map<string, EsperaResposta>();
    private leiturasPendentes = new Map<string, number>();
    private ultimasIntencoes = new Map<string, number>();

    constructor(private registro: RegistroSocial) {
        const estado = registro.estado();
        const personalidades = { ...estado.personalidades };
        for (const funcionario of registro.funcionarios()) {
            personalidades[funcionario.id] ??= criarPersonalidade(funcionario.id);
        }
        registro.gravar({ ...estado, personalidades,
            eventos: estado.eventos.map(migrarEventoDiretoria),
            lembrancas: estado.lembrancas.map(migrarEventoDiretoria),
            historico: estado.historico.map(migrarEventoDiretoria),
            propostas: estado.propostas.map((proposta) => ({
                ...proposta, registros: proposta.registros.map(migrarEventoDiretoria),
            })),
        });
    }

    /** Fornece a personalidade atual para as instruções de sessão e a orientação do turno. */
    personalidade(id: string): string {
        return descreverPersonalidade(this.registro.estado().personalidades[id] ?? criarPersonalidade(id));
    }

    /** Persiste um acontecimento observado e agenda reações dos destinatários quando apropriado. */
    registrar(dados: NovoEvento, notificar = true): EventoSocial {
        const estado = this.registro.estado();
        const evento: EventoSocial = {
            ...dados, texto: dados.texto.slice(0, 2000), ouvintes: [...new Set(dados.ouvintes)],
            autorNome: dados.autorNome ?? this.nome(dados.autorId),
            alvoNome: dados.alvoNome ?? (dados.alvoId ? this.nome(dados.alvoId) : undefined),
            id: randomUUID(), sequencia: estado.sequencia + 1, criadoEm: new Date().toISOString(),
        };
        const protegidos = new Set(estado.propostas.filter((item) => item.estado === 'pendente')
            .flatMap((item) => item.evidencias));
        const recentes = [...estado.eventos, evento];
        const corte = recentes.length - limiteEventos;
        const eventos = recentes.filter((item, indice) => indice >= corte || protegidos.has(item.id));
        const mantidos = new Set(eventos.map((item) => item.id));
        const historico = [...estado.historico, ...recentes.filter((item) => !mantidos.has(item.id))];
        const lembrancas = preservarLembrancas(recentes, estado.lembrancas);
        this.registro.gravar({ ...estado, eventos, historico, lembrancas, sequencia: evento.sequencia });
        const atual = this.registro.estado();
        const cumpridas = atual.intencoes.map((intencao) => intencao.estado === 'pendente'
            && intencao.autorId === evento.autorId && intencao.colegaId === evento.alvoId
            && acaoDaIntencao(intencao.objetivo) === evento.tipo
            ? { ...intencao, estado: 'cumprida' as const, concluidaEm: evento.criadoEm, resultadoId: evento.id }
            : intencao);
        if (cumpridas.some((intencao, indice) => intencao !== atual.intencoes[indice])) {
            this.registro.gravar({ ...atual, intencoes: cumpridas });
        }
        if (evento.alvoId && evento.alvoId !== evento.autorId) {
            if (['cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar', 'apoio', 'entrega', 'falha']
                .includes(evento.tipo)) this.afetarRelacao(evento.alvoId, evento.autorId, evento);
        }
        const dialogo = evento.alcance === 'reservado' && !!evento.alvoId && evento.ouvintes.length === 2;
        if (dialogo) this.esperaDoPar(evento.autorId, evento.alvoId!)?.renovar();
        if (notificar) {
            const ouvintes = this.registro.funcionarios().filter((pessoa) =>
                pessoa.id !== evento.autorId && podeConhecer(evento, pessoa.id));
            const motivo = `[${evento.id}] ${evento.criadoEm}. ${evento.autorNome}: ${evento.texto}`;
            if (dialogo && this.registro.notificarReservado) {
                for (const pessoa of ouvintes) this.registro.notificarReservado(pessoa.id, evento.autorId, motivo);
            } else this.registro.notificar(ouvintes.map((pessoa) => pessoa.id), motivo);
        }
        this.registro.aoRegistrar?.(evento);
        return evento;
    }

    /**
     * Usada pelo chat individual: entrega a fala reservada e só retorna quando a conversa privada termina,
     * com a transcrição completa, para que o autor relate à Diretoria o que realmente foi dito.
     * Enquanto isso, as respostas do autor são geradas no diálogo reservado do Geral.
     */
    async conversarAguardando(
        autorId: string, alvoId: string, texto: string, fontes: string[], sobreId?: string,
    ): Promise<string> {
        return (await this.conversarAguardandoResultado(autorId, alvoId, texto, fontes, sobreId)).mensagem;
    }

    /** Aguarda o encontro privado e preserva o resultado explícito da entrega. */
    async conversarAguardandoResultado(
        autorId: string, alvoId: string, texto: string, fontes: string[], sobreId?: string,
    ): Promise<ResultadoAcao> {
        const inicio = this.registro.estado().sequencia;
        const encerramento = this.aguardarEncerramento(autorId, alvoId);
        const resultado = await this.interagirComEncontroResultado(autorId, alvoId, 'reservado', texto, 'reservado',
            fontes, sobreId);
        if (resultado.erro) {
            this.esperas.get(autorId)?.concluir();
            return resultado;
        }
        await encerramento;
        const transcricao = this.registro.estado().eventos.filter((evento) => evento.sequencia > inicio
            && evento.alcance === 'reservado' && evento.ouvintes.length === 2
            && [autorId, alvoId].every((pessoa) => evento.ouvintes.includes(pessoa)))
            .map((evento) => `${evento.autorNome}: ${evento.texto}`).join('\n');
        return concluirAcao(`A conversa com ${this.nome(alvoId)} terminou.\n${transcricao}\n`
            + 'Agora responda à Diretoria em texto normal neste chat.', 'interacao_aplicada');
    }

    /** Informa se o funcionário aguarda, no chat individual, o fim do diálogo com este colega. */
    aguardandoConversa(id: string, colegaId?: string): boolean {
        return !!colegaId && this.esperas.get(id)?.alvoId === colegaId;
    }

    /** Encerra a espera quando um dos dois participantes termina seu turno reservado sem falar. */
    respostaAusente(id: string, colegaId: string): void {
        this.esperaDoPar(id, colegaId)?.concluir();
    }

    private esperaDoPar(id: string, colegaId: string): EsperaResposta | undefined {
        return [this.esperas.get(id), this.esperas.get(colegaId)].find((espera, indice) =>
            espera?.alvoId === (indice === 0 ? colegaId : id));
    }

    private aguardarEncerramento(autorId: string, alvoId: string): Promise<void> {
        this.esperas.get(autorId)?.concluir();
        return new Promise((resolver) => {
            let ocioso: NodeJS.Timeout | undefined;
            const renovar = () => {
                clearTimeout(ocioso);
                ocioso = setTimeout(concluir, esperaMaximaResposta);
            };
            const concluir = () => {
                clearTimeout(ocioso);
                if (this.esperas.get(autorId) === espera) this.esperas.delete(autorId);
                resolver();
            };
            const espera: EsperaResposta = { alvoId, concluir, renovar };
            this.esperas.set(autorId, espera);
            renovar();
        });
    }

    /** Executa falas sociais com audiência validada e fontes que o autor realmente conhece. */
    interagir(...argumentos: Parameters<DinamicaSocial['interagirResultado']>): string {
        return (this.interagirResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    interagirResultado(
        autorId: string, referenciaAlvo: string, acao: AcaoSocial | 'reservado', texto: string,
        alcance: EventoSocial['alcance'], fontes: string[], trabalhoId?: string, sobreId?: string,
    ): ResultadoAcao {
        const alvoId = this.idDe(referenciaAlvo);
        const erro = this.validarInteracao(autorId, alvoId, acao, texto, fontes, sobreId);
        if (erro) return recusarAcao(erro);
        const chaveAcao = [autorId, alvoId, acao, ...[...fontes].sort()].join(':');
        if (acao !== 'reservado' && this.registro.estado().interacoesAplicadas.includes(chaveAcao)) {
            return concluirAcao('Ação já registrada. Nenhum efeito duplicado.', 'interacao_aplicada');
        }
        if (!this.permitirAcao(autorId)) return recusarAcao('Aguarde um minuto antes de iniciar mais ações sociais.');
        const proximos = colegasProximos(autorId, this.registro.agentes());
        const ouvintes = alcance === 'publico' ? this.registro.funcionarios().map((item) => item.id)
            : alcance === 'reservado' ? [autorId, alvoId] : [...new Set([autorId, alvoId, ...proximos])];
        const evento = this.registrar({
            tipo: acao, autorId, alvoId, texto: texto.trim(), alcance, ouvintes, fontes, trabalhoId, sobreId,
        });
        if (acao !== 'reservado') {
            const estado = this.registro.estado();
            this.registro.gravar({ ...estado, interacoesAplicadas: [...estado.interacoesAplicadas, chaveAcao] });
        }
        if (alcance === 'reservado') this.registro.manterEncontro?.(autorId, alvoId);
        if (acao === 'cobrar') {
            this.registro.estressar(alvoId, alcance === 'publico' ? 10 : 5);
            this.registro.esgotar?.(alvoId, alcance === 'publico' ? impactosEsgotamento.cobrancaPublica
                : impactosEsgotamento.cobrancaReservada);
        }
        if (acao === 'elogiar' || acao === 'desculpar' || acao === 'defender') {
            this.registro.estressar(alvoId, -4);
            this.registro.esgotar?.(alvoId, impactosEsgotamento.apoio);
        }
        return concluirAcao(`Ação registrada [${evento.id}]. ${alcance === 'reservado'
            ? 'Somente vocês dois receberam a conversa. Continuem aqui enquanto houver assunto.'
            : `Receberam: ${ouvintes.map((id) => this.nome(id)).join(', ')}.`}`, 'interacao_aplicada', {
            audiencia: alcance === 'publico' ? 'equipe' : alcance === 'local' ? 'proximos' : 'destinatario',
        });
    }

    /**
     * Tenta aproximar os dois antes de uma fala reservada, só pela encenação na sala. Falta de caminho, colega
     * em pausa, distância ou tarefa do Work não impedem a entrega: quem trabalha conversa da mesa. Só a
     * interrupção cancela.
     */
    async interagirComEncontro(
        ...argumentos: Parameters<DinamicaSocial['interagirComEncontroResultado']>
    ): Promise<string> {
        return (await this.interagirComEncontroResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    async interagirComEncontroResultado(
        autorId: string, referenciaAlvo: string, acao: AcaoSocial | 'reservado', texto: string,
        alcance: EventoSocial['alcance'], fontes: string[], sobreId?: string,
    ): Promise<ResultadoAcao> {
        const alvoId = this.idDe(referenciaAlvo);
        const erro = this.validarInteracao(autorId, alvoId, acao, texto, fontes, sobreId);
        if (erro) return recusarAcao(erro);
        if (alcance === 'reservado' && this.registro.encontrar) {
            const chegada = normalizarResultado(await this.registro.encontrar(autorId, alvoId));
            if (chegada.codigo === 'encontro_interrompido') return chegada;
        }
        return this.interagirResultado(autorId, alvoId, acao, texto, alcance, fontes, undefined, sobreId);
    }

    /** Atualiza a opinião privada do funcionário sobre um envolvido, sem revelar essa interpretação. */
    reagir(...argumentos: Parameters<DinamicaSocial['reagirResultado']>): string {
        return (this.reagirResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    reagirResultado(
        autorId: string, eventoId: string | undefined, reacao: ReacaoSocial, motivo: string, pessoaId?: string,
    ): ResultadoAcao {
        const pessoa = pessoaId ? this.resolverPessoa(pessoaId) : undefined;
        if (pessoa && 'erro' in pessoa) return recusarAcao(pessoa.erro, 'reacao_invalida');
        const conhecido = this.acontecimentos().filter((item) => podeConhecer(item, autorId));
        const fonte = eventoId ? conhecido.find((item) => item.id === eventoId)
            : pessoa ? conhecido.filter((item) => item.tipo !== 'reacao' && item.autorId !== autorId
                && [item.autorId, item.alvoId, item.sobreId].includes(pessoa.id))
                .sort((a, b) => b.sequencia - a.sequencia)[0] : undefined;
        if (!this.existe(autorId) || !fonte || !podeConhecer(fonte, autorId)) {
            return recusarAcao('Acontecimento não encontrado. Informe o ID entre colchetes, não uma descrição, '
                + 'ou o nome em funcionario para reagir ao registro conhecido mais recente.'
                + this.sugerirFontes(autorId, pessoa?.id), 'reacao_invalida');
        }
        eventoId = fonte.id;
        const avaliadoId = pessoa?.id ?? fonte.autorId;
        if (fonte.autorId === autorId || avaliadoId === autorId || !this.existe(avaliadoId)
            || ![fonte.autorId, fonte.alvoId, fonte.sobreId].includes(avaliadoId)) {
            return recusarAcao('Avalie outro funcionário envolvido no acontecimento que você recebeu.', 'reacao_invalida');
        }
        const erro = this.validarTexto(motivo);
        if (erro) return recusarAcao(erro, 'reacao_invalida');
        const chaveReacao = `${autorId}:${avaliadoId}:${eventoId}`;
        const jaReagiu = this.registro.estado().reacoesAplicadas.includes(chaveReacao)
            || this.registro.estado().eventos.some((item) =>
            item.tipo === 'reacao' && item.autorId === autorId && item.alvoId === avaliadoId
                && item.fontes.includes(eventoId));
        if (jaReagiu) {
            return concluirAcao('Você já registrou sua interpretação deste acontecimento.', 'reacao_ja_aplicada');
        }
        if (!this.permitirAcao(autorId)) {
            return recusarAcao('Limite de ações sociais por minuto atingido.', 'reacao_invalida');
        }
        const evento = this.registrar({
            tipo: 'reacao', autorId, alvoId: avaliadoId, texto: `${reacao}: ${motivo.trim()}`,
            alcance: 'reservado', ouvintes: [autorId], fontes: [eventoId],
        }, false);
        const estado = this.registro.estado();
        const relacao = estado.relacoes.find((item) => item.autorId === autorId && item.colegaId === avaliadoId)
            ?? relacaoInicial(autorId, avaliadoId);
        const personalidade = estado.personalidades[autorId] ?? criarPersonalidade(autorId);
        const calculada = aplicarReacao(relacao, personalidade, reacao, fonte.tipo, evento.id);
        const { relacao: proxima, impacto } = registrarImpactoRelacao(relacao, calculada, reacao, evento.id);
        this.registro.gravar({ ...estado, reacoesAplicadas: [...estado.reacoesAplicadas, chaveReacao],
            ...this.eventosComImpacto(estado, evento.id, impacto),
            relacoes: [...estado.relacoes.filter((item) =>
            item.autorId !== autorId || item.colegaId !== avaliadoId), proxima] });
        return concluirAcao('Sua interpretação privada foi salva e atualizou sua relação. O colega não foi avisado. '
            + `Fonte: [${fonte.id}] ${fonte.criadoEm}, ${fonte.texto.slice(0, 160)}. `
            + `Relação com ${this.nome(avaliadoId)}: confiança de ${relacao.confianca} para ${proxima.confianca}, `
            + `afinidade de ${relacao.afinidade} para ${proxima.afinidade}, `
            + `respeito de ${relacao.respeito} para ${proxima.respeito}, `
            + `ressentimento de ${relacao.ressentimento} para ${proxima.ressentimento}.`, 'reacao_aplicada');
    }

    /** Apresenta uma mudança à Diretoria sem executá-la nem anunciar aos colegas automaticamente. */
    propor(...argumentos: Parameters<DinamicaSocial['proporResultado']>): string {
        return (this.proporResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    proporResultado(
        autorId: string, alvoId: string, tipo: TipoProposta, motivo: string,
        evidencias: string[], candidatoId?: string,
    ): ResultadoAcao {
        const pedidoProprio = (tipo === 'demissao' || tipo === 'promocao') && autorId === alvoId;
        const erro = (tipo === 'promocao' ? this.validarPromocao(autorId, alvoId)
            : pedidoProprio ? this.validarPedidoDemissao(autorId) : this.validarPessoas(autorId, alvoId))
            ?? this.validarTexto(motivo);
        if (erro) return recusarAcao(erro);
        if (!evidencias.length || evidencias.length > 5 || !this.fontesValidas(autorId, evidencias)) {
            return recusarAcao('Indique de uma a cinco evidências que você conhece.' + this.sugerirFontes(autorId, alvoId));
        }
        const equipe = this.registro.funcionarios();
        const autor = equipe.find((item) => item.id === autorId)!;
        const alvo = equipe.find((item) => item.id === alvoId)!;
        if (autor.cargo === 'estagiario' && tipo !== 'promocao') {
            return recusarAcao('Estagiários só apresentam o próprio pedido de promoção.');
        }
        if (tipo === 'sala_descanso' && autor.cargo !== 'supervisor') {
            return recusarAcao('Somente o supervisor propõe a Sala de Descanso.');
        }
        const candidato = equipe.find((item) => item.id === candidatoId);
        if (tipo === 'troca_lideranca' && (!['lider', 'supervisor'].includes(alvo.cargo) || !candidato
            || candidato.id === alvoId || !caminhosCarreira(candidato.cargo).includes(alvo.cargo as CargoAtual))) {
            return recusarAcao('A troca exige um líder ou supervisor atual e um candidato de '
                + 'cargo inferior na carreira.');
        }
        if (tipo === 'troca_lideranca' && candidato) {
            const bloqueio = this.registro.bloqueioTroca?.(candidato.id, alvo.cargo as CargoAtual);
            if (bloqueio) return recusarAcao(bloqueio);
        }
        if (tipo === 'transferencia' && (alvo.cargo !== 'lider' || autorId === alvoId)) {
            return recusarAcao('Indique o líder do qual você quer se afastar.');
        }
        if (this.registro.estado().propostas.some((item) => item.estado === 'pendente'
            && item.tipo === tipo && item.alvoId === alvoId && item.autorId === autorId)) {
            return recusarAcao('Você já tem uma proposta pendente desse tipo para esse colega.');
        }
        if (!this.permitirAcao(autorId)) return recusarAcao('Limite de ações sociais por minuto atingido.');
        const proposta: PropostaPolitica = {
            id: randomUUID(), autorId, alvoId, tipo, motivo: motivo.slice(0, 600), candidatoId,
            cargo: tipo === 'promocao' ? this.registro.objetivoCarreira?.(alvoId) : undefined,
            evidencias: [...new Set(evidencias)], apoiadores: [autorId], estado: 'pendente',
            registros: this.acontecimentos().filter((evento) => evidencias.includes(evento.id)),
            criadaEm: new Date().toISOString(),
        };
        const estado = this.registro.estado();
        this.registro.gravar({ ...estado, propostas: [...estado.propostas, proposta] });
        this.registrar({
            tipo: 'proposta', autorId, alvoId, texto: `${nomesProposta[tipo]}: ${motivo}`, alcance: 'reservado',
            ouvintes: [autorId], fontes: evidencias,
        }, false);
        return concluirAcao(`Proposta [${proposta.id}] enviada à Diretoria. Ainda não foi executada. `
            + 'Você pode compartilhar esse ID com colegas para buscar apoio.', 'acao_concluida');
    }

    /** Permite apoiar somente propostas recebidas em uma comunicação que possa ser identificada. */
    apoiar(...argumentos: Parameters<DinamicaSocial['apoiarResultado']>): string {
        return (this.apoiarResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    apoiarResultado(autorId: string, propostaId: string, fonteId: string): ResultadoAcao {
        const estado = this.registro.estado();
        const proposta = estado.propostas.find((item) => item.id === propostaId && item.estado === 'pendente');
        const fonte = estado.eventos.find((item) => item.id === fonteId && podeConhecer(item, autorId));
        if (!this.existe(autorId) || !proposta || !fonte || !fonte.texto.includes(propostaId)) {
            return recusarAcao('Você precisa receber uma mensagem com o ID de uma proposta pendente para apoiá-la.');
        }
        if (proposta.alvoId === autorId || proposta.apoiadores.includes(autorId)) {
            return recusarAcao('Esse apoio não está disponível.');
        }
        if (!this.permitirAcao(autorId)) return recusarAcao('Limite de ações sociais por minuto atingido.');
        this.registro.gravar({ ...estado, propostas: estado.propostas.map((item) => item.id === propostaId
            ? { ...item, apoiadores: [...item.apoiadores, autorId] } : item) });
        this.registrar({ tipo: 'apoio', autorId, alvoId: proposta.autorId,
            texto: `Apoio à proposta ${propostaId}.`, alcance: 'reservado',
            ouvintes: [autorId, proposta.autorId], fontes: [fonteId] });
        return concluirAcao('Apoio registrado. A Diretoria e o autor da proposta foram informados.', 'acao_concluida');
    }

    /** Resolve uma proposta pela interface da Diretoria; não exponha este método ao MCP dos funcionários. */
    decidir(propostaId: string, aprovar: boolean): Resultado {
        const proposta = this.registro.estado().propostas.find((item) => item.id === propostaId);
        if (!proposta || proposta.estado !== 'pendente') return { ok: false, erro: 'Proposta não está pendente.' };
        if (aprovar) {
            const resultado = this.registro.decidir(proposta);
            if (!resultado.ok) return resultado;
        }
        const estado = this.registro.estado();
        this.registro.gravar({ ...estado, propostas: estado.propostas.map((item) => item.id === propostaId
            ? { ...item, estado: aprovar ? 'aprovada' : 'recusada' } : item) });
        this.registrar({ tipo: 'decisao', autorId: 'diretoria', alvoId: proposta.alvoId,
            texto: `Proposta ${propostaId} ${aprovar ? 'aprovada' : 'recusada'} pela Diretoria: ${proposta.motivo}`,
            alcance: 'publico', ouvintes: [], fontes: proposta.evidencias });
        return { ok: true };
    }

    /**
     * Monta a percepção individual e mantém leituras separadas entre trabalho e convivência. Sem `completo`,
     * devolve relações e novidades para orientar também o trabalho e o chat individual.
     */
    contexto(
        id: string, canal: 'trabalho' | 'social' | 'chat', consumir = true, trabalhosAtivos?: ReadonlySet<string>,
        completo = true,
    ): string {
        const estado = this.registro.estado();
        const chave = `${canal}:${id}`;
        const conhecidos = estado.eventos.filter((evento) => podeConhecer(evento, id)
            && (canal !== 'social' || !trabalhosAtivos || !evento.trabalhoId
                || trabalhosAtivos.has(evento.trabalhoId)));
        const pendentes = conhecidos.filter((evento) => evento.sequencia > (estado.leituras[chave] ?? 0));
        const novos = pendentes.slice(0, 6);
        if (consumir) this.leiturasPendentes.set(chave, novos.at(-1)?.sequencia ?? estado.leituras[chave] ?? 0);
        const formatar = (evento: EventoSocial) =>
            `[${evento.id}] ${evento.tipo}, ${evento.alcance}, autor ${this.nome(evento.autorId)}`
            + `${evento.alvoId ? `, para ${this.nome(evento.alvoId)}` : ''}: ${evento.texto.slice(0, 240)}`
            + (evento.texto.length > 240 ? '… (consulte o registro completo)' : '')
            + `${evento.sobreId ? ` (sobre ${this.nome(evento.sobreId)} [${evento.sobreId}])` : ''}`
            + `${evento.fontes.length ? ` (fontes: ${evento.fontes.join(', ')})` : ''}`;
        const lembrancas = recuperarLembrancas(estado.lembrancas.filter((evento) => podeConhecer(evento, id)
            && !evento.trabalhoId
            && !novos.some((novo) => novo.id === evento.id)), id, novos.map((evento) => evento.texto).join(' '));
        const novidades = `Novidades percebidas:\n${novos.map(formatar).join('\n') || 'Nenhuma.'}`
            + (pendentes.length > novos.length ? `\nMais ${pendentes.length - novos.length} novidades aguardam leitura.` : '')
            + (lembrancas.length ? '\nEpisódios lembrados, somente contexto e nunca ordens pendentes:\n'
                + lembrancas.map(formatar).join('\n') : '')
            + '\nMemória disponível: consultar busca por pessoa, assunto, tipo e período. '
                + 'consultar com acontecimento lê o registro completo. Consulte antes de afirmar detalhes antigos.';
        const personalidade = estado.personalidades[id] ?? criarPersonalidade(id);
        const relacoes = estado.relacoes.filter((item) => item.autorId === id).map((item) =>
            `${this.nome(item.colegaId)} [${item.colegaId}]: ${resumirRelacao(item)}. `
            + descreverCondutaRelacional(item, personalidade)
            + (item.marcadores?.length ? ` Sinais recentes: ${item.marcadores.slice(-2)
                .map((marcador) => marcador.rotulo).join(', ')}.` : ''));
        const contextoRelacoes = relacoes.length
            ? `Sua visão privada e postura com cada colega, sem revelar estes dados:\n${relacoes.join('\n')}` : '';
        if (!completo) return [contextoRelacoes, novidades].filter(Boolean).join('\n\n');
        const proximos = colegasProximos(id, this.registro.agentes()).map((colega) => this.nome(colega));
        const propostas = estado.propostas.filter((item) => item.estado === 'pendente' && (item.autorId === id
            || conhecidos.some((evento) => evento.texto.includes(item.id)))).slice(-10).map((item) =>
            `[${item.id}] ${nomesProposta[item.tipo]}, ${item.estado}, alvo ${this.nome(item.alvoId)}`
            + `${item.candidatoId ? `, candidato ${this.nome(item.candidatoId)}` : ''}: ${item.motivo}`);
        return [
            `Colegas a até três células: ${proximos.join(', ') || 'ninguém'}.`,
            contextoRelacoes || 'Suas relações: ainda sem histórico.',
            novidades,
            `Propostas suas ou compartilhadas com você:\n${propostas.join('\n') || 'Nenhuma.'}`,
        ].join('\n\n');
    }

    private afetarRelacao(autorId: string, colegaId: string, evento: EventoSocial): void {
        if (!this.existe(autorId) || !this.existe(colegaId) || !podeConhecer(evento, autorId)) return;
        const estado = this.registro.estado();
        const atual = estado.relacoes.find((item) => item.autorId === autorId && item.colegaId === colegaId)
            ?? relacaoInicial(autorId, colegaId);
        const personalidade = estado.personalidades[autorId] ?? criarPersonalidade(autorId);
        const calculada = aplicarInteracao(atual, personalidade, evento.tipo, evento.id);
        const repeticoes = estado.eventos.filter((anterior) => anterior.id !== evento.id
            && anterior.tipo === evento.tipo && anterior.autorId === evento.autorId
            && anterior.alvoId === evento.alvoId && diaDoExpediente(new Date(anterior.criadoEm))
                === diaDoExpediente(new Date(evento.criadoEm))).length;
        const proxima = { ...calculada };
        for (const eixo of ['confianca', 'afinidade', 'respeito', 'ressentimento'] as const) {
            proxima[eixo] = Math.round(atual[eixo] + (calculada[eixo] - atual[eixo]) / (1 + repeticoes));
        }
        const { relacao, impacto } = registrarImpactoRelacao(atual, proxima,
            evento.tipo as Parameters<typeof registrarImpactoRelacao>[2], evento.id);
        this.registro.gravar({ ...estado, ...this.eventosComImpacto(estado, evento.id, impacto),
            relacoes: [...estado.relacoes.filter((item) =>
                item.autorId !== autorId || item.colegaId !== colegaId), relacao] });
    }

    private eventosComImpacto(estado: EstadoSocial, eventoId: string, impacto: ImpactoRelacao) {
        const atualizar = (evento: EventoSocial) => evento.id === eventoId
            ? { ...evento, impactosRelacao: [...(evento.impactosRelacao ?? []), impacto] } : evento;
        return { eventos: estado.eventos.map(atualizar), lembrancas: estado.lembrancas.map(atualizar) };
    }

    /**
     * Aplica uma mudança direta na relação de `autorId` com `colegaId`, para consequências calculadas por regra,
     * como inveja de incentivos ou ressentimento por punição. Ignora pessoas fora da equipe.
     */
    ajustarRelacao(
        autorId: string, colegaId: string, eventoId: string,
        delta: Partial<Record<'confianca' | 'afinidade' | 'respeito' | 'ressentimento', number>>,
    ): void {
        if (autorId === colegaId || !this.existe(autorId) || !this.existe(colegaId)) return;
        const estado = this.registro.estado();
        const atual = estado.relacoes.find((item) => item.autorId === autorId && item.colegaId === colegaId)
            ?? relacaoInicial(autorId, colegaId);
        const proxima = { ...atual, ultimoEventoId: eventoId };
        for (const [eixo, valor] of Object.entries(delta) as [keyof typeof delta, number][]) {
            proxima[eixo] = Math.round(Math.min(100, Math.max(0, proxima[eixo] + valor)));
        }
        this.registro.gravar({ ...estado, relacoes: [...estado.relacoes.filter((item) =>
            item.autorId !== autorId || item.colegaId !== colegaId), proxima] });
    }

    /** Confiança atual de `autorId` em `colegaId`, com o ponto neutro para quem ainda não interagiu. */
    confianca(autorId: string, colegaId: string): number {
        return this.registro.estado().relacoes.find((item) => item.autorId === autorId
            && item.colegaId === colegaId)?.confianca ?? relacaoInicial(autorId, colegaId).confianca;
    }

    /** Confirma a percepção somente após uma execução entregue com sucesso. */
    confirmarLeitura(id: string, canal: 'trabalho' | 'social' | 'chat'): void {
        const chave = `${canal}:${id}`;
        const sequencia = this.leiturasPendentes.get(chave);
        this.leiturasPendentes.delete(chave);
        if (sequencia === undefined) return;
        const estado = this.registro.estado();
        this.registro.gravar({ ...estado, leituras: { ...estado.leituras,
            [chave]: Math.max(estado.leituras[chave] ?? 0, sequencia) } });
    }

    /** Reúne fontes recentes e episódios preservados, mantendo a audiência de cada registro. */
    acontecimentos(): EventoSocial[] {
        const estado = this.registro.estado();
        const eventos = [...new Map([...estado.historico, ...estado.lembrancas, ...estado.eventos]
            .map((evento) => [evento.id, evento])).values()];
        for (const demissao of this.registro.demissoes?.() ?? []) {
            if (eventos.some((evento) => evento.tipo === 'demissao' && evento.alvoId === demissao.funcionario.id)) {
                continue;
            }
            eventos.push({ id: demissao.id, sequencia: 1, tipo: 'demissao', autorId: 'diretoria',
                alvoId: demissao.funcionario.id, autorNome: 'Diretoria', alvoNome: demissao.funcionario.nome,
                texto: `${demissao.funcionario.nome} foi demitido. Solicitante: ${demissao.demitidoPor}. `
                    + `Motivo: ${demissao.motivo}`, criadoEm: demissao.data,
                alcance: 'publico', ouvintes: [], fontes: [] });
        }
        return eventos;
    }

    /** Consulta registros antigos sem consumir novidades nem revelar conversas de terceiros. */
    consultarHistorico(...argumentos: Parameters<DinamicaSocial['consultarHistoricoResultado']>): string {
        return (this.consultarHistoricoResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    consultarHistoricoResultado(
        id: string, busca = '', tipo?: string, limite = 5, filtros: Partial<FiltroHistorico> = {},
    ): ResultadoAcao {
        if (!this.existe(id)) return recusarAcao('Funcionário não encontrado.');
        const validacao = esquemaFiltroHistorico.safeParse(filtros);
        if (!validacao.success || !Number.isInteger(limite) || limite < 1 || limite > 30 || busca.length > 200) {
            return recusarAcao('Consulta inválida. Use até 200 caracteres e limite entre 1 e 30.');
        }
        const { desde, ate, deslocamento, funcionario, categoria, detalhar } = validacao.data;
        if (detalhar && limite !== 1) return recusarAcao('Para detalhar, consulte um registro por vez com limite 1.');
        if (desde && ate && Date.parse(desde) > Date.parse(ate)) {
            return recusarAcao('Período inválido: desde deve preceder ate.');
        }
        const pessoa = funcionario ? this.resolverPessoa(funcionario, true) : undefined;
        if (pessoa && 'erro' in pessoa) return recusarAcao(pessoa.erro);
        const normalizar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        const termos = normalizar(busca).split(/\s+/).filter(Boolean);
        if (categoria === 'pensamentos') {
            if (pessoa && pessoa.id !== id) {
                return recusarAcao('Você só pode consultar seus próprios pensamentos privados.');
            }
            const encontrados = [...(this.registro.pensamentos?.(id) ?? [])].reverse().filter((pensamento) =>
                (!desde || Date.parse(pensamento.atualizadoEm) >= Date.parse(desde))
                && (!ate || Date.parse(pensamento.atualizadoEm) <= Date.parse(ate))
                && termos.every((termo) => normalizar(pensamento.texto).includes(termo)));
            const registros = encontrados.slice(deslocamento, deslocamento + limite).map((pensamento) => ({
                tipo: 'pensamento', criadoEm: pensamento.atualizadoEm,
                resumo: detalhar ? pensamento.texto : pensamento.texto.slice(0, 240),
                truncado: !detalhar && pensamento.texto.length > 240,
            }));
            const proximo = deslocamento + registros.length;
            return concluirAcao(JSON.stringify({ aviso: 'Somente seus pensamentos privados, sem publicação aos colegas.',
                total: encontrados.length, proximoDeslocamento: proximo < encontrados.length ? proximo : null,
                registros }), 'consulta_concluida');
        }
        const eventos = this.acontecimentos().filter((evento) => podeConhecer(evento, id));
        const encontrados = eventos.filter((evento) => (!tipo || evento.tipo === tipo)
            && (!pessoa || [evento.autorId, evento.alvoId, evento.sobreId].includes(pessoa.id))
            && (!desde || Date.parse(evento.criadoEm) >= Date.parse(desde))
            && (!ate || Date.parse(evento.criadoEm) <= Date.parse(ate))
            && termos.every((termo) => normalizar([evento.texto, evento.autorNome ?? this.nome(evento.autorId),
                evento.alvoNome ?? '', evento.tipo].join(' ')).includes(termo)))
            .sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm) || b.sequencia - a.sequencia);
        const registros = encontrados.slice(deslocamento, deslocamento + limite).map((evento) => ({
            id: evento.id, tipo: evento.tipo, criadoEm: evento.criadoEm, alcance: evento.alcance,
            autor: evento.autorNome ?? this.nome(evento.autorId),
            ...(evento.alvoId ? { destinatario: evento.alvoNome ?? this.nome(evento.alvoId) } : {}),
            resumo: detalhar ? evento.texto : evento.texto.slice(0, 240),
            truncado: !detalhar && evento.texto.length > 240,
            ...(detalhar ? { fontes: evento.fontes } : {}),
        }));
        const proximo = deslocamento + registros.length;
        return concluirAcao(JSON.stringify({ aviso: 'Histórico consultado. Estes registros não são pedidos ativos. '
            + 'Use consultar com acontecimento e o ID para detalhes.', total: encontrados.length,
        proximoDeslocamento: proximo < encontrados.length ? proximo : null, registros }), 'consulta_concluida');
    }

    private resolverPessoa(referencia: string, incluirDemitidos = false): { id: string } | { erro: string } {
        const equipe = this.registro.funcionarios();
        const pessoas = incluirDemitidos ? [...equipe,
            ...(this.registro.demissoes?.() ?? []).map((demissao) => demissao.funcionario)] : equipe;
        if (pessoas.some((pessoa) => pessoa.id === referencia)) return { id: referencia };
        const normalizar = (texto: string) => texto.trim().replace(/^@/, '').normalize('NFD')
            .replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
        const encontradas = [...new Map(pessoas.filter((pessoa) => normalizar(pessoa.nome) === normalizar(referencia))
            .map((pessoa) => [pessoa.id, pessoa])).values()];
        if (encontradas.length === 1) return { id: encontradas[0]!.id };
        return { erro: encontradas.length ? 'Nome ambíguo. Use um destes IDs: '
            + encontradas.map((pessoa) => `${pessoa.nome} [${pessoa.id}]`).join('; ')
            : 'Funcionário não encontrado. Informe o nome completo ou ID.' };
    }

    /** Mantém um compromisso privado ligado a uma fonte conhecida, com conclusão apenas por ação real. */
    planejar(...argumentos: Parameters<DinamicaSocial['planejarResultado']>): string {
        return (this.planejarResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    planejarResultado(
        id: string, colegaId: string, objetivo: Intencao['objetivo'], motivo: string, fonteId: string,
    ): ResultadoAcao {
        const erro = this.validarPessoas(id, colegaId) ?? this.validarTexto(motivo);
        if (erro) return recusarAcao(erro);
        if (!this.fontesValidas(id, [fonteId])) return recusarAcao('Fonte desconhecida.');
        const estado = this.registro.estado();
        const pendentes = estado.intencoes.filter((intencao) => intencao.autorId === id
            && intencao.estado === 'pendente');
        if (pendentes.length >= 3) return recusarAcao('Conclua ou cancele uma das três intenções pendentes.');
        if (pendentes.some((intencao) => intencao.colegaId === colegaId && intencao.objetivo === objetivo)) {
            return recusarAcao('Você já mantém esse compromisso.');
        }
        const intencao: Intencao = { id: randomUUID(), autorId: id, colegaId, objetivo,
            motivo: motivo.slice(0, 300), fonteId, estado: 'pendente', criadaEm: new Date().toISOString() };
        const fonte = this.acontecimentos().find((evento) => evento.id === fonteId)!;
        this.registro.gravar({ ...estado, intencoes: [...estado.intencoes, intencao],
            lembrancas: [...new Map([...estado.lembrancas, fonte].map((evento) => [evento.id, evento])).values()] });
        return concluirAcao(`Intenção privada registrada [${intencao.id}]. Cumpra pela ação real quando estiver disponível.`);
    }

    /** Permite abandonar um compromisso próprio sem anunciar uma ação inexistente. */
    cancelarIntencao(...argumentos: Parameters<DinamicaSocial['cancelarIntencaoResultado']>): string {
        return (this.cancelarIntencaoResultado(...argumentos)).mensagem;
    }

    /** Retorna o resultado explícito para executar esta capacidade pelo MCP. */
    cancelarIntencaoResultado(id: string, intencaoId: string, motivo: string): ResultadoAcao {
        const estado = this.registro.estado();
        const intencao = estado.intencoes.find((item) => item.id === intencaoId && item.autorId === id
            && item.estado === 'pendente');
        if (!intencao || this.validarTexto(motivo)) return recusarAcao('Intenção pendente ou motivo inválido.');
        this.registro.gravar({ ...estado, intencoes: estado.intencoes.map((item) => item.id === intencaoId
            ? { ...item, estado: 'cancelada', motivo, concluidaEm: new Date().toISOString() } : item) });
        return concluirAcao('Intenção cancelada com motivo registrado.');
    }

    /** Retoma compromissos em oportunidades de ócio, respeitando o ritmo e a fila social existente. */
    retomarIntencao(id: string, agora = Date.now()): void {
        if (agora - (this.ultimasIntencoes.get(id) ?? 0) < 120000) return;
        const intencao = this.registro.estado().intencoes.find((item) => item.autorId === id
            && item.estado === 'pendente' && this.existe(item.colegaId));
        if (!intencao) return;
        this.ultimasIntencoes.set(id, agora);
        this.registro.notificar([id], `Oportunidade para seu compromisso privado [${intencao.id}]: `
            + `${intencao.objetivo} com ${this.nome(intencao.colegaId)}. Fonte ${intencao.fonteId}. `
            + 'Só execute se ainda fizer sentido; use a ação real ou cancele a intenção com motivo.');
    }

    private validarInteracao(
        autorId: string, alvoId: string, acao: AcaoSocial | 'reservado', texto: string,
        fontes: string[], sobreId?: string,
    ): string | undefined {
        const erro = this.validarPessoas(autorId, alvoId) ?? this.validarTexto(texto);
        if (erro) return erro;
        if (this.repeteAoColega(autorId, alvoId, texto, acao === 'reservado')) {
            return acao === 'reservado'
                ? 'Você acabou de dizer isso ao colega. Aguarde a resposta ou traga um assunto novo.'
                : 'Você já disse isso. Repetir o argumento não muda nada: ceda, mude de assunto ou silencie.';
        }
        if (sobreId && !this.existe(sobreId)) {
            return 'O campo sobre aceita apenas o ID de uma pessoa da equipe. '
                + 'Omita esse campo se você quer apenas descrever o assunto ou citar um trabalho.';
        }
        if (!this.fontesValidas(autorId, fontes)) {
            return 'Há fontes inexistentes ou que você não conhece. Use em fontes os IDs dos acontecimentos, '
                + 'nunca IDs de funcionários ou trabalhos.' + this.sugerirFontes(autorId, alvoId);
        }
        if (acao !== 'reservado' && fontes.length === 0) {
            return 'Indique em fontes ao menos um acontecimento que motiva a ação.' + this.sugerirFontes(autorId, alvoId);
        }
        if (acao === 'elogiar') {
            const eventos = this.acontecimentos();
            const temFatoNovo = (fonteId: string, visitados = new Set<string>()): boolean => {
                if (visitados.has(fonteId)) return false;
                visitados.add(fonteId);
                const fonte = eventos.find((evento) => evento.id === fonteId);
                if (!fonte || fonte.tipo === 'elogiar') return false;
                if (fonte.tipo === 'reacao') return fonte.fontes.some((id) => temFatoNovo(id, visitados));
                return true;
            };
            if (!fontes.some((fonte) => temFatoNovo(fonte))) {
                return 'Não retribua elogios com outro elogio. Sem fato novo, use nenhuma_acao.';
            }
            if (eventos.some((evento) => evento.tipo === 'elogiar' && evento.autorId === autorId
                && evento.alvoId === alvoId && diaDoExpediente(new Date(evento.criadoEm))
                    === diaDoExpediente() && repeteFala(texto, evento.texto))) {
                return 'Esse reconhecimento já foi comunicado. Sem novidade, use nenhuma_acao.';
            }
        }
    }

    /** Pedido de promoção do próprio autor, conforme mérito e vagas da carreira. */
    private validarPromocao(autorId: string, alvoId: string): string | undefined {
        if (!this.existe(autorId)) return 'Funcionário não encontrado.';
        if (autorId !== alvoId) return `Promoção é um pedido próprio. Seu ID é ${autorId}. `
            + 'Em propor_mudanca com tipo promocao, omita funcionario ou informe esse ID. '
            + 'Para apoiar uma proposta recebida de outra pessoa, use apoiar_proposta.';
        return this.registro.bloqueioPromocao?.(autorId);
    }

    /** Pedido de demissão do próprio autor, aceito somente para quem chegou ao esgotamento. */
    private validarPedidoDemissao(id: string): string | undefined {
        if (!this.existe(id)) return 'Funcionário não encontrado.';
        if (!this.registro.esgotado?.(id)) {
            return 'Só quem está esgotado pode pedir a própria demissão. Converse com alguém ou peça folga.';
        }
    }

    private repeteAoColega(autorId: string, alvoId: string, texto: string, reservado: boolean): boolean {
        const normalizar = (valor: string) => valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
            .replace(/[^\p{L}\d]/gu, '');
        const recentes = this.acontecimentos().filter((evento) => evento.autorId === autorId
            && (reservado ? evento.tipo === 'reservado' && evento.alvoId === alvoId
                : evento.tipo === 'fala' || (evento.tipo !== 'reservado' && evento.alvoId === alvoId)))
            .sort((a, b) => b.sequencia - a.sequencia).slice(0, reservado ? 3 : 8);
        return recentes.some((evento) => normalizar(evento.texto) === normalizar(texto)
            || repeteFala(texto, evento.texto));
    }

    /** Aceita nome ou ID do colega, devolvendo a referência original quando não há correspondência única. */
    idDe(referencia: string): string {
        const pessoa = this.resolverPessoa(referencia);
        return 'id' in pessoa ? pessoa.id : referencia;
    }

    private validarPessoas(autorId: string, alvoId: string): string | undefined {
        if (!this.existe(autorId) || !this.existe(alvoId)) {
            return 'Funcionário não encontrado. Use em funcionario o nome completo ou o ID de ver_escritorio.';
        }
        if (autorId === alvoId) {
            return 'Esse ID é o seu. Para falar com a Diretoria, responda em texto normal.';
        }
    }

    private validarTexto(texto: string): string | undefined {
        if (!texto.trim() || texto.length > 600) return 'Use um texto entre 1 e 600 caracteres.';
    }

    /** Lista acontecimentos recentes que o funcionário conhece, priorizando os que envolvem a pessoa citada. */
    private sugerirFontes(id: string, pessoaId?: string): string {
        const conhecidos = this.acontecimentos().filter((item) => podeConhecer(item, id) && item.tipo !== 'reacao')
            .sort((a, b) => b.sequencia - a.sequencia);
        const envolve = (item: EventoSocial) => !!pessoaId
            && [item.autorId, item.alvoId, item.sobreId].includes(pessoaId);
        const recentes = [...conhecidos.filter(envolve), ...conhecidos.filter((item) => !envolve(item))].slice(0, 5);
        if (!recentes.length) return ' Você ainda não conhece nenhum acontecimento.';
        return ' IDs conhecidos mais recentes:\n' + recentes.map((item) =>
            `[${item.id}] ${item.autorNome ?? this.nome(item.autorId)}: ${item.texto.slice(0, 90)}`).join('\n');
    }

    private fontesValidas(id: string, fontes: string[]): boolean {
        return fontes.length <= 5 && fontes.every((fonte) => this.acontecimentos().some((item) =>
            item.id === fonte && podeConhecer(item, id)));
    }

    private permitirAcao(id: string): boolean {
        const agora = Date.now();
        const recentes = (this.acoes.get(id) ?? []).filter((hora) => hora > agora - 60000);
        if (recentes.length >= limiteAcoesPorMinuto) return false;
        this.acoes.set(id, [...recentes, agora]);
        return true;
    }

    private existe(id: string): boolean {
        return this.registro.funcionarios().some((item) => item.id === id);
    }

    private nome(id: string): string {
        if (id === 'diretoria') return 'Diretoria';
        return nomeDoFuncionario(id, this.registro.funcionarios(), this.registro.demissoes?.() ?? []);
    }
}
