import { MapControls, OrthographicCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing';
import { MOUSE } from 'three';
import type { Celula, ItemPosicionado } from '../../../shared/escritorio';
import type { EstadoPublico } from '../../../shared/estado';
import type { Modo } from '../../store/modo';
import type { Simulacao } from '../../store/simulacao';
import { Agente } from './Agente';
import type { FalaBalao } from '../../../shared/baloes';
import { Itens } from './Itens';
import { Posicionador } from './Posicionador';
import { Sala } from './Sala';
import { atividadeDepartamento } from '../../../shared/atividadeDepartamento';
import { nomesAusencia } from '../../../shared/ausencias';
import { recuoAnexos } from '../../../shared/anexos';
import { Anexos } from './Anexos';
import { estagioEsgotamento, nomesEstagio } from '../../../shared/esgotamento';

const distanciaCamera = 20;

function rotuloNaSala(id: string, estado: EstadoPublico): string | undefined {
    const ausencia = estado.ausencias?.[id];
    if (ausencia?.retornando) return 'Retornando às atividades';
    if (ausencia?.duracao !== undefined) return ausencia.motivo === 'folga' ? 'Saindo de folga' : 'Indo ao anexo';
    if (ausencia) return nomesAusencia[ausencia.motivo];
    if (estado.status[id] === 'conversando') return 'Conversando';
    if (estado.status[id] === 'em_pausa') return 'Em pausa';
    const trabalho = atividadeDepartamento(id, estado.trabalhos);
    if (trabalho) return trabalho;
    const estagio = estagioEsgotamento(estado.necessidades[id]?.esgotamento ?? 0);
    return estagio === 'estavel' ? undefined : nomesEstagio[estagio];
}
const botoesMouse = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

function PosProcessamento() {
    return (
        <EffectComposer multisampling={4}>
            <N8AO aoRadius={0.7} intensity={2.4} distanceFalloff={0.6} quality="high" />
            <Bloom luminanceThreshold={0.85} intensity={0.6} mipmapBlur />
            <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>
    );
}

function Iluminacao({ centro }: { centro: [number, number, number] }) {
    return (
        <>
            <ambientLight intensity={0.55} color="#c9d1c6" />
            <hemisphereLight args={['#e3e4d6', '#1b2119', 0.45]} />
            <directionalLight
                position={[centro[0] + 6, 14, centro[2] + 10]}
                intensity={0.45}
                color="#e8e2d0"
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-20}
                shadow-camera-right={20}
                shadow-camera-top={20}
                shadow-camera-bottom={-20}
                shadow-camera-far={60}
                shadow-bias={-0.0005}
            />
        </>
    );
}

type PropriedadesEscritorio = {
    estado: EstadoPublico;
    simulacao: Simulacao;
    modo: Modo;
    selecionadoId: string | null;
    aoSelecionar: (funcionarioId: string) => void;
    aoEscolherItem: (item: ItemPosicionado) => void;
    aoPosicionar: (celula: Celula) => void;
    falas: Record<string, FalaBalao>;
};

/** Cena isométrica do escritório, com câmera ortográfica que permite arrastar e aproximar. */
export function Escritorio(propriedades: PropriedadesEscritorio) {
    const { estado, simulacao, modo, selecionadoId, aoSelecionar, aoEscolherItem, aoPosicionar, falas } = propriedades;
    const { sala } = estado;
    const centro: [number, number, number] = [(sala.largura + recuoAnexos + 6) / 2, 0, sala.profundidade / 2];
    const posicionando = modo.tipo === 'posicionar' ? modo : null;
    return (
        <Canvas shadows dpr={[1, 2]}>
            <color attach="background" args={['#151a22']} />
            <OrthographicCamera
                makeDefault
                zoom={56}
                position={[centro[0] + distanciaCamera, distanciaCamera * 0.82, centro[2] + distanciaCamera]}
            />
            <MapControls
                target={centro}
                enableRotate={false}
                minZoom={28}
                maxZoom={140}
                screenSpacePanning
                mouseButtons={botoesMouse}
            />
            <Iluminacao centro={centro} />
            <PosProcessamento />
            <Sala sala={sala} />
            <Anexos sala={sala} />
            <Itens
                itens={sala.itens}
                ocultarId={posicionando?.itemId}
                aoClicar={modo.tipo === 'editar' ? aoEscolherItem : undefined}
            />
            {posicionando && (
                <Posicionador
                    sala={sala}
                    tipo={posicionando.item}
                    itemId={posicionando.itemId}
                    rotacao={posicionando.rotacao}
                    aoConfirmar={aoPosicionar}
                />
            )}
            {estado.funcionarios.map((funcionario) => (
                <Agente
                    key={funcionario.id}
                    simulacao={simulacao}
                    funcionario={funcionario}
                    atividadeDepartamento={rotuloNaSala(funcionario.id, estado)}
                    esgotamento={estado.necessidades[funcionario.id]?.esgotamento ?? 0}
                    status={estado.status[funcionario.id] ?? 'ocioso'}
                    selecionado={funcionario.id === selecionadoId}
                    fala={falas[funcionario.id] ?? null}
                    escrevendo={estado.geral.falandoId === funcionario.id
                        && estado.geral.etapaResposta === 'escrevendo'}
                    aoSelecionar={aoSelecionar}
                />
            ))}
        </Canvas>
    );
}
