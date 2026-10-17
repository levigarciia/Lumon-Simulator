import type { ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import {
    celulasOcupadas,
    comItem,
    dimensoesItem,
    validarSala,
    type Celula,
    type Rotacao,
    type Sala,
    type TipoItem,
} from '../../../shared/escritorio';
import { ModeloItem } from './Itens';

const idFantasma = '__fantasma';
const limiteArrasteClique = 6;

type PropriedadesPosicionador = {
    sala: Sala;
    tipo: TipoItem;
    itemId?: string;
    rotacao: Rotacao;
    aoConfirmar: (celula: Celula) => void;
};

/**
 * Prévia do item sob o cursor, com a área ocupada em verde quando o layout resultante é válido e em vermelho
 * quando não é. A validação é a mesma que o processo principal aplica na compra.
 */
export function Posicionador({ sala, tipo, itemId, rotacao, aoConfirmar }: PropriedadesPosicionador) {
    const [cursor, setCursor] = useState<Celula | null>(null);
    const { largura, profundidade } = dimensoesItem({ tipo, rotacao });
    const celula = cursor && {
        x: Math.min(Math.max(cursor.x - Math.floor((largura - 1) / 2), 0), sala.largura - largura),
        z: Math.min(Math.max(cursor.z - Math.floor((profundidade - 1) / 2), 0), sala.profundidade - profundidade),
    };
    const candidato = celula && { id: itemId ?? idFantasma, tipo, celula, rotacao };
    const valido = !!candidato && validarSala(comItem(sala, candidato)) === null;

    const acompanhar = (evento: ThreeEvent<PointerEvent>) => {
        const proxima = { x: Math.floor(evento.point.x), z: Math.floor(evento.point.z) };
        if (proxima.x !== cursor?.x || proxima.z !== cursor?.z) setCursor(proxima);
    };
    const confirmar = (evento: ThreeEvent<MouseEvent>) => {
        evento.stopPropagation();
        if (evento.delta <= limiteArrasteClique && celula && valido) aoConfirmar(celula);
    };

    return (
        <group>
            <mesh
                position={[sala.largura / 2, 0.002, sala.profundidade / 2]}
                rotation={[-Math.PI / 2, 0, 0]}
                onPointerMove={acompanhar}
                onPointerLeave={() => setCursor(null)}
                onClick={confirmar}
            >
                <planeGeometry args={[sala.largura, sala.profundidade]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {candidato && (
                <group>
                    <ModeloItem item={candidato} />
                    {celulasOcupadas(candidato).map((ocupada) => (
                        <mesh
                            key={`${ocupada.x},${ocupada.z}`}
                            position={[ocupada.x + 0.5, 0.01, ocupada.z + 0.5]}
                            rotation={[-Math.PI / 2, 0, 0]}
                        >
                            <planeGeometry args={[0.96, 0.96]} />
                            <meshBasicMaterial color={valido ? '#5fd38a' : '#e0574f'} transparent opacity={0.35} />
                        </mesh>
                    ))}
                </group>
            )}
        </group>
    );
}
