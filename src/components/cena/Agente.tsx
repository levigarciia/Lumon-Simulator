import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { Atividade } from '../../../shared/escritorio';
import type { Funcionario, StatusFuncionario } from '../../../shared/funcionarios';
import type { Simulacao } from '../../store/simulacao';
import { Bloco } from './Bloco';
import { Boneco, usePartesBoneco } from './Boneco';
import type { FalaBalao } from '../../../shared/baloes';
import { estagioEsgotamento, type EstagioEsgotamento } from '../../../shared/esgotamento';

type Postura = { avanco: number; altura: number; virar: boolean; sentado: boolean };

const emPe: Postura = { avanco: 0, altura: 0, virar: false, sentado: false };

const posturas: Partial<Record<Atividade, Postura>> = {
    trabalhando: { avanco: 0.34, altura: 0.08, virar: false, sentado: true },
    descansando: { avanco: 0.75, altura: 0.0, virar: true, sentado: true },
    cafe: { ...emPe, avanco: 0.15 },
    comendo: { ...emPe, avanco: 0.15 },
};

const sentadoNoAnexo: Postura = { avanco: 0, altura: 0.02, virar: false, sentado: true };

const inclinacaoCabeca: Record<EstagioEsgotamento, number> = {
    estavel: 0, cansado: 0.08, desgastado: 0.2, esgotado: 0.35,
};

const coresAlerta:Partial<Record<StatusFuncionario, string>> = { bloqueado: '#f0b44c', erro: '#e0574f' };

const suavizacaoGiro = 10;
const suavizacaoPosicao = 9;
const limiteArrasteClique = 6;

function aproximarAngulo(atual: number, alvo: number, fator: number): number {
    const diferenca = Math.atan2(Math.sin(alvo - atual), Math.cos(alvo - atual));
    return atual + diferenca * Math.min(1, fator);
}

const cicloMouseSegundos = 4;

function faseDoAgente(id: string): number {
    return [...id].reduce((soma, caractere) => soma + caractere.charCodeAt(0), 0) % 97;
}

function estaNoMouse(tempo: number): boolean {
    return Math.floor(tempo / cicloMouseSegundos) % 3 === 2;
}

/**
 * Braços de quem está sentado à mesa: digitando com as duas mãos sobre o teclado, alternando o braço direito
 * com o mouse, ou apoiados no tampo quando não há tarefa.
 */
function poseBracoNaMesa(lado: number, tempo: number, digitando: boolean): { x: number; z: number } {
    if (!digitando) return { x: -1.2, z: 0 };
    if (lado === 0 && estaNoMouse(tempo)) return { x: -1.28 + Math.sin(tempo * 3) * 0.03, z: -0.22 };
    return { x: -1.32 + Math.sin(tempo * 16 + lado * 2.1) * 0.07, z: lado ? -0.08 : 0.08 };
}

function Alerta({ cor }: { cor: string }) {
    const grupo = useRef<Group>(null);
    useFrame(({ clock }) => {
        if (grupo.current) grupo.current.position.y = 1.62 + Math.sin(clock.getElapsedTime() * 4) * 0.04;
    });
    return (
        <group ref={grupo}>
            <Bloco tamanho={[0.07, 0.2, 0.07]} posicao={[0, 0.12, 0]} cor={cor} emissiva={cor} intensidade={1.5} />
            <Bloco tamanho={[0.07, 0.07, 0.07]} posicao={[0, -0.04, 0]} cor={cor} emissiva={cor} intensidade={1.5} />
        </group>
    );
}

type PropriedadesAgente = {
    simulacao: Simulacao;
    funcionario: Funcionario;
    status: StatusFuncionario;
    selecionado: boolean;
    fala: FalaBalao | null;
    escrevendo: boolean;
    aoSelecionar: (id: string) => void;
    atividadeDepartamento?: string;
    esgotamento?: number;
};

function Balao({ fala, pensando }: { fala: FalaBalao | null; pensando: boolean }) {
    const elemento = useRef<HTMLDivElement>(null);
    const ultimoConteudo = useRef({ fala, pensando });
    const visivel = Boolean(fala || pensando);
    if (visivel) ultimoConteudo.current = { fala, pensando: !fala && pensando };
    const conteudo = ultimoConteudo.current;
    const deslocamento = useRef({ x: 0, y: 0, proximaMedicao: 0 });
    useFrame(({ clock }) => {
        if (!visivel || !elemento.current || clock.elapsedTime < deslocamento.current.proximaMedicao) return;
        const atual = deslocamento.current;
        atual.proximaMedicao = clock.elapsedTime + 0.25;
        const caixa = elemento.current.getBoundingClientRect();
        const esquerda = caixa.left - atual.x;
        const topo = caixa.top - atual.y;
        atual.x = Math.max(12 - esquerda, Math.min(0, window.innerWidth - 12 - esquerda - caixa.width));
        atual.y = Math.max(12 - topo, Math.min(0, window.innerHeight - 12 - topo - caixa.height));
        elemento.current.style.translate = `${atual.x}px ${atual.y}px`;
    });
    return (
        <Html position={[0, 2.25, 0]} center zIndexRange={[6, 0]} className="pointer-events-none select-none">
            <div
                ref={elemento}
                data-balao-fala
                data-pensando={conteudo.pensando || undefined}
                aria-hidden={!visivel}
                style={{
                    opacity: visivel ? 1 : 0,
                    visibility: visivel ? 'visible' : 'hidden',
                    transition: visivel ? 'opacity 180ms ease, visibility 0s'
                        : 'opacity 350ms ease, visibility 0s linear 350ms',
                }}
                className={`max-w-[calc(100vw-32px)] rounded-xl border border-black/15 bg-[#f8f5ed]
                    text-[15px] leading-relaxed text-[#1b1f1c] shadow-xl
                    ${conteudo.pensando ? 'w-fit min-w-12 px-3 py-1.5 text-center' : 'w-80 px-4 py-3'}`}
            >
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{conteudo.fala?.texto ?? '...'}</p>
                {conteudo.fala && conteudo.fala.total > 1
                    && <p className="mt-2 text-right text-[11px] tabular-nums text-[#5e655e]">
                    {conteudo.fala.parte} / {conteudo.fala.total}
                </p>}
            </div>
        </Html>
    );
}

/** Funcionário na sala: segue o agente da simulação e mostra no corpo o status real do harness. */
export function Agente(propriedades: PropriedadesAgente) {
    const { simulacao, funcionario, status, selecionado, fala, escrevendo, aoSelecionar } = propriedades;
    const raiz = useRef<Group>(null);
    const rotulo = useRef<HTMLSpanElement>(null);
    const posicionado = useRef(false);
    const partes = usePartesBoneco();
    const fase = faseDoAgente(funcionario.id);
    const abatimento = inclinacaoCabeca[estagioEsgotamento(propriedades.esgotamento ?? 0)];

    useFrame(({ clock }, intervalo) => {
        const agente = simulacao.porId.get(funcionario.id);
        const corpo = partes.corpo.current;
        if (!agente || !raiz.current || !corpo) return;
        const noAnexo = !!agente.anexo;
        raiz.current.visible = agente.atividade !== 'ausente' || noAnexo;
        if (rotulo.current) rotulo.current.style.display = raiz.current.visible ? '' : 'none';
        const postura = noAnexo ? (agente.anexo === 'bem_estar' ? sentadoNoAnexo : emPe)
            : posturas[agente.atividade] ?? emPe;
        const { direcao, posicao } = agente;
        const giro = direcao + (postura.virar ? Math.PI : 0);
        raiz.current.rotation.y = aproximarAngulo(raiz.current.rotation.y, giro, intervalo * suavizacaoGiro);
        const alvoX = posicao.x + Math.sin(direcao) * postura.avanco;
        const alvoZ = posicao.z + Math.cos(direcao) * postura.avanco;
        const fator = posicionado.current ? Math.min(1, intervalo * suavizacaoPosicao) : 1;
        posicionado.current = true;
        raiz.current.position.x += (alvoX - raiz.current.position.x) * fator;
        raiz.current.position.z += (alvoZ - raiz.current.position.z) * fator;
        const tempo = clock.getElapsedTime();
        const andando = agente.atividade === 'andando';
        const digitando = agente.atividade === 'trabalhando' && status === 'trabalhando'
            && !propriedades.atividadeDepartamento?.startsWith('Coordena');
        const balanco = andando ? Math.sin(tempo * 9) * 0.6 : 0;
        corpo.position.y = postura.altura + (andando ? Math.abs(Math.sin(tempo * 9)) * 0.03 : 0);
        partes.pernas.forEach((perna, lado) => {
            if (perna.current) perna.current.rotation.x = postura.sentado ? -Math.PI / 2 : lado ? balanco : -balanco;
        });
        const aMesa = agente.atividade === 'trabalhando';
        partes.bracos.forEach((braco, lado) => {
            if (!braco.current) return;
            const pose = aMesa ? poseBracoNaMesa(lado, tempo + fase, digitando) : { x: lado ? -balanco : balanco, z: 0 };
            braco.current.rotation.set(pose.x, 0, pose.z);
        });
        const cabeca = partes.cabeca.current;
        if (cabeca) {
            const usandoMouse = digitando && estaNoMouse(tempo + fase);
            cabeca.rotation.x = (digitando ? 0.1 + Math.sin(tempo * 1.3 + fase) * 0.03 : 0) + abatimento;
            cabeca.rotation.y = usandoMouse ? -0.12 : aMesa && !digitando ? Math.sin((tempo + fase) * 0.4) * 0.35 : 0;
        }
    });

    const selecionar = (evento: ThreeEvent<MouseEvent>) => {
        evento.stopPropagation();
        if (evento.delta <= limiteArrasteClique) aoSelecionar(funcionario.id);
    };
    const alerta = coresAlerta[status];
    return (
        <group ref={raiz} onClick={selecionar}>
            <Boneco aparencia={funcionario.aparencia} partes={partes} />
            {alerta && <Alerta cor={alerta} />}
            <Balao fala={fala} pensando={escrevendo && !fala} />
            <Html position={[0, 1.95, 0]} center zIndexRange={[5, 0]} className="pointer-events-none select-none">
                <span
                    ref={rotulo}
                    className={`rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap ${selecionado ? 'bg-principal text-fundo' : 'bg-superficie text-principal'}`}
                >
                    {funcionario.nome}
                    {propriedades.atividadeDepartamento && <span className="ml-2 border-l border-current/30 pl-2
                        text-[10px] opacity-80">{propriedades.atividadeDepartamento}</span>}
                </span>
            </Html>
        </group>
    );
}
