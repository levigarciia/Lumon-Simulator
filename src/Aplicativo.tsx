import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Celula, ItemPosicionado, TipoItem } from '../shared/escritorio';
import type { EstadoPublico } from '../shared/estado';
import type { Resultado } from '../shared/ponte';
import { Barra, type JanelaAberta } from './components/Barra';
const Escritorio = lazy(() => import('./components/cena/Escritorio')
    .then((modulo) => ({ default: modulo.Escritorio })));
const Contratacao = lazy(() => import('./components/Contratacao')
    .then((modulo) => ({ default: modulo.Contratacao })));
import { Equipe, idGeral } from './components/Equipe';
import { Historico } from './components/Historico';
import { Loja } from './components/Loja';
import { PainelFuncionario } from './components/PainelFuncionario';
import { Relogio } from './components/Relogio';
import { PainelGeral } from './components/PainelGeral';
import { useEscritorio, useFalasRecentes, useGeral, useSimulacao } from './hooks/useEscritorio';
import { lumon } from './services/ponte';
import { girar, type Modo } from './store/modo';
import { necessidadesIniciais } from '../shared/necessidades';
import { Preferencias } from './components/Preferencias';

const duracaoAvisoMs = 4000;

function mesaLivre(estado: EstadoPublico): boolean {
    const ocupadas = new Set(estado.funcionarios.map((funcionario) => funcionario.mesaId));
    return estado.sala.itens.some((item) => item.tipo === 'mesa' && !ocupadas.has(item.id));
}

function useAviso(): [string | null, (texto: string) => void] {
    const [aviso, setAviso] = useState<string | null>(null);
    useEffect(() => {
        if (!aviso) return;
        const temporizador = setTimeout(() => setAviso(null), duracaoAvisoMs);
        return () => clearTimeout(temporizador);
    }, [aviso]);
    return [aviso, setAviso];
}

function useTeclasEdicao(modo: Modo, setModo: (modo: Modo) => void): void {
    useEffect(() => {
        const teclar = (evento: KeyboardEvent) => {
            if (evento.target instanceof HTMLInputElement || evento.target instanceof HTMLTextAreaElement) return;
            if (modo.tipo === 'posicionar' && evento.key.toLowerCase() === 'r') {
                setModo({ ...modo, rotacao: girar(modo.rotacao) });
            }
            if (evento.key === 'Escape' && modo.tipo !== 'normal') {
                setModo(modo.tipo === 'posicionar' ? { tipo: 'editar' } : { tipo: 'normal' });
            }
        };
        window.addEventListener('keydown', teclar);
        return () => window.removeEventListener('keydown', teclar);
    }, [modo, setModo]);
}

function Mensagem({ texto }: { texto: string }) {
    return <main className="flex h-full items-center justify-center text-[13px] text-discreto">{texto}</main>;
}

export function Aplicativo() {
    const estado = useEscritorio();
    const simulacao = useSimulacao();
    const mensagensGeral = useGeral();
    const falas = useFalasRecentes(mensagensGeral, estado?.social.eventos);
    const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
    const [modo, setModo] = useState<Modo>({ tipo: 'normal' });
    const [janela, setJanela] = useState<JanelaAberta | null>(null);
    const [aviso, setAviso] = useAviso();
    useTeclasEdicao(modo, setModo);

    const executar = useCallback(
        async (operacao: Promise<Resultado>) => {
            try {
                const resultado = await operacao;
                if (!resultado.ok) setAviso(resultado.erro);
                return resultado.ok;
            } catch (erro) {
                setAviso(erro instanceof Error ? erro.message : 'Não foi possível concluir a operação.');
                return false;
            }
        },
        [setAviso],
    );

    if (!lumon) return <Mensagem texto="Abra o Lumon pelo aplicativo desktop." />;
    if (!estado) return <Mensagem texto="Abrindo o escritório" />;

    const funcionario = estado.funcionarios.find((candidato) => candidato.id === selecionadoId);
    const comprar = (tipo: TipoItem) => {
        setJanela(null);
        setModo({ tipo: 'posicionar', item: tipo, rotacao: 0 });
    };
    const escolherItem = (item: ItemPosicionado) =>
        setModo({ tipo: 'posicionar', item: item.tipo, itemId: item.id, rotacao: item.rotacao });
    const posicionar = async (celula: Celula) => {
        if (modo.tipo !== 'posicionar') return;
        const operacao = modo.itemId
            ? lumon!.mover(modo.itemId, celula, modo.rotacao)
            : lumon!.comprar(modo.item, celula, modo.rotacao);
        if (await executar(operacao)) setModo({ tipo: 'editar' });
    };
    const vender = async () => {
        if (modo.tipo === 'posicionar' && modo.itemId && (await executar(lumon!.vender(modo.itemId)))) {
            setModo({ tipo: 'editar' });
        }
    };

    return (
        <main className="relative h-full overflow-hidden">
            <Suspense fallback={<Mensagem texto="Preparando a sala" />}><Escritorio
                estado={estado}
                simulacao={simulacao}
                modo={modo}
                selecionadoId={selecionadoId}
                aoSelecionar={setSelecionadoId}
                aoEscolherItem={escolherItem}
                aoPosicionar={(celula) => void posicionar(celula)}
                falas={falas}
            />
            <div className="absolute inset-x-0 top-0 h-9 [-webkit-app-region:drag]" />
            </Suspense>
            <Relogio moedas={estado.moedas} />
            <Equipe
                funcionarios={estado.funcionarios}
                status={estado.status}
                naoLidas={estado.naoLidas ?? {}}
                selecionadoId={selecionadoId}
                aoSelecionar={setSelecionadoId}
            />
            {estado.sala.itens.length === 0 && modo.tipo === 'normal' && (
                <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] text-secundario">
                    O escritório está vazio. Compre uma mesa na loja e contrate o primeiro funcionário.
                </p>
            )}
            <Barra
                modo={modo}
                aoAbrir={setJanela}
                aoAlternarEdicao={() => setModo(modo.tipo === 'normal' ? { tipo: 'editar' } : { tipo: 'normal' })}
                aoVender={() => void vender()}
            />
            {funcionario && (
                <PainelFuncionario
                    key={funcionario.id}
                    funcionario={funcionario}
                    status={estado.status[funcionario.id] ?? 'ocioso'}
                    conversando={estado.conversandoIds?.includes(funcionario.id) ?? false}
                    naoLidas={estado.naoLidas?.[funcionario.id] ?? 0}
                    necessidades={estado.necessidades[funcionario.id] ?? necessidadesIniciais}
                    ausencia={estado.ausencias?.[funcionario.id]}
                    moedas={estado.moedas}
                    carreira={estado.carreira}
                    pensamento={estado.pensamentos?.[funcionario.id]}
                    social={estado.social}
                    funcionarios={estado.funcionarios}
                    demissoes={estado.demissoes}
                    threads={estado.threads ?? []}
                    projetos={estado.projetos}
                    trabalhos={estado.trabalhos ?? []}
                    aprovacoes={estado.aprovacoes.filter((aprovacao) => aprovacao.funcionarioId === funcionario.id)}
                    aoFechar={() => setSelecionadoId(null)}
                    aoEditar={() => setJanela('editar')}
                    executar={executar}
                />
            )}
            {janela === 'editar' && funcionario && (
                <Suspense fallback={null}><Contratacao
                    key={funcionario.id}
                    editando={funcionario}
                    mesaLivre={mesaLivre(estado)}
                    aoFechar={() => setJanela(null)}
                    aoAbrirLoja={() => setJanela('loja')}
                    executar={executar}
                /></Suspense>
            )}
            {selecionadoId === idGeral && (
                <PainelGeral
                    refinamentos={estado.refinamentos}
                    cota={estado.cota}
                    mensagens={mensagensGeral}
                    funcionarios={estado.funcionarios}
                    situacao={estado.geral}
                    social={estado.social}
                    threads={estado.threads ?? []}
                    projetos={estado.projetos}
                    trabalhos={estado.trabalhos ?? []}
                    aprovacoes={estado.aprovacoes}
                    aoFechar={() => setSelecionadoId(null)}
                    executar={executar}
                />
            )}
            {janela === 'contratar' && (
                <Suspense fallback={null}><Contratacao
                    mesaLivre={mesaLivre(estado)}
                    aoFechar={() => setJanela(null)}
                    aoAbrirLoja={() => setJanela('loja')}
                    executar={executar}
                /></Suspense>
            )}
            {janela === 'loja' && <Loja moedas={estado.moedas} aoFechar={() => setJanela(null)} aoComprar={comprar} />}
            {janela === 'historico' && <Historico estado={estado} aoFechar={() => setJanela(null)} executar={executar} />}
            {janela === 'preferencias' && <Preferencias
                aoFechar={() => setJanela(null)} executar={executar} />}
            {aviso && (
                <p className="absolute top-12 left-1/2 z-30 -translate-x-1/2 rounded-md border border-[#e0574f]/40 bg-superficie px-4 py-2 text-[13px] text-principal">
                    {aviso}
                </p>
            )}
        </main>
    );
}
