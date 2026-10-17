import { useMemo } from 'react';
import { CanvasTexture, Object3D, RepeatWrapping, SRGBColorSpace } from 'three';
import { celulaAcessoAnexos, type Sala as DadosSala } from '../../../shared/escritorio';
import { Bloco } from './Bloco';
import { Passagem } from './Passagem';

const alturaParede = 2.7;
const espessura = 0.16;
const larguraPainel = 2;
const corParede = '#bdbaa8';
const corJunta = '#a6a392';
const corRodape = '#2f3a30';
const corMoldura = '#11141a';
const placasPorTextura = 2;
const pixelsPorPlaca = 128;

function criarTexturaCarpete(largura: number, profundidade: number): CanvasTexture {
    const tamanho = placasPorTextura * pixelsPorPlaca;
    const tela = document.createElement('canvas');
    tela.width = tamanho;
    tela.height = tamanho;
    const contexto = tela.getContext('2d');
    if (!contexto) throw new Error('Canvas 2D indisponível para gerar o carpete.');
    for (let linha = 0; linha < placasPorTextura; linha++) {
        for (let coluna = 0; coluna < placasPorTextura; coluna++) {
            contexto.fillStyle = (linha + coluna) % 2 === 0 ? '#617058' : '#5b6953';
            contexto.fillRect(coluna * pixelsPorPlaca, linha * pixelsPorPlaca, pixelsPorPlaca, pixelsPorPlaca);
        }
    }
    for (let ponto = 0; ponto < 9000; ponto++) {
        contexto.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,240,0.05)' : 'rgba(0,0,0,0.07)';
        contexto.fillRect(Math.random() * tamanho, Math.random() * tamanho, 1.5, 1.5);
    }
    contexto.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let indice = 0; indice <= placasPorTextura; indice++) {
        const posicao = indice * pixelsPorPlaca;
        contexto.strokeRect(posicao, 0, 0.5, tamanho);
        contexto.strokeRect(0, posicao, tamanho, 0.5);
    }
    const textura = new CanvasTexture(tela);
    textura.colorSpace = SRGBColorSpace;
    textura.wrapS = RepeatWrapping;
    textura.wrapT = RepeatWrapping;
    textura.anisotropy = 8;
    textura.repeat.set(largura / placasPorTextura, profundidade / placasPorTextura);
    return textura;
}

function Piso({ largura, profundidade }: { largura: number; profundidade: number }) {
    const textura = useMemo(() => criarTexturaCarpete(largura, profundidade), [largura, profundidade]);
    return (
        <mesh position={[largura / 2, -0.05, profundidade / 2]} receiveShadow>
            <boxGeometry args={[largura, 0.1, profundidade]} />
            <meshStandardMaterial map={textura} roughness={1} />
        </mesh>
    );
}

function Parede({ comprimento, eixo }: { comprimento: number; eixo: 'norte' | 'oeste' }) {
    const juntas = Array.from({ length: Math.floor(comprimento / larguraPainel) - 1 }, (_, indice) => (indice + 1) * larguraPainel);
    const rotacao: [number, number, number] = eixo === 'norte' ? [0, 0, 0] : [0, Math.PI / 2, 0];
    const origem: [number, number, number] = eixo === 'norte' ? [0, 0, 0] : [0, 0, comprimento];
    return (
        <group position={origem} rotation={rotacao}>
            <Bloco
                tamanho={[comprimento + espessura, alturaParede, espessura]}
                posicao={[comprimento / 2 - espessura / 2, alturaParede / 2, -espessura / 2]}
                cor={corParede}
                aspereza={0.95}
            />
            {juntas.map((posicao) => (
                <Bloco
                    key={posicao}
                    tamanho={[0.02, alturaParede - 0.2, 0.01]}
                    posicao={[posicao, alturaParede / 2 + 0.08, 0.004]}
                    cor={corJunta}
                />
            ))}
            <Bloco tamanho={[comprimento, 0.16, 0.04]} posicao={[comprimento / 2, 0.08, 0.02]} cor={corRodape} />
            <Bloco tamanho={[comprimento, 0.05, 0.03]} posicao={[comprimento / 2, alturaParede - 0.03, 0.015]} cor="#9d9a89" />
        </group>
    );
}

function Quadro({ x, z, eixo }: { x: number; z: number; eixo: 'norte' | 'oeste' }) {
    const rotacao: [number, number, number] = eixo === 'norte' ? [0, 0, 0] : [0, Math.PI / 2, 0];
    return (
        <group position={[x, 1.6, z]} rotation={rotacao}>
            <Bloco tamanho={[0.9, 1.1, 0.04]} cor="#15181c" />
            <Bloco tamanho={[0.76, 0.96, 0.02]} posicao={[0, 0, 0.025]} cor="#b3b4a5" />
            <mesh position={[-0.08, -0.14, 0.04]}>
                <coneGeometry args={[0.3, 0.6, 3]} />
                <meshStandardMaterial color="#2c3a2f" roughness={1} />
            </mesh>
            <mesh position={[0.16, -0.2, 0.038]}>
                <coneGeometry args={[0.22, 0.45, 3]} />
                <meshStandardMaterial color="#45574a" roughness={1} />
            </mesh>
        </group>
    );
}

function Porta({ x }: { x: number }) {
    return (
        <group position={[x, 0, 0.01]}>
            <Bloco tamanho={[1.08, 2.12, 0.04]} posicao={[0, 1.06, 0]} cor="#cfcdbf" />
            <Bloco tamanho={[0.92, 2.0, 0.05]} posicao={[0, 1.0, 0.012]} cor="#26332a" aspereza={0.6} />
            <Bloco tamanho={[0.08, 0.4, 0.02]} posicao={[0.14, 1.45, 0.045]} cor="#dfe3d6" emissiva="#dfe3d6" intensidade={0.25} />
            <Bloco tamanho={[0.04, 0.16, 0.04]} posicao={[-0.34, 1.0, 0.05]} cor="#9a9a92" aspereza={0.3} />
            <Bloco tamanho={[0.2, 0.26, 0.04]} posicao={[0.9, 1.15, 0.02]} cor="#2a2c2a" />
            <Bloco tamanho={[0.04, 0.04, 0.02]} posicao={[0.86, 1.2, 0.05]} cor="#e0a54a" emissiva="#e0a54a" intensidade={2.5} />
            <Bloco tamanho={[0.04, 0.04, 0.02]} posicao={[0.94, 1.2, 0.05]} cor="#e0a54a" emissiva="#e0a54a" intensidade={2.5} />
        </group>
    );
}

function LuzPendente({ x, z }: { x: number; z: number }) {
    const alvo = useMemo(() => new Object3D(), []);
    return (
        <group>
            <primitive object={alvo} position={[x, 0, z]} />
            <group position={[x, 2.3, z]}>
                <Bloco tamanho={[2.3, 0.07, 0.22]} cor="#16181b" />
                <Bloco tamanho={[2.2, 0.02, 0.13]} posicao={[0, -0.045, 0]} cor="#fff3d6" emissiva="#ffeec8" intensidade={4} />
                <Bloco tamanho={[0.012, 1.6, 0.012]} posicao={[-0.95, 0.83, 0]} cor="#0d0f12" />
                <Bloco tamanho={[0.012, 1.6, 0.012]} posicao={[0.95, 0.83, 0]} cor="#0d0f12" />
                <spotLight
                    target={alvo}
                    position={[0, -0.1, 0]}
                    color="#ffeccb"
                    intensity={38}
                    angle={1.05}
                    penumbra={0.85}
                    distance={12}
                    decay={1.4}
                    castShadow
                    shadow-mapSize={[2048, 2048]}
                    shadow-bias={-0.0004}
                    shadow-radius={6}
                />
            </group>
        </group>
    );
}

/** Piso, paredes e elementos fixos do escritório. Móveis ficam em `Itens`. */
export function Sala({ sala }: { sala: DadosSala }) {
    const { largura, profundidade } = sala;
    const acesso = celulaAcessoAnexos(sala).z;
    return (
        <group>
            <Piso largura={largura} profundidade={profundidade} />
            <Parede comprimento={largura} eixo="norte" />
            <Parede comprimento={profundidade} eixo="oeste" />
            <Bloco
                tamanho={[largura + espessura * 2, 0.42, espessura * 1.6]}
                posicao={[largura / 2, 0.21, profundidade + espessura * 0.8]}
                cor={corMoldura}
            />
            {[[0, acesso], [acesso + 1, profundidade]].map(([inicio, fim]) => (
                <Bloco key={inicio} tamanho={[espessura * 1.6, 0.42, fim - inicio]}
                    posicao={[largura + espessura * 0.8, 0.21, (inicio + fim) / 2]} cor={corMoldura} />
            ))}
            <Passagem x={largura} z={acesso} />
            <Quadro x={4} z={0.02} eixo="norte" />
            <Quadro x={0.02} z={5} eixo="oeste" />
            <Porta x={7.5} />
            <LuzPendente x={7} z={6} />
        </group>
    );
}
