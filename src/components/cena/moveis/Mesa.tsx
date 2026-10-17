import { Bloco } from '../Bloco';

const corTampo = '#d9d0b8';
const corGaveteiro = '#8c886f';
const corGaveta = '#9d9880';
const corDivisoria = '#3f5141';
const corBege = '#e3dccb';
const corEscura = '#26282a';

function sortearVariacao(id: string): number {
    let valor = 0;
    for (const caractere of id) valor = (valor * 31 + caractere.charCodeAt(0)) >>> 0;
    return valor;
}

function Monitor() {
    return (
        <group position={[-0.5, 0.745, -0.12]}>
            <Bloco tamanho={[0.22, 0.03, 0.2]} posicao={[0, 0.015, 0]} cor={corBege} />
            <Bloco tamanho={[0.44, 0.38, 0.3]} posicao={[0, 0.22, 0.02]} cor={corBege} aspereza={0.6} />
            <Bloco tamanho={[0.32, 0.28, 0.22]} posicao={[0, 0.21, -0.2]} cor="#d4cdbb" aspereza={0.6} />
            <Bloco tamanho={[0.36, 0.29, 0.01]} posicao={[0, 0.23, 0.175]} cor="#b7b09c" />
            <Bloco tamanho={[0.3, 0.23, 0.012]} posicao={[0, 0.23, 0.181]} cor="#d7ecff" emissiva="#bcdcff" intensidade={1.6} />
        </group>
    );
}

function Perifericos() {
    return (
        <group>
            <Bloco tamanho={[0.42, 0.025, 0.14]} posicao={[-0.5, 0.757, 0.22]} cor="#ddd6c4" />
            <Bloco tamanho={[0.38, 0.008, 0.1]} posicao={[-0.5, 0.773, 0.22]} cor="#c9c1ad" />
            <Bloco tamanho={[0.05, 0.02, 0.08]} posicao={[-0.18, 0.755, 0.24]} cor="#ddd6c4" />
        </group>
    );
}

function Gaveteiro() {
    return (
        <group position={[0.66, 0, 0]}>
            <Bloco tamanho={[0.5, 0.7, 0.82]} posicao={[0, 0.35, 0]} cor={corGaveteiro} />
            {[0.13, 0.36, 0.58].map((altura) => (
                <group key={altura} position={[0, altura, 0.412]}>
                    <Bloco tamanho={[0.44, 0.19, 0.01]} cor={corGaveta} />
                    <Bloco tamanho={[0.14, 0.025, 0.02]} posicao={[0, 0.05, 0.01]} cor="#4a4a40" />
                </group>
            ))}
        </group>
    );
}

function Cadeira() {
    const pes = [0, 1, 2, 3, 4].map((indice) => (indice / 5) * Math.PI * 2);
    return (
        <group position={[-0.5, 0, 0.66]}>
            <Bloco tamanho={[0.44, 0.08, 0.42]} posicao={[0, 0.44, 0]} cor="#26352c" />
            <Bloco tamanho={[0.42, 0.46, 0.07]} posicao={[0, 0.76, 0.21]} cor="#26352c" />
            <Bloco tamanho={[0.05, 0.36, 0.05]} posicao={[0, 0.24, 0]} cor="#161616" />
            {pes.map((angulo) => (
                <group key={angulo} rotation={[0, angulo, 0]}>
                    <Bloco tamanho={[0.04, 0.03, 0.26]} posicao={[0, 0.06, 0.13]} cor="#161616" />
                    <Bloco tamanho={[0.05, 0.05, 0.05]} posicao={[0, 0.025, 0.25]} cor="#0d0d0d" />
                </group>
            ))}
        </group>
    );
}

function Caneca() {
    return (
        <mesh position={[0.3, 0.8, 0.12]} castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.1, 12]} />
            <meshStandardMaterial color="#1f2321" roughness={0.5} />
        </mesh>
    );
}

function PortaLapis() {
    return (
        <group position={[0.5, 0.75, -0.1]}>
            <Bloco tamanho={[0.08, 0.11, 0.08]} posicao={[0, 0.055, 0]} cor="#2b2d2b" />
            <Bloco tamanho={[0.012, 0.12, 0.012]} posicao={[-0.015, 0.14, 0]} rotacao={[0.2, 0, 0.15]} cor="#c9a45a" />
            <Bloco tamanho={[0.012, 0.12, 0.012]} posicao={[0.015, 0.14, 0.01]} rotacao={[-0.15, 0, -0.1]} cor="#3d5a7a" />
        </group>
    );
}

function Papeis() {
    return <Bloco tamanho={[0.24, 0.015, 0.3]} posicao={[0.15, 0.753, 0.05]} rotacao={[0, 0.25, 0]} cor="#f1eee6" />;
}

function Gabinete() {
    return <Bloco tamanho={[0.18, 0.34, 0.36]} posicao={[0.78, 0.92, -0.18]} cor={corEscura} aspereza={0.5} />;
}

const enfeites = [Caneca, PortaLapis, Papeis, Gabinete];

/**
 * Estação de trabalho de duas células no estilo da Lumon: tampo creme, divisória verde, gaveteiro e terminal
 * CRT. Os enfeites variam pelo identificador, para que mesas vizinhas não sejam idênticas.
 */
export function Mesa({ id }: { id: string }) {
    const variacao = sortearVariacao(id);
    const escolhidos = enfeites.filter((_, indice) => (variacao >> indice) & 1);
    return (
        <group>
            <Bloco tamanho={[1.96, 0.05, 0.92]} posicao={[0, 0.72, 0]} cor={corTampo} aspereza={0.7} />
            <Bloco tamanho={[1.96, 0.03, 0.92]} posicao={[0, 0.685, 0]} cor="#bdb39a" />
            <Bloco tamanho={[0.05, 0.68, 0.05]} posicao={[-0.94, 0.34, 0.41]} cor={corEscura} />
            <Bloco tamanho={[0.05, 0.68, 0.05]} posicao={[-0.94, 0.34, -0.41]} cor={corEscura} />
            <Bloco tamanho={[1.2, 0.3, 0.02]} posicao={[-0.35, 0.5, -0.42]} cor={corGaveteiro} />
            <Gaveteiro />
            <Bloco tamanho={[2, 0.56, 0.05]} posicao={[0, 1.02, -0.485]} cor={corDivisoria} aspereza={1} />
            <Bloco tamanho={[2.02, 0.03, 0.07]} posicao={[0, 1.31, -0.485]} cor="#2b392d" />
            <Monitor />
            <Perifericos />
            {escolhidos.map((Enfeite) => (
                <Enfeite key={Enfeite.name} />
            ))}
            <Cadeira />
        </group>
    );
}
