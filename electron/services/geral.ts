import { randomUUID } from 'node:crypto';
import { instrucaoAgirNoTurno, instrucaoDepartamento } from '../../shared/departamento';
import { instrucaoHierarquia } from '../../shared/diretoria';
import type { SituacaoGeral } from '../../shared/estado';
import { cargos, nomeCargo, cargoAtual, type Ferramenta, type Funcionario } from '../../shared/funcionarios';
import {
    autorSistema,
    autorUsuario,
    contarFalasDoEmbate,
    encontrarInterpelados,
    encontrarMencoes,
    ehSilencio,
    removerFrasesRepetidas,
    ehCumprimento,
    removerAutoVocativo,
    repeteFala,
    limiteFalasSeguidas,
    limiteMensagensGeral,
    respostaSilencio,
    type EtapaResposta,
    type MensagemGeral,
} from '../../shared/geral';
import type { Resultado } from '../../shared/ponte';
import { instrucoesPausas, instrucoesSociais } from '../../shared/social';
import { criarSessao } from './harness/sessao';
import type { SessaoAgente } from './harness/tipos';

const mensagensNovasMaximas = 20;
const mensagensGeralNoReservado = 12;

/** Acesso do canal ao restante do escritório. */
export type RegistroGeral = {
    funcionarios: () => Funcionario[];
    mensagens: () => MensagemGeral[];
    gravar: (mensagens: MensagemGeral[]) => void;
    contexto: (funcionarioId: string) => string;
    personalidade?: (funcionarioId: string) => string;
    registrarFala?: (funcionarioId: string, texto: string) => string | undefined;
    urlMcp: (funcionarioId: string, reservado?: boolean) => Promise<string>;
    ferramentasReservadas?: (funcionarioId: string) => string[] | undefined;
    emPausa?: (funcionarioId: string) => boolean;
    contextoReservado?: (id: string, colegaId: string) => { chave: string; texto: string } | undefined;
    pasta: string;
    emitirMensagens: () => void;
    emitirEstado: () => void;
    /**
     * `citado` indica uma menção direta no Geral. Menções e diálogos reservados podem ser respondidos durante
     * uma tarefa do Work, da própria mesa.
     */
    disponivel?: (funcionarioId: string, reservadoCom?: string, citado?: boolean) => boolean;
    leitura?: (funcionarioId: string) => string | undefined;
    gravarLeitura?: (funcionarioId: string, mensagemId: string) => void;
    limparLeituras?: () => void;
    nomeResponsavel?: () => string;
    historicoReservado?: (id: string, colegaId: string) => string;
    responderReservado?: (id: string, colegaId: string, texto: string) => string | Promise<string>;
    reservadoSemResposta?: (id: string, colegaId: string) => void;
    conversaReservadaEncerrada?: (id: string, colegaId: string) => void;
    confirmarPercepcao?: (id: string) => void;
};

type Vez = {
    funcionarioId: string; contada: boolean; respostaObrigatoria?: boolean; motivos?: string[]; reservadoCom?: string;
    reflexao?: boolean;
    /** Turno livre do aviso periódico, que recebe a memória das ações recentes. */
    livre?: boolean;
    pedidoDaDiretoria?: boolean;
    citado?: boolean;
    /** Reação a uma discussão em ciclo: exige um ato real e dispensa a nova fala. */
    embate?: boolean;
};

const falasParaEmbate = 4;
const falasParaAgirNoEmbate = 6;

function motivoDoEmbate(colega: string, falas: number): string {
    return `Você e ${colega} já trocaram ${falas} falas seguidas na mesma discussão, que está em ciclo. `
        + 'Não rebata nem conteste de novo o mesmo ponto, nem com outras palavras. Encerre o embate: ceda, peça '
        + 'desculpas, registre o que sente com reagir_ao_acontecimento, faça uma pausa ou leve a briga para '
        + 'conversar_reservado.';
}

const ferramentasReflexao = ['interagir_socialmente', 'reagir_ao_acontecimento', 'atualizar_pensamento',
    'conversar_reservado', 'nenhuma_acao'];

/**
 * Ferramentas do turno de reação. Citado pela Diretoria, o agente precisa agir sobre o pedido, então ganha pausa,
 * conserto e ações sociais. Reações entre colegas permitem ações públicas e propostas à Diretoria.
 */
function ferramentasDaReacao(pedidoDaDiretoria: boolean, embate: boolean): string[] {
    const base = pedidoDaDiretoria
        ? ['ver_escritorio', 'consertar_item', 'fazer_pausa', 'atualizar_pensamento', 'conversar_reservado',
            'reagir_ao_acontecimento',
            'interagir_socialmente', 'nenhuma_acao']
        : ferramentasReflexao;
    const ferramentas = [...new Set([...base, 'consultar', 'propor_mudanca', 'escolher_carreira'])];
    return embate ? [...new Set([...ferramentas.filter((nome) => nome !== 'nenhuma_acao'), 'fazer_pausa'])]
        : ferramentas;
}

const aberturaPedidoDaDiretoria = 'Turno de ação: a Diretoria citou você. Execute agora pela ferramenta o '
    + 'que ela pediu ou o que sua decisão exige. Texto aqui não é publicado.';

const aberturaReflexao = 'Turno de reação.';

const instrucoesReacao = `Num "${aberturaReflexao}" texto livre não sai. Se há algo a tratar com um colega, `
    + 'use interagir_socialmente apenas se houver motivo novo e concreto: conteste, defenda ou repare. '
    + 'Ataque público é motivo concreto. '
    + 'Reagir é privado. Reserve intimidades; sem novidade, nenhuma_acao.';

const instrucoesLideranca = 'Na liderança, reveja cobranças indevidas. Cobre falhas ou suspeitas de quebra via '
    + 'interagir_socialmente (acao cobrar, alcance publico, fontes). Discordância não justifica punição. '
    + 'Em inimizade, propor_mudanca (tipo demissao) pode declarar conflito pessoal, sem inventar falhas.';

type FalaAtiva = {
    etapa?: EtapaResposta;
    falou: boolean; publicou: boolean; liberar: () => void; pausada: boolean; reflexao: boolean; pedidoDaDiretoria: boolean;
    silenciou?: boolean;
    encerrouParticipacao?: boolean;
};

function instrucoesGeral(funcionario: Funcionario, equipe: Funcionario[]): string {
    const colegas = equipe
        .filter((colega) => colega.id !== funcionario.id)
        .map((colega) => `${colega.nome} [ID ${colega.id}] (${nomeCargo(colega.cargo)})`)
        .join(', ');
    return [
        `Você é ${funcionario.nome}, ${nomeCargo(funcionario.cargo).toLowerCase()} no escritório da Lumon.`,
        instrucaoDepartamento,
        cargos[cargoAtual(funcionario.cargo)].instrucao,
        instrucaoHierarquia(funcionario.cargo),
        `Seu ID é ${funcionario.id}. Seus colegas: ${colegas || 'ninguém ainda'}. Use IDs nas ferramentas.`,
        'Geral: conversa pública e consulta do Work. Texto normal nunca é privado.',
        'Fale em português brasileiro, em primeira pessoa e com naturalidade. Complete explicações.',
        `Pausas exigem fazer_pausa. ${instrucaoAgirNoTurno}`,
        'Impressões privadas usam atualizar_pensamento, nunca o Geral.',
        'Responda ao motivo atual; histórico é contexto, sem retomar o Work.',
        'Confira acusações. Cota só do contexto atual.',
        instrucoesReacao,
        ...(funcionario.cargo === 'lider' || funcionario.cargo === 'supervisor' ? [instrucoesLideranca] : []),
        instrucoesSociais,
        'Para silenciar, use silencio, sem publicar o marcador.',
    ].join('\n');
}

/**
 * Canal Geral: a Diretoria fala com todos ou com quem citar, e os agentes conversam entre si. As falas rodam uma
 * por vez, numa sessão de conversa separada do trabalho de cada funcionário. Falas iniciadas por agentes contam
 * num limite de falas seguidas, zerado por uma nova mensagem da Diretoria. Quem é citado por um colega reflete em
 * privado antes de responder, para registrar reações e pensamentos.
 */
export class CanalGeral {
    private fila: Vez[] = [];
    private falandoId: string | null = null;
    private conversaLivre = false;
    private semLimite = false;
    private encerrandoConversa = false;
    private falaramNaRodada = 0;
    private restantesNaRodada = 0;
    private falasSeguidas = 0;
    private turnosPorFuncionario = new Map<string, number>();
    private ultimoFalanteId: string | null = null;
    private limiteAnunciado = false;
    private sessoes = new Map<string, {
        sessao: SessaoAgente; reservadoCom?: string; personalidade: string; chaveReservada?: string;
    }>();
    private destinosReservados = new Map<string, string>();
    private versoesReservados = new Map<string, number>();
    private leituras = new Map<string, string>();
    private controles = new Map<string, AbortController>();
    private ativas = new Map<string, FalaAtiva>();
    private falasEmAndamento = new Map<string, MensagemGeral>();
    private retomada: NodeJS.Timeout | null = null;
    private encerrado = false;
    private geracao = 0;

    /** Oferece uma decisão sobre o estado atual quando o funcionário está livre. */
    avisarEstado(id: string): void {
        if (this.encerrado || this.encerrandoConversa || this.emExecucao(id)) return;
        if (this.falandoId === id) return;
        if (this.fila.some((vez) => vez.funcionarioId === id)) return;
        this.enfileirar([{ funcionarioId: id, contada: false, livre: true, motivos: [
            'Aviso periódico: momento livre. Não é uma ordem da Diretoria. Se o corpo pedir de verdade, '
                + 'faça uma pausa; se tiver um compromisso pendente, retome. Caso contrário, fique em silêncio. '
                + 'Não relate necessidades no Geral.',
        ] }]);
    }

    /** Agenda uma reação ao que foi percebido sem interromper trabalho ou furar o limite diário. */
    notificar(ids: string[], motivo = 'Reaja somente se houver algo novo e útil nos acontecimentos percebidos.'): void {
        const geracao = this.geracao;
        queueMicrotask(() => {
            if (this.encerrado || this.geracao !== geracao) return;
            this.enfileirar(ids.map((funcionarioId) => ({ funcionarioId, contada: true, motivos: [motivo] })));
        });
    }

    /** Agenda a resposta no mesmo diálogo privado, sem misturar motivos ou sessões do Geral. */
    notificarReservado(id: string, colegaId: string, motivo: string): void {
        const geracao = this.geracao;
        const par = [id, colegaId].sort().join(':');
        const versao = this.versoesReservados.get(par) ?? 0;
        queueMicrotask(() => {
            if (this.encerrado || this.geracao !== geracao) return;
            if ((this.versoesReservados.get(par) ?? 0) !== versao) return;
            this.enfileirar([{ funcionarioId: id, contada: false, reservadoCom: colegaId, motivos: [motivo] }]);
        });
    }

    /**
     * Encerra pela interface o diálogo privado entre dois colegas: descarta respostas pendentes e interrompe a
     * que estiver em andamento. Conversas privadas não têm limite de turnos, então esta é a forma de pará-las.
     */
    encerrarReservado(id: string, colegaId: string, preservarId?: string): void {
        const par = [id, colegaId].sort().join(':');
        this.versoesReservados.set(par, (this.versoesReservados.get(par) ?? 0) + 1);
        const doPar = (pessoa: string, parceiro?: string) =>
            (pessoa === id && parceiro === colegaId) || (pessoa === colegaId && parceiro === id);
        this.fila = this.fila.filter((vez) => !doPar(vez.funcionarioId, vez.reservadoCom));
        for (const [pessoa, parceiro] of this.destinosReservados) {
            if (doPar(pessoa, parceiro) && pessoa !== preservarId) this.controles.get(pessoa)?.abort();
        }
        this.registro.emitirEstado();
    }

    private paresReservadosAtivos(): string[] {
        const pares = [...this.destinosReservados, ...this.fila.flatMap((vez) =>
            vez.reservadoCom ? [[vez.funcionarioId, vez.reservadoCom] as const] : [])];
        return [...new Set(pares.map((par) => [...par].sort().join(':')))];
    }

    /** Informa se o funcionário ainda está gerando uma fala para manter seu encontro físico. */
    emExecucao(id: string): boolean {
        return this.ativas.has(id) || this.fila.some((vez) => vez.funcionarioId === id && !!vez.reservadoCom);
    }

    /** Transcrição das últimas falas públicas, para turnos fora do Geral que precisam saber o que foi dito ali. */
    falasRecentes(quantidade = mensagensGeralNoReservado): string {
        return this.transcrever(this.registro.mensagens().filter((mensagem) => mensagem.tipo !== 'acao')
            .slice(-quantidade));
    }

    private transcrever(itens: MensagemGeral[], leitorId?: string): string {
        const nomes = new Map<string, string>([
            [autorUsuario, this.registro.nomeResponsavel?.() || 'Diretoria'],
            [autorSistema, 'Sistema'],
            ...this.registro.funcionarios().map((colega): [string, string] => [colega.id,
                colega.id === leitorId ? `Você (${colega.nome})` : colega.nome]),
        ]);
        return itens
            .filter((mensagem) => !mensagem.tipo && mensagem.texto.trim())
            .map((mensagem) => `[${mensagem.criadaEm}] ${nomes.get(mensagem.autorId) ?? 'Ex funcionário'}`
                + `${mensagem.eventoId ? ` (fonte ${mensagem.eventoId})` : ''}: ${mensagem.texto}`)
            .join('\n');
    }

    /** Informa se o funcionário está num turno privado de reflexão, em que nenhuma ação pública é permitida. */
    emReflexao(id: string): boolean {
        return this.ativas.get(id)?.reflexao ?? false;
    }

    /** Informa se o turno de reação atende a uma citação da Diretoria, que libera ações sociais de qualquer cargo. */
    atendeDiretoria(id: string): boolean {
        return this.ativas.get(id)?.pedidoDaDiretoria ?? false;
    }

    /** Marca uma ação social explícita para evitar outra publicação automática no mesmo turno. */
    registrarAcao(id: string, encerrarParticipacao = false): void {
        const fala = this.ativas.get(id);
        if (!fala) return;
        fala.falou = true;
        this.removerPrevia(id);
        if (!encerrarParticipacao) return;
        fala.encerrouParticipacao = true;
        if (!fala.reflexao) return;
        const indice = this.fila.findIndex((vez) => vez.funcionarioId === id && !vez.reflexao && !vez.reservadoCom);
        if (indice < 0) return;
        const [resposta] = this.fila.splice(indice, 1);
        if (resposta?.contada && this.conversaLivre) this.restantesNaRodada--;
    }

    /** Impede novas publicações após uma ação que já concluiu a participação atual. */
    participacaoEncerrada(id: string): boolean {
        return this.ativas.get(id)?.encerrouParticipacao ?? false;
    }

    constructor(private registro: RegistroGeral, private abrirSessao: typeof criarSessao = criarSessao) {
        const pendentes = registro.mensagens().filter((mensagem) =>
            mensagem.ferramentas.some((ferramenta) => ferramenta.estado === 'rodando'));
        for (const mensagem of pendentes) this.atualizarFerramenta(mensagem.id, {
            estado: 'recusada', concluidaEm: new Date().toISOString(),
            saida: 'O aplicativo foi encerrado durante esta ação.',
        });
    }

    situacao(): SituacaoGeral {
        return {
            etapaResposta: this.falandoId ? this.ativas.get(this.falandoId)?.etapa ?? 'preparando' : undefined,
            falasEmAndamento: [...this.falasEmAndamento.values()],
            falandoId: this.falandoId,
            conversaLivre: this.conversaLivre,
            conversaAtiva: this.conversaLivre || !!this.falandoId || this.ativas.size > 0 || this.fila.length > 0,
            encerrando: this.encerrandoConversa,
            semLimite: this.semLimite,
            falasRestantes: Math.max(0, limiteFalasSeguidas - this.falasSeguidas),
            reservadosAtivos: this.paresReservadosAtivos(),
        };
    }

    enviarDoUsuario(texto: string): Resultado {
        const equipe = this.registro.funcionarios();
        if (equipe.length === 0) return { ok: false, erro: 'Contrate alguém antes de usar o Geral.' };
        this.encerrandoConversa = false;
        this.falasSeguidas = 0;
        this.turnosPorFuncionario.clear();
        this.ultimoFalanteId = null;
        this.limiteAnunciado = false;
        const anteriores = this.registro.mensagens();
        this.publicar(autorUsuario, texto);
        const mencionados = encontrarMencoes(texto, equipe);
        if (mencionados.length === 0) {
            this.enfileirar(this.ordemDaRodada(equipe, anteriores)
                .map((funcionario) => ({ funcionarioId: funcionario.id, contada: false })), true);
            return { ok: true };
        }
        const citados = new Set(mencionados.map((funcionario) => funcionario.id));
        this.fila = this.fila.filter((vez) => !citados.has(vez.funcionarioId) || !!vez.reservadoCom || !!vez.reflexao);
        this.fila.unshift(...mencionados.flatMap((funcionario) => [
            ...(!ehCumprimento(texto) ? [{ funcionarioId: funcionario.id, contada: false,
                reflexao: true, pedidoDaDiretoria: true }] : []),
            { funcionarioId: funcionario.id, contada: false, respostaObrigatoria: true },
        ]));
        this.registro.emitirEstado();
        void this.processar();
        return { ok: true };
    }

    /** Publica a mensagem explícita de `falar_no_geral` e coloca os colegas citados na fila. */
    falarDoAgente(funcionarioId: string, textoOriginal: string, ferramentas: Ferramenta[] = []): string {
        const autor = this.registro.funcionarios().find((funcionario) => funcionario.id === funcionarioId);
        const mensagens = this.registro.mensagens();
        const ultimaDiretoria = mensagens.findLastIndex((mensagem) => mensagem.autorId === autorUsuario);
        const recentes = mensagens.slice(Math.max(0, ultimaDiretoria)).filter((mensagem) => !mensagem.tipo)
            .slice(-mensagensGeralNoReservado);
        const textosDe = (proprias: boolean) => recentes
            .filter((mensagem) => (mensagem.autorId === funcionarioId) === proprias).map((mensagem) => mensagem.texto);
        const semVocativo = autor ? removerAutoVocativo(textoOriginal, autor.nome) : textoOriginal;
        const texto = removerFrasesRepetidas(semVocativo, textosDe(true), textosDe(false));
        if (!texto) return this.guardarSilencio(funcionarioId);
        const fala = this.destinosReservados.has(funcionarioId) ? undefined : this.ativas.get(funcionarioId);
        if (fala?.encerrouParticipacao) throw new Error('Sua ação já encerrou a participação neste turno.');
        if (fala?.silenciou) throw new Error('Você encerrou sua vez em silêncio. Aguarde outro turno.');
        if (ehSilencio(texto)) return this.guardarSilencio(funcionarioId);
        const emPausa = encontrarMencoes(texto, this.registro.funcionarios())
            .find((colega) => this.registro.emPausa?.(colega.id));
        if (emPausa) {
            return `${emPausa.nome} está em pausa e indisponível no Geral. Converse somente em particular.`;
        }
        if (fala?.reflexao) throw new Error('Este é o turno de reação. Sua resposta pública vem no próximo turno.');
        if (fala?.publicou) {
            throw new Error('Você já publicou sua fala neste turno. Aguarde uma nova mensagem antes de falar novamente.');
        }
        if (mensagens.slice(ultimaDiretoria + 1).some((mensagem) => repeteFala(texto, mensagem.texto))) {
            return this.guardarSilencio(funcionarioId);
        }
        if (fala) { fala.falou = true; fala.publicou = true; }
        this.removerPrevia(funcionarioId);
        const eventoId = this.registro.registrarFala?.(funcionarioId, texto);
        this.publicar(funcionarioId, texto, ferramentas, undefined, eventoId);
        const mencionados = encontrarInterpelados(texto, this.registro.funcionarios())
            .filter((colega) => colega.id !== funcionarioId);
        this.enfileirar(mencionados.flatMap((colega) => this.vezesDoCitado(funcionarioId, colega.id, texto)), true);
        return mencionados.length > 0 ? 'Mensagem enviada. Os colegas citados vão responder no Geral.' : 'Mensagem enviada.';
    }

    /** Numa discussão em ciclo, o citado é orientado a agir e, se ela persistir, só tem a vez de agir. */
    private vezesDoCitado(autorId: string, citadoId: string, texto: string): Vez[] {
        const resposta: Vez = { funcionarioId: citadoId, contada: true, citado: true };
        if (ehCumprimento(texto)) return [resposta];
        const falas = contarFalasDoEmbate(this.registro.mensagens(), autorId, citadoId);
        const reacao: Vez = { funcionarioId: citadoId, contada: false, reflexao: true, citado: true };
        if (falas < falasParaEmbate) return [reacao, resposta];
        const autor = this.registro.funcionarios().find((pessoa) => pessoa.id === autorId)?.nome ?? 'seu colega';
        const motivos = [motivoDoEmbate(autor, falas)];
        if (falas >= falasParaAgirNoEmbate) return [{ ...reacao, motivos, embate: true }];
        return [{ ...reacao, motivos }, { ...resposta, motivos }];
    }

    /** Encerra a participação atual sem publicar fala nem gerar acontecimento social. */
    guardarSilencio(funcionarioId: string): string {
        const fala = this.ativas.get(funcionarioId);
        if (!fala || fala.reflexao) return 'Silêncio indisponível fora de um turno de fala.';
        if (fala.falou) return 'Você já se manifestou neste turno.';
        fala.silenciou = true;
        this.removerPrevia(funcionarioId);
        return 'Silêncio registrado. Encerre o turno sem falar.';
    }

    alternarConversaLivre(ativa: boolean): Resultado {
        if (!ativa) {
            this.conversaLivre = false;
            this.encerrandoConversa = this.ativas.size > 0;
            this.fila = [];
            if (this.retomada) clearTimeout(this.retomada);
            this.retomada = null;
            this.falaramNaRodada = 0;
            this.restantesNaRodada = 0;
            this.registro.emitirEstado();
            return { ok: true };
        }
        this.encerrandoConversa = false;
        if (ativa && this.registro.funcionarios().length < 2) {
            return { ok: false, erro: 'São precisos pelo menos dois funcionários para conversarem.' };
        }
        this.conversaLivre = ativa;
        if (ativa) {
            this.falasSeguidas = 0;
            this.turnosPorFuncionario.clear();
            this.ultimoFalanteId = null;
            this.limiteAnunciado = false;
            this.iniciarRodada();
        }
        this.registro.emitirEstado();
        return { ok: true };
    }

    /** Alterna o limite sem iniciar rodadas nem interromper a resposta em andamento. */
    alternarConversaSemLimite(ativa: boolean): Resultado {
        this.semLimite = ativa;
        this.registro.emitirEstado();
        return { ok: true };
    }

    /**
     * Passa a vez ao sair para uma pausa e impede anúncios automáticos de retorno no mesmo turno.
     */
    pausaIniciada(funcionarioId: string): void {
        const fala = this.ativas.get(funcionarioId);
        if (!fala || fala.pausada) return;
        this.registrarAcao(funcionarioId, true);
        fala.pausada = true;
        fala.publicou = false;
        fala.liberar();
    }

    dispensar(funcionarioId: string): void {
        this.removerPrevia(funcionarioId);
        this.interromperFerramentas(funcionarioId);
        this.fila = this.fila.filter((vez) => vez.funcionarioId !== funcionarioId);
        this.controles.get(funcionarioId)?.abort();
        this.sessoes.get(funcionarioId)?.sessao.encerrar();
        this.sessoes.delete(funcionarioId);
    }

    /** Inicia uma conversa vazia e descarta as respostas pendentes do contexto anterior. */
    limpar(): Resultado {
        this.encerrar();
        this.encerrado = false;
        this.sessoes.clear();
        this.leituras.clear();
        this.registro.limparLeituras?.();
        this.ativas.clear();
        this.falaramNaRodada = 0;
        this.restantesNaRodada = 0;
        this.falasSeguidas = 0;
        this.turnosPorFuncionario.clear();
        this.ultimoFalanteId = null;
        this.limiteAnunciado = false;
        this.registro.gravar([]);
        this.registro.emitirMensagens();
        this.registro.emitirEstado();
        return { ok: true };
    }

    /** Descarta sessões e respostas pendentes após exclusão de memórias, preservando as mensagens restantes. */
    renovarContexto(): void {
        this.encerrar();
        this.encerrado = false;
        this.sessoes.clear();
    }

    encerrar(): void {
        this.interromperFerramentas();
        this.falasEmAndamento.clear();
        this.encerrado = true;
        this.encerrandoConversa = false;
        this.geracao++;
        if (this.retomada) clearTimeout(this.retomada);
        this.retomada = null;
        this.conversaLivre = false;
        this.fila = [];
        this.destinosReservados.clear();
        for (const controle of this.controles.values()) controle.abort();
        for (const { sessao } of this.sessoes.values()) sessao.encerrar();
        this.falandoId = null;
        this.ativas.clear();
        this.controles.clear();
    }

    private iniciarRodada(): void {
        const equipe = this.registro.funcionarios();
        this.falaramNaRodada = 0;
        this.restantesNaRodada = equipe.length;
        this.enfileirar(this.ordemDaRodada(equipe, this.registro.mensagens())
            .map((funcionario) => ({ funcionarioId: funcionario.id, contada: true, livre: true })), true);
    }

    /** Quem foi citado e ainda não respondeu abre a rodada; sem citação pendente, o líder começa. */
    private ordemDaRodada(equipe: Funcionario[], mensagens: MensagemGeral[]): Funcionario[] {
        const lideres = equipe.filter((funcionario) => cargoAtual(funcionario.cargo) === 'lider');
        return [...new Set([...this.citadosPendentes(equipe, mensagens), ...lideres, ...equipe])];
    }

    private citadosPendentes(equipe: Funcionario[], mensagens: MensagemGeral[]): Funcionario[] {
        const falas = mensagens.filter((mensagem) => !mensagem.tipo && mensagem.autorId !== autorSistema);
        for (let indice = falas.length - 1; indice >= 0; indice--) {
            const fala = falas[indice]!;
            const citados = encontrarInterpelados(fala.texto, equipe).filter((colega) => colega.id !== fala.autorId);
            if (!citados.length) continue;
            const responderam = new Set(falas.slice(indice + 1).map((mensagem) => mensagem.autorId));
            return citados.filter((colega) => !responderam.has(colega.id));
        }
        return [];
    }

    private enfileirar(vezes: Vez[], priorizar = false): void {
        if (this.encerrandoConversa) return;
        const agendadas: Vez[] = [];
        for (const vez of vezes) {
            const existente = this.fila.find((item) => item.funcionarioId === vez.funcionarioId
                && item.reservadoCom === vez.reservadoCom && !!item.reflexao === !!vez.reflexao);
            if (existente) {
                existente.contada &&= vez.contada;
                existente.respostaObrigatoria ||= vez.respostaObrigatoria;
                existente.citado ||= vez.citado;
                existente.livre ||= vez.livre;
                existente.embate ||= vez.embate;
                existente.motivos = [...new Set([...existente.motivos ?? [], ...vez.motivos ?? []])].slice(-5);
                agendadas.push(existente);
                continue;
            }
            this.fila.push(vez);
            agendadas.push(vez);
        }
        if (priorizar) {
            const prioritarias = new Set(agendadas);
            this.fila = [...prioritarias, ...this.fila.filter((vez) => !prioritarias.has(vez))];
        }
        this.registro.emitirEstado();
        void this.processar();
    }

    private publicar(
        autorId: string, texto: string, ferramentas: Ferramenta[] = [], tipo?: MensagemGeral['tipo'], eventoId?: string,
    ): void {
        if (!texto && ferramentas.length === 0) return;
        const mensagem: MensagemGeral = {
            id: randomUUID(),
            autorId,
            texto,
            ...(tipo ? { tipo } : {}),
            ...(eventoId ? { eventoId } : {}),
            criadaEm: new Date().toISOString(),
            ferramentas: ferramentas.map((ferramenta) => ({ ...ferramenta })),
        };
        this.registrarMensagem(mensagem);
    }

    private registrarMensagem(mensagem: MensagemGeral): void {
        this.registro.gravar([...this.registro.mensagens(), mensagem].slice(-limiteMensagensGeral));
        this.registro.emitirMensagens();
    }

    private removerPrevia(funcionarioId: string): void {
        if (this.falasEmAndamento.delete(funcionarioId)) this.registro.emitirEstado();
    }

    private interromperFerramentas(funcionarioId?: string): void {
        const pendentes = this.registro.mensagens().filter((mensagem) =>
            (!funcionarioId || mensagem.autorId === funcionarioId)
            && mensagem.ferramentas.some((ferramenta) => ferramenta.estado === 'rodando'));
        for (const mensagem of pendentes) this.atualizarFerramenta(mensagem.id, {
            estado: 'recusada', concluidaEm: new Date().toISOString(), saida: 'Ação interrompida.',
        });
    }

    private atualizarFerramenta(mensagemId: string, alteracao: Partial<Ferramenta>): void {
        if (!this.registro.mensagens().some((mensagem) => mensagem.id === mensagemId)) return;
        const mensagens = this.registro.mensagens().map((mensagem) =>
            mensagem.id === mensagemId
                ? {
                      ...mensagem,
                      ferramentas: mensagem.ferramentas.map((ferramenta) =>
                          ferramenta.estado === 'rodando' ? { ...ferramenta, ...alteracao } : ferramenta,
                      ),
                  }
                : mensagem,
        );
        this.registro.gravar(mensagens);
        this.registro.emitirMensagens();
    }

    private indiceProximaVez(): number {
        const disponiveis = this.fila.map((vez, indice) => ({ vez, indice }))
            .filter(({ vez }) => !this.ativas.has(vez.funcionarioId)
                && (this.registro.disponivel?.(vez.funcionarioId, vez.reservadoCom,
                    vez.citado || vez.pedidoDaDiretoria || vez.respostaObrigatoria) ?? true));
        const solicitadas = disponiveis.filter(({ vez }) => vez.pedidoDaDiretoria || vez.respostaObrigatoria);
        const citadas = disponiveis.filter(({ vez }) => vez.citado);
        const outrasPessoas = disponiveis.filter(({ vez }) =>
            !!vez.reservadoCom || vez.funcionarioId !== this.ultimoFalanteId);
        const candidatas = [solicitadas, citadas, outrasPessoas].find((grupo) => grupo.length) ?? disponiveis;
        return candidatas.reduce((escolhido, atual) => {
            if (escolhido < 0) return atual.indice;
            const anterior = this.fila[escolhido]!;
            return (this.turnosPorFuncionario.get(atual.vez.funcionarioId) ?? 0)
                < (this.turnosPorFuncionario.get(anterior.funcionarioId) ?? 0) ? atual.indice : escolhido;
        }, -1);
    }

    private async processar(): Promise<void> {
        if (this.encerrado || this.falandoId) return;
        const geracao = this.geracao;
        const indice = this.indiceProximaVez();
        if (indice < 0 && this.fila.length > 0) {
            if (!this.retomada) this.retomada = setTimeout(() => {
                this.retomada = null;
                void this.processar();
            }, 1000);
            return;
        }
        const vez = this.fila.splice(indice < 0 ? 0 : indice, 1)[0];
        if (!vez) return this.fimDaFila();
        const funcionario = this.registro.funcionarios().find((existente) => existente.id === vez.funcionarioId);
        if (!funcionario || this.ativas.has(funcionario.id)) return this.processar();
        if (vez.contada && !this.semLimite && this.falasSeguidas >= limiteFalasSeguidas) return this.esgotarLimite();
        if (vez.contada) this.falasSeguidas++;
        if (!vez.reflexao) this.turnosPorFuncionario.set(funcionario.id,
            (this.turnosPorFuncionario.get(funcionario.id) ?? 0) + 1);
        if (!vez.reflexao && !vez.reservadoCom) this.ultimoFalanteId = funcionario.id;
        const controle = new AbortController();
        this.controles.set(funcionario.id, controle);
        this.falandoId = funcionario.id;
        this.registro.emitirEstado();
        let liberar = () => {};
        const liberada = new Promise<'liberada'>((resolver) => (liberar = () => resolver('liberada')));
        const andamento = this.ouvirFala(funcionario, vez, controle.signal, liberar).catch((erro: unknown) => {
            if (this.geracao !== geracao) return null;
            this.removerPrevia(funcionario.id);
            if (vez.reservadoCom) this.registro.reservadoSemResposta?.(funcionario.id, vez.reservadoCom);
            if (!controle.signal.aborted) {
                this.sessoes.get(funcionario.id)?.sessao.encerrar();
                this.sessoes.delete(funcionario.id);
                const detalhe = erro instanceof Error ? erro.message : String(erro);
                this.publicar(autorSistema, `${funcionario.nome} não conseguiu responder${vez.reservadoCom
                    ? ' em reservado' : ''}: ${vez.reservadoCom ? 'A conversa foi interrompida.' : detalhe}`);
            }
            return null;
        });
        const primeiro = await Promise.race([andamento.then(() => 'concluida' as const), liberada]);
        if (this.geracao !== geracao) return;
        this.falandoId = null;
        this.registro.emitirEstado();
        const finalizar = (fala: FalaAtiva | null) => {
            if (this.geracao !== geracao) return;
            this.ativas.delete(funcionario.id);
            if (this.ativas.size === 0) this.encerrandoConversa = false;
            this.destinosReservados.delete(funcionario.id);
            this.controles.delete(funcionario.id);
            if (!controle.signal.aborted) this.concluirFala(vez, fala);
            if (vez.reservadoCom && !this.emExecucao(funcionario.id) && !this.emExecucao(vez.reservadoCom)) {
                this.registro.conversaReservadaEncerrada?.(funcionario.id, vez.reservadoCom);
            }
        };
        if (primeiro === 'liberada') {
            void andamento.then((fala) => {
                finalizar(fala);
                void this.processar();
            });
            return this.processar();
        }
        finalizar(await andamento);
        return this.processar();
    }

    private concluirFala(vez: Vez, fala: FalaAtiva | null): void {
        if (vez.contada && this.conversaLivre) {
            this.restantesNaRodada--;
            if (fala?.falou || fala?.pausada) this.falaramNaRodada++;
        }
        this.registro.emitirEstado();
    }

    private fimDaFila(): void {
        if (!this.conversaLivre || this.ativas.size > 0) return;
        if (this.falaramNaRodada === 0 && this.restantesNaRodada <= 0) {
            this.conversaLivre = false;
            this.publicar(autorSistema, 'A conversa morreu: ninguém tinha mais nada a dizer.');
            this.registro.emitirEstado();
            return;
        }
        this.iniciarRodada();
    }

    private esgotarLimite(): void {
        this.conversaLivre = false;
        this.fila = this.fila.filter((vez) => !vez.contada && !vez.reflexao);
        if (!this.limiteAnunciado) {
            this.publicar(autorSistema, 'Os agentes pararam de conversar. Mande uma mensagem para retomar.');
            this.limiteAnunciado = true;
        }
        this.registro.emitirEstado();
        void this.processar();
    }

    private async ouvirFala(
        funcionario: Funcionario, vez: Vez, sinal: AbortSignal, liberar: () => void,
    ): Promise<FalaAtiva> {
        const equipe = this.registro.funcionarios();
        const personalidade = this.registro.personalidade?.(funcionario.id) ?? '';
        const situacaoReservada = vez.reservadoCom
            ? this.registro.contextoReservado?.(funcionario.id, vez.reservadoCom) : undefined;
        let entrada = this.sessoes.get(funcionario.id);
        if (entrada && (entrada.reservadoCom !== vez.reservadoCom || entrada.personalidade !== personalidade
            || entrada.chaveReservada !== situacaoReservada?.chave)) {
            entrada.sessao.encerrar();
            this.sessoes.delete(funcionario.id);
            entrada = undefined;
        }
        const retomando = !entrada;
        if (!entrada) {
            const mcpUrl = await this.registro.urlMcp(funcionario.id, !!vez.reservadoCom);
            sinal.throwIfAborted();
            const sessao = this.abrirSessao(funcionario, {
                modelo: funcionario.modelo.id,
                pasta: this.registro.pasta,
                autonomia: false,
                instrucoes: [(vez.reservadoCom ? [
                    instrucaoDepartamento,
                    cargos[cargoAtual(funcionario.cargo)].instrucao,
                    instrucaoHierarquia(funcionario.cargo),
                    `Você é ${funcionario.nome} e conversa em particular com `
                        + `${equipe.find((pessoa) => pessoa.id === vez.reservadoCom)?.nome ?? 'seu colega'}.`,
                    `O ID do parceiro é ${vez.reservadoCom}. Somente vocês dois recebem esta conversa.`,
                    'Texto normal fica neste diálogo privado. Para falar com a equipe toda, use falar_no_geral.',
                    'Vocês permanecem juntos até o fim da conversa. Relatos não são fatos verificados.',
                    instrucoesPausas,
                    'Fale em português brasileiro e em primeira pessoa. Seja breve, mas complete explicações.',
                    'Explique na própria resposta, sem prometer explicar depois.',
                    instrucaoAgirNoTurno,
                    'Não repita despedidas, concordâncias ou ofertas de ajuda já ditas no diálogo.',
                    'Se a conversa terminou ou não tiver nada útil a acrescentar, use silencio.',
                ].join('\n') : instrucoesGeral(funcionario, equipe)), personalidade].filter(Boolean).join('\n\n'),
                modo: 'personagem',
                atividade: 'social',
                mcpUrl,
            });
            entrada = { sessao, reservadoCom: vez.reservadoCom, personalidade,
                chaveReservada: situacaoReservada?.chave };
            this.sessoes.set(funcionario.id, entrada);
        }
        const mensagens = this.registro.mensagens().filter((mensagem) => mensagem.tipo !== 'acao');
        const ultimaLida = this.registro.leitura?.(funcionario.id) ?? this.leituras.get(funcionario.id);
        const indiceLido = mensagens.findIndex((mensagem) => mensagem.id === ultimaLida);
        const inicioNovas = ultimaLida && indiceLido < 0 ? Math.max(0, mensagens.length - mensagensNovasMaximas)
            : indiceLido + 1;
        const novas = mensagens.slice(inicioNovas).filter((mensagem) => mensagem.autorId !== funcionario.id);
        const transcrever = (itens: MensagemGeral[]) => this.transcrever(itens, funcionario.id);
        const prompt = vez.reflexao ? [
            vez.pedidoDaDiretoria ? aberturaPedidoDaDiretoria : aberturaReflexao,
            ...(vez.motivos?.length ? [`Motivo deste turno: ${vez.motivos.join('\n')}`] : []),
            `Contexto atual:\n${this.registro.contexto(funcionario.id)}`,
            'Falas recentes no Geral:',
            transcrever(mensagens.slice(inicioNovas).slice(-mensagensNovasMaximas)) || '(nenhuma)',
        ].join('\n\n') : vez.reservadoCom ? [
            `Contexto atual:\n${this.registro.contexto(funcionario.id)}`,
            `Motivo deste turno: ${vez.motivos?.join('\n') ?? ''}`,
            ...(!situacaoReservada ? [
                'Falas recentes no Geral, que vocês dois presenciaram. São contexto, não responda a elas aqui:',
                transcrever(mensagens.slice(-mensagensGeralNoReservado)) || '(nenhuma)',
            ] : []),
            'Histórico deste diálogo privado:',
            this.registro.historicoReservado?.(funcionario.id, vez.reservadoCom) ?? '',
            ...(situacaoReservada ? [`Situação confirmada para esta resposta:\n${situacaoReservada.texto}`] : []),
        ].join('\n\n') : [
            `Contexto atual:\n${this.registro.contexto(funcionario.id)}`,
            ...(retomando && inicioNovas > 0 ? [
                'Histórico já lido, somente para retomar o contexto. Não responda outra vez:',
                transcrever(mensagens.slice(0, inicioNovas).slice(-8)),
            ] : []),
            `Motivo deste turno: ${vez.motivos?.join('\n') || (vez.contada
                ? 'Conversa espontânea. Reaja ao que acabou de ser dito, por fala ou por ação, ou leve a conversa '
                    + 'para outro lugar, conforme seu pensamento, relações e acontecimentos, sem expor informações '
                    + 'privadas.'
                : 'Mensagem da Diretoria.')}`,
            'Novas mensagens no Geral:',
            transcrever(novas) || '(nenhuma)',
            `Sua vez de falar, ${funcionario.nome}.`,
            ...(vez.respostaObrigatoria ? [
                'A Diretoria mencionou você diretamente. Responda em texto normal, que será publicado no Geral.',
            ] : []),
        ].join('\n\n');
        const fala: FalaAtiva = { falou: false, publicou: false, liberar, pausada: false,
            reflexao: !!vez.reflexao, pedidoDaDiretoria: !!vez.pedidoDaDiretoria };
        this.ativas.set(funcionario.id, fala);
        if (vez.reservadoCom) this.destinosReservados.set(funcionario.id, vez.reservadoCom);
        let respostaPublica = '';
        const mensagensFerramentas = new Map<string, string>();
        const atualizarEtapa = (etapa: EtapaResposta) => {
            if (sinal.aborted || fala.etapa === etapa) return;
            fala.etapa = etapa;
            this.registro.emitirEstado();
        };
        const previa: MensagemGeral = {
            id: randomUUID(), autorId: funcionario.id, texto: '',
            criadaEm: new Date().toISOString(), ferramentas: [],
        };
        const ouvinte = {
            etapa: (etapa: EtapaResposta) => atualizarEtapa(
                vez.reflexao && etapa === 'processando' ? 'reagindo' : etapa,
            ),
            texto: (texto: string) => {
                if (sinal.aborted) return;
                respostaPublica = texto;
                if (texto.trim()) atualizarEtapa(vez.reflexao ? 'reagindo' : 'escrevendo');
                if (vez.reflexao || vez.reservadoCom || fala.falou || fala.silenciou) return;
                const conteudo = texto.trim();
                const marcador = conteudo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
                if (!conteudo || ehSilencio(conteudo) || '(silencio)'.startsWith(marcador)
                    || 'silencio'.startsWith(marcador)) {
                    this.removerPrevia(funcionario.id);
                    return;
                }
                this.falasEmAndamento.set(funcionario.id, { ...previa, texto });
                this.registro.emitirEstado();
            },
            iniciarFerramenta: (id: string, resumo: string, entrada?: string) => {
                if (sinal.aborted) return;
                atualizarEtapa('executando_acao');
                const existente = mensagensFerramentas.get(id);
                if (existente) {
                    if (entrada !== undefined) this.atualizarFerramenta(existente, { entrada });
                    return;
                }
                const mensagemId = randomUUID();
                mensagensFerramentas.set(id, mensagemId);
                const acao = resumo.replace(/^Escritório: /, '');
                const iniciadaEm = new Date().toISOString();
                this.registrarMensagem({
                    id: mensagemId, autorId: funcionario.id, tipo: 'acao', texto: '', criadaEm: iniciadaEm,
                    ferramentas: [{ id, resumo, estado: 'rodando', entrada, iniciadaEm }],
                    ...(vez.reservadoCom ? {
                        participantes: [funcionario.id, vez.reservadoCom],
                        destinatarioNome: equipe.find((colega) => colega.id === vez.reservadoCom)?.nome,
                    } : {}),
                });
            },
            concluirFerramenta: (id: string, erro: boolean, saida?: string) => {
                const mensagemId = mensagensFerramentas.get(id);
                if (!sinal.aborted && mensagemId) this.atualizarFerramenta(mensagemId, {
                    estado: erro ? 'falhou' : 'concluida', saida, concluidaEm: new Date().toISOString(),
                });
            },
            aprovar: async () => false,
        };
        try {
            await entrada.sessao.enviar(prompt, ouvinte, sinal, vez.reflexao ? {
                ferramentas: ferramentasDaReacao(!!vez.pedidoDaDiretoria, !!vez.embate),
                exigirFerramenta: true,
            } : vez.reservadoCom ? { ferramentas: this.registro.ferramentasReservadas?.(funcionario.id) } : undefined);
        } finally {
            for (const mensagemId of mensagensFerramentas.values()) this.atualizarFerramenta(mensagemId, {
                estado: sinal.aborted ? 'recusada' : 'falhou', concluidaEm: new Date().toISOString(),
                saida: sinal.aborted ? 'Ação interrompida.' : 'O turno terminou sem confirmar o resultado desta ação.',
            });
        }
        sinal.throwIfAborted();
        this.removerPrevia(funcionario.id);
        this.registro.confirmarPercepcao?.(funcionario.id);
        if (vez.reflexao) return fala;
        const lida = !vez.reservadoCom ? mensagens.at(-1)?.id : undefined;
        if (lida) {
            this.leituras.set(funcionario.id, lida);
            this.registro.gravarLeitura?.(funcionario.id, lida);
        }
        const texto = respostaPublica.trim();
        if (!fala.falou && !fala.silenciou && texto && !ehSilencio(texto)) {
            if (vez.reservadoCom) {
                await this.registro.responderReservado?.(funcionario.id, vez.reservadoCom, texto);
                fala.falou = true;
            } else this.falarDoAgente(funcionario.id, texto);
        }
        if (vez.reservadoCom && !fala.falou) this.registro.reservadoSemResposta?.(funcionario.id, vez.reservadoCom);
        return fala;
    }
}
