import type { Aparencia } from '../../shared/funcionarios';

/** Ícone voxel com as mesmas cores e o estilo de cabelo do funcionário na sala. */
export function RetratoFuncionario({ aparencia, grande = false, tamanho }: {
    aparencia: Aparencia; grande?: boolean; tamanho?: 'pequeno';
}) {
    return (
        <span aria-hidden="true" className={`relative inline-block shrink-0 overflow-hidden rounded-xl
            border border-white/5 bg-[#223a3d] ${grande ? 'size-24' : tamanho === 'pequeno' ? 'size-8' : 'size-11'}`}>
            <span className="absolute bottom-[-12%] left-[18%] h-[40%] w-[64%] bg-[#eceae4]" />
            <span className="absolute bottom-0 left-[46%] h-[22%] w-[8%]"
                style={{ backgroundColor: aparencia.gravata }} />
            <span className="absolute top-[23%] left-[26%] h-[47%] w-[48%] shadow-[4px_3px_0_#0002]"
                style={{ backgroundColor: aparencia.pele }}>
                <span className="absolute top-[48%] left-[20%] h-[13%] w-[10%] bg-[#202524]" />
                <span className="absolute top-[48%] right-[20%] h-[13%] w-[10%] bg-[#202524]" />
            </span>
            {aparencia.estiloCabelo !== 'careca' && (
                <span className="absolute top-[17%] left-[23%] h-[18%] w-[54%]"
                    style={{ backgroundColor: aparencia.cabelo }}>
                    <span className={`absolute top-full left-0 w-[12%]
                        ${aparencia.estiloCabelo === 'longo' ? 'h-[220%]' : 'h-[80%]'}`}
                        style={{ backgroundColor: aparencia.cabelo }} />
                    <span className="absolute top-full right-0 h-[65%] w-[12%]"
                        style={{ backgroundColor: aparencia.cabelo }} />
                </span>
            )}
        </span>
    );
}
