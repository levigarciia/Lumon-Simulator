import type { ImpactoRelacao } from '../../../shared/social';

const nomesEixos = {
    confianca: 'Confiança', afinidade: 'Afinidade', respeito: 'Respeito', ressentimento: 'Ressentimento',
};

/** Exibe consequências sociais apenas para o jogador, separadas das falas dos personagens. */
export function ImpactosRelacao({ impactos, nome }: {
    impactos: ImpactoRelacao[]; nome: (id: string) => string;
}) {
    if (!impactos.length) return null;
    return <div className="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Mudanças nas relações">
        {impactos.map((impacto) => <details key={`${impacto.eventoId}:${impacto.autorId}:${impacto.colegaId}`}
            className={`rounded-lg border px-2 py-1 text-[11px] ${impacto.tipo === 'positivo'
                ? 'border-[#729c80]/40 bg-[#244537]/40 text-[#b5d5bd]'
                : 'border-[#bc8277]/40 bg-[#51302e]/35 text-[#e1b4ab]'}`}>
            <summary className="cursor-pointer">
                {nome(impacto.autorId)} com {nome(impacto.colegaId)}: {impacto.rotulo}
            </summary>
            <div className="mt-1 space-y-0.5 border-t border-current/20 pt-1">
                <p>{impacto.tipo === 'positivo' ? 'Efeito positivo' : 'Efeito negativo'}</p>
                {impacto.mudancas.map((mudanca) => <p key={mudanca.eixo}>
                    {nomesEixos[mudanca.eixo]}: {mudanca.anterior} para {mudanca.atual}
                </p>)}
                {!impacto.mudancas.length && <p>Impressão registrada; valores já estabilizados.</p>}
            </div>
        </details>)}
    </div>;
}
