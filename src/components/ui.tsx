import { X } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'principal' | 'discreto' | 'perigo';

const variantes: Record<Variante, string> = {
    principal: 'bg-[#b3ceba] text-[#132c27] hover:bg-[#c8dfcc]',
    discreto: 'border border-borda text-secundario hover:bg-white/5 hover:text-principal',
    perigo: 'bg-[#a24e45] text-white hover:bg-[#8a4039]',
};

export function Botao({
    variante = 'discreto',
    className = '',
    ...propriedades
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
    return (
        <button
            {...propriedades}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-40 ${variantes[variante]} ${className}`}
        />
    );
}

/** Janela modal centralizada, fechada pelo botão do canto ou clicando fora. */
export function Janela({ titulo, aoFechar, children, largura = 'w-[560px]' }: {
    titulo: string;
    aoFechar: () => void;
    children: ReactNode;
    largura?: string;
}) {
    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" onClick={aoFechar}>
            <section
                className={`${largura} max-h-[86vh] overflow-hidden rounded-2xl border border-borda bg-superficie shadow-2xl flex flex-col`}
                onClick={(evento) => evento.stopPropagation()}
            >
                <header className="flex h-12 shrink-0 items-center justify-between border-b border-borda px-5">
                    <h2 className="text-[14px] font-medium tracking-wide text-principal">{titulo}</h2>
                    <button onClick={aoFechar} className="rounded p-1 text-discreto hover:text-principal" aria-label="Fechar">
                        <X size={16} />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            </section>
        </div>
    );
}

/** Seletor de cores em amostras redondas. */
export function Amostras({ cores, valor, aoMudar }: { cores: string[]; valor: string; aoMudar: (cor: string) => void }) {
    return (
        <div className="flex gap-2">
            {cores.map((cor) => (
                <button
                    key={cor}
                    onClick={() => aoMudar(cor)}
                    aria-label={cor}
                    style={{ backgroundColor: cor }}
                    className={`size-7 rounded-full border-2 ${cor === valor ? 'border-principal' : 'border-transparent'}`}
                />
            ))}
        </div>
    );
}

/** Grupo de opções exclusivas apresentadas lado a lado. */
export function Segmentos<Chave extends string>({ opcoes, valor, aoMudar }: {
    opcoes: Record<Chave, string>;
    valor: Chave;
    aoMudar: (chave: Chave) => void;
}) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {(Object.entries(opcoes) as [Chave, string][]).map(([chave, rotulo]) => (
                <button
                    key={chave}
                    onClick={() => aoMudar(chave)}
                    className={`h-8 rounded-md px-3 text-[12px] ${chave === valor ? 'bg-principal text-fundo' : 'border border-borda text-secundario hover:text-principal'}`}
                >
                    {rotulo}
                </button>
            ))}
        </div>
    );
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.08em] text-discreto uppercase">{rotulo}</span>
            {children}
        </label>
    );
}

export const classeEntrada =
    'h-9 rounded-md border border-borda bg-black/20 px-3 text-[13px] text-principal outline-none focus:border-white/25';
