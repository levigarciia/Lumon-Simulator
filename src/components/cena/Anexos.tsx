import { Html } from '@react-three/drei';
import { anexosDaSala, portaDoAnexo, recuoAnexos, type Anexo } from '../../../shared/anexos';
import type { Sala } from '../../../shared/escritorio';
import { Bloco } from './Bloco';
import { Passagem } from './Passagem';

const alturaParede = 1.4;
const espessura = 0.14;

function Paredes({ anexo, cor }: { anexo: Anexo; cor: string }) {
    const { largura, profundidade } = anexo;
    const porta = portaDoAnexo(anexo).z - anexo.z;
    return (
        <>
            <Bloco tamanho={[largura, alturaParede, espessura]} posicao={[largura / 2, alturaParede / 2, 0]} cor={cor} />
            <Bloco tamanho={[espessura, alturaParede, profundidade]}
                posicao={[largura, alturaParede / 2, profundidade / 2]} cor={cor} />
            <Bloco tamanho={[espessura, alturaParede, porta]}
                posicao={[0, alturaParede / 2, porta / 2]} cor={cor} />
            <Bloco tamanho={[espessura, alturaParede, profundidade - porta - 1]}
                posicao={[0, alturaParede / 2, (profundidade + porta + 1) / 2]} cor={cor} />
            <Passagem x={0} z={porta} />
            <Bloco tamanho={[largura, 0.3, espessura]} posicao={[largura / 2, 0.15, profundidade]} cor="#11141a" />
        </>
    );
}

function Placa({ anexo }: { anexo: Anexo }) {
    return (
        <Html position={[anexo.largura / 2, alturaParede + 0.35, 0]} center zIndexRange={[4, 0]}
            className="pointer-events-none select-none">
            <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] tracking-[0.12em] whitespace-nowrap
                text-[#d9dccf] uppercase">{anexo.nome}</span>
        </Html>
    );
}

/** Cômodo estreito e frio, com a mesa do terminal onde se repete a declaração de arrependimento. */
function SalaDescanso({ anexo }: { anexo: Anexo }) {
    return (
        <group position={[anexo.x, 0, anexo.z]}>
            <Bloco tamanho={[anexo.largura, 0.1, anexo.profundidade]}
                posicao={[anexo.largura / 2, -0.05, anexo.profundidade / 2]} cor="#9a9d98" aspereza={1} />
            <Paredes anexo={anexo} cor="#d7d8d2" />
            {[0, 1, 2].map((indice) => (
                <group key={indice} position={[1.5 + indice * 2, 0, anexo.profundidade - 2.5]}>
                    <Bloco tamanho={[1, 0.06, 0.5]} posicao={[0, 0.74, 0]} cor="#e5e6e1" />
                    <Bloco tamanho={[0.06, 0.74, 0.06]} posicao={[0, 0.37, 0]} cor="#7d807b" />
                    <Bloco tamanho={[0.34, 0.24, 0.05]} posicao={[0, 0.9, -0.12]} cor="#1c1f1c"
                        emissiva="#7ab08a" intensidade={0.5} />
                </group>
            ))}
            <Bloco tamanho={[anexo.largura - 1, 0.04, 0.12]} posicao={[anexo.largura / 2, 1.38, anexo.profundidade / 2]}
                cor="#ffffff" emissiva="#f4f7ff" intensidade={3} />
            <Placa anexo={anexo} />
        </group>
    );
}

/** Ambiente acolhedor com duas poltronas frente a frente, planta e luz quente. */
function SalaBemEstar({ anexo }: { anexo: Anexo }) {
    const meio = Math.floor(anexo.profundidade / 2) + 0.5;
    return (
        <group position={[anexo.x, 0, anexo.z]}>
            <Bloco tamanho={[anexo.largura, 0.1, anexo.profundidade]}
                posicao={[anexo.largura / 2, -0.05, meio]} cor="#8a7a62" aspereza={1} />
            <Paredes anexo={anexo} cor="#cdbfa3" />
            {[1.5, 4.5].map((x, indice) => (
                <group key={x} position={[x, 0, meio]} rotation={[0, indice ? -Math.PI / 2 : Math.PI / 2, 0]}>
                    <Bloco tamanho={[0.8, 0.4, 0.8]} posicao={[0, 0.2, 0]} cor="#5d4b3a" />
                    <Bloco tamanho={[0.8, 0.6, 0.16]} posicao={[0, 0.6, -0.34]} cor="#5d4b3a" />
                </group>
            ))}
            <Bloco tamanho={[0.6, 0.4, 0.6]} posicao={[3.5, 0.2, meio]} cor="#3b3027" />
            <Bloco tamanho={[0.4, 0.5, 0.4]} posicao={[anexo.largura - 0.5, 0.25, 0.5]} cor="#6b5a46" />
            <mesh position={[anexo.largura - 0.5, 0.85, 0.5]} castShadow>
                <coneGeometry args={[0.35, 0.8, 5]} />
                <meshStandardMaterial color="#3f5a3f" roughness={1} />
            </mesh>
            <pointLight position={[3, 1.3, meio]} color="#ffd9a0" intensity={6} distance={6} decay={1.5} />
            <Placa anexo={anexo} />
        </group>
    );
}

/** Anexos da Lumon ao lado do escritório, onde aparecem os funcionários punidos ou em sessão. */
export function Anexos({ sala }: { sala: Sala }) {
    const anexos = anexosDaSala(sala);
    const profundidade = Math.max(sala.profundidade, ...anexos.map((anexo) => anexo.z + anexo.profundidade));
    return (
        <>
            <Bloco tamanho={[recuoAnexos, 0.1, profundidade]}
                posicao={[sala.largura + recuoAnexos / 2, -0.05, profundidade / 2]} cor="#69735f" />
            {[0, profundidade].map((z) => (
                <Bloco key={z} tamanho={[recuoAnexos, 0.3, espessura]}
                    posicao={[sala.largura + recuoAnexos / 2, 0.15, z]} cor="#26332a" />
            ))}
            <Bloco tamanho={[0.14, 0.02, profundidade - 1]}
                posicao={[sala.largura + 1.5, 0.006, profundidade / 2]} cor="#c1c6ae" />
            {anexos.map((anexo) => anexo.tipo === 'sala_descanso'
                ? <SalaDescanso key={anexo.tipo} anexo={anexo} />
                : <SalaBemEstar key={anexo.tipo} anexo={anexo} />)}
        </>
    );
}
