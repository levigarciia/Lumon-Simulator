import { Stop } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { Aprovacao, Funcionario } from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import { threadPrincipal } from '../../shared/threads';
import type { RegistroTrabalho } from '../../shared/trabalho';
import { lumon } from '../services/ponte';
import { HistoricoArquivos } from './refinamento/HistoricoArquivos';
import { Aprovacoes } from './PainelFuncionario';
import { Botao, classeEntrada } from './ui';
import { cotaAtual, prepararTerminal, type CotaDepartamento } from '../../shared/departamento';
import type { ArquivoRefinamento } from '../../shared/refinamento';
import { TerminalMacrodados } from './refinamento/TerminalMacrodados';
import { CotaDoDepartamento, DoutrinaDepartamento } from './refinamento/DoutrinaDepartamento';

type PropriedadesWork = {
    funcionarios: Funcionario[];
    trabalhos: RegistroTrabalho[];
    aprovacoes: Aprovacao[];
    refinamentos: Record<string, ArquivoRefinamento>;
    cota: CotaDepartamento;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
};

/** Acompanha o refinamento simulado, desde a abertura do arquivo até a avaliação da Diretoria. */
export function PainelWork({ funcionarios, trabalhos, aprovacoes, executar, refinamentos, cota }: PropriedadesWork) {
    const [minutos, setMinutos] = useState(5);
    const [iniciando, setIniciando] = useState(false);
    const [aba, setAba] = useState<'terminal' | 'historico'>('terminal');
    const [, atualizarDia] = useState(0);
    useEffect(() => {
        const intervalo = setInterval(() => atualizarDia((valor) => valor + 1), 60000);
        return () => clearInterval(intervalo);
    }, []);
    const cotaDoDia = cotaAtual(cota);
    const simulacoes = trabalhos.filter((trabalho) => trabalho.arquivoId);
    const ativos = simulacoes.filter((trabalho) => trabalho.estado === 'trabalhando');
    const temLider = funcionarios.some((pessoa) => pessoa.cargo === 'lider');
    const ocupado = ativos.length > 0;
    const trabalhoAtual = ativos.at(-1) ?? simulacoes.at(-1);
    const arquivo = trabalhoAtual?.arquivoId ? refinamentos[trabalhoAtual.arquivoId] : undefined;
    const iniciar = async () => {
        if (iniciando || ocupado || !temLider) return;
        setIniciando(true);
        try {
            if (await executar(lumon!.iniciarRefinamento(minutos))) setAba('terminal');
        } finally {
            setIniciando(false);
        }
    };
    const interromper = () => {
        const pedidos = new Map(ativos.map((trabalho) => [trabalho.pedidoId, trabalho]));
        for (const trabalho of pedidos.values()) {
            void lumon!.interromperTrabalho(trabalho.threadId ?? threadPrincipal, trabalho.projetoId);
        }
    };
    return <>
        <div className="flex shrink-0 flex-col gap-3 border-b border-borda p-4">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-principal">Macrodados</span>
                <span role="status" className="text-[11px] text-discreto">
                    {ocupado ? 'Refinamento em andamento' : arquivo ? 'Arquivo encerrado' : 'Aguardando arquivo'}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[12px] text-secundario">
                    Duração
                    <select aria-label="Duração do refinamento" value={minutos} disabled={iniciando || ocupado}
                        onChange={(evento) => setMinutos(Number(evento.target.value))} className={classeEntrada}>
                        {[1, 5, 15, 30, 60].map((valor) => <option key={valor} value={valor}>{valor} min</option>)}
                    </select>
                </label>
                {ocupado ? <Botao variante="perigo" onClick={interromper}>
                    <Stop size={14} weight="fill" /> Interromper refinamento
                </Botao> : <Botao variante="principal" disabled={iniciando || !temLider}
                    onClick={() => void iniciar()}>{iniciando ? 'Iniciando...' : 'Iniciar macrodados'}</Botao>}
            </div>
            {!temLider && <p className="text-[12px] text-[#e5c587]">
                Defina um líder para coordenar o refinamento.
            </p>}
            <CotaDoDepartamento cota={cotaDoDia} />
        </div>
        <div role="tablist" aria-label="Macrodados" className="flex shrink-0 gap-4 border-b border-borda px-4">
            {(['terminal', 'historico'] as const).map((item) => <button key={item} role="tab"
                aria-selected={aba === item} onClick={() => setAba(item)}
                className={`border-b-2 py-2 text-[12px] ${aba === item
                    ? 'border-[#b3ceba] text-principal' : 'border-transparent text-discreto'}`}>
                {item === 'terminal' ? 'Terminal' : 'Histórico'}
            </button>)}
        </div>
        {aba === 'terminal' ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <TerminalMacrodados arquivo={arquivo ? prepararTerminal(arquivo) : undefined}
                ativo={ocupado} funcionarios={funcionarios} />
            <DoutrinaDepartamento cota={cotaDoDia} trabalhando={ocupado} />
            {simulacoes.some((item) => item.avaliacao?.estado === 'aguardando_aprovacao') && <Botao
                onClick={() => setAba('historico')}>Avaliar entrega no histórico</Botao>}
        </div> : <HistoricoArquivos trabalhos={simulacoes} refinamentos={refinamentos}
            funcionarios={funcionarios} executar={executar} />}
        <Aprovacoes aprovacoes={aprovacoes.filter((aprovacao) =>
            ativos.some((trabalho) => trabalho.funcionarioId === aprovacao.funcionarioId))} />
    </>;
}
