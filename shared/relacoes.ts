import type { Personalidade } from './personalidade';
import type { EventoSocial, ImpactoRelacao, ReacaoSocial, Relacao } from './social';

/** Consulta o vínculo atual em uma direção, sem presumir reciprocidade nem duplicar estado salvo. */
export function statusRelacao(relacao: Relacao): 'Romance' | 'Inimizade' | 'Amizade' | 'Distante' | 'Neutra' {
    if (relacao.ressentimento >= 90) return 'Inimizade';
    if (relacao.afinidade > 90) return 'Romance';
    if (relacao.afinidade >= 70) return 'Amizade';
    if (relacao.afinidade <= 25) return 'Distante';
    return 'Neutra';
}

const sinaisRelacionamento = {
    concordar: ['Concordância', 'positivo'], perdoar: ['Perdão', 'positivo'],
    discordar: ['Discordância', 'negativo'], desconfiar: ['Desconfiança', 'negativo'],
    cobrar: ['Pressão recebida', 'negativo'], contestar: ['Posição contestada', 'negativo'],
    elogiar: ['Reconhecimento', 'positivo'], desculpar: ['Reconciliação', 'positivo'],
    defender: ['Apoio recebido', 'positivo'], apoio: ['Apoio recebido', 'positivo'],
    fofocar: ['Fofoca recebida', 'negativo'], entrega: ['Entrega reconhecida', 'positivo'],
    falha: ['Confiança abalada', 'negativo'],
} as const;

/** Registra o sinal da interação mesmo quando os números da relação já atingiram seus limites. */
export function registrarImpactoRelacao(
    anterior: Relacao, atual: Relacao, tipo: keyof typeof sinaisRelacionamento, eventoId: string,
): { relacao: Relacao; impacto: ImpactoRelacao } {
    const [rotulo, sinal] = sinaisRelacionamento[tipo];
    const marcador = { rotulo, tipo: sinal, eventoId };
    const mudancas = (['confianca', 'afinidade', 'respeito', 'ressentimento'] as const)
        .filter((eixo) => anterior[eixo] !== atual[eixo])
        .map((eixo) => ({ eixo, anterior: anterior[eixo], atual: atual[eixo] }));
    return {
        relacao: { ...atual, marcadores: [...(atual.marcadores ?? []).filter((item) => item.rotulo !== rotulo),
            marcador].slice(-6) },
        impacto: { ...marcador, autorId: atual.autorId, colegaId: atual.colegaId, mudancas },
    };
}

/** Calcula a revisão de uma relação sem apagar mágoas por uma concordância pontual. */
export function aplicarReacao(
    atual: Relacao, personalidade: Personalidade, reacao: ReacaoSocial,
    tipoFonte: EventoSocial['tipo'], eventoId: string,
): Relacao {
    const abertura = (personalidade.tolerancia + personalidade.empatia) / 200;
    const resistencia = personalidade.orgulho / 100;
    const conflito = ['cobrar', 'contestar', 'falha'].includes(tipoFonte);
    const variacoes = {
        concordar: { confianca: 4 + abertura * 3, respeito: 5 + abertura * 3,
            afinidade: 1, ressentimento: -(3 + abertura * 5 - resistencia) },
        perdoar: { confianca: 2 + abertura * 3, respeito: 2, afinidade: 3 + abertura * 3,
            ressentimento: -(12 + abertura * 12 - resistencia * 4) },
        discordar: { confianca: conflito ? -3 : 0, respeito: 0, afinidade: conflito ? -2 : 0,
            ressentimento: conflito ? 3 + resistencia * 4 - abertura * 2 : 0 },
        desconfiar: { confianca: -(7 + resistencia * 3), respeito: -2, afinidade: -2,
            ressentimento: 2 + resistencia * 2 },
    } satisfies Record<ReacaoSocial, Record<'confianca' | 'respeito' | 'afinidade' | 'ressentimento', number>>;
    const delta = variacoes[reacao];
    const limitar = (valor: number) => Math.round(Math.max(0, Math.min(100, valor)));
    return { ...atual, ultimoEventoId: eventoId,
        confianca: limitar(atual.confianca + delta.confianca),
        respeito: limitar(atual.respeito + delta.respeito),
        afinidade: limitar(atual.afinidade + delta.afinidade),
        ressentimento: limitar(atual.ressentimento + delta.ressentimento) };
}

/** Resume a relação em palavras para o prompt, sem números que levem o modelo a uma leitura mecânica. */
export function resumirRelacao(relacao: Relacao): string {
    const faixa = (valor: number, baixo: string, medio: string, alto: string) =>
        valor <= 30 ? baixo : valor >= 70 ? alto : medio;
    return [
        faixa(relacao.confianca, 'desconfia', 'confia com reservas', 'confia'),
        faixa(relacao.afinidade, 'não gosta muito', 'sem afeto especial', 'gosta'),
        faixa(relacao.respeito, 'duvida da competência', 'respeito comum', 'admira a competência'),
        ...(relacao.ressentimento >= 35 ? ['guarda mágoa'] : relacao.ressentimento >= 15 ? ['leve incômodo'] : []),
    ].join(', ');
}

/** Traduz a visão privada de um colega em uma postura de conversa própria dessa relação. */
export function descreverCondutaRelacional(relacao: Relacao, personalidade: Personalidade): string {
    const conduta: string[] = [];
    const status = statusRelacao(relacao);
    conduta.push(`Relação: ${status}.`);
    if (status === 'Inimizade') {
        conduta.push('Você considera este colega um inimigo e quer remover esse colega do departamento. '
            + 'Expresse a hostilidade conforme sua personalidade, busque aliados e proponha demissão '
            + 'com propor_mudanca, usando fontes conhecidas e assumindo o conflito pessoal como motivo. '
            + 'Não invente faltas nem apoios. Só a Diretoria decide; não repita propostas pendentes ou recusadas '
            + 'sem fatos novos.');
    } else if (status === 'Romance') {
        conduta.push('Você sente interesse romântico por este colega. Demonstre carinho, procure proximidade '
            + 'e conversas reservadas e considere seu bem estar nas escolhas de apoio e defesa. '
            + 'Não presuma reciprocidade; respeite recusas, sem elogios automáticos nem ignorar fatos.');
    }
    if (relacao.ressentimento >= 70) {
        const reativo = personalidade.tolerancia < 40 || personalidade.empatia < 35 || personalidade.orgulho >= 70;
        conduta.push(reativo
            ? 'Mágoa intensa: seja seco, ríspido ou sarcástico com este colega quando houver atrito.'
            : 'Mágoa intensa: demonstre frieza e distância com este colega, mesmo mantendo a educação.');
        conduta.push('Concordar num ponto não é perdoar nem recuperar intimidade.');
    } else if (relacao.ressentimento >= 35) {
        conduta.push('Mágoa presente: mantenha reservas e mostre incômodo se o assunto tocar no conflito.');
    } else if (relacao.afinidade >= 70) {
        conduta.push('Proximidade: fale com familiaridade, abertura e consideração por este colega.');
    } else if (relacao.afinidade <= 25) {
        conduta.push('Pouca afinidade: seja distante e objetivo com este colega, sem intimidade forçada.');
    }
    if (relacao.confianca <= 30) conduta.push('Desconfiança: confira alegações e peça evidências antes de apoiar.');
    if (relacao.respeito >= 70) conduta.push('Reconheça a competência dele, mesmo se não gostar dele.');
    if (relacao.respeito <= 25) conduta.push('Questione a posição dele com fatos, sem deferência automática.');
    return conduta.join(' ');
}
