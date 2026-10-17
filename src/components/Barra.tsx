import { ClockCounterClockwise, GearSix, PencilSimple, Storefront, UserPlus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { catalogo } from '../../shared/escritorio';
import { fracaoRevenda } from '../../shared/estado';
import type { Modo } from '../store/modo';
import { Botao } from './ui';
import { EstadoMotorLocal } from './EstadoMotorLocal';

export type JanelaAberta = 'contratar' | 'editar' | 'loja' | 'historico' | 'preferencias';

function Tecla({ children }: { children: ReactNode }) {
    return <kbd className="rounded border border-borda px-1.5 py-0.5 font-mono text-[11px] text-secundario">{children}</kbd>;
}

function Dicas({ modo, aoVender }: { modo: Modo; aoVender: () => void }) {
    if (modo.tipo === 'editar') {
        return <span className="text-[12px] text-secundario">Clique em um móvel para mover ou vender.</span>;
    }
    if (modo.tipo !== 'posicionar') return null;
    return (
        <span className="flex items-center gap-3 text-[12px] text-secundario">
            {catalogo[modo.item].nome}
            <Tecla>R</Tecla> gira
            <Tecla>Esc</Tecla> cancela
            {modo.itemId && (
                <Botao variante="perigo" className="h-7 px-2 text-[12px]" onClick={aoVender}>
                    Vender por {Math.floor(catalogo[modo.item].preco * fracaoRevenda)}
                </Botao>
            )}
        </span>
    );
}

type PropriedadesBarra = {
    modo: Modo;
    aoAbrir: (janela: JanelaAberta) => void;
    aoAlternarEdicao: () => void;
    aoVender: () => void;
};

/** Ações da Diretoria na base da tela, com as dicas do modo de edição logo acima. */
export function Barra({ modo, aoAbrir, aoAlternarEdicao, aoVender }: PropriedadesBarra) {
    const editando = modo.tipo !== 'normal';
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-3">
            <EstadoMotorLocal />
            <div className="pointer-events-auto">
                <Dicas modo={modo} aoVender={aoVender} />
            </div>
            <nav className="pointer-events-auto flex gap-1 rounded-2xl border border-borda bg-superficie/95 p-1.5 shadow-xl">
                <Botao title="Configurações" aria-label="Configurações" className="size-11 border-0 px-0!"
                    onClick={() => aoAbrir('preferencias')}><GearSix size={21} /></Botao>
                <Botao className="group relative size-11 border-0 px-0! [&>svg]:shrink-0" onClick={() => aoAbrir('contratar')}>
                    <UserPlus size={21} /><span className="sr-only">Contratar</span>
                    <span className="pointer-events-none absolute bottom-14 rounded-lg bg-superficie px-3 py-1.5
                        text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                        Contratar
                    </span>
                </Botao>
                <Botao className="group relative size-11 border-0 px-0! [&>svg]:shrink-0" onClick={() => aoAbrir('loja')}>
                    <Storefront size={21} /><span className="sr-only">Loja</span>
                    <span className="pointer-events-none absolute bottom-14 rounded-lg bg-superficie px-3 py-1.5
                        text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                        Loja
                    </span>
                </Botao>
                <Botao title="Decorar sala" aria-label="Decorar sala" className="group relative size-11 border-0 px-0! [&>svg]:shrink-0" variante={editando ? 'principal' : 'discreto'} onClick={aoAlternarEdicao}>
                    <PencilSimple size={21} /><span className="sr-only">Decorar</span>
                    <span className="pointer-events-none absolute bottom-14 rounded-lg bg-superficie px-3 py-1.5
                        text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                        Decorar
                    </span>
                </Botao>
                <Botao className="group relative size-11 border-0 px-0! [&>svg]:shrink-0" onClick={() => aoAbrir('historico')}>
                    <ClockCounterClockwise size={21} /><span className="sr-only">Histórico</span>
                    <span className="pointer-events-none absolute bottom-14 rounded-lg bg-superficie px-3 py-1.5
                        text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                        Histórico
                    </span>
                </Botao>
            </nav>
        </div>
    );
}
