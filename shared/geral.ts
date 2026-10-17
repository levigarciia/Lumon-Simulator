import { z } from 'zod';
import { esquemaFerramenta, type Mensagem } from './funcionarios';
import type { EventoSocial, ImpactoRelacao } from './social';

export const esquemaMensagemGeral = z.object({
    id: z.string(),
    autorId: z.string(),
    texto: z.string(),
    tipo: z.enum(['pensamento', 'acao']).optional(),
    participantes: z.array(z.string()).optional(),
    destinatarioNome: z.string().optional(),
    eventoId: z.string().optional(),
    criadaEm: z.string(),
    ferramentas: z.array(esquemaFerramenta).default([]),
});

/**
 * Fala no canal Geral. `autorId` é o identificador do funcionário, `usuario` ou `sistema`. `ferramentas` lista
 * o que o agente fez no escritório durante a fala, como ir comer. `eventoId` liga a fala ao acontecimento social
 * que os agentes citam como fonte.
 */
export type MensagemGeral = z.infer<typeof esquemaMensagemGeral>;

/** Etapa real do turno, para distinguir espera, geração e execução na interface. */
export type EtapaResposta = 'preparando' | 'aguardando_motor' | 'processando' | 'reagindo'
    | 'escrevendo' | 'executando_acao';

export type FalaChat = MensagemGeral & {
    participantes?: string[];
    alcance?: EventoSocial['alcance'];
    autorNome?: string;
    destinatarioNome?: string;
    acao?: string;
    impactosRelacao?: ImpactoRelacao[];
};

/** Insere acontecimentos físicos no chat individual sem inventar falas no histórico do harness. */
export function mensagensComPausas(
    mensagens: Mensagem[], eventos: EventoSocial[], funcionarioId: string,
): Mensagem[] {
    const pausas: Mensagem[] = eventos.filter((evento) =>
        evento.tipo === 'pausa' && evento.autorId === funcionarioId).map((evento) => ({
        id: evento.id, autor: 'funcionario', tipo: 'pausa', texto: evento.texto,
        criadaEm: evento.criadoEm, ferramentas: [], canal: 'conversa',
    }));
    return [...mensagens, ...pausas].sort((a, b) => Date.parse(a.criadaEm) - Date.parse(b.criadaEm));
}

const rotulosAcao: Record<string, string> = {
    cobrar: 'Cobrou', contestar: 'Contestou', elogiar: 'Elogiou', desculpar: 'Pediu desculpas a',
    defender: 'Defendeu', fofocar: 'Fofocou com',
};

function rotularAcao(evento: EventoSocial): string | undefined {
    const alvo = evento.alvoNome ?? 'um colega';
    if (evento.tipo === 'proposta') return `Proposta sobre ${alvo}, visível só para você. Decida na ficha.`;
    if (evento.tipo === 'pausa') return 'Pausa';
    if (evento.tipo === 'quebra') return 'Móvel quebrado';
    if (evento.tipo === 'conserto') return 'Conserto';
    if (evento.tipo === 'comunicado') return 'Comunicado da Diretoria';
    return rotulosAcao[evento.tipo] ? `${rotulosAcao[evento.tipo]} ${alvo}` : undefined;
}

/**
 * Reúne falas públicas, reservadas e propostas para a interface da Diretoria, sem pensamentos ou relatos
 * individuais. Use só na interface: propostas aparecem aqui, mas continuam privadas para os colegas.
 */
export function falasDoChat(mensagens: MensagemGeral[], eventos: EventoSocial[]): FalaChat[] {
    const impactosPorEvento = new Map<string, ImpactoRelacao[]>();
    for (const evento of eventos) {
        const fonteId = evento.tipo === 'reacao' ? evento.fontes[0] : evento.id;
        if (!fonteId || !evento.impactosRelacao?.length) continue;
        impactosPorEvento.set(fonteId, [...(impactosPorEvento.get(fonteId) ?? []), ...evento.impactosRelacao]);
    }
    const acoes = ['cobrar', 'contestar', 'elogiar', 'desculpar', 'defender', 'fofocar', 'reservado',
        'proposta', 'pausa', 'quebra', 'conserto', 'comunicado'];
    const sociais: FalaChat[] = eventos.filter((evento) => acoes.includes(evento.tipo)).map((evento) => ({
        id: evento.id, autorId: evento.autorId, autorNome: evento.autorNome, texto: evento.texto,
        criadaEm: evento.criadoEm, ferramentas: [], eventoId: evento.id,
        destinatarioNome: evento.alvoNome, alcance: evento.alcance,
        ...(evento.alcance === 'reservado' && evento.tipo !== 'proposta' ? { participantes: evento.ouvintes } : {}),
        ...(rotularAcao(evento) ? { acao: rotularAcao(evento) } : {}),
    }));
    return [...mensagens.filter((mensagem) => mensagem.tipo !== 'pensamento'), ...sociais]
        .map((fala) => ({ ...fala, impactosRelacao: impactosPorEvento.get(fala.eventoId ?? fala.id) }))
        .sort((a, b) => Date.parse(a.criadaEm) - Date.parse(b.criadaEm));
}

export const autorUsuario = 'usuario';
export const autorSistema = 'sistema';

/** Resposta que o funcionário dá quando não tem nada a acrescentar; não é publicada no canal. */
export const respostaSilencio = '(silêncio)';

/** Reconhece marcadores isolados de ausência de fala, preservando frases que mencionam silêncio. */
export function ehSilencio(texto: string): boolean {
    const normalizado = texto.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/^\(?silencio\)?[.!…]*$/.test(normalizado)) return true;
    return normalizado.length <= 120
        && /\b(vou|irei|prefiro|melhor)\s+(guardar|ficar em|permanecer em|manter)\s+(o\s+)?silencio\b/.test(normalizado);
}

/** Remove o vocativo com o próprio nome do autor, como "Jamal, ..." dito pelo Jamal. */
export function removerAutoVocativo(texto: string, nome: string): string {
    const inicio = texto.trimStart();
    const vocativo = new RegExp(`^@?${escaparRegex(normalizarTexto(nome))}\\s*[,:]\\s*`);
    const encontrado = normalizarTexto(inicio).match(vocativo);
    if (!encontrado) return texto;
    const resto = inicio.slice(encontrado[0].length);
    return resto.charAt(0).toLocaleUpperCase('pt-BR') + resto.slice(1);
}

const verbosDeAcao = 'resolver|consertar|comprar|conversar|falar|verificar|revisar|checar|conferir|consultar|'
    + 'comer|descansar|cobrar|pausar|comecar|iniciar|acessar|assumir|abrir|buscar|perguntar|elogiar|propor|'
    + 'chamar|tomar|ouvir|pegar|olhar|ver|procurar|analisar|pagar|reclamar|defender|contestar';
const promessaDeAcao = new RegExp(`\\b(vou|irei|deixa que eu|deixe que eu|aproveito para|decidi|decido)\\s+`
    + `(\\S+\\s+){0,2}?(${verbosDeAcao}|fazer\\s+(uma\\s+)?pausa)\\b`);

/** Identifica uma decisão de pausa que precisa ser confirmada pela ferramenta correspondente. */
export function anunciaPausa(texto: string): boolean {
    const normalizado = texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return promessaDeAcao.test(normalizado)
        && /\b(pausa|comer|descansar|pausar|tomar\s+(um\s+)?cafe|ouvir\s+musica)\b/.test(normalizado);
}

/**
 * Reconhece falas que anunciam uma ação para já, como "vou consertar agora". Use para dar ao agente a chance de
 * executar a ferramenta no mesmo turno, em vez de passar a vez com uma promessa pendente.
 */
export function anunciaAcao(texto: string): boolean {
    return promessaDeAcao.test(texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
}

/** Falas seguidas entre agentes permitidas até uma nova mensagem da Diretoria ou da conversa livre ligada. */
export const limiteFalasSeguidas = 6;

export const limiteMensagensGeral = 300;

/** Detecta cópias longas com pequenas variações, preservando perguntas, números e mudanças de negação. */
export function repeteFala(texto: string, anterior: string): boolean {
    const normalizar = (valor: string) => valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
        .replace(/@\S+/g, '').replace(/[^\p{L}\d\s?]/gu, '').replace(/\s+/g, ' ').trim();
    const atual = normalizar(texto);
    const passada = normalizar(anterior);
    if (atual.length < 80 || passada.length < 80) return false;
    if (atual === passada) return true;
    if (atual.includes('?') || passada.includes('?')) return false;
    const ressalvas = (valor: string) => valor.match(/\b(nao|nunca|nem|sem|\d+)\b/g)?.join(' ') ?? '';
    if (ressalvas(atual) !== ressalvas(passada)) return false;
    const palavras = new Set(atual.split(' '));
    const anteriores = new Set(passada.split(' '));
    const comuns = [...palavras].filter((palavra) => anteriores.has(palavra)).length;
    return comuns / Math.min(palavras.size, anteriores.size) >= 0.8;
}

/** Reconhece cumprimentos simples para responder sem abrir uma etapa artificial de ação. */
export function ehCumprimento(texto: string): boolean {
    const normalizado = texto.replace(/@\S+/g, '').normalize('NFD').replace(/\p{M}/gu, '')
        .toLowerCase().replace(/[!?.,]/g, '').trim();
    return /^(oi|ola|bom dia|boa tarde|boa noite)( tudo bem)?$/.test(normalizado);
}

function normalizarTexto(valor: string): string {
    return valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escaparRegex(valor: string): string {
    return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Funcionários citados com `@Nome`, sem diferenciar maiúsculas e acentos. */
export function encontrarMencoes<T extends { id: string; nome: string }>(texto: string, funcionarios: T[]): T[] {
    const alvo = normalizarTexto(texto);
    return funcionarios.filter((funcionario) => alvo.includes(`@${normalizarTexto(funcionario.nome)}`));
}

/**
 * Funcionários citados com `@Nome` ou chamados por vocativo no início de uma frase, como "Claudio, ...".
 * Use nas falas dos agentes, que costumam chamar colegas pelo nome sem arroba.
 */
export function encontrarInterpelados<T extends { id: string; nome: string }>(texto: string, funcionarios: T[]): T[] {
    const alvo = normalizarTexto(texto);
    return funcionarios.filter((funcionario) => {
        const nome = normalizarTexto(funcionario.nome);
        return alvo.includes(`@${nome}`)
            || new RegExp(`(^|[.!?…]\\s+|\\n\\s*)${escaparRegex(nome)}\\s*[,:!?]`).test(alvo);
    });
}

/**
 * Conta as falas seguidas trocadas apenas entre dois colegas, da mais recente para trás, ignorando avisos do
 * sistema. Use para reconhecer uma discussão em ciclo; retorna zero se um dos dois ainda não falou nela.
 */
export function contarFalasDoEmbate(
    mensagens: readonly Pick<MensagemGeral, 'autorId' | 'tipo'>[], autorId: string, colegaId: string,
): number {
    const participantes = new Set([autorId, colegaId]);
    const autores = new Set<string>();
    let falas = 0;
    for (const mensagem of [...mensagens].reverse()) {
        if (mensagem.tipo || mensagem.autorId === autorSistema) continue;
        if (!participantes.has(mensagem.autorId)) break;
        autores.add(mensagem.autorId);
        falas++;
    }
    return autores.size === 2 ? falas : 0;
}

const tamanhoMinimoFrasePropria = 8;
const tamanhoMinimoFraseAlheia = 25;

function chaveDaFrase(frase: string): string {
    return normalizarTexto(frase).replace(/[^\p{L}\d\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function dividirFrases(paragrafo: string): string[] {
    return paragrafo.split(/(?<=[.!?…])\s+/).filter((frase) => frase.trim());
}

function chavesDasFrases(textos: readonly string[], tamanhoMinimo: number): string[] {
    return textos.flatMap((anterior) => anterior.split(/\n+/).flatMap(dividirFrases))
        .map(chaveDaFrase).filter((chave) => chave.length >= tamanhoMinimo);
}

/**
 * Remove frases copiadas literalmente das falas recentes: bordões e fechamentos que o autor repete em toda fala
 * e frases longas de outras pessoas. Respostas curtas e comuns, como "Estou bem.", seguem permitidas entre
 * autores diferentes. Retorna texto vazio quando nada novo sobra.
 */
export function removerFrasesRepetidas(
    texto: string, proprias: readonly string[], alheias: readonly string[] = [],
): string {
    const conhecidas = new Set([...chavesDasFrases(proprias, tamanhoMinimoFrasePropria),
        ...chavesDasFrases(alheias, tamanhoMinimoFraseAlheia)]);
    const repete = (frase: string) => conhecidas.has(chaveDaFrase(frase));
    if (!texto.split(/\n+/).flatMap(dividirFrases).some(repete)) return texto;
    return texto.split(/\n+/)
        .map((paragrafo) => dividirFrases(paragrafo).filter((frase) => !repete(frase)).join(' '))
        .filter((paragrafo) => paragrafo.trim())
        .join('\n\n')
        .trim();
}
