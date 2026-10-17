import { randomUUID } from 'node:crypto';
import {
    avancarAgente,
    criarAgente,
    criarAgenteNaMesa,
    reajustarAgente,
    usandoItem,
    type Agente,
    type ContextoSimulacao,
    type Ordem,
} from '../../shared/agentes';
import {
    catalogo, capacidadeItem, celulaDeUso, celulaDoPonto, celulaEntrada, centroCelula, criarVerificadorLivre,
    type Atividade, type Celula, type ItemPosicionado, type Sala,
} from '../../shared/escritorio';
import { escolherLugarEncontro } from '../../shared/encontros';
import { encontrarRota } from '../../shared/caminhos';
import type { QuadroSimulacao } from '../../shared/estado';
import type { Funcionario, StatusFuncionario } from '../../shared/funcionarios';
import {
    aplicarAcontecimento,
    aplicarTempo,
    necessidadesIniciais,
    resumirNecessidades,
    type Acontecimento,
    type Necessidades,
    type Situacao,
} from '../../shared/necessidades';
import { diaDoExpediente } from '../../shared/departamento';
import { alivioAmbiente } from '../../shared/ambiente';
import { ritmoCaminhada } from '../../shared/esgotamento';
import { ajustarEsgotamento } from '../../shared/necessidades';
import { conversaDuranteAusencia, type Ausencia } from '../../shared/ausencias';
import { anexoDaAusencia, capacidadeAnexo, lugarNoAnexo } from '../../shared/anexos';
import { criarVerificadorCirculacao } from '../../shared/circulacao';
import { protegerNecessidades, type NecessidadeLiberada } from '../../shared/acolhimento';

const intervaloPassoMs = 100;
const passosPorQuadro = 2;
const passosPorGravacao = 50;
const minutosMaximosPausa = 15;
const folgaCaminhoSegundos = 40;

/** Acesso da simulação ao restante do escritório. */
export type RegistroSimulacao = {
    registrarPausa?: (evento: RegistroPausa) => void;
    sala: () => Sala;
    necessidadesLiberadas?: () => NecessidadeLiberada[];
    funcionarios: () => Funcionario[];
    statusTrabalho: (funcionarioId: string) => StatusFuncionario;
    relogioInicial: number;
    necessidadesIniciais: Record<string, Necessidades>;
    gravar: (relogio: number, necessidades: Record<string, Necessidades>, dia?: string) => void;
    diaInicial?: string;
    agora?: () => Date;
    agoraPausaMs?: () => number;
    emitirQuadro: (quadro: QuadroSimulacao) => void;
    emitirEstado: () => void;
    /** Desligue nos testes para avançar o tempo com `avancar`. */
    automatica?: boolean;
    emConversa?: (id: string) => boolean;
    emTurnoSocial?: (id: string) => boolean;
    aoOcioso?: (id: string) => void;
    aoCompartilharPausa?: (id: string, colegaId: string, itemId: string) => void;
    aoEncerrarCompanhia?: (id: string, colegaId: string) => void;
    ausenciasIniciais?: Record<string, Ausencia>;
    gravarAusencias?: (ausencias: Record<string, Ausencia>) => void;
    aoRetornar?: (id: string, ausencia: Ausencia) => void;
};

/** Acontecimento físico da pausa, para registro nos chats e percepção dos colegas. */
export type RegistroPausa = {
    funcionarioId: string;
    itemId: string;
    atividade: Atividade;
    origem: 'ferramenta';
    fase: 'inicio' | 'conclusao' | 'interrupcao';
    motivo?: string;
};

type Pausa = {
    id: string; iniciadaEm: string;
    itemId: string; indiceUso: number; companhiaAvisada?: string;
    atividade: Atividade; origem: RegistroPausa['origem']; segundos: number;
    terminaEm: number | null; atualizadoEm: number | null; limite: number; concluir: (texto: string) => void;
};
type Encontro = {
    alvoId: string; celula: Celula; limite: number; chegou: boolean; concluir: (texto: string) => void;
};

const atividadesDePausa = new Set<Atividade>(['cafe', 'comendo', 'descansando', 'ouvindo_musica']);


function itensDaAtividade(sala: Sala, atividade: Atividade): ItemPosicionado[] {
    return sala.itens.filter((item) => !item.quebrado && catalogo[item.tipo].uso?.atividade === atividade);
}

/**
 * Relógio único do escritório. Avança corpos e necessidades no processo principal, obedece às pausas pedidas
 * pelos agentes e publica quadros para a interface, que apenas interpola.
 */
export class SimulacaoEscritorio {
    private agentesPorId = new Map<string, Agente>();
    private necessidades: Record<string, Necessidades>;
    private pausas = new Map<string, Pausa>();
    private proximoAviso = new Map<string, number>();
    private encontros = new Map<string, Encontro>();
    private ausencias: Map<string, Ausencia>;
    private chegadasAnexos = new Map<string, { ids: string[]; concluir: (chegaram: boolean) => void }>();
    private segundos: number;
    private salaConhecida: Sala;
    private passos = 0;
    private dia: string;
    private temporizador: NodeJS.Timeout | null = null;

    constructor(private registro: RegistroSimulacao) {
        this.segundos = registro.relogioInicial;
        this.dia = registro.diaInicial ?? diaDoExpediente(this.registro.agora?.());
        this.necessidades = { ...registro.necessidadesIniciais };
        this.ausencias = new Map(Object.entries(registro.ausenciasIniciais ?? {}));
        this.salaConhecida = registro.sala();
        const contexto = this.contexto();
        for (const funcionario of registro.funcionarios()) {
            const agente = criarAgenteNaMesa(funcionario.id, funcionario.mesaId, contexto);
            this.agentesPorId.set(funcionario.id, agente);
        }
        this.restaurarAusencias();
        if (registro.automatica !== false) {
            this.temporizador = setInterval(() => this.avancar(intervaloPassoMs / 1000), intervaloPassoMs);
        }
    }

    agentes(): Agente[] {
        return [...this.agentesPorId.values()];
    }

    necessidadesDe(funcionarioId: string): Necessidades {
        return this.necessidades[funcionarioId] ?? necessidadesIniciais;
    }

    todasNecessidades(): Record<string, Necessidades> {
        return this.necessidades;
    }

    emPausa(funcionarioId: string): boolean {
        return this.pausas.has(funcionarioId) || this.encontros.has(funcionarioId) || this.ausencias.has(funcionarioId);
    }

    /** Distingue o uso de um objeto dos encontros reservados e das ausências. */
    emPausaNoItem(id: string): boolean {
        return this.pausas.has(id);
    }

    /** Permite encontros e conversa reservada com o colega do mesmo item, sem sair da pausa ou da sala. */
    podeResponderSocialmente(id: string, parceiroReservado?: string): boolean {
        const ausencia = this.ausencias.get(id);
        const podeNaPausa = !!parceiroReservado && this.parceiroDePausa(id) === parceiroReservado;
        if (ausencia) {
            const outra = parceiroReservado && this.ausencias.get(parceiroReservado);
            return conversaDuranteAusencia(ausencia.motivo) && !ausencia.retornando
                && this.agentesPorId.get(id)?.anexo === 'bem_estar' && !!outra
                && outra.motivo === 'bem_estar' && outra.autorId === ausencia.autorId;
        }
        return !this.pausas.has(id) || podeNaPausa;
    }

    ausenciaDe(id: string): Ausencia | undefined {
        return this.ausencias.get(id);
    }

    todasAusencias(): Record<string, Ausencia> {
        return Object.fromEntries(this.ausencias);
    }

    /**
     * Tira o funcionário da sala por `segundos`, interrompendo pausa e encontro. Quem já está ausente ou ainda
     * não está na sala é recusado com um texto explicativo.
     */
    afastar(id: string, ausencia: Omit<Ausencia, 'terminaEm'>, segundos: number): string | undefined {
        this.sincronizar();
        const erro = this.validarAfastamento([id], ausencia.motivo);
        if (erro) return erro;
        if (!Number.isFinite(segundos) || segundos <= 0) throw new Error('A ausência exige uma duração positiva.');
        this.cancelarEncontro(id);
        const pausa = this.pausas.get(id);
        if (pausa) {
            this.registrarPausa(id, 'interrupcao');
            this.pausas.delete(id);
            pausa.concluir('Sua pausa foi interrompida porque você saiu da sala.');
        }
        this.ausencias.set(id, { ...ausencia, lugar: this.lugaresLivres(ausencia.motivo)[0],
            duracao: segundos, terminaEm: this.segundos + segundos, retornando: false });
        this.registro.gravarAusencias?.(this.todasAusencias());
        this.registro.emitirEstado();
    }

    /** Verifica todas as vagas e rotas antes de iniciar um afastamento conjunto, como uma sessão. */
    validarAfastamento(ids: string[], motivo: Ausencia['motivo']): string | undefined {
        const tipo = anexoDaAusencia(motivo);
        const livres = this.lugaresLivres(motivo);
        if (!ids.length) return 'Escolha ao menos um funcionário.';
        if (new Set(ids).size !== ids.length) return 'Escolha funcionários distintos.';
        if (tipo && livres.length < ids.length) return 'Não há lugares livres no anexo. Aguarde uma vaga.';
        for (const [indice, id] of ids.entries()) {
            const agente = this.agentesPorId.get(id);
            if (!agente) return 'Funcionário fora da sala.';
            if (this.ausencias.has(id)) return 'O funcionário já está fora da sala.';
            const destino = tipo ? celulaDoPonto(lugarNoAnexo(this.salaConhecida, tipo, livres[indice]).posicao)
                : celulaEntrada;
            if (!encontrarRota(celulaDoPonto(agente.posicao), destino,
                criarVerificadorCirculacao(this.salaConhecida))) return 'Não há caminho livre até o destino.';
        }
    }

    /** Aguarda os dois corpos chegarem ao cômodo, sem iniciar a conversa durante o trajeto. */
    aguardarChegadaAnexos(ids: string[]): Promise<boolean> {
        if (ids.length !== 2 || new Set(ids).size !== 2) throw new Error('A sessão exige dois participantes distintos.');
        const chave = [...ids].sort().join(':');
        if (this.chegadasAnexos.has(chave)) throw new Error('Já existe uma espera para esta sessão.');
        return new Promise((concluir) => {
            this.chegadasAnexos.set(chave, { ids: [...ids], concluir });
        });
    }

    private lugaresLivres(motivo: Ausencia['motivo']): number[] {
        const tipo = anexoDaAusencia(motivo);
        if (!tipo) return [];
        const usados = new Set([...this.ausencias.values()].filter((ausencia) => ausencia.motivo === motivo)
            .map((ausencia) => ausencia.lugar));
        return Array.from({ length: capacidadeAnexo[tipo] }, (_, indice) => indice)
            .filter((indice) => !usados.has(indice));
    }

    private restaurarAusencias(): void {
        const salvas = [...this.ausencias];
        this.ausencias.clear();
        for (const [id, salva] of salvas) {
            const agente = this.agentesPorId.get(id);
            if (!agente) continue;
            const tipo = anexoDaAusencia(salva.motivo);
            const livre = this.lugaresLivres(salva.motivo)[0];
            const ocupado = [...this.ausencias.values()].some((outra) =>
                outra.motivo === salva.motivo && outra.lugar === salva.lugar);
            const lugar = tipo && salva.lugar !== undefined && salva.lugar < capacidadeAnexo[tipo] && !ocupado
                ? salva.lugar : livre;
            const ausencia = { ...salva, lugar };
            if (tipo && lugar === undefined) ausencia.retornando = true;
            this.ausencias.set(id, ausencia);
            if (tipo && lugar !== undefined && salva.duracao === undefined) {
                const destino = lugarNoAnexo(this.salaConhecida, tipo, lugar);
                this.agentesPorId.set(id, { ...agente, posicao: destino.posicao, direcao: destino.direcao,
                    rota: [], destinoId: `anexo:${tipo}:${lugar}`, atividade: 'ausente', anexo: tipo });
            } else if (!tipo && salva.duracao === undefined) {
                this.agentesPorId.set(id, { ...agente, posicao: centroCelula(celulaEntrada),
                    atividade: 'ausente', destinoId: 'saida' });
            }
        }
        this.registro.gravarAusencias?.(this.todasAusencias());
    }

    /** Aplica impacto direto no esgotamento, como cobrança, rejeição ou sessão de bem estar. */
    ajustarEsgotamento(id: string, delta: number): void {
        this.necessidades[id] = ajustarEsgotamento(this.necessidadesDe(id), delta);
        this.registro.gravar(this.segundos, this.necessidades);
        this.registro.emitirEstado();
    }

    /** Identifica o parceiro reservado para não iniciar conversas públicas durante o encontro. */
    parceiroEncontro(id: string): string | undefined {
        return this.encontros.get(id)?.alvoId
            ?? [...this.chegadasAnexos.values()].find((espera) => espera.ids.includes(id))?.ids
                .find((pessoa) => pessoa !== id);
    }

    /** Renova a permanência de ambos depois de cada fala entregue. */
    manterEncontro(id: string, alvoId: string): void {
        for (const [participante, colega] of [[id, alvoId], [alvoId, id]]) {
            const encontro = this.encontros.get(participante);
            if (encontro?.alvoId === colega) encontro.limite = this.segundos + 60;
        }
    }

    /** Itens reservados por pausas em andamento, com todos que estão usando ou indo usar cada um. */
    ocupantes(): Map<string, string[]> {
        const ocupantes = new Map<string, string[]>();
        for (const [id, pausa] of this.pausas) {
            ocupantes.set(pausa.itemId, [...(ocupantes.get(pausa.itemId) ?? []), id]);
        }
        return ocupantes;
    }

    /** Colega que já chegou ao mesmo item e pode conversar sem interromper o descanso. */
    parceiroDePausa(id: string): string | undefined {
        const pausa = this.pausas.get(id);
        const agente = this.agentesPorId.get(id);
        if (!pausa || !agente || !usandoItem(agente, pausa.itemId)) return undefined;
        return [...this.pausas].find(([colegaId, outra]) => colegaId !== id && outra.itemId === pausa.itemId
            && usandoItem(this.agentesPorId.get(colegaId)!, outra.itemId))?.[0];
    }

    /** Contexto físico atual da pausa, renovado em cada resposta para ambos os participantes. */
    contextoPausa(id: string): string {
        const pausa = this.pausas.get(id);
        const item = pausa && this.registro.sala().itens.find((movel) => movel.id === pausa.itemId);
        if (!pausa || !item) return '';
        const agente = this.agentesPorId.get(id);
        if (!agente || !usandoItem(agente, pausa.itemId)) {
            return `Você já iniciou uma pausa e está a caminho de ${catalogo[item.tipo].nome}. Não peça outra pausa.`;
        }
        const parceiroId = this.parceiroDePausa(id);
        const nome = this.registro.funcionarios().find((pessoa) => pessoa.id === parceiroId)?.nome;
        return `Você já está em pausa em ${catalogo[item.tipo].nome}. Não precisa iniciar outra pausa.`
            + (parceiroId ? ` ${nome ?? parceiroId} [${parceiroId}] também já está em pausa no mesmo item. `
                + 'Vocês conversam em particular aqui. Não pergunte se o colega vai pausar: ele já está com você.'
                : ' Você está usando o item sem companhia no momento.')
            + ' A recuperação continua durante a conversa, sem desgaste passivo nem mudança nos prazos de cada um.';
    }

    /** Isola cada encontro na pausa e informa a situação presente antes de cada resposta privada. */
    conversaNaPausa(id: string, colegaId: string): { chave: string; desde: string; texto: string } | undefined {
        if (this.parceiroDePausa(id) !== colegaId) return undefined;
        const propria = this.pausas.get(id)!;
        const colega = this.pausas.get(colegaId)!;
        return {
            chave: [propria.id, colega.id].sort().join(':'),
            desde: [propria.iniciadaEm, colega.iniciadaEm].sort()[1]!,
            texto: this.contextoPausa(id) + ' Esta é a situação física confirmada agora. '
                + 'Falas anteriores sobre ir pausar ou sobre o item estar livre estão desatualizadas. '
                + 'Não ofereça a vaga que vocês já ocupam. Conversem sobre outro assunto, sem narrar estas instruções.',
        };
    }

    /** Cancela o uso de um item indisponível e libera seus ocupantes e diálogos imediatamente. */
    interromperPausasDoItem(itemId: string, motivo: string): void {
        if (!motivo.trim()) throw new Error('A interrupção exige um motivo.');
        for (const [id, pausa] of [...this.pausas]) {
            if (pausa.itemId !== itemId) continue;
            this.pausas.delete(id);
            this.registrarPausa(id, 'interrupcao', pausa, motivo);
            this.proximoAviso.set(id, this.segundos + 120);
            const agente = this.agentesPorId.get(id);
            if (agente) this.agentesPorId.set(id, avancarAgente(agente, this.contexto(), 0, this.ordemDe(id)));
            pausa.concluir(`Pausa interrompida: ${motivo} Você deixou de usar o item. `
                + 'A recuperação foi encerrada. Não anuncie sua volta automaticamente no Geral.');
        }
        this.registro.emitirQuadro({ segundos: this.segundos, agentes: this.agentes() });
        this.registro.emitirEstado();
    }

    temItem(atividade: Atividade): boolean {
        return itensDaAtividade(this.registro.sala(), atividade).length > 0;
    }

    segundosAtuais(): number {
        return this.segundos;
    }

    registrar(funcionarioId: string, acontecimento: Acontecimento): void {
        this.necessidades[funcionarioId] = aplicarAcontecimento(this.necessidadesDe(funcionarioId), acontecimento);
    }

    /** Aplica o impacto emocional de interações sem contabilizar uma falha técnica inexistente. */
    ajustarEstresse(id: string, delta: number): void {
        const atual = this.necessidadesDe(id);
        this.necessidades[id] = { ...atual, estresse: Math.max(0, Math.min(100, atual.estresse + delta)) };
        this.registro.gravar(this.segundos, this.necessidades);
        this.registro.emitirEstado();
    }

    /** Reserva um canto para os dois participantes e responde somente quando ambos chegarem. */
    encontrarColega(id: string, alvoId: string): Promise<string> {
        this.sincronizar();
        const autor = this.agentesPorId.get(id);
        const alvo = this.agentesPorId.get(alvoId);
        if (!autor || !alvo || id === alvoId) return Promise.resolve('Escolha um colega presente na sala.');
        if (this.parceiroDePausa(id) === alvoId) {
            return Promise.resolve('Vocês já dividem o item de pausa. Conversem aqui, sem sair ou interromper o descanso.');
        }
        const atual = this.encontros.get(id);
        if (atual?.alvoId === alvoId && atual.chegou) {
            this.manterEncontro(id, alvoId);
            return Promise.resolve('Você chegou perto do colega. Continuem a conversa aqui.');
        }
        if (this.emPausa(id)) return Promise.resolve('Termine seu encontro ou pausa atual antes de sair de novo.');
        if (this.emPausa(alvoId)) return Promise.resolve('O colega está em outra pausa ou encontro. Aguarde terminar.');
        const status = this.registro.statusTrabalho(id);
        if (status === 'bloqueado' || (status === 'trabalhando' && !this.registro.emConversa?.(id))) {
            return Promise.resolve('Termine sua tarefa primeiro.');
        }
        const statusAlvo = this.registro.statusTrabalho(alvoId);
        if (statusAlvo === 'bloqueado' || (statusAlvo === 'trabalhando' && !this.registro.emConversa?.(alvoId))) {
            return Promise.resolve('O colega está trabalhando. Aguarde a tarefa terminar para conversar.');
        }
        const ocupadas = this.agentes().filter((item) => item.id !== id && item.id !== alvoId)
            .map((item) => celulaDoPonto(item.posicao));
        const destino = escolherLugarEncontro(this.salaConhecida, autor.posicao, alvo.posicao,
            [...ocupadas, ...[...this.encontros.values()].map((encontro) => encontro.celula)]);
        if (!destino) return Promise.resolve('Não há caminho livre até o colega.');
        return new Promise((concluir) => {
            this.encontros.set(id, { alvoId, celula: destino.autor, limite: this.segundos + 40,
                chegou: false, concluir });
            this.encontros.set(alvoId, { alvoId: id, celula: destino.colega, limite: this.segundos + 40,
                chegou: false, concluir: () => {} });
            this.registro.emitirEstado();
        });
    }

    /** Libera a caminhada ou conversa ao iniciar trabalho, demitir alguém ou fechar o escritório. */
    cancelarEncontro(id: string): void {
        for (const [chave, espera] of this.chegadasAnexos) {
            if (!espera.ids.includes(id)) continue;
            for (const pessoa of espera.ids) {
                const ausencia = this.ausencias.get(pessoa);
                if (ausencia) this.ausencias.set(pessoa, { ...ausencia, retornando: true });
            }
            espera.concluir(false);
            this.chegadasAnexos.delete(chave);
            this.registro.gravarAusencias?.(this.todasAusencias());
        }
        const encontro = this.encontros.get(id);
        if (!encontro) return;
        encontro.concluir('O encontro foi encerrado.');
        this.encontros.delete(id);
        const parceiro = this.encontros.get(encontro.alvoId);
        if (parceiro?.alvoId === id) {
            parceiro.concluir('O encontro foi encerrado.');
            this.encontros.delete(encontro.alvoId);
        }
        this.registro.emitirEstado();
    }

    /**
     * Leva o funcionário ao item mais próximo do tipo pedido e só responde quando ele volta, para que o turno do
     * harness fique parado durante a pausa. Devolve um texto para o agente ler.
     */
    pedirPausa(funcionarioId: string, atividade: Atividade, minutos: number): Promise<string> {
        if (!atividadesDePausa.has(atividade)) return Promise.resolve('Escolha uma atividade de pausa válida.');
        this.sincronizar();
        const agente = this.agentesPorId.get(funcionarioId);
        if (!agente) return Promise.resolve('Você não está na sala.');
        if (this.emPausa(funcionarioId)) return Promise.resolve('Você já está em pausa ou em um encontro.');
        const item = this.itemMaisProximo(agente, atividade);
        if (!item) {
            const quebrados = this.salaConhecida.itens.filter((existente) =>
                existente.quebrado && catalogo[existente.tipo].uso?.atividade === atividade);
            if (quebrados.length) {
                const itens = quebrados.map((quebrado) => `${catalogo[quebrado.tipo].nome} [ID ${quebrado.id}]`);
                return Promise.resolve('A pausa não pode começar: os itens para essa atividade estão quebrados. '
                    + `${itens.join(', ')}. Use consertar_item com o ID do móvel para consertar antes de tentar novamente.`);
            }
            return Promise.resolve('Não há nenhum item para isso no escritório. Peça à Diretoria que compre um.');
        }
        const indiceUso = this.vagasLivres(item, funcionarioId)[0];
        if (indiceUso === undefined) {
            return Promise.resolve('Os itens dessa atividade estão ocupados. Aguarde um ficar livre para acompanhar.');
        }
        if (!Number.isInteger(minutos) || minutos < 1 || minutos > minutosMaximosPausa) {
            return Promise.resolve('Escolha uma pausa entre 1 e 15 minutos reais.');
        }
        const duracao = minutos * 60;
        return new Promise((concluir) => {
            this.pausas.set(funcionarioId, {
                id: randomUUID(), iniciadaEm: new Date().toISOString(),
                itemId: item.id,
                indiceUso,
                atividade, origem: 'ferramenta',
                segundos: duracao,
                terminaEm: null,
                atualizadoEm: null,
                limite: this.segundos + folgaCaminhoSegundos,
                concluir,
            });
            this.registrarPausa(funcionarioId, 'inicio');
            this.registro.emitirEstado();
        });
    }

    encerrar(): void {
        if (this.temporizador) clearInterval(this.temporizador);
        for (const espera of this.chegadasAnexos.values()) espera.concluir(false);
        this.chegadasAnexos.clear();
        for (const id of this.encontros.keys()) this.cancelarEncontro(id);
        for (const [id, pausa] of this.pausas) {
            this.registrarPausa(id, 'interrupcao');
            pausa.concluir('O escritório fechou durante a sua pausa.');
            this.pausas.delete(id);
        }
        this.registro.gravar(this.segundos, this.necessidades);
    }

    private contexto(): ContextoSimulacao {
        return { sala: this.salaConhecida, agoraSegundos: this.segundos, sortear: Math.random };
    }

    /** Item do tipo pedido mais perto do agente, preferindo os que ninguém está usando. */
    private itemMaisProximo(agente: Agente, atividade: Atividade): ItemPosicionado | undefined {
        const aqui = celulaDoPonto(agente.posicao);
        const custo = (item: ItemPosicionado) =>
            (this.vagasLivres(item, agente.id).length ? 0 : 1000)
                + Math.abs(item.celula.x - aqui.x) + Math.abs(item.celula.z - aqui.z);
        return itensDaAtividade(this.salaConhecida, atividade).sort((a, b) => custo(a) - custo(b))[0];
    }

    private sincronizar(): void {
        const sala = this.registro.sala();
        if (sala !== this.salaConhecida) {
            this.salaConhecida = sala;
            const contexto = this.contexto();
            for (const [id, agente] of this.agentesPorId) this.agentesPorId.set(id, reajustarAgente(agente, contexto));
        }
        const contexto = this.contexto();
        for (const itemId of new Set([...this.pausas.values()].map((pausa) => pausa.itemId))) {
            const item = sala.itens.find((movel) => movel.id === itemId);
            if (item && !item.quebrado) continue;
            const motivo = item ? `${catalogo[item.tipo].nome} quebrou e precisa de conserto.`
                : 'O item não está mais na sala.';
            this.interromperPausasDoItem(itemId, motivo);
        }
        const presentes = new Set<string>();
        for (const funcionario of this.registro.funcionarios()) {
            presentes.add(funcionario.id);
            const agente = this.agentesPorId.get(funcionario.id);
            if (!agente) {
                this.agentesPorId.set(funcionario.id, criarAgente(funcionario.id, funcionario.mesaId, contexto));
                this.necessidades[funcionario.id] ??= necessidadesIniciais;
            } else if (agente.mesaId !== funcionario.mesaId) {
                this.agentesPorId.set(funcionario.id, reajustarAgente({ ...agente, mesaId: funcionario.mesaId }, contexto));
            }
        }
        for (const id of this.agentesPorId.keys()) {
            if (presentes.has(id)) continue;
            this.agentesPorId.delete(id);
            this.proximoAviso.delete(id);
            if (this.ausencias.delete(id)) this.registro.gravarAusencias?.(this.todasAusencias());
            this.registrarPausa(id, 'interrupcao');
            this.pausas.get(id)?.concluir('Você foi demitido.');
            this.pausas.delete(id);
            this.cancelarEncontro(id);
        }
    }

    private ordemDe(funcionarioId: string): Ordem {
        const ausencia = this.ausencias.get(funcionarioId);
        if (ausencia) {
            if (ausencia.retornando) return { tipo: 'mesa' };
            const anexo = anexoDaAusencia(ausencia.motivo);
            return anexo && ausencia.lugar !== undefined
                ? { tipo: 'anexo', anexo, lugar: ausencia.lugar } : { tipo: 'saida' };
        }
        const encontro = this.encontros.get(funcionarioId);
        if (encontro) return { tipo: 'encontro', celula: encontro.celula, encontroId: `encontro:${encontro.alvoId}` };
        const pausa = this.pausas.get(funcionarioId);
        return pausa ? { tipo: 'item', itemId: pausa.itemId, indiceUso: pausa.indiceUso } : { tipo: 'mesa' };
    }

    private vagasLivres(item: ItemPosicionado, id: string): number[] {
        const usadas = [...this.pausas].filter(([pessoa]) => pessoa !== id).map(([, pausa]) => {
            const reservado = this.salaConhecida.itens.find((movel) => movel.id === pausa.itemId);
            return reservado && celulaDeUso(reservado, pausa.indiceUso);
        });
        const origem = this.agentesPorId.get(id);
        if (!origem) return [];
        return Array.from({ length: capacidadeItem(item) }, (_, indice) => indice).filter((indice) => {
            const celula = celulaDeUso(item, indice)!;
            if (usadas.some((usada) => usada?.x === celula.x && usada.z === celula.z)) return false;
            return encontrarRota(celulaDoPonto(origem.posicao), celula,
                criarVerificadorLivre(this.salaConhecida)) !== null;
        });
    }

    private situacao(agente: Agente, funcionarioId: string): Situacao {
        const ausencia = this.ausencias.get(funcionarioId);
        if (ausencia) return agente.atividade === 'ausente' && !ausencia.retornando ? ausencia.motivo : 'ocioso';
        const usando = agente.rota.length === 0 && atividadesDePausa.has(agente.atividade);
        if (usando) return agente.atividade as Situacao;
        const status = this.registro.statusTrabalho(funcionarioId);
        if (this.registro.emConversa?.(funcionarioId)) return 'ocioso';
        return status === 'trabalhando' || status === 'bloqueado' ? 'trabalhando' : 'ocioso';
    }

    private acompanharPausa(id: string, agente: Agente, necessidades: Necessidades): void {
        const pausa = this.pausas.get(id);
        if (!pausa) return;
        const terminou = pausa.terminaEm !== null && this.agoraDaPausa() >= pausa.terminaEm;
        if (!terminou && (pausa.terminaEm !== null || this.segundos < pausa.limite)) return;
        this.pausas.delete(id);
        this.registrarPausa(id, terminou ? 'conclusao' : 'interrupcao', pausa);
        this.proximoAviso.set(id, this.segundos + 120);
        const texto = terminou
            ? `Pausa concluída após ${pausa.segundos / 60} ${pausa.segundos === 60 ? 'minuto real' : 'minutos reais'}. `
                + 'Sua vez terminou. '
                + `Estado privado: ${resumirNecessidades(necessidades)}. Não anuncie a volta no Geral.`
            : 'Você não conseguiu chegar ao item a tempo e voltou ao trabalho.';
        pausa.concluir(texto);
        this.registro.emitirEstado();
    }

    /** Um passo da simulação. Chamado pelo temporizador, ou diretamente quando `automatica` é falso. */
    avancar(segundos: number): void {
        if (!Number.isFinite(segundos) || segundos < 0) {
            throw new Error('O passo deve ter duração finita e não negativa.');
        }
        this.sincronizar();
        this.segundos += segundos;
        const contexto = this.contexto();
        for (const [id, agente] of this.agentesPorId) {
            this.avisarQuandoLivre(id);
            const ritmo = ritmoCaminhada(this.necessidadesDe(id).esgotamento ?? 0);
            const avancado = avancarAgente(agente, contexto, segundos, this.ordemDe(id), ritmo);
            this.agentesPorId.set(id, avancado);
            const alivio = avancado.atividade === 'ausente' ? 0 : alivioAmbiente(this.salaConhecida, avancado.posicao);
            const tempoNecessidades = this.tempoDeUsoPausa(id, avancado, segundos);
            const anterior = this.necessidadesDe(id);
            const proxima = aplicarTempo(anterior, this.situacao(avancado, id),
                tempoNecessidades, alivio);
            const necessidades = this.registro.necessidadesLiberadas
                ? protegerNecessidades(anterior, proxima, this.registro.necessidadesLiberadas()) : proxima;
            this.necessidades[id] = necessidades;
            this.acompanharPausa(id, avancado, necessidades);
            this.acompanharEncontro(id, avancado);
            this.acompanharAusencia(id);
        }
        this.acompanharChegadasAnexos();
        this.avisarCompanhiasDePausa();
        this.virarDia();
        this.passos++;
        if (this.passos % passosPorQuadro === 0) {
            this.registro.emitirQuadro({ segundos: this.segundos, agentes: [...this.agentesPorId.values()] });
        }
        if (this.passos % passosPorGravacao === 0) {
            this.registro.gravar(this.segundos, this.necessidades);
            this.registro.emitirEstado();
        }
    }

    private acompanharChegadasAnexos(): void {
        for (const [chave, espera] of this.chegadasAnexos) {
            const cancelada = espera.ids.some((id) => !this.ausencias.has(id) || this.ausencias.get(id)?.retornando);
            const chegaram = espera.ids.every((id) => this.agentesPorId.get(id)?.anexo === 'bem_estar');
            if (!cancelada && !chegaram) continue;
            this.chegadasAnexos.delete(chave);
            espera.concluir(!cancelada && chegaram);
        }
    }

    private avisarQuandoLivre(id: string): void {
        const proximo = this.proximoAviso.get(id);
        if (proximo === undefined) {
            this.proximoAviso.set(id, this.segundos + 120);
            return;
        }
        if (this.segundos < proximo || this.emPausa(id)) return;
        if (this.registro.emConversa?.(id) || this.registro.emTurnoSocial?.(id)) return;
        if (['trabalhando', 'bloqueado'].includes(this.registro.statusTrabalho(id))) return;
        this.proximoAviso.set(id, this.segundos + 120);
        this.registro.aoOcioso?.(id);
    }

    private agoraDaPausa(): number {
        return this.registro.agoraPausaMs?.()
            ?? (this.registro.automatica === false ? this.segundos * 1000 : Date.now());
    }

    private tempoDeUsoPausa(id: string, agente: Agente, segundos: number): number {
        const pausa = this.pausas.get(id);
        if (!pausa) return segundos;
        if (!usandoItem(agente, pausa.itemId)) return 0;
        const agora = this.agoraDaPausa();
        if (pausa.terminaEm === null) {
            pausa.terminaEm = agora + pausa.segundos * 1000;
            pausa.atualizadoEm = agora;
        }
        const ate = Math.min(agora, pausa.terminaEm);
        const decorrido = Math.max(0, (ate - pausa.atualizadoEm!) / 1000);
        pausa.atualizadoEm = Math.max(pausa.atualizadoEm!, ate);
        return decorrido;
    }

    private acompanharAusencia(id: string): void {
        const ausencia = this.ausencias.get(id);
        const agente = this.agentesPorId.get(id);
        if (!ausencia || !agente) return;
        if (ausencia.retornando) {
            if (agente.atividade !== 'trabalhando' || agente.destinoId !== agente.mesaId) return;
        } else {
            if (agente.atividade !== 'ausente') return;
            if (ausencia.duracao !== undefined) {
                this.ausencias.set(id, { ...ausencia, duracao: undefined,
                    terminaEm: this.segundos + ausencia.duracao });
                this.registro.gravarAusencias?.(this.todasAusencias());
                this.registro.emitirEstado();
                return;
            }
            if (this.segundos < ausencia.terminaEm) return;
            this.ausencias.set(id, { ...ausencia, retornando: true });
            this.registro.gravarAusencias?.(this.todasAusencias());
            this.registro.emitirEstado();
            return;
        }
        this.ausencias.delete(id);
        this.registro.gravarAusencias?.(this.todasAusencias());
        this.registro.aoRetornar?.(id, ausencia);
        this.registro.emitirEstado();
    }

    private registrarPausa(
        id: string, fase: RegistroPausa['fase'], pausa = this.pausas.get(id), motivo?: string,
    ): void {
        if (!pausa) return;
        if (fase !== 'inicio') this.encerrarCompanhiaDePausa(id, pausa);
        this.registro.registrarPausa?.({ funcionarioId: id, itemId: pausa.itemId,
            atividade: pausa.atividade, origem: pausa.origem, fase, ...(motivo ? { motivo } : {}) });
    }

    private avisarCompanhiasDePausa(): void {
        for (const [id, pausa] of this.pausas) {
            const colegaId = this.parceiroDePausa(id);
            if (!colegaId) {
                this.encerrarCompanhiaDePausa(id, pausa);
                continue;
            }
            if (pausa.companhiaAvisada === colegaId) continue;
            pausa.companhiaAvisada = colegaId;
            this.pausas.get(colegaId)!.companhiaAvisada = id;
            this.registro.aoCompartilharPausa?.(id, colegaId, pausa.itemId);
        }
    }

    private encerrarCompanhiaDePausa(id: string, pausa: Pausa): void {
        const parceiro = pausa.companhiaAvisada;
        if (!parceiro) return;
        this.registro.aoEncerrarCompanhia?.(id, parceiro);
        const outra = this.pausas.get(parceiro);
        if (outra?.companhiaAvisada === id) outra.companhiaAvisada = undefined;
        pausa.companhiaAvisada = undefined;
    }

    private acompanharEncontro(id: string, agente: Agente): void {
        const encontro = this.encontros.get(id);
        if (!encontro) return;
        const alvo = this.agentesPorId.get(encontro.alvoId);
        if (!alvo) return this.cancelarEncontro(id);
        if (this.segundos >= encontro.limite) {
            const emTurno = encontro.chegou && [id, encontro.alvoId].some((pessoa) =>
                this.registro.emTurnoSocial?.(pessoa) || this.registro.emConversa?.(pessoa));
            if (!emTurno) return this.cancelarEncontro(id);
            this.manterEncontro(id, encontro.alvoId);
        }
        if (agente.atividade !== 'conversando') return;
        this.agentesPorId.set(id, { ...agente, direcao: Math.atan2(
            alvo.posicao.x - agente.posicao.x, alvo.posicao.z - agente.posicao.z,
        ) });
        if (encontro.chegou) return;
        if (alvo.atividade !== 'conversando') return;
        if (Math.hypot(agente.posicao.x - alvo.posicao.x, agente.posicao.z - alvo.posicao.z) > 3) return;
        encontro.chegou = true;
        this.manterEncontro(id, encontro.alvoId);
        encontro.concluir('Você chegou perto do colega. Fale com ele agora usando conversar_reservado: texto normal '
            + 'vai para quem conversa com você, não para o colega. Sem conversa, vocês voltam às mesas.');
    }

    private virarDia(): void {
        const dia = diaDoExpediente(this.registro.agora?.());
        if (dia === this.dia) return;
        this.dia = dia;
        for (const [id, necessidades] of Object.entries(this.necessidades)) {
            this.necessidades[id] = { ...necessidades, falhasHoje: 0, segundosSeguidos: 0, energia: 90 };
        }
        this.registro.gravar(this.segundos, this.necessidades, dia);
    }
}
