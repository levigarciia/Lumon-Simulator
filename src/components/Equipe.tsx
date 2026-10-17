import { RetratoFuncionario } from './RetratoFuncionario';
import { ChatsCircle } from '@phosphor-icons/react';
import { nomeCargo, type Funcionario, type StatusFuncionario } from '../../shared/funcionarios';
import { coresStatus, rotulosStatus } from './PainelFuncionario';

/** Seleção que abre o canal Geral no lugar do painel de um funcionário. */
export const idGeral = 'geral';

type PropriedadesEquipe = {
    funcionarios: Funcionario[];
    status: Record<string, StatusFuncionario>;
    naoLidas: Record<string, number>;
    selecionadoId: string | null;
    aoSelecionar: (id: string) => void;
};

/** Lista compacta da equipe, para achar alguém sem procurar na sala. */
export function Equipe({ funcionarios, status, naoLidas, selecionadoId, aoSelecionar }: PropriedadesEquipe) {
    if (funcionarios.length === 0) return null;
    return (
        <ul className="absolute top-30 bottom-28 left-6 flex w-56 flex-col gap-2 overflow-y-auto pr-2">
            <li>
                <button
                    onClick={() => aoSelecionar(idGeral)}
                    className={`flex w-full items-center gap-3 rounded-2xl border border-borda px-3 py-3 text-left shadow-sm transition hover:translate-x-1 ${selecionadoId === idGeral ? 'bg-[#294943]' : 'bg-superficie hover:bg-[#233d40]' }`}
                >
                    <ChatsCircle size={14} className="shrink-0 text-secundario" />
                    <span className="text-[13px] text-principal">Geral</span>
                </button>
            </li>
            {funcionarios.map((funcionario) => {
                const atual = status[funcionario.id] ?? 'ocioso';
                const novas = naoLidas[funcionario.id] ?? 0;
                return (
                    <li key={funcionario.id}>
                        <button
                            onClick={() => aoSelecionar(funcionario.id)}
                            title={rotulosStatus[atual]}
                            className={`flex w-full items-center gap-3 rounded-2xl border border-borda px-3 py-3 text-left shadow-sm transition hover:translate-x-1 ${funcionario.id === selecionadoId ? 'bg-[#294943]' : 'bg-superficie hover:bg-[#233d40]' }`}
                        >
                            <span className="relative shrink-0">
                                <RetratoFuncionario aparencia={funcionario.aparencia} />
                                <span className={"absolute right-0 bottom-0 size-2.5 rounded-full border border-superficie "
                                    + coresStatus[atual]} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] text-principal">{funcionario.nome}</span>
                                <span className="block truncate text-[11px] text-discreto">
                                    {nomeCargo(funcionario.cargo)}
                                    <span className="block text-[#a8cbb3]">{rotulosStatus[atual]}</span>
                                </span>
                            </span>
                            {novas > 0 && <span aria-label={`${novas} mensagens novas de ${funcionario.nome}`}
                                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full
                                    bg-[#6fa8dc] px-1.5 text-[11px] font-semibold text-fundo">{novas}</span>}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
