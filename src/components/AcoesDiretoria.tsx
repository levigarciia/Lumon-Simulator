import { useState } from 'react';
import type { Funcionario } from '../../shared/funcionarios';
import { incentivos, tiposIncentivo, type TipoIncentivo } from '../../shared/incentivos';
import type { Resultado } from '../../shared/ponte';
import { lumon } from '../services/ponte';
import { Botao, classeEntrada, Segmentos } from './ui';

export type DecisaoDiretoria = 'sala_descanso' | 'incentivo';

type Propriedades = {
    decisao: DecisaoDiretoria;
    funcionario: Funcionario;
    moedas: number;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
    aoConcluir: () => void;
};

const opcoesIncentivo = Object.fromEntries(tiposIncentivo.map((tipo) =>
    [tipo, `${incentivos[tipo].nome} (${incentivos[tipo].preco})`])) as Record<TipoIncentivo, string>;

/**
 * Formulário das decisões da Diretoria que exigem motivo: Sala de Descanso e incentivos. Incentivos coletivos
 * alcançam toda a equipe presente, mesmo abertos pela ficha de um funcionário.
 */
export function AcoesDiretoria({ decisao, funcionario, moedas, executar, aoConcluir }: Propriedades) {
    const [motivo, setMotivo] = useState('');
    const [tipo, setTipo] = useState<TipoIncentivo>('armadilha_dedo');
    const incentivo = incentivos[tipo];
    const confirmar = async () => {
        const operacao = decisao === 'sala_descanso'
            ? lumon!.enviarSalaDescanso(funcionario.id, motivo)
            : lumon!.concederIncentivo(tipo, motivo, incentivo.coletivo ? undefined : funcionario.id);
        if (await executar(operacao)) aoConcluir();
    };
    return (
        <div className="flex flex-col gap-3 border-t border-borda p-4">
            {decisao === 'incentivo' && <Segmentos opcoes={opcoesIncentivo} valor={tipo} aoMudar={setTipo} />}
            <textarea
                autoFocus
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                placeholder={decisao === 'sala_descanso'
                    ? `Por que ${funcionario.nome} vai para a Sala de Descanso?`
                    : incentivo.coletivo ? 'Motivo da celebração da equipe' : `Por que ${funcionario.nome} merece?`}
                className={`${classeEntrada} h-20 resize-none py-2`}
            />
            <div className="flex justify-end gap-2">
                <Botao onClick={aoConcluir}>Cancelar</Botao>
                <Botao
                    variante={decisao === 'sala_descanso' ? 'perigo' : 'principal'}
                    disabled={!motivo.trim() || (decisao === 'incentivo' && moedas < incentivo.preco)}
                    onClick={() => void confirmar()}
                >
                    {decisao === 'sala_descanso' ? 'Enviar' : 'Conceder'}
                </Botao>
            </div>
        </div>
    );
}
