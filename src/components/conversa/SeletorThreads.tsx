import { Plus, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Resultado } from '../../../shared/ponte';
import { threadPrincipal, type Thread } from '../../../shared/threads';
import { lumon } from '../../services/ponte';

type Propriedades = {
    threads: Thread[];
    tipo: Thread['tipo'];
    destinoId: string;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
};

/** Item exibido na faixa de threads. */
export type ItemThread = { id: string; titulo: string; ativo?: boolean; renomeavel?: boolean; excluivel?: boolean };

/** Mantém a seleção e os rascunhos ao trocar de conversa ou reabrir o painel. */
export function useSelecaoThread({ threads, tipo, destinoId, executar }: Propriedades) {
    const chave = `lumon:thread:${tipo}:${destinoId}`;
    const [selecao, setSelecao] = useState(() => localStorage.getItem(chave) ?? threadPrincipal);
    const opcoes = threads.filter((thread) => thread.tipo === tipo && thread.destinoId === destinoId);
    const threadId = opcoes.some((thread) => thread.id === selecao) ? selecao : threadPrincipal;
    const selecionar = (id: string) => {
        localStorage.setItem(chave, id);
        setSelecao(id);
    };
    const criar = async () => {
        const thread: Thread = {
            id: crypto.randomUUID(), titulo: `Conversa ${opcoes.length + 2}`, tipo, destinoId,
            criadaEm: new Date().toISOString(),
        };
        if (!await executar(lumon!.criarThread(thread))) return;
        selecionar(thread.id);
    };
    const renomear = (id: string, titulo: string) => executar(lumon!.renomearThread(id, titulo));
    const excluir = async (id: string) => {
        const operacao = id !== threadPrincipal ? lumon!.excluirThread(id)
            : tipo === 'work' ? lumon!.limparTrabalhos(id, destinoId) : lumon!.limparConversa(destinoId, id);
        if (await executar(operacao) && id === threadId) selecionar(threadPrincipal);
    };
    return { threadId, opcoes, selecionar, criar, renomear, excluir };
}

/** Guarda o texto ainda não enviado separadamente para cada thread. */
export function useRascunho(chave: string): [string, (texto: string) => void] {
    const [valor, setValor] = useState(() => localStorage.getItem(chave) ?? '');
    return [valor, (texto) => {
        localStorage.setItem(chave, texto);
        setValor(texto);
    }];
}

function TituloEditavel({ titulo, aoSalvar, aoCancelar }: {
    titulo: string; aoSalvar: (titulo: string) => void; aoCancelar: () => void;
}) {
    const [valor, setValor] = useState(titulo);
    const finalizar = () => (valor.trim() && valor.trim() !== titulo ? aoSalvar(valor.trim()) : aoCancelar());
    return <input autoFocus aria-label="Título da thread" maxLength={80} value={valor}
        onChange={(evento) => setValor(evento.target.value)} onFocus={(evento) => evento.target.select()}
        onBlur={finalizar} onKeyDown={(evento) => {
            if (evento.key === 'Enter') finalizar();
            if (evento.key === 'Escape') aoCancelar();
        }}
        className="h-7 w-32 rounded-md border border-white/25 bg-black/30 px-2 text-[12px] text-principal outline-none" />;
}

function ConfirmacaoExclusao({ titulo, acao, aoConfirmar, aoCancelar }: {
    titulo: string; acao: string; aoConfirmar: () => void; aoCancelar: () => void;
}) {
    return <span className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#a24e45]/20 pl-2.5 text-[12px]">
        <span className="max-w-28 truncate text-principal">{acao} {titulo}?</span>
        <button autoFocus onClick={aoConfirmar} onKeyDown={(evento) => evento.key === 'Escape' && aoCancelar()}
            className="rounded px-1.5 text-[#eda599] hover:bg-white/5">{acao}</button>
        <button onClick={aoCancelar} className="rounded px-1.5 text-discreto hover:bg-white/5">Cancelar</button>
    </span>;
}

/**
 * Faixa horizontal de threads. Use quando a Diretoria precisa alternar entre conversas paralelas;
 * `aoCriar`, `aoRenomear` e `aoExcluir` são opcionais para listas somente de leitura.
 */
export function FaixaThreads({ itens, selecionado, aoSelecionar, aoCriar, aoRenomear, aoExcluir }: {
    itens: ItemThread[];
    selecionado: string;
    aoSelecionar: (id: string) => void;
    aoCriar?: () => void;
    aoRenomear?: (id: string, titulo: string) => void;
    aoExcluir?: (id: string) => void;
}) {
    const [editando, setEditando] = useState<string | null>(null);
    const [excluindo, setExcluindo] = useState<string | null>(null);
    const faixa = useRef<HTMLDivElement>(null);
    useEffect(() => {
        faixa.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selecionado, itens.length]);
    const renderizar = (item: ItemThread) => {
        const editavel = item.renomeavel === true;
        if (item.id === editando && aoRenomear) {
            return <TituloEditavel key={item.id} titulo={item.titulo} aoCancelar={() => setEditando(null)}
                aoSalvar={(titulo) => { aoRenomear(item.id, titulo); setEditando(null); }} />;
        }
        if (item.id === excluindo && aoExcluir) {
            return <ConfirmacaoExclusao key={item.id} titulo={item.titulo}
                acao={item.id === threadPrincipal ? 'Limpar' : 'Excluir'} aoCancelar={() => setExcluindo(null)}
                aoConfirmar={() => { aoExcluir(item.id); setExcluindo(null); }} />;
        }
        const selecionada = item.id === selecionado;
        return <span key={item.id} className={`group flex h-7 max-w-44 shrink-0 items-center rounded-md transition
            ${selecionada ? 'bg-white/10 text-principal' : 'text-discreto hover:bg-white/5 hover:text-secundario'}`}>
            <button role="tab" aria-selected={selecionada} onClick={() => aoSelecionar(item.id)}
                title={editavel && aoRenomear ? 'Clique duas vezes para renomear' : item.titulo}
                onDoubleClick={() => editavel && aoRenomear && setEditando(item.id)}
                className="flex h-full min-w-0 items-center gap-1.5 px-2.5 text-[12px]">
                {item.ativo && <span aria-label="Em andamento"
                    className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#5fd38a]" />}
                <span className="truncate">{item.titulo}</span>
            </button>
            {item.excluivel && aoExcluir && !item.ativo && <button aria-label={`Excluir ${item.titulo}`}
                title={item.id === threadPrincipal ? 'Limpar conversa' : 'Excluir thread'} onClick={() => setExcluindo(item.id)}
                className="-ml-1.5 mr-1 hidden size-5 shrink-0 items-center justify-center rounded text-discreto
                    group-hover:flex hover:bg-white/10 hover:text-principal"><X size={11} /></button>}
        </span>;
    };
    return <div className="flex shrink-0 items-center gap-1 border-b border-borda px-3 py-2">
        <div ref={faixa} role="tablist" aria-label="Threads"
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
            {itens.map(renderizar)}
        </div>
        {aoCriar && <button aria-label="Nova thread" title="Nova thread" onClick={aoCriar}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-discreto
                hover:bg-white/5 hover:text-principal"><Plus size={14} /></button>}
    </div>;
}

/** Permite criar, selecionar, renomear e excluir conversas sem sair do painel. */
export function SeletorThreads({ selecao, ativos = [] }: {
    selecao: ReturnType<typeof useSelecaoThread>;
    ativos?: string[];
}) {
    const { threadId, opcoes, selecionar, criar, renomear, excluir } = selecao;
    const itens: ItemThread[] = [
        { id: threadPrincipal, titulo: 'Principal', ativo: ativos.includes(threadPrincipal), excluivel: true },
        ...opcoes.map((thread) => ({ id: thread.id, titulo: thread.titulo,
            ativo: ativos.includes(thread.id), renomeavel: true, excluivel: true })),
    ];
    return <FaixaThreads itens={itens} selecionado={threadId} aoSelecionar={selecionar}
        aoCriar={() => void criar()} aoRenomear={(id, titulo) => void renomear(id, titulo)}
        aoExcluir={(id) => void excluir(id)} />;
}

