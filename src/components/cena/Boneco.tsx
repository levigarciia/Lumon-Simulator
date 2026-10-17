import { useRef, type RefObject } from 'react';
import type { Group } from 'three';
import type { Aparencia } from '../../../shared/funcionarios';
import { Bloco } from './Bloco';

const corCamisa = '#eceae4';
const corCalca = '#262a30';

/** Grupos animáveis do boneco: corpo inteiro, pernas e braços, cada membro girando a partir do ombro ou quadril. */
export type PartesBoneco = {
    corpo: RefObject<Group | null>;
    cabeca: RefObject<Group | null>;
    pernas: [RefObject<Group | null>, RefObject<Group | null>];
    bracos: [RefObject<Group | null>, RefObject<Group | null>];
};

export function usePartesBoneco(): PartesBoneco {
    return {
        corpo: useRef<Group>(null),
        cabeca: useRef<Group>(null),
        pernas: [useRef<Group>(null), useRef<Group>(null)],
        bracos: [useRef<Group>(null), useRef<Group>(null)],
    };
}

function Membro({ cor, tamanho }: { cor: string; tamanho: [number, number, number] }) {
    return <Bloco tamanho={tamanho} posicao={[0, -tamanho[1] / 2, 0]} cor={cor} />;
}

const pescoco = 0.78;
const tamanhoCabeca = 0.46;
const alturaCabeca = 1.01;

function Cabelo({ aparencia }: { aparencia: Aparencia }) {
    const { cabelo, estiloCabelo } = aparencia;
    if (estiloCabelo === 'careca') return null;
    return (
        <group>
            <Bloco tamanho={[0.5, 0.14, 0.5]} posicao={[0, 1.25, -0.01]} cor={cabelo} />
            <Bloco tamanho={[0.5, 0.3, 0.1]} posicao={[0, 1.1, -0.21]} cor={cabelo} />
            <Bloco tamanho={[0.04, 0.18, 0.42]} posicao={[-0.245, 1.13, -0.03]} cor={cabelo} />
            <Bloco tamanho={[0.04, 0.18, 0.42]} posicao={[0.245, 1.13, -0.03]} cor={cabelo} />
            <Bloco tamanho={[0.5, 0.06, 0.04]} posicao={[0, 1.19, 0.235]} cor={cabelo} />
            {estiloCabelo === 'lateral' && (
                <Bloco tamanho={[0.3, 0.12, 0.05]} posicao={[-0.1, 1.14, 0.24]} cor={cabelo} />
            )}
            {estiloCabelo === 'longo' && (
                <>
                    <Bloco tamanho={[0.5, 0.58, 0.1]} posicao={[0, 0.95, -0.21]} cor={cabelo} />
                    <Bloco tamanho={[0.05, 0.46, 0.4]} posicao={[-0.25, 1.02, -0.03]} cor={cabelo} />
                    <Bloco tamanho={[0.05, 0.46, 0.4]} posicao={[0.25, 1.02, -0.03]} cor={cabelo} />
                </>
            )}
        </group>
    );
}

function Rosto({ pele }: { pele: string }) {
    return (
        <group>
            <Bloco tamanho={[tamanhoCabeca, tamanhoCabeca, tamanhoCabeca]} posicao={[0, alturaCabeca, 0]} cor={pele} />
            <Bloco tamanho={[0.05, 0.07, 0.01]} posicao={[-0.1, 1.0, 0.232]} cor="#15120f" />
            <Bloco tamanho={[0.05, 0.07, 0.01]} posicao={[0.1, 1.0, 0.232]} cor="#15120f" />
        </group>
    );
}

/** Modelo voxel de um funcionário com a aparência escolhida na contratação. A frente aponta para +z. */
export function Boneco({ aparencia, partes }: { aparencia: Aparencia; partes: PartesBoneco }) {
    return (
        <group ref={partes.corpo}>
            {[-0.09, 0.09].map((x, lado) => (
                <group key={x} ref={partes.pernas[lado]} position={[x, 0.4, 0]}>
                    <Membro cor={corCalca} tamanho={[0.15, 0.4, 0.17]} />
                </group>
            ))}
            <Bloco tamanho={[0.4, 0.38, 0.24]} posicao={[0, 0.59, 0]} cor={corCamisa} />
            <Bloco tamanho={[0.16, 0.04, 0.02]} posicao={[0, 0.765, 0.12]} cor="#f6f4ef" />
            <Bloco tamanho={[0.07, 0.05, 0.015]} posicao={[0, 0.73, 0.124]} cor={aparencia.gravata} />
            <Bloco tamanho={[0.055, 0.24, 0.012]} posicao={[0, 0.6, 0.123]} cor={aparencia.gravata} />
            {[-0.26, 0.26].map((x, lado) => (
                <group key={x} ref={partes.bracos[lado]} position={[x, 0.76, 0]}>
                    <Membro cor={corCamisa} tamanho={[0.12, 0.34, 0.14]} />
                    <Bloco tamanho={[0.1, 0.08, 0.12]} posicao={[0, -0.38, 0]} cor={aparencia.pele} />
                </group>
            ))}
            <group ref={partes.cabeca} position={[0, pescoco, 0]}>
                <group position={[0, -pescoco, 0]}>
                    <Rosto pele={aparencia.pele} />
                    <Cabelo aparencia={aparencia} />
                </group>
            </group>
        </group>
    );
}
