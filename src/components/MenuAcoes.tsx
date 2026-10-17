import { DotsThree } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

type Acao = { nome: string; executar: () => void; perigo?: boolean; desabilitada?: boolean };

/** Agrupa ações secundárias num menu fechado por clique externo ou Escape. */
export function MenuAcoes({ acoes }: { acoes: Acao[] }) {
    const [aberto, setAberto] = useState(false);
    const raiz = useRef<HTMLDivElement>(null);
    const botao = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!aberto) return;
        const fechar = (evento: PointerEvent) => {
            if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
        };
        const teclar = (evento: KeyboardEvent) => {
            if (evento.key !== 'Escape') return;
            setAberto(false);
            botao.current?.focus();
        };
        document.addEventListener('pointerdown', fechar);
        document.addEventListener('keydown', teclar);
        return () => {
            document.removeEventListener('pointerdown', fechar);
            document.removeEventListener('keydown', teclar);
        };
    }, [aberto]);
    return (
        <div ref={raiz} className="relative">
            <button ref={botao} aria-label="Mais opções" aria-haspopup="menu" aria-expanded={aberto}
                onClick={() => setAberto(!aberto)} className="flex size-8 items-center justify-center rounded-lg
                    text-secundario hover:bg-white/5">
                <DotsThree size={23} weight="bold" />
            </button>
            {aberto && (
                <div role="menu" className="absolute top-10 right-0 z-30 min-w-40 rounded-xl border border-borda
                    bg-superficie p-1.5 shadow-2xl">
                    {acoes.map((acao) => (
                        <button key={acao.nome} role="menuitem" disabled={acao.desabilitada}
                            onClick={() => { setAberto(false); acao.executar(); }}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-[13px]
                                hover:bg-white/5 disabled:opacity-40 ${acao.perigo ? 'text-[#eda599]' : 'text-principal'}`}>
                            {acao.nome}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
