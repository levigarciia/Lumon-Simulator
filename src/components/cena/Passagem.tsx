import { Bloco } from './Bloco';

/** Porta aberta sobre uma célula de passagem, com a folha recolhida ao lado do vão. */
export function Passagem({ x, z, altura = 1.4 }: { x: number; z: number; altura?: number }) {
    return (
        <group position={[x, 0, z + 0.5]}>
            {[-0.54, 0.54].map((lado) => (
                <Bloco key={lado} tamanho={[0.2, altura, 0.08]}
                    posicao={[0, altura / 2, lado]} cor="#26332a" />
            ))}
            <Bloco tamanho={[0.2, 0.1, 1.16]} posicao={[0, altura, 0]} cor="#26332a" />
            <Bloco tamanho={[0.04, altura - 0.15, 0.85]} posicao={[0.12, (altura - 0.15) / 2, -0.97]}
                cor="#405044" />
            <Bloco tamanho={[0.04, 0.08, 0.08]} posicao={[-0.12, altura - 0.18, 0.65]}
                cor="#b5cba3" emissiva="#b5cba3" intensidade={0.6} />
        </group>
    );
}
