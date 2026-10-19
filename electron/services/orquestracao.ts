import { concluirAcao, recusarAcao, type ResultadoAcao } from './ferramentas/resultado';
import { randomUUID } from 'node:crypto';
import {
    nomeCargo, refina, type Funcionario, type Mensagem, type Projeto, type StatusFuncionario,
} from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import {
    esquemaValidacaoEntrega, pendenciaValidacao,
    type RegistroTrabalho, type RespostaTrabalho, type ValidacaoEntrega,
} from '../../shared/trabalho';

import { threadPrincipal } from '../../shared/threads';

type RegistroOrquestracao = {
    funcionarios: () => Funcionario[];
    projetos: () => Projeto[];
    trabalhos: () => RegistroTrabalho[];
    gravar: (trabalhos: RegistroTrabalho[]) => void;
    status: (id: string) => StatusFuncionario;
    executar: (
        funcionario: Funcionario, projeto: Projeto, tarefa: string, threadId: string,
        observar?: (mensagem: Mensagem) => void,
    ) => Promise<RespostaTrabalho>;
    interromper: (id: string) => void;
    afastado?: (funcionarioId: string, liderId: string) => boolean;
    /** Motivo que impede o funcionário de receber trabalho, como esgotamento ou terminal avariado. */
    impedimento?: (funcionarioId: string) => string | undefined;
    acontecer?: (trabalho: RegistroTrabalho, tipo: 'delegacao' | 'entrega' | 'falha') => void;
    cobrar?: (liderId: string, trabalho: RegistroTrabalho, motivo: string) => string;
    aprovar?: (trabalhoId: string) => Resultado;
    rejeitar?: (trabalhoId: string, motivo: string) => Resultado;
    prepararCorrecao?: (arquivoId: string, motivo: string) => Resultado;
    adequacao?: (liderId: string, funcionarioId: string) => number;
    resumirRefinamento?: (trabalho: RegistroTrabalho) => string;
    duracaoRefinamento?: (arquivoId: string) => number;
    refinamentoCompleto?: (arquivoId: string) => boolean;
    aoLiberar?: (funcionarioId: string, arquivoId?: string) => void;
};

type PedidoAtivo = {
    id: string;
    liderId: string;
    threadId: string;
    projeto: Projeto;
    cancelado: boolean;
    delegacoes: number;
    funcionarios: Set<string>;
    pendentes: Set<Promise<RespostaTrabalho>>;
    interrompidos: Set<string>;
    pausados: Set<string>;
    origemCorrecaoId?: string;
    arquivoId?: string;
};

/** Limites técnicos de execução e tolerância para liberar sessões após o fim do período. */
export type PrazosOrquestracao = { liderMs: number; delegadoMs: number; toleranciaMs: number };

const prazosPadrao: PrazosOrquestracao = { liderMs: 1200000, delegadoMs: 180000, toleranciaMs: 15000 };

async function aguardarAte<T>(promessa: Promise<T>, ms: number): Promise<T | undefined> {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<undefined>((resolver) => { temporizador = setTimeout(() => resolver(undefined), ms); });
    try {
        return await Promise.race([promessa, limite]);
    } finally {
        clearTimeout(temporizador);
    }
}

const instrucoesLiderRefinamento = [
    'Pedido da aba Work: refinamento de macrodados. Você coordena o arquivo.',
    'Primeiro abra o arquivo para conhecer os dados e os participantes atuais.',
    'Para trabalhar em conjunto, use invocar_pro_work: os colegas livres iniciam períodos independentes no mesmo arquivo.',
    'Você pode refinar enquanto eles trabalham. Não aguarde nem delegue a quem já está no Work.',
    'Use delegar somente quando quiser atribuir uma etapa específica a um colega livre e aguardar o resultado.',
    'Não invente coordenadas nem uma caixa obrigatória antes de examinar os dados e os envios reais.',
    'Delegue o envio real de um grupo por refinar, com as três células '
        + 'verificadas na grade e sem impor caixa desconhecida.',
    'Cada colega faz uma etapa curta: um grupo aceito ou no máximo quatro envios, e devolve o resultado.',
    'Depois de cada retorno, delegue ao próximo colega disponível que ainda não participou deste arquivo.',
    'Não repita colegas enquanto houver alguém disponível que ainda não participou. Depois de todos participarem, '
        + 'ou se todos os que ainda não participaram estiverem indisponíveis, refine você; não delegue de novo.',
    'Considere o bem estar, a confiança e os envios anteriores ao escolher entre colegas ainda não participantes.',
    'O contador delimita seu período de trabalho, não a conclusão do arquivo. Só a Diretoria aprova.',
    'Você pode sair_do_work para discutir no Geral ou ficar livre, ou fazer_pausa para descansar num móvel.',
    'Os colegas continuam suas etapas mesmo se você sair. Você decide quando voltar por ir_para_work no Geral.',
    'Priorize chamadas de ferramentas; não narre hipóteses a cada envio. Resuma a entrega em até três frases.',
];

const instrucoesDelegadoRefinamento = 'Use abrir_arquivo para ver a grade e refinar para enviar grupos. '
    + 'Busque três células consecutivas na mesma linha com o mesmo dígito. '
    + 'As quatro caixas são aflicao, alegria, pavor e malicia. Não descarte uma seleção reconhecida '
    + 'enquanto houver caixa não testada. Sua tarefa exige envios reais por refinar, não apenas listar coordenadas. '
    + 'Somente retornos das ferramentas comprovam tentativas, aceitações ou rejeições. '
    + 'Sua etapa termina ao aceitar um grupo, após quatro envios ou ao terminar o prazo, o que vier primeiro. '
    + 'Leia a grade e os envios recentes antes de escolher; nunca use células marcadas * nem repita uma seleção já '
    + 'rejeitada. Priorize seleções reconhecidas ainda não aceitas nos '
        + 'envios da equipe e teste só caixas não tentadas. '
    + 'Região ou caixa sugeridas não são resultados verificados. Abandone uma região sem padrões reconhecidos. '
    + 'Não narre hipóteses a cada envio. '
    + 'Pode sair_do_work para conversar no Geral ou fazer_pausa para descansar antes de terminar a etapa. '
    + 'Se a região pedida não tiver três dígitos iguais, escolha outra na grade em vez de reclamar ao líder. '
    + 'Ao terminar, devolva as células, resultados e pendências em até três frases. Outros colegas continuarão.';

/** Encaminha pedidos do Work ao líder e devolve os resultados reais das delegações pelo MCP. */
export class Orquestracao {
    private ativos = new Map<string, PedidoAtivo>();

    constructor(private registro: RegistroOrquestracao, private prazos = prazosPadrao) {}

    enviar(
        projetoId: string, tarefa: string, threadId = threadPrincipal, origemCorrecaoId?: string, arquivoId?: string,
        funcionarioId?: string,
    ): Resultado {
        const chave = `${projetoId}:${threadId}${funcionarioId ? `:${funcionarioId}` : ''}`;
        if (this.ativos.has(chave)) return { ok: false, erro: 'Aguarde ou interrompa o pedido atual do Work.' };
        const projeto = this.registro.projetos().find((item) => item.id === projetoId);
        if (!projeto) return { ok: false, erro: 'Escolha o projeto em que a equipe vai trabalhar.' };
        const lideres = this.registro.funcionarios().filter((pessoa) => funcionarioId
            ? pessoa.id === funcionarioId && !!arquivoId && refina(pessoa.cargo) : pessoa.cargo === 'lider');
        if (!lideres.length) return { ok: false, erro: funcionarioId
            ? 'Esse funcionário não pode refinar Macrodados.' : 'Defina um líder na equipe para distribuir os pedidos.' };
        const lider = lideres.filter((pessoa) => !this.ocupado(pessoa.id)
            && !this.registro.impedimento?.(pessoa.id)).sort((a, b) =>
            this.registro.trabalhos().filter((item) => item.funcionarioId === a.id && !item.solicitante?.id).length
            - this.registro.trabalhos().filter((item) => item.funcionarioId === b.id && !item.solicitante?.id).length)[0];
        if (!lider) {
            return { ok: false, erro: funcionarioId ? 'Você está ocupado, ausente ou esgotado.'
                : 'Os líderes estão ocupados, ausentes ou esgotados. Aguarde ou conceda folga.' };
        }
        const pedido: PedidoAtivo = {
            id: randomUUID(), liderId: lider.id, threadId, projeto, cancelado: false, delegacoes: 0,
            funcionarios: new Set(), pendentes: new Set(), interrompidos: new Set(), pausados: new Set(),
            origemCorrecaoId, arquivoId,
        };
        const devolvida = origemCorrecaoId
            ? this.registro.trabalhos().find((item) => item.id === origemCorrecaoId) : undefined;
        this.ativos.set(chave, pedido);
        const instrucoes = arquivoId
            ? (lider.cargo === 'lider'
                ? [...instrucoesLiderRefinamento, this.equipeRefinamento(lider.id, pedido.id), `Pedido: ${tarefa}`]
                : ['Você decidiu refinar o arquivo disponível. Abra a grade e faça envios reais.',
                    'Trabalhe durante seu período ou até decidir sair_do_work ou fazer_pausa.',
                    'Seu arquivo permanece disponível até 100%. Só a Diretoria aprova.', tarefa]).join('\n')
            : this.instrucoesProjeto(projetoId, threadId, tarefa, devolvida);
        void this.executar(pedido, lider, tarefa, instrucoes, this.prazos.liderMs).finally(async () => {
            await Promise.allSettled([...pedido.pendentes]);
            if (this.ativos.get(chave) === pedido) this.ativos.delete(chave);
        });
        return { ok: true };
    }

    /** Libera a participação no Work sem cancelar o arquivo ou interromper os colegas. */
    pausar(funcionarioId: string, motivo?: string): Resultado {
        const pedido = [...this.ativos.values()].find((item) => item.funcionarios.has(funcionarioId));
        if (!pedido?.arquivoId || pedido.cancelado) return { ok: false, erro: 'Nenhum refinamento ativo.' };
        pedido.pausados.add(funcionarioId);
        if (motivo) this.registro.gravar(this.registro.trabalhos().map((item) =>
            item.funcionarioId === funcionarioId && item.pedidoId === pedido.id && item.estado === 'trabalhando'
                ? { ...item, avaliacao: { ...item.avaliacao!, motivo } } : item));
        return { ok: true };
    }

    /** Impede novos envios depois de o agente decidir sair no mesmo turno. */
    saindo(funcionarioId: string): boolean {
        return [...this.ativos.values()].some((pedido) => pedido.pausados.has(funcionarioId)
            && pedido.funcionarios.has(funcionarioId));
    }

    private instrucoesProjeto(
        projetoId: string, threadId: string, tarefa: string, devolvida?: RegistroTrabalho,
    ): string {
        const historico = this.registro.trabalhos()
            .filter((item) => (item.threadId ?? threadPrincipal) === threadId
                && item.projetoId === projetoId && item.estado !== 'trabalhando')
            .slice(-12)
            .map((item) => `[${item.id}] ${item.nome}, ${item.estado}, avaliação `
                + `${item.avaliacao?.estado ?? 'não registrada'}: ${item.tarefa.slice(0, 160)}`);
        return [
            'Pedido da aba Work. Você orquestra a entrega.',
            'Use delegar com IDs de ver_escritorio, uma etapa por vez, para evitar alterações concorrentes.',
            'Antes de encerrar, use registrar_validacao. Interface exige critério visual em renderização e critérios '
                + 'funcionais; inspeção estática não comprova comportamento. Sem evidência, marque pendente e diga '
                + 'como desbloquear.',
            'Encerrar o turno não aprova a entrega: somente a Diretoria aprova.',
            'Se não houver colegas disponíveis, explique o bloqueio. Não invente delegações nem resultados.',
            ...(devolvida ? [
                `Entrega devolvida: ${devolvida.id}. Tarefa original: ${devolvida.tarefa}`,
                `Pendências anteriores: ${devolvida.avaliacao?.motivo ?? devolvida.avaliacao?.estado ?? 'nenhuma'}`,
                'Use revisar_trabalho para ler o resultado anterior. O retorno exige nova revisão e evidências.',
            ] : []),
            ...(historico.length ? [
                'Entregas anteriores desta thread, só referência. Leia detalhes com revisar_trabalho:',
                ...historico,
            ] : []),
            `Pedido da Diretoria: ${tarefa}`,
        ].join('\n');
    }

    private equipeRefinamento(liderId: string, pedidoId?: string): string {
        const carga = (id: string) => this.registro.trabalhos().filter((item) => item.pedidoId === pedidoId
            && item.funcionarioId === id).length;
        const colegas = this.registro.funcionarios().filter((pessoa) => pessoa.id !== liderId && refina(pessoa.cargo)
            && !this.registro.afastado?.(pessoa.id, liderId)).sort((a, b) => carga(a.id) - carga(b.id)
                || (this.registro.adequacao?.(liderId, b.id) ?? 0) - (this.registro.adequacao?.(liderId, a.id) ?? 0));
        const participantes = new Set(this.registro.trabalhos().filter((item) => item.pedidoId === pedidoId)
            .map((item) => item.funcionarioId));
        const disponiveisNovos = colegas.filter((pessoa) => !participantes.has(pessoa.id)
            && !this.registro.impedimento?.(pessoa.id) && !this.ocupado(pessoa.id));
        return ['Equipe para delegação (use o ID em delegar):', ...colegas.map((pessoa) =>
            `${pessoa.nome}, ID ${pessoa.id}, ${nomeCargo(pessoa.cargo)}, `
                + `${this.registro.impedimento?.(pessoa.id) ?? (this.ocupado(pessoa.id) ? 'ocupado' : 'disponível')}, `
                + `${participantes.has(pessoa.id) ? 'já participou' : 'ainda não participou'}, ${carga(pessoa.id)} etapas.`),
        ...(disponiveisNovos.length ? [`Próxima etapa: delegue a ${disponiveisNovos[0]!.nome}, ainda não participante.`]
            : ['Todos já participaram: delegue novamente a um colega disponível ou refine você mesmo.'])].join('\n');
    }

    async delegar(...argumentos: Parameters<Orquestracao['delegarResultado']>): Promise<string> {
        return (await this.delegarResultado(...argumentos)).mensagem;
    }

    /** Entrega resultado estruturado para coordenar etapas reais pelo MCP. */
    async delegarResultado(liderId: string, destino: string, tarefa: string): Promise<ResultadoAcao> {
        const pedido = [...this.ativos.values()].find((item) => item.liderId === liderId
            && item.funcionarios.has(liderId) && !item.pausados.has(liderId));
        const lider = this.registro.funcionarios().find((pessoa) => pessoa.id === liderId);
        if (!pedido || pedido.cancelado || pedido.liderId !== liderId || lider?.cargo !== 'lider') {
            return recusarAcao('A delegação só está disponível para o líder de um pedido ativo no Work.');
        }
        const candidatos = this.registro.funcionarios().filter((pessoa) =>
            pessoa.id === destino || pessoa.nome.toLocaleLowerCase('pt-BR') === destino.toLocaleLowerCase('pt-BR'));
        if (candidatos.length !== 1) {
            return recusarAcao('Funcionário não encontrado ou nome ambíguo. Use o ID de ver_escritorio.');
        }
        const funcionario = candidatos[0]!;
        if (funcionario.id === liderId) return recusarAcao('Delegue a um colega, não a você mesmo.');
        if (!refina(funcionario.cargo)) {
            return recusarAcao(`${funcionario.nome} não refina Macrodados. Escolha um refinador.`);
        }
        const impedimento = this.registro.impedimento?.(funcionario.id);
        if (impedimento) {
            return recusarAcao(`${funcionario.nome} está indisponível: ${impedimento}. Escolha outro colega.`);
        }
        if (this.registro.afastado?.(funcionario.id, liderId)) {
            return recusarAcao('A Diretoria aprovou a transferência desse funcionário para longe da sua liderança.');
        }
        if (pedido.pendentes.size) {
            return recusarAcao('A etapa delegada anterior continua em execução, mesmo que a chamada tenha falhado. '
                + 'Use cancelar_delegacao para seguir com outro colega.');
        }
        if (pedido.delegacoes >= 20) {
            return recusarAcao('Limite de 20 delegações neste pedido. Resuma o progresso à Diretoria.');
        }
        if (this.ocupado(funcionario.id)) {
            return recusarAcao(`${funcionario.nome} está ocupado. Escolha outro colega ou aguarde.`);
        }
        if (pedido.arquivoId) {
            const participantes = new Set(this.registro.trabalhos()
                .filter((item) => item.pedidoId === pedido.id).map((item) => item.funcionarioId));
            const disponiveisNovos = this.registro.funcionarios().filter((pessoa) =>
                pessoa.id !== liderId && !participantes.has(pessoa.id) && refina(pessoa.cargo)
                && !this.ocupado(pessoa.id) && !this.registro.impedimento?.(pessoa.id)
                && !this.registro.afastado?.(pessoa.id, liderId));
            if (participantes.has(funcionario.id) && disponiveisNovos.length) {
                return recusarAcao(`Distribua a etapa para ${disponiveisNovos[0]!.nome}, que ainda não participou e está disponível.`);
            }
        }
        pedido.delegacoes++;
        const execucao = this.executar(pedido, funcionario, tarefa,
            `Tarefa delegada por ${lider.nome}, no projeto ${pedido.projeto.nome}:\n${tarefa}\n`
                + (pedido.arquivoId ? instrucoesDelegadoRefinamento
                    : 'Antes de encerrar, use registrar_validacao com critérios e evidências reais. '
                        + 'Marque como pendente qualquer teste ou inspeção visual que não conseguiu executar.'),
            this.prazos.delegadoMs, lider);
        pedido.pendentes.add(execucao);
        try {
            const resposta = await execucao;
            const responder = resposta.ok ? concluirAcao : recusarAcao;
            const trabalho = this.registro.trabalhos().findLast((item) =>
                item.pedidoId === pedido.id && item.funcionarioId === funcionario.id);
            if (pedido.arquivoId) {
                return responder(`Etapa de ${funcionario.nome}: ${resposta.ok ? 'encerrada' : 'não concluída'}.\n`
                    + `${resposta.texto}\n${this.equipeRefinamento(liderId, pedido.id)}\n`
                    + 'Passe a próxima etapa a um colega disponível que ainda não participou. '
                    + 'Se todos já participaram, delegue novamente a quem estiver disponível.');
            }
            return responder(`Trabalho ${trabalho?.id}. ${funcionario.nome}: `
                + `${resposta.ok ? 'execução encerrada, ainda exige revisão' : 'não concluiu'}\n${resposta.texto}`
                + `\nValidação: ${JSON.stringify(trabalho?.avaliacao)}`);
        } finally {
            pedido.pendentes.delete(execucao);
        }
    }

    private interromperDelegado(pedido: PedidoAtivo, funcionarioId: string): void {
        pedido.interrompidos.add(funcionarioId);
        this.registro.interromper(funcionarioId);
    }

    /** Interrompe a etapa delegada em andamento para o líder seguir com outro colega ou refinar sozinho. */
    cancelarDelegacao(...argumentos: Parameters<Orquestracao['cancelarDelegacaoResultado']>): string {
        return (this.cancelarDelegacaoResultado(...argumentos)).mensagem;
    }

    /** Entrega resultado estruturado para coordenar etapas reais pelo MCP. */
    cancelarDelegacaoResultado(liderId: string): ResultadoAcao {
        const pedido = [...this.ativos.values()].find((item) => item.liderId === liderId && !item.cancelado);
        if (!pedido) return recusarAcao('A delegação só está disponível para o líder de um pedido ativo no Work.');
        const delegados = [...pedido.funcionarios].filter((id) => id !== liderId);
        if (!delegados.length) return recusarAcao('Nenhuma etapa delegada em andamento.');
        for (const id of delegados) this.interromperDelegado(pedido, id);
        const nomes = this.registro.funcionarios().filter((pessoa) => delegados.includes(pessoa.id))
            .map((pessoa) => pessoa.nome).join(', ');
        return concluirAcao(`Etapa de ${nomes} cancelada. Delegue ao próximo colega disponível ou refine você mesmo.`);
    }

    /** Guarda evidências do próprio turno ativo; não concede aprovação nem recompensa. */
    registrarValidacao(funcionarioId: string, dados: ValidacaoEntrega): string {
        const validado = esquemaValidacaoEntrega.safeParse(dados);
        if (!validado.success) return 'Validação inválida. Informe resumo, critérios, tipos, estados e evidências.';
        const trabalho = this.registro.trabalhos().findLast((item) =>
            item.funcionarioId === funcionarioId && item.estado === 'trabalhando');
        if (!trabalho || ![...this.ativos.values()].some((item) =>
            item.id === trabalho.pedidoId && !item.cancelado && item.funcionarios.has(funcionarioId))) {
            return 'A validação só está disponível durante o seu próprio trabalho ativo no Work.';
        }
        this.registro.gravar(this.registro.trabalhos().map((item) => item.id === trabalho.id ? {
            ...item, avaliacao: { estado: 'pendente', validacao: validado.data, recompensa: 0 },
        } : item));
        return `Validação registrada no trabalho ${trabalho.id}. A aprovação continua com a Diretoria.`;
    }

    /** Aprova somente a entrega principal, encerrada e sem validações pendentes. */
    aprovarEntrega(trabalhoId: string): Resultado {
        const trabalho = this.registro.trabalhos().find((item) => item.id === trabalhoId);
        if (!trabalho || trabalho.solicitante?.id || trabalho.estado !== 'concluido' || !trabalho.avaliacao) {
            return { ok: false, erro: 'Escolha uma entrega principal concluída com avaliação registrada.' };
        }
        if (trabalho.avaliacao.estado === 'aprovada') return { ok: true };
        if (['rejeitada', 'reprovada'].includes(trabalho.avaliacao.estado) || this.pedidoEmAndamento(trabalho)) {
            return { ok: false, erro: 'Aguarde a correção ou o fim do pedido antes de aprovar.' };
        }
        const pendencia = this.pendencia(trabalho);
        if (pendencia) return { ok: false, erro: pendencia };
        return this.registro.aprovar?.(trabalhoId) ?? { ok: false, erro: 'Aprovação indisponível.' };
    }

    /** Retoma uma entrega pelo Work e preserva o vínculo com o pedido devolvido. */
    corrigirEntrega(trabalhoId: string, motivo: string): Resultado {
        const trabalho = this.registro.trabalhos().find((item) => item.id === trabalhoId);
        if (!trabalho || trabalho.solicitante?.id || trabalho.estado === 'trabalhando'
            || !trabalho.avaliacao || ['aprovada', 'rejeitada', 'reprovada'].includes(trabalho.avaliacao.estado)) {
            return { ok: false, erro: 'Escolha uma entrega principal que ainda aguarda aprovação.' };
        }
        if (!motivo.trim() || motivo.length > 2000) return { ok: false, erro: 'Informe o que precisa ser corrigido.' };
        if (this.pedidoEmAndamento(trabalho)) return { ok: false, erro: 'Aguarde o fim do pedido.' };
        if (trabalho.arquivoId) {
            if (this.ativos.has(`${trabalho.projetoId}:${trabalho.threadId ?? threadPrincipal}`)) {
                return { ok: false, erro: 'Aguarde o arquivo atual antes de iniciar a correção.' };
            }
            if (!this.registro.funcionarios().some((pessoa) => pessoa.cargo === 'lider' && !this.ocupado(pessoa.id))) {
                return { ok: false, erro: 'Aguarde um líder disponível para iniciar a correção.' };
            }
            const preparado = this.registro.prepararCorrecao?.(trabalho.arquivoId, motivo.trim());
            if (preparado && !preparado.ok) return preparado;
        }
        const resultado = this.enviar(trabalho.projetoId, `Correção solicitada: ${motivo.trim()}`,
            trabalho.threadId ?? threadPrincipal, trabalho.id, trabalho.arquivoId);
        if (!resultado.ok) return resultado;
        this.registro.gravar(this.registro.trabalhos().map((item) => item.id === trabalhoId ? {
            ...item, avaliacao: { ...trabalho.avaliacao!, estado: 'rejeitada', motivo: motivo.trim(),
                avaliadaEm: new Date().toISOString() },
        } : item));
        return resultado;
    }

    private pedidoEmAndamento(trabalho: RegistroTrabalho): boolean {
        if (trabalho.arquivoId && this.registro.trabalhos().some((item) => item.arquivoId === trabalho.arquivoId
            && item.estado === 'trabalhando')) return true;
        return [...this.ativos.values()].some((pedido) => pedido.id === trabalho.pedidoId);
    }

    /** Encerra a avaliação como fracasso, sem abrir uma tarefa de correção. */
    rejeitarEntrega(trabalhoId: string, motivo: string): Resultado {
        const trabalho = this.registro.trabalhos().find((item) => item.id === trabalhoId);
        if (!trabalho || trabalho.solicitante?.id || trabalho.estado === 'trabalhando' || !trabalho.avaliacao) {
            return { ok: false, erro: 'Escolha um trabalho principal encerrado.' };
        }
        if (!motivo.trim() || motivo.length > 2000) return { ok: false, erro: 'Informe o motivo da rejeição.' };
        if (this.pedidoEmAndamento(trabalho)) return { ok: false, erro: 'Aguarde o fim do pedido.' };
        if (trabalho.avaliacao.estado === 'reprovada') return { ok: true };
        if (['aprovada', 'rejeitada'].includes(trabalho.avaliacao.estado)) {
            return { ok: false, erro: 'A avaliação desse trabalho já foi decidida.' };
        }
        return this.registro.rejeitar?.(trabalhoId, motivo.trim()) ?? { ok: false, erro: 'Rejeição indisponível.' };
    }

    private pendencia(trabalho: RegistroTrabalho): string | null {
        if (trabalho.arquivoId) return this.registro.refinamentoCompleto?.(trabalho.arquivoId) === false
            ? 'O arquivo permanece pendente até atingir 100% de refinamento.' : null;
        const registros = this.registro.trabalhos();
        const pedidos = new Set([trabalho.pedidoId]);
        let origem = trabalho.origemCorrecaoId;
        const visitados = new Set<string>();
        while (origem && !visitados.has(origem)) {
            visitados.add(origem);
            const anterior = registros.find((item) => item.id === origem);
            if (!anterior) break;
            pedidos.add(anterior.pedidoId);
            origem = anterior.origemCorrecaoId;
        }
        const tarefas = registros.filter((item) => pedidos.has(item.pedidoId))
            .map((item) => item.tarefa).join('\n');
        return pendenciaValidacao(tarefas, trabalho.avaliacao?.validacao);
    }

    /** Devolve uma entrega do mesmo projeto e thread ao autor durante um pedido ativo. */
    async pedirRefazer(...argumentos: Parameters<Orquestracao['pedirRefazerResultado']>): Promise<string> {
        return (await this.pedirRefazerResultado(...argumentos)).mensagem;
    }

    /** Entrega resultado estruturado para coordenar etapas reais pelo MCP. */
    async pedirRefazerResultado(liderId: string, trabalhoId: string, motivo: string): Promise<ResultadoAcao> {
        const pedido = [...this.ativos.values()].find((item) => item.liderId === liderId && !item.cancelado);
        const trabalho = this.registro.trabalhos().find((item) => item.id === trabalhoId);
        if (!pedido || !trabalho || trabalho.projetoId !== pedido.projeto.id
            || (trabalho.threadId ?? threadPrincipal) !== pedido.threadId || trabalho.funcionarioId === liderId
            || trabalho.estado === 'trabalhando' || trabalho.estado === 'interrompido') {
            return recusarAcao('Escolha uma entrega de um colega neste pedido ativo.');
        }
        if (pedido.pendentes.size || pedido.delegacoes >= 20 || this.ocupado(trabalho.funcionarioId)) {
            return recusarAcao('A correção não pode começar agora. Verifique disponibilidade e limite de delegações.');
        }
        if (this.registro.afastado?.(trabalho.funcionarioId, liderId)) {
            return recusarAcao('Esse colega foi transferido.');
        }
        const cobranca = this.registro.cobrar?.(liderId, trabalho, motivo);
        return this.delegarResultado(liderId, trabalho.funcionarioId,
            `Correção da entrega ${trabalho.id}. Motivo: ${motivo}\nTarefa original: ${trabalho.tarefa}`
            + `${cobranca ? `\n${cobranca}` : ''}`);
    }

    interromper(threadId?: string, projetoId?: string, preservarArquivo = false): void {
        for (const pedido of this.ativos.values()) {
            if (threadId !== undefined && pedido.threadId !== threadId) continue;
            if (projetoId !== undefined && pedido.projeto.id !== projetoId) continue;
            if (!preservarArquivo || !pedido.arquivoId) pedido.cancelado = true;
            for (const id of pedido.funcionarios) {
                if (preservarArquivo && pedido.arquivoId) pedido.pausados.add(id);
                this.registro.interromper(id);
            }
        }
    }

    interromperSeLider(funcionarioId: string): void {
        for (const pedido of this.ativos.values()) {
            if (pedido.liderId === funcionarioId) this.interromper(pedido.threadId, pedido.projeto.id);
        }
    }

    limpar(threadId?: string, projetoId?: string): Resultado {
        const pertence = (item: { threadId?: string; projetoId: string }) =>
            (threadId === undefined || (item.threadId ?? threadPrincipal) === threadId)
            && (projetoId === undefined || item.projetoId === projetoId);
        if ([...this.ativos.values()].some((pedido) => pertence({
            threadId: pedido.threadId, projetoId: pedido.projeto.id,
        }))) return { ok: false, erro: 'Aguarde o pedido terminar antes de limpar o Work.' };
        this.registro.gravar(this.registro.trabalhos().filter((item) => !pertence(item)));
        return { ok: true };
    }

    private ocupado(id: string): boolean {
        return [...this.ativos.values()].some((pedido) => pedido.funcionarios.has(id)
            || pedido.liderId === id && !pedido.pausados.has(id))
            || ['trabalhando', 'bloqueado', 'em_pausa'].includes(this.registro.status(id));
    }

    private async executar(
        pedido: PedidoAtivo, funcionario: Funcionario, tarefa: string, prompt: string, prazoMs: number,
        solicitante?: Funcionario,
    ): Promise<RespostaTrabalho> {
        const id = randomUUID();
        const duracao = pedido.arquivoId ? this.registro.duracaoRefinamento?.(pedido.arquivoId) : undefined;
        const periodoMs = duracao === undefined ? prazoMs
            : solicitante ? Math.min(prazoMs, duracao * 60000) : duracao * 60000;
        pedido.funcionarios.add(funcionario.id);
        const registro: RegistroTrabalho = {
            id, pedidoId: pedido.id, threadId: pedido.threadId, funcionarioId: funcionario.id, nome: funcionario.nome,
            projetoId: pedido.projeto.id, tarefa, resultado: '', estado: 'trabalhando',
            criadoEm: new Date().toISOString(),
            ...(pedido.arquivoId ? { prazo: new Date(Date.now() + periodoMs).toISOString() } : {}),
            avaliacao: { estado: 'pendente', recompensa: 0 },
            ...(solicitante ? {} : { origemCorrecaoId: pedido.origemCorrecaoId }),
            ...(pedido.arquivoId ? { arquivoId: pedido.arquivoId } : {}),
            aparencia: funcionario.aparencia,
            solicitante: solicitante
                ? { id: solicitante.id, nome: solicitante.nome, aparencia: solicitante.aparencia } : { nome: 'Diretoria' },
            ordem: this.proximaOrdem(), eventos: [],
        };
        this.registro.gravar([...this.registro.trabalhos(), registro]);
        this.registro.acontecer?.(registro, 'delegacao');
        const chamada = this.registro.executar(
            funcionario, pedido.projeto, prompt, pedido.threadId, (mensagem) => this.registrarEventos(id, mensagem),
        ).catch((erro): RespostaTrabalho => ({ ok: false, texto: erro instanceof Error ? erro.message : String(erro) }));
        let resposta = await aguardarAte(chamada, periodoMs);
        if (!resposta) {
            if (pedido.arquivoId) pedido.pausados.add(funcionario.id);
            else pedido.interrompidos.add(funcionario.id);
            this.registro.interromper(funcionario.id);
            await aguardarAte(chamada, this.prazos.toleranciaMs);
            resposta = pedido.arquivoId
                ? { ok: true, texto: 'Período de trabalho encerrado. O arquivo e os envios foram preservados.' }
                : { ok: false, texto: `${funcionario.nome} excedeu o tempo da etapa e foi interrompido.` };
        }
        pedido.funcionarios.delete(funcionario.id);
        const interrompido = pedido.cancelado || pedido.interrompidos.delete(funcionario.id);
        const incompleto = !!pedido.arquivoId
            && this.registro.refinamentoCompleto?.(pedido.arquivoId) === false;
        const pausado = !interrompido && (pedido.pausados.has(funcionario.id)
            || resposta.ok && incompleto && !solicitante);
        if (pausado) pedido.pausados.add(funcionario.id);
        if (pausado) resposta = { ok: true, texto: 'Período encerrado. O arquivo e os envios foram preservados.' };
        if (!interrompido && resposta.ok && registro.arquivoId && this.registro.resumirRefinamento) {
            resposta = { ...resposta, texto: this.registro.resumirRefinamento(registro) };
        }
        this.registro.gravar(this.registro.trabalhos().map((item) => item.id === id ? {
            ...item, resultado: resposta.texto,
            estado: interrompido ? 'interrompido' : pausado ? 'pausado' : resposta.ok ? 'concluido' : 'falhou',
            falhaTecnica: !interrompido && !resposta.ok,
            avaliacao: { ...item.avaliacao!,
                estado: !interrompido && !pausado && resposta.ok && !this.pendencia(item)
                    ? 'aguardando_aprovacao' : 'pendente',
                motivo: pausado ? item.avaliacao?.motivo
                    ?? 'Período encerrado. O arquivo foi preservado para a próxima retomada.'
                    : interrompido ? 'Execução interrompida.' : !resposta.ok ? resposta.texto
                    : this.pendencia(item) ?? undefined },
        } : item));
        if (!interrompido && resposta.ok) this.registro.acontecer?.(
            { ...registro, resultado: resposta.texto, estado: resposta.ok ? 'concluido' : 'falhou' },
            resposta.ok ? 'entrega' : 'falha',
        );
        this.registro.aoLiberar?.(funcionario.id, pedido.arquivoId);
        return resposta;
    }

    private proximaOrdem(): number {
        return this.registro.trabalhos().reduce((maior, trabalho, indice) => Math.max(
            maior, trabalho.ordem ?? indice * 2 + 1, ...(trabalho.eventos ?? []).map((evento) => evento.ordem),
        ), 0) + 1;
    }

    private registrarEventos(id: string, mensagem: Mensagem): void {
        let ordem = this.proximaOrdem();
        this.registro.gravar(this.registro.trabalhos().map((trabalho) => {
            if (trabalho.id !== id) return trabalho;
            const anteriores = new Map(trabalho.eventos?.map((evento) => [evento.parte.id, evento]));
            const eventos = (mensagem.partes ?? []).map((parte) => ({
                parte, ordem: anteriores.get(parte.id)?.ordem ?? ordem++,
            }));
            return { ...trabalho, eventos };
        }));
    }
}
