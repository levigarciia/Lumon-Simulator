import { readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EstadoSalvo } from '../../shared/estado';
import type { Mensagem, ParteResposta } from '../../shared/funcionarios';
import { threadPrincipal } from '../../shared/threads';
import { detalharFerramenta } from './harness/tipos';

type ItemOriginal = {
    type: string; id: string; content?: { type: string; text?: string }[];
    arguments?: unknown; command?: unknown; changes?: unknown; result?: unknown; aggregated_output?: string;
};
type EventoOriginal = {
    timestamp: string;
    type: string;
    payload: { type?: string; turn_id?: string; started_at_ms?: number; item?: ItemOriginal; cwd?: string };
};

function normalizarTexto(texto: string): string {
    return texto.replace(/\s+/g, ' ').trim();
}

/** Recupera apenas trechos públicos e ferramentas cujos IDs e texto correspondem integralmente à resposta salva. */
export function recuperarPartes(mensagem: Mensagem, eventos: EventoOriginal[]): ParteResposta[] | null {
    const ferramentas = new Map(mensagem.ferramentas.map((ferramenta) => [ferramenta.id, ferramenta]));
    if (!ferramentas.size || mensagem.partes?.length) return null;
    const turnos = new Map<string, EventoOriginal[]>();
    for (const evento of eventos) {
        if (evento.type !== 'event_msg' || evento.payload.type !== 'item_completed') continue;
        if (!evento.payload.turn_id) continue;
        const turno = turnos.get(evento.payload.turn_id) ?? [];
        turno.push(evento);
        turnos.set(evento.payload.turn_id, turno);
    }
    for (const turno of turnos.values()) {
        const ids = new Set(turno.map((evento) => evento.payload.item?.id));
        if (![...ferramentas.keys()].every((id) => ids.has(id))) continue;
        const partes: ParteResposta[] = [];
        for (const evento of turno) {
            const item = evento.payload.item;
            if (!item) continue;
            const inicio = evento.payload.started_at_ms;
            const criadaEm = inicio && inicio > 1577836800000 ? new Date(inicio).toISOString() : evento.timestamp;
            if (item.type === 'AgentMessage') {
                const texto = (item.content ?? []).filter((parte) => parte.type === 'Text')
                    .map((parte) => parte.text ?? '').join('');
                if (texto) partes.push({ id: item.id, tipo: 'texto', texto, criadaEm });
            } else {
                const ferramenta = ferramentas.get(item.id);
                if (!ferramenta) continue;
                partes.push({ id: item.id, tipo: 'ferramenta', criadaEm, ferramenta: {
                    ...ferramenta, iniciadaEm: criadaEm, concluidaEm: evento.timestamp,
                    entrada: detalharFerramenta(item.arguments ?? item.command ?? item.changes),
                    saida: detalharFerramenta(item.result ?? item.aggregated_output),
                } });
            }
        }
        partes.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm));
        const texto = partes.filter((parte) => parte.tipo === 'texto').map((parte) => parte.texto).join('\n\n');
        if (normalizarTexto(texto) === normalizarTexto(mensagem.texto)) return partes;
    }
    return null;
}

async function lerCabecalho(arquivo: string): Promise<EventoOriginal | null> {
    const fluxo = createReadStream(arquivo, { encoding: 'utf8' });
    const linhas = createInterface({ input: fluxo, crlfDelay: Infinity });
    try {
        for await (const linha of linhas) return JSON.parse(linha) as EventoOriginal;
        return null;
    } catch {
        return null;
    } finally {
        linhas.close();
        fluxo.destroy();
    }
}

function recuperarEventosWork(estado: EstadoSalvo): void {
    let recuperou = false;
    estado.trabalhos = estado.trabalhos.map((trabalho) => {
        if (trabalho.eventos?.length) return trabalho;
        const mensagens = estado.conversas[trabalho.funcionarioId] ?? [];
        const pedido = mensagens.findIndex((mensagem) => mensagem.autor === 'usuario' && mensagem.canal === 'work'
            && mensagem.projetoId === trabalho.projetoId && mensagem.criadaEm >= trabalho.criadoEm
            && (mensagem.threadId ?? threadPrincipal) === (trabalho.threadId ?? threadPrincipal)
            && mensagem.texto.endsWith(trabalho.tarefa));
        const resposta = pedido >= 0 ? mensagens[pedido + 1] : undefined;
        if (resposta?.autor !== 'funcionario' || !resposta.partes?.length) return trabalho;
        recuperou = true;
        return { ...trabalho, eventos: resposta.partes.map((parte) => ({ parte, ordem: 0 })) };
    });
    if (!recuperou) return;
    const sequencia = estado.trabalhos.flatMap((trabalho) => [
        { data: trabalho.criadoEm, definir: (ordem: number) => { trabalho.ordem = ordem; } },
        ...(trabalho.eventos ?? []).map((evento) => ({ data: evento.parte.criadaEm,
            definir: (ordem: number) => { evento.ordem = ordem; } })),
    ]).sort((a, b) => a.data.localeCompare(b.data));
    sequencia.forEach((entrada, indice) => entrada.definir(indice + 1));
}

/** Restaura a ordem de respostas antigas quando o Codex ainda mantém a sessão original do mesmo projeto e dia. */
export async function recuperarHistoricoCodex(
    estado: EstadoSalvo, pastaSessoes = join(homedir(), '.codex', 'sessions'),
): Promise<boolean> {
    const pendentes = Object.values(estado.conversas).flat().filter((mensagem) =>
        mensagem.autor === 'funcionario' && !mensagem.partes?.length && mensagem.ferramentas.length > 0);
    if (!pendentes.length) return false;
    const dias = new Set(pendentes.map((mensagem) => mensagem.criadaEm.slice(0, 10)));
    const projetos = new Set(estado.projetos.map((projeto) => projeto.pasta.replace(/\\/g, '/').toLowerCase()));
    let recuperadas = 0;
    for (const dia of dias) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
        const pasta = join(pastaSessoes, ...dia.split('-'));
        const arquivos = await readdir(pasta).catch(() => [] as string[]);
        for (const nome of arquivos) {
            if (!nome.endsWith('.jsonl')) continue;
            try {
                const arquivo = join(pasta, nome);
                const cabecalho = await lerCabecalho(arquivo);
                const projeto = cabecalho?.payload.cwd?.replace(/\\/g, '/').toLowerCase();
                if (!projeto || !projetos.has(projeto)) continue;
                const eventos = (await readFile(arquivo, 'utf8')).trim().split('\n')
                    .map((linha) => JSON.parse(linha) as EventoOriginal);
                for (const mensagem of pendentes) {
                    const partes = recuperarPartes(mensagem, eventos);
                    if (!partes) continue;
                    mensagem.partes = partes;
                    mensagem.ferramentas = partes.flatMap((parte) =>
                        parte.tipo === 'ferramenta' ? [parte.ferramenta] : []);
                    recuperadas++;
                }
            } catch {
                continue;
            }
        }
    }
    if (recuperadas > 0) recuperarEventosWork(estado);
    return recuperadas > 0;
}
