import { Coins } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

const formatoData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const formatoHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Exibe a data e a hora locais do computador, independentemente do tempo da simulação. */
export function Relogio({ moedas }: { moedas: number }) {
    const [agora, setAgora] = useState(() => new Date());
    useEffect(() => {
        const atualizar = () => setAgora(new Date());
        const temporizador = setInterval(atualizar, 1000);
        window.addEventListener('focus', atualizar);
        return () => {
            clearInterval(temporizador);
            window.removeEventListener('focus', atualizar);
        };
    }, []);
    return (
        <div className="pointer-events-none absolute top-12 left-6 flex items-center rounded-2xl border border-borda
            bg-superficie px-5 py-3 text-[13px] text-secundario shadow-lg tabular-nums">
            <span className="mr-4 text-[11px] font-semibold tracking-[0.22em] text-principal">LUMON</span>
            <time dateTime={agora.toISOString()} className="flex items-center gap-3">
                <span>{formatoData.format(agora)}</span>
                <span className="border-l border-borda pl-3">{formatoHora.format(agora)}</span>
            </time>
            <span className="ml-3 flex items-center gap-1.5 border-l border-borda pl-3 text-principal">
                <Coins size={14} /> {moedas}
            </span>
        </div>
    );
}
