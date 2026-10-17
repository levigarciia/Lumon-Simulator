import { Coins } from '@phosphor-icons/react';
import { Bounds, OrthographicCamera, View } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { Group } from 'three';
import { catalogo, tiposItem, type TipoItem } from '../../shared/escritorio';
import { ModeloTipo } from './cena/Itens';
import { Botao, Janela } from './ui';

const velocidadeGiro = 0.5;

function ModeloGirando({ tipo }: { tipo: TipoItem }) {
    const grupo = useRef<Group>(null);
    useFrame((_, intervalo) => {
        if (grupo.current) grupo.current.rotation.y += intervalo * velocidadeGiro;
    });
    return (
        <group ref={grupo}>
            <ModeloTipo tipo={tipo} id={`previa_${tipo}`} />
        </group>
    );
}

function Previa({ tipo }: { tipo: TipoItem }) {
    return (
        <View className="h-36 w-full">
            <OrthographicCamera makeDefault position={[5, 4, 5]} zoom={60} />
            <ambientLight intensity={0.9} />
            <directionalLight position={[3, 5, 4]} intensity={1.6} />
            <Bounds fit clip observe margin={1.25}>
                <ModeloGirando tipo={tipo} />
            </Bounds>
        </View>
    );
}

type PropriedadesLoja = { moedas: number; aoFechar: () => void; aoComprar: (tipo: TipoItem) => void };

/** Catálogo de móveis com prévia 3D. Comprar fecha a loja e leva o item ao cursor para ser posicionado. */
export function Loja({ moedas, aoFechar, aoComprar }: PropriedadesLoja) {
    const lista = useRef<HTMLUListElement>(null);
    return (
        <Janela titulo="Loja" aoFechar={aoFechar} largura="w-[760px]">
            <ul ref={lista} className="grid grid-cols-3 gap-3 p-5">
                {tiposItem.map((tipo) => {
                    const item = catalogo[tipo];
                    return (
                        <li key={tipo} className="flex flex-col overflow-hidden rounded-lg border border-borda bg-black/15">
                            <div className="bg-[radial-gradient(circle_at_50%_40%,#2a3330,#151a1d)]">
                                <Previa tipo={tipo} />
                            </div>
                            <div className="flex flex-1 flex-col gap-2 p-4">
                                <h3 className="text-[13px] font-medium text-principal">{item.nome}</h3>
                                <p className="flex-1 text-[12px] text-discreto">{item.descricao}</p>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1 text-[13px] text-secundario tabular-nums">
                                        <Coins size={14} />
                                        {item.preco}
                                    </span>
                                    <Botao disabled={item.preco > moedas} onClick={() => aoComprar(tipo)} className="h-8">
                                        Comprar
                                    </Botao>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <div className="pointer-events-none fixed inset-0 z-30">
                <Canvas eventSource={lista as RefObject<HTMLElement>}>
                    <View.Port />
                </Canvas>
            </div>
        </Janela>
    );
}
