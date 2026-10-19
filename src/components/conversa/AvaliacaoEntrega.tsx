import { useState } from 'react';
import type { Resultado } from '../../../shared/ponte';
import type { RegistroTrabalho } from '../../../shared/trabalho';
import { lumon } from '../../services/ponte';
import { Botao, classeEntrada } from '../ui';

const rotulos = {
    pendente: 'Validação pendente', aguardando_aprovacao: 'Aguardando sua aprovação',
    aprovada: 'Entrega aprovada', rejeitada: 'Correção solicitada', reprovada: 'Trabalho rejeitado',
};

/** Mostra evidências e permite decidir sobre uma entrega principal encerrada. */
export function AvaliacaoEntrega({ trabalho, ocupado, executar }: {
    trabalho: RegistroTrabalho;
    ocupado: boolean;
    executar?: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const [decisao, setDecisao] = useState<'correcao' | 'rejeicao' | null>(null);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const avaliacao = trabalho.avaliacao;
    if (!avaliacao || trabalho.solicitante?.id || ['trabalhando', 'pausado'].includes(trabalho.estado)) return null;
    const decidida = ['aprovada', 'rejeitada', 'reprovada'].includes(avaliacao.estado);
    const decidir = async (operacao: () => Promise<Resultado>) => {
        if (!executar || enviando) return;
        setEnviando(true);
        try {
            if (await executar(operacao())) setDecisao(null);
        } finally { setEnviando(false); }
    };
    return <div className="mt-3 flex flex-col gap-3 border-t border-borda pt-3" aria-label="Avaliação da entrega">
        <p className="text-[12px] font-medium text-secundario">{rotulos[avaliacao.estado]}
            {avaliacao.recompensa > 0 && `: ${avaliacao.recompensa} moedas`}</p>
        {trabalho.origemCorrecaoId && <p className="text-[11px] text-discreto">Revisão de uma entrega anterior</p>}
        {avaliacao.validacao && <details className="text-[12px] text-secundario">
            <summary className="cursor-pointer">Critérios e evidências</summary>
            <p className="mt-2 whitespace-pre-wrap">{avaliacao.validacao.resumo}</p>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-4">
                {avaliacao.validacao.criterios.map((item, indice) => <li key={indice}>
                    <strong>{item.criterio}</strong>: {item.estado === 'verificado' ? 'Verificado'
                        : item.estado === 'falhou' ? 'Falhou' : 'Pendente'}
                    <p className="mt-1 whitespace-pre-wrap text-discreto">{item.evidencia}</p>
                </li>)}
            </ul>
        </details>}
        {avaliacao.motivo && <p className="text-[12px] whitespace-pre-wrap text-discreto">{avaliacao.motivo}</p>}
        {!decidida && executar && <>
            <div className="flex flex-wrap gap-2">
                <Botao variante="principal" disabled={ocupado || enviando || trabalho.estado !== 'concluido'
                    || avaliacao.estado !== 'aguardando_aprovacao'}
                    onClick={() => void decidir(() => lumon!.aprovarEntrega(trabalho.id))}>Aprovar entrega</Botao>
                <Botao disabled={ocupado || enviando}
                    onClick={() => setDecisao(decisao === 'correcao' ? null : 'correcao')}>Pedir correção</Botao>
                <Botao variante="perigo" disabled={ocupado || enviando}
                    onClick={() => setDecisao(decisao === 'rejeicao' ? null : 'rejeicao')}>Rejeitar trabalho</Botao>
            </div>
            {decisao && <form className="flex flex-col gap-2" onSubmit={(evento) => {
                evento.preventDefault();
                void decidir(() => decisao === 'rejeicao' ? lumon!.rejeitarEntrega(trabalho.id, motivo)
                    : lumon!.corrigirEntrega(trabalho.id, motivo));
            }}>
                <textarea aria-label={decisao === 'rejeicao' ? 'Motivo da rejeição' : 'O que precisa ser corrigido'}
                    value={motivo} maxLength={2000} required
                    onChange={(evento) => setMotivo(evento.target.value)}
                    placeholder={decisao === 'rejeicao' ? 'Por que o trabalho foi rejeitado?'
                        : 'Explique o que falta ou precisa mudar'}
                    className={`${classeEntrada} h-24 resize-none py-2`} />
                <Botao type="submit" variante={decisao === 'rejeicao' ? 'perigo' : undefined}
                    disabled={enviando || ocupado || !motivo.trim()}>
                    {decisao === 'rejeicao' ? 'Confirmar rejeição' : 'Enviar correção'}
                </Botao>
            </form>}
        </>}
    </div>;
}
