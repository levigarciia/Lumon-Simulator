import { useEffect, useState } from 'react';
import type { Funcionario } from '../../../shared/funcionarios';
import type { TerminalRefinamento } from '../../../shared/departamento';
import { nomesTemperamento, temperamentos } from '../../../shared/refinamento';
import './terminal.css';

const resultados = {
    aceito: 'Grupo aceito', temperamento_incorreto: 'Caixa incorreta', rejeitado: 'Seleção não reconhecida',
};

/** Observa as seleções dos agentes e os grupos aceitos, sem oferecer acesso ao gabarito. */
export function TerminalMacrodados({ arquivo, ativo, funcionarios }: {
    arquivo?: TerminalRefinamento; ativo: boolean; funcionarios: Funcionario[];
}) {
    const [agora, setAgora] = useState(Date.now);
    useEffect(() => {
        const intervalo = setInterval(() => setAgora(Date.now()), 1000);
        return () => clearInterval(intervalo);
    }, []);
    if (!arquivo) return <div className="terminal-macrodados flex min-h-64 flex-col items-center justify-center p-6">
        <span className="mb-4 text-[11px] tracking-[0.3em]">LUMON INDUSTRIES</span>
        <p className="text-[14px]">Nenhum arquivo carregado</p>
        <p className="mt-2 text-center text-[12px] opacity-70">Inicie o refinamento para acompanhar sua equipe.</p>
    </div>;
    const segundos = Math.max(0, Math.ceil((Date.parse(arquivo.prazo) - agora) / 1000));
    const tempo = `${Math.floor(segundos / 60).toString().padStart(2, '0')}:${(segundos % 60)
        .toString().padStart(2, '0')}`;
    const refinadas = new Set(arquivo.celulasRefinadas);
    const envio = arquivo.ultimoEnvio;
    const selecionadas = new Set(envio?.celulas);
    const progresso = arquivo.total ? Math.round(arquivo.refinados / arquivo.total * 100) : 0;
    const autor = funcionarios.find((pessoa) => pessoa.id === envio?.funcionarioId)?.nome ?? 'Funcionário';
    return <section className="terminal-macrodados p-3" aria-label="Terminal de Macrodados">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-current/25 pb-2 text-[11px]">
            <strong className="truncate text-[13px]">{arquivo.nome}</strong>
            <span>{ativo ? segundos ? tempo : 'Prazo encerrado' : 'Sessão encerrada'}</span>
        </div>
        <div className="grid grid-cols-10 gap-y-1" aria-label="Grade numérica">
            {arquivo.grade.flatMap((linha, l) => linha.map((digito, c) => {
                const celula = `${String.fromCharCode(65 + l)}${c + 1}`;
                const selecionada = selecionadas.has(celula);
                const refinada = refinadas.has(celula);
                return <span key={celula} data-celula={celula} data-selecionada={selecionada}
                    data-refinada={refinada} title={`${celula}${refinada ? ': refinada' : ''}`}
                    aria-label={`${celula}: ${refinada ? 'refinada' : digito}`}
                    className={`terminal-celula ${selecionada ? 'terminal-selecao' : ''}
                        ${refinada ? 'terminal-refinada' : ''}`}>
                    {refinada ? '·' : digito}
                </span>;
            }))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px]">
            <span>Refinamento</span><span>{progresso}%</span>
        </div>
        <progress aria-label="Progresso do arquivo" max={arquivo.total} value={arquivo.refinados}
            className="terminal-progresso mt-1 h-1 w-full" />
        <div className="mt-3 grid grid-cols-4 gap-2">
            {temperamentos.map((temperamento, indice) => {
                const selecionada = envio?.temperamento === temperamento;
                const quantidade = arquivo.caixas.filter((caixa) => caixa === temperamento).length;
                return <div key={temperamento} data-caixa={temperamento} data-selecionada={selecionada}
                    className={`border p-2 text-center ${selecionada ? 'bg-[#a5d8dc]/15' : 'border-current/25'}`}>
                    <div className="text-[10px] opacity-60">0{indice + 1}</div>
                    <div className="mt-1 text-[10px]">{nomesTemperamento[temperamento]}</div>
                    <div className="mt-1 text-[12px]">{quantidade}</div>
                </div>;
            })}
        </div>
        <p role="status" className="mt-3 min-h-8 text-[11px] leading-relaxed opacity-80">
            {envio ? `${autor}: ${envio.celulas.join(', ')}. ${resultados[envio.resultado]}.`
                : 'Aguardando a primeira seleção da equipe.'}
        </p>
    </section>;
}
