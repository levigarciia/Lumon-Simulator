import { useState } from 'react';
import type { Funcionario } from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import { nomesProposta, type EstadoSocial } from '../../shared/social';
import { nomeCargo } from '../../shared/cargos';
import { lumon } from '../services/ponte';
import { Botao } from './ui';

/** Mantém decisões manuais na ficha do proponente, sem um histórico paralelo de conversas. */
export function PropostasFuncionario({ id, social, funcionarios, executar }: {
    id: string; social: EstadoSocial; funcionarios: Funcionario[];
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const [confirmando, setConfirmando] = useState<string | null>(null);
    const [pendente, setPendente] = useState(false);
    const propostas = social.propostas.filter((proposta) => proposta.autorId === id && proposta.estado === 'pendente');
    const nome = (pessoaId: string) => funcionarios.find((pessoa) => pessoa.id === pessoaId)?.nome ?? 'Ex funcionário';
    const decidir = async (propostaId: string, aprovar: boolean) => {
        setPendente(true);
        try {
            if (await executar(lumon!.decidirProposta(propostaId, aprovar))) setConfirmando(null);
        } finally { setPendente(false); }
    };
    if (!propostas.length) return null;
    return <section className="space-y-3 border-t border-borda px-5 py-5 text-[12px]">
        {propostas.map((proposta) => <article key={proposta.id} className="space-y-3 rounded-xl border border-borda p-3">
            <p className="font-medium">{nomesProposta[proposta.tipo]}: {nome(proposta.alvoId)}</p>
            <p className="text-secundario">{proposta.motivo}</p>
            {proposta.cargo && <p>Cargo pretendido: {nomeCargo(proposta.cargo)}</p>}
            {proposta.candidatoId && <p>Candidato: {nome(proposta.candidatoId)}</p>}
            <p className="text-discreto">Apoiam: {proposta.apoiadores.map(nome).join(', ')}</p>
            <details className="text-secundario">
                <summary className="cursor-pointer">Evidências citadas</summary>
                {(proposta.registros ?? []).map((evento) => <p key={evento.id} className="mt-2">{evento.texto}</p>)}
            </details>
            {confirmando === proposta.id && <p className="text-[#f0b44c]">
                {proposta.tipo === 'demissao' ? 'Isso encerra o agente e mantém seu histórico.'
                    : proposta.tipo === 'troca_lideranca' ? 'Os dois funcionários trocam de cargo.'
                        : proposta.tipo === 'promocao' ? 'A promoção muda o cargo e conserva 30% do mérito.'
                            : proposta.tipo === 'sala_descanso' ? 'O funcionário será enviado à Sala de Descanso.'
                        : 'Esse funcionário deixará de receber delegações do líder indicado.'}
            </p>}
            <div className="flex flex-wrap gap-2">
                <Botao disabled={pendente} variante={proposta.tipo === 'demissao' ? 'perigo' : 'principal'}
                    onClick={() => confirmando === proposta.id
                        ? void decidir(proposta.id, true) : setConfirmando(proposta.id)}>
                    {confirmando === proposta.id ? 'Confirmar decisão' : 'Aprovar'}
                </Botao>
                <Botao disabled={pendente} onClick={() => void decidir(proposta.id, false)}>Recusar</Botao>
                {confirmando === proposta.id && <Botao disabled={pendente}
                    onClick={() => setConfirmando(null)}>Voltar</Botao>}
            </div>
        </article>)}
    </section>;
}
