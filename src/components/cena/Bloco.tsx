type Vetor = [number, number, number];

type PropriedadesBloco = {
    tamanho: Vetor;
    posicao?: Vetor;
    rotacao?: Vetor;
    cor: string;
    emissiva?: string;
    intensidade?: number;
    aspereza?: number;
};

/** Caixa com sombra, peça básica de todos os modelos voxel do escritório. */
export function Bloco({ tamanho, posicao, rotacao, cor, emissiva, intensidade = 1, aspereza = 0.85 }: PropriedadesBloco) {
    return (
        <mesh position={posicao} rotation={rotacao} castShadow receiveShadow>
            <boxGeometry args={tamanho} />
            <meshStandardMaterial
                color={cor}
                roughness={aspereza}
                emissive={emissiva ?? '#000000'}
                emissiveIntensity={emissiva ? intensidade : 0}
            />
        </mesh>
    );
}
