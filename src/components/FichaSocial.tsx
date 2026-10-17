import { nomeDoFuncionario, type Demissao, type Funcionario } from '../../shared/funcionarios';
import type { EstadoSocial } from '../../shared/social';
import { statusRelacao } from '../../shared/relacoes';

const interesses = {
    qualidade: 'Qualidade', reconhecimento: 'Reconhecimento', lideranca: 'Liderança',
    estabilidade: 'Estabilidade', amizades: 'Amizades',
};
/** Mostra à Diretoria a personalidade e as opiniões privadas de um funcionário. */
export function FichaSocial({ id, social, funcionarios, demissoes }: {
    id: string; social: EstadoSocial; funcionarios: Funcionario[]; demissoes: Demissao[];
}) {
    const personalidade = social.personalidades[id];
    const relacoes = social.relacoes.filter((item) => item.autorId === id);
    const intencoes = social.intencoes.filter((item) => item.autorId === id).slice(-6).reverse();
    const nome = (colegaId: string) => nomeDoFuncionario(colegaId, funcionarios, demissoes);
    return (
        <section className="space-y-4 border-t border-borda px-5 py-5 text-[12px]">
            {personalidade && <>
                <p className="text-secundario">Interesse: {interesses[personalidade.interesse]}</p>
                <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                    {([
                        ['Orgulho', personalidade.orgulho], ['Ambição', personalidade.ambicao],
                        ['Empatia', personalidade.empatia], ['Autoritarismo', personalidade.autoritarismo],
                        ['Tolerância', personalidade.tolerancia], ['Lealdade a Kier', personalidade.lealdade ?? 50],
                    ] as const).map(([rotulo, valor]) => <div key={rotulo} className="flex justify-between gap-3">
                        <span className="text-discreto">{rotulo}</span><span>{valor}</span>
                    </div>)}
                </div>
            </>}
            <details>
                <summary className="cursor-pointer text-secundario">
                    Como enxerga os colegas ({relacoes.length})
                </summary>
                <p className="my-3 text-[11px] text-discreto">Estas impressões são privadas e podem ser diferentes
                    das opiniões que os colegas têm sobre ele.</p>
                {relacoes.map((relacao) => <div key={relacao.colegaId}
                    className="my-2 rounded-xl border border-borda p-3">
                    <p className="mb-2 text-principal">{nome(relacao.colegaId)}</p>
                    <p className="mb-2 text-secundario">{statusRelacao(relacao)}</p>
                    <p className="text-discreto">Confiança {relacao.confianca} · Respeito {relacao.respeito}</p>
                    <p className="text-discreto">
                        Afinidade {relacao.afinidade} · Ressentimento {relacao.ressentimento}
                    </p>
                    {!!relacao.marcadores?.length && <div className="mt-2 flex flex-wrap gap-1">
                        {relacao.marcadores.map((marcador) => <span key={marcador.rotulo}
                            className={`rounded-md px-2 py-0.5 text-[10px] ${marcador.tipo === 'positivo'
                                ? 'bg-[#244537] text-[#b5d5bd]' : 'bg-[#51302e] text-[#e1b4ab]'}`}>
                            {marcador.rotulo}
                        </span>)}
                    </div>}
                </div>)}
            </details>
            {intencoes.length > 0 && <details>
                <summary className="cursor-pointer text-secundario">Compromissos privados</summary>
                {intencoes.map((item) => <div key={item.id} className="mt-2 rounded-xl border border-borda p-3">
                    <p>{item.objetivo === 'reconciliar' ? 'Reconciliação' : item.objetivo === 'conversar'
                        ? 'Conversa' : item.objetivo === 'defender' ? 'Defesa' : 'Reconhecimento'}: {nome(item.colegaId)}</p>
                    <p className="mt-1 text-discreto">{item.motivo}</p>
                    <p className="mt-1 text-discreto">{item.estado === 'cumprida' ? 'Cumprido por ação registrada'
                        : item.estado === 'cancelada' ? 'Cancelado' : 'Pendente'}</p>
                </div>)}
            </details>}
        </section>
    );
}

