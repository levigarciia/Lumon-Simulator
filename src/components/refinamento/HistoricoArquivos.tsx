import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import type { Funcionario } from '../../../shared/funcionarios';
import type { Resultado } from '../../../shared/ponte';
import type { ArquivoRefinamento } from '../../../shared/refinamento';
import type { RegistroTrabalho } from '../../../shared/trabalho';
import { lumon } from '../../services/ponte';
import { HistoricoWork } from '../conversa/HistoricoWork';
import { classeEntrada } from '../ui';

type ArquivoDoWork = { id: string; rotulo: string; trabalhos: RegistroTrabalho[] };

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function agruparPorArquivo(trabalhos: RegistroTrabalho[], refinamentos: Record<string, ArquivoRefinamento>) {
    const grupos = new Map<string, RegistroTrabalho[]>();
    for (const trabalho of trabalhos) {
        if (!trabalho.arquivoId) continue;
        grupos.set(trabalho.arquivoId, [...grupos.get(trabalho.arquivoId) ?? [], trabalho]);
    }
    return [...grupos].map(([id, itens]): ArquivoDoWork => ({ id, trabalhos: itens,
        rotulo: `${refinamentos[id]?.nome ?? 'Arquivo'} · ${formatoData.format(new Date(itens[0]!.criadoEm))}` }))
        .reverse();
}

/** Histórico do Work separado por arquivo de Macrodados, com exclusão definitiva de um arquivo ou de todos. */
export function HistoricoArquivos({ trabalhos, refinamentos, funcionarios, executar }: {
    trabalhos: RegistroTrabalho[];
    refinamentos: Record<string, ArquivoRefinamento>;
    funcionarios: Funcionario[];
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
    const [confirmando, setConfirmando] = useState<'arquivo' | 'todos' | null>(null);
    const [excluindo, setExcluindo] = useState(false);
    const arquivos = agruparPorArquivo(trabalhos, refinamentos);
    const escolhido = arquivos.find((arquivo) => arquivo.id === escolhidoId) ?? arquivos[0];
    const emAndamento = (lista: RegistroTrabalho[]) => lista.some((item) => item.estado === 'trabalhando');
    const bloqueado = confirmando === 'todos' ? emAndamento(trabalhos)
        : !!escolhido && emAndamento(escolhido.trabalhos);
    const excluir = async () => {
        if (!lumon || excluindo || !confirmando) return;
        setExcluindo(true);
        try {
            const alvo = confirmando === 'arquivo' ? escolhido?.id : undefined;
            if (await executar(lumon.excluirArquivoWork(alvo))) {
                setEscolhidoId(null);
                setConfirmando(null);
            }
        } finally { setExcluindo(false); }
    };
    return <div className="flex min-h-0 flex-1 flex-col">
        {arquivos.length > 0 && <div className="flex shrink-0 items-center gap-2 border-b border-borda px-4 py-2">
            <select aria-label="Arquivo do histórico" value={escolhido?.id}
                className={`${classeEntrada} min-w-0 flex-1`}
                onChange={(evento) => { setEscolhidoId(evento.target.value); setConfirmando(null); }}>
                {arquivos.map((arquivo) => <option key={arquivo.id} value={arquivo.id}>{arquivo.rotulo}</option>)}
            </select>
            <button aria-label="Excluir arquivo" title="Excluir arquivo" disabled={excluindo}
                onClick={() => setConfirmando('arquivo')} className="p-1 text-discreto hover:text-red-300">
                <Trash size={16} />
            </button>
            <button disabled={excluindo} onClick={() => setConfirmando('todos')}
                className="shrink-0 text-[12px] text-secundario hover:text-red-300">Limpar tudo</button>
        </div>}
        {confirmando && <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-borda px-4 py-2
            text-[12px]">
            <span className="text-secundario">{bloqueado ? 'Interrompa o refinamento antes de excluir.'
                : confirmando === 'todos' ? `Excluir definitivamente os ${arquivos.length} arquivos do Work?`
                    : 'Excluir definitivamente este arquivo e suas mensagens?'}</span>
            {!bloqueado && <button disabled={excluindo} onClick={() => void excluir()}
                className="text-red-300 disabled:opacity-50">{excluindo ? 'Excluindo' : 'Excluir definitivamente'}</button>}
            <button disabled={excluindo} onClick={() => setConfirmando(null)} className="text-secundario">Cancelar</button>
        </div>}
        <HistoricoWork trabalhos={escolhido?.trabalhos ?? []} funcionarios={funcionarios} executar={executar}
            mensagemVazia="Escolha a duração e inicie um arquivo para a equipe refinar." />
    </div>;
}
