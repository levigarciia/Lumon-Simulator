import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { custoConserto } from '../../../shared/manutencao';
import type { ReactNode } from 'react';
import { anguloRotacao, centroItem, type ItemPosicionado, type TipoItem } from '../../../shared/escritorio';
import { Bloco } from './Bloco';
import { Mesa } from './moveis/Mesa';

const corMadeiraEscura = '#2a2925';

function AparadorCafe() {
    return (
        <group position={[0, 0, -0.18]}>
            <Bloco tamanho={[1.9, 0.82, 0.55]} posicao={[0, 0.41, 0]} cor={corMadeiraEscura} />
            <Bloco tamanho={[1.94, 0.04, 0.6]} posicao={[0, 0.84, 0]} cor="#bdb7a3" />
            <Bloco tamanho={[0.34, 0.46, 0.32]} posicao={[0.4, 1.09, 0]} cor="#141414" aspereza={0.4} />
            <Bloco tamanho={[0.06, 0.06, 0.02]} posicao={[0.4, 1.12, 0.17]} cor="#e0a54a" emissiva="#e0a54a" intensidade={2} />
            <Bloco tamanho={[0.26, 0.36, 0.28]} posicao={[0.8, 1.04, 0]} cor="#1c1c1c" aspereza={0.4} />
            <Bloco tamanho={[0.08, 0.1, 0.08]} posicao={[0.05, 0.91, 0.1]} cor="#ece8dc" />
            <Bloco tamanho={[0.08, 0.1, 0.08]} posicao={[-0.1, 0.91, 0.1]} cor="#ece8dc" />
        </group>
    );
}

function MaquinaGuloseimas() {
    const prateleiras = [0.55, 0.85, 1.15, 1.45];
    return (
        <group position={[0, 0, -0.1]}>
            <Bloco tamanho={[0.85, 1.95, 0.72]} posicao={[0, 0.975, 0]} cor="#121416" aspereza={0.5} />
            <Bloco tamanho={[0.55, 1.3, 0.02]} posicao={[-0.08, 1.05, 0.36]} cor="#9cc3e6" emissiva="#7fb3ff" intensidade={0.9} />
            {prateleiras.map((altura) => (
                <Bloco key={altura} tamanho={[0.5, 0.12, 0.03]} posicao={[-0.08, altura, 0.37]} cor="#e7d8b8" />
            ))}
            <Bloco tamanho={[0.14, 0.4, 0.02]} posicao={[0.3, 1.2, 0.36]} cor="#2a2d31" />
            <pointLight position={[0, 1.1, 0.7]} color="#8fbaff" intensity={1.6} distance={2.5} decay={2} />
        </group>
    );
}

function VasoComFolhas({ escala = 1 }: { escala?: number }) {
    const folhas = [-0.5, -0.2, 0.15, 0.45];
    return (
        <group scale={escala}>
            <Bloco tamanho={[0.42, 0.42, 0.42]} posicao={[0, 0.21, 0]} cor="#e6e3da" />
            {folhas.map((inclinacao, indice) => (
                <Bloco
                    key={inclinacao}
                    tamanho={[0.12, 0.8, 0.03]}
                    posicao={[inclinacao * 0.3, 0.75, (indice % 2) * 0.08 - 0.04]}
                    rotacao={[0, indice * 0.8, inclinacao]}
                    cor="#3f6a3b"
                />
            ))}
        </group>
    );
}

function Aparador() {
    return (
        <group position={[0, 0, -0.18]}>
            <Bloco tamanho={[1.9, 0.75, 0.55]} posicao={[0, 0.375, 0]} cor="#2b2420" />
            <group position={[-0.5, 0.75, 0]}>
                <VasoComFolhas escala={0.6} />
            </group>
        </group>
    );
}

function LuminariaPiso() {
    return (
        <group>
            <Bloco tamanho={[0.3, 0.05, 0.3]} posicao={[0, 0.025, 0]} cor="#151515" />
            <Bloco tamanho={[0.05, 0.4, 0.05]} posicao={[0, 0.25, 0]} cor="#151515" />
            <Bloco tamanho={[0.2, 0.9, 0.2]} posicao={[0, 0.9, 0]} cor="#f6deb0" emissiva="#ffcf87" intensidade={2.2} />
            <pointLight position={[0, 1, 0]} color="#ffcf87" intensity={5} distance={5} decay={1.6} />
        </group>
    );
}

function Sofa() {
    return (
        <group>
            <Bloco tamanho={[1.8, 0.4, 0.8]} posicao={[0, 0.2, 0]} cor="#3a4234" />
            <Bloco tamanho={[1.8, 0.5, 0.2]} posicao={[0, 0.55, -0.3]} cor="#343c2f" />
            <Bloco tamanho={[0.18, 0.55, 0.8]} posicao={[-0.81, 0.3, 0]} cor="#343c2f" />
            <Bloco tamanho={[0.18, 0.55, 0.8]} posicao={[0.81, 0.3, 0]} cor="#343c2f" />
        </group>
    );
}

function MesaCentro() {
    return (
        <group>
            <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.36, 0.36, 0.05, 24]} />
                <meshStandardMaterial color="#1d1d1b" roughness={0.6} />
            </mesh>
            <Bloco tamanho={[0.05, 0.42, 0.05]} posicao={[0, 0.21, 0]} cor="#1d1d1b" />
            <Bloco tamanho={[0.22, 0.02, 0.16]} posicao={[0.05, 0.485, 0]} rotacao={[0, 0.3, 0]} cor="#6b7f8c" />
        </group>
    );
}

function Vitrola() {
    return (
        <group>
            <Bloco tamanho={[0.8, 0.6, 0.55]} posicao={[0, 0.3, -0.1]} cor="#4a3424" />
            <mesh position={[0, 0.62, -0.1]} castShadow>
                <cylinderGeometry args={[0.2, 0.2, 0.02, 24]} />
                <meshStandardMaterial color="#0c0c0c" roughness={0.3} />
            </mesh>
        </group>
    );
}

const modelos: Record<TipoItem, (propriedades: { id: string }) => ReactNode> = {
    mesa: Mesa,
    aparador_cafe: AparadorCafe,
    maquina_guloseimas: MaquinaGuloseimas,
    aparador: Aparador,
    planta: () => <VasoComFolhas />,
    luminaria_piso: LuminariaPiso,
    sofa: Sofa,
    mesa_centro: MesaCentro,
    vitrola: Vitrola,
};

/** Modelo do móvel na origem, com a frente para +z. Usado pela sala e pelas prévias da loja. */
export function ModeloTipo({ tipo, id }: { tipo: TipoItem; id: string }) {
    const Modelo = modelos[tipo];
    return <Modelo id={id} />;
}

/** Modelo de um móvel centrado na própria área e girado conforme a posição. Serve à sala e ao posicionamento. */
export function ModeloItem({ item }: { item: ItemPosicionado }) {
    const centro = centroItem(item);
    const destinoAviso = useThree((estado) => estado.gl.domElement.parentElement);
    return (
        <group position={[centro.x, 0, centro.z]} rotation={[0, anguloRotacao(item.rotacao), 0]}>
            <ModeloTipo tipo={item.tipo} id={item.id} />
            {item.quebrado && destinoAviso && <Html portal={{ current: destinoAviso }} position={[0, 2.2, 0]}
                center zIndexRange={[5, 0]}
                className="pointer-events-none select-none">
                <div className="whitespace-nowrap rounded-md border border-[#a24e45] bg-superficie
                    px-2 py-1 text-[12px] text-principal">
                    Quebrado: {custoConserto(item)} moedas
                </div>
            </Html>}
        </group>
    );
}

const limiteArrasteClique = 6;

type PropriedadesItens = {
    itens: ItemPosicionado[];
    ocultarId?: string;
    aoClicar?: (item: ItemPosicionado) => void;
};

/** Móveis da sala. Com `aoClicar`, cada item pode ser escolhido para mover ou vender. */
export function Itens({ itens, ocultarId, aoClicar }: PropriedadesItens) {
    return itens
        .filter((item) => item.id !== ocultarId)
        .map((item) => (
            <group
                key={item.id}
                onClick={(evento: ThreeEvent<MouseEvent>) => {
                    if (!aoClicar || evento.delta > limiteArrasteClique) return;
                    evento.stopPropagation();
                    aoClicar(item);
                }}
            >
                <ModeloItem item={item} />
            </group>
        ));
}
