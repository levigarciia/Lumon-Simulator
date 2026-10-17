import { cotaAtual, comunicadoDiretoria, metaDiaria, type CotaDepartamento } from '../../../shared/departamento';

/** Mantém a meta coletiva visível durante o acompanhamento e a avaliação dos arquivos. */
export function CotaDoDepartamento({ cota }: { cota: CotaDepartamento }) {
    const atual = cotaAtual(cota);
    const percentual = Math.min(100, Math.round(atual.grupos / metaDiaria * 100));
    return <section aria-label="Cota do departamento">
        <div className="flex items-center justify-between gap-2 text-[12px] text-secundario">
            <span>Cota diária</span>
            <strong>{atual.grupos}/{metaDiaria} grupos aprovados</strong>
        </div>
        <progress aria-label="Progresso da cota diária" max={metaDiaria} value={Math.min(metaDiaria, atual.grupos)}
            className="mt-2 h-1 w-full accent-[#b3ceba]" />
        <div className="mt-1 flex justify-between text-[10px] text-discreto">
            <span>Equipe de Macrodados</span><span>{percentual}%</span>
        </div>
        {!atual.primeiraMetaEm && <p className="mt-3 text-[12px] text-discreto">
            Estabeleça o escritório no seu ritmo. Visitas, auditorias e avarias começam após a primeira cota cumprida.
            O desgaste de cada necessidade começa quando você compra um móvel para recuperá-la.
        </p>}
    </section>;
}

/** Apresenta comunicados da Diretoria e o manual ficcional do departamento. */
export function DoutrinaDepartamento({ cota, trabalhando }: { cota: CotaDepartamento; trabalhando: boolean }) {
    return <section aria-label="Comunicado da Diretoria" className="border border-borda bg-fundo/30 p-3">
        <div className="flex items-start gap-3">
            <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center border
                border-[#b3ceba]/40 font-serif text-2xl text-[#b3ceba]">K</div>
            <div>
                <p className="text-[10px] tracking-widest text-discreto">DIRETORIA</p>
                <p className="mt-1 font-serif text-[14px] leading-relaxed text-secundario">
                    {comunicadoDiretoria(cotaAtual(cota), trabalhando)}
                </p>
            </div>
        </div>
        <details className="mt-3 text-[11px] text-discreto">
            <summary className="cursor-pointer">Manual do departamento</summary>
            <p className="mt-2 leading-relaxed">Honre Kier pela atenção. Preserve a harmonia entre colegas.
                Submeta cada entrega à Diretoria. Só grupos de arquivos aprovados integram a cota,
                contados uma vez por arquivo. A cota recomeça a cada dia do calendário local.</p>
            <p className="mt-2 font-serif italic text-secundario">Que seu zelo encontre propósito nos números.</p>
        </details>
    </section>;
}
