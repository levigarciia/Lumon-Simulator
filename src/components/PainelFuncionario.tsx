import { PaperPlaneRight, Stop, X } from '@phosphor-icons/react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import {
    nomeCargo,
    type Aprovacao,
    type Demissao,
    type Funcionario,
    type Projeto,
    type StatusFuncionario,
} from '../../shared/funcionarios';
import type { Necessidades } from '../../shared/necessidades';
import type { Resultado } from '../../shared/ponte';
import { useConversa } from '../hooks/useEscritorio';
import { lumon } from '../services/ponte';
import { ListaMensagens } from './conversa/ListaMensagens';
import { Botao, classeEntrada } from './ui';
import { MenuAcoes } from './MenuAcoes';
import { RetratoFuncionario } from './RetratoFuncionario';
import { SeletorThreads, useRascunho, useSelecaoThread } from './conversa/SeletorThreads';
import { threadPrincipal, type Thread } from '../../shared/threads';
import { humor } from '../../shared/necessidades';
import { mensagensComPausas } from '../../shared/geral';
import type { Pensamento } from '../../shared/trabalho';
import type { EstadoSocial } from '../../shared/social';
import { FichaSocial } from './FichaSocial';
import { PropostasFuncionario } from './PropostasFuncionario';
import { WorkFuncionario } from './WorkFuncionario';
import { AcoesDiretoria, type DecisaoDiretoria } from './AcoesDiretoria';
import { nomesAusencia, type Ausencia } from '../../shared/ausencias';
import { estagioEsgotamento, nomesEstagio } from '../../shared/esgotamento';
import type { RegistroTrabalho } from '../../shared/trabalho';
import { caminhosCarreira, situacaoCarreira, type Carreira } from '../../shared/carreira';

export const rotulosStatus: Record<StatusFuncionario, string> = {
    ocioso: 'Livre',
    trabalhando: 'Trabalhando',
    bloqueado: 'Aguardando aprovação',
    erro: 'Serviço de IA indisponível',
    em_pausa: 'Em pausa',
};

export const coresStatus: Record<StatusFuncionario, string> = {
    ocioso: 'bg-discreto',
    trabalhando: 'bg-[#5fd38a]',
    bloqueado: 'bg-[#f0b44c]',
    erro: 'bg-[#e0574f]',
    em_pausa: 'bg-[#6fa8dc]',
};

type Aba = 'ficha' | 'chat' | 'work';

const rotulosAbas: Record<Aba, string> = { ficha: 'Ficha', chat: 'Chat', work: 'Work' };

const barras:{ chave: 'energia' | 'estresse' | 'fome' | 'esgotamento'; rotulo: string; cor: string }[] = [
    { chave: 'energia', rotulo: 'Energia', cor: '[&::-webkit-progress-value]:bg-[#5fd38a]' },
    { chave: 'estresse', rotulo: 'Estresse', cor: '[&::-webkit-progress-value]:bg-[#e0574f]' },
    { chave: 'fome', rotulo: 'Fome', cor: '[&::-webkit-progress-value]:bg-[#f0b44c]' },
    { chave: 'esgotamento', rotulo: 'Esgotamento', cor: '[&::-webkit-progress-value]:bg-[#9b7fd1]' },
];

function CarreiraFuncionario({ id, equipe, carreira }: { id: string; equipe: Funcionario[]; carreira: Carreira }) {
    const situacao = situacaoCarreira(id, equipe, carreira);
    const pessoa = equipe.find((item) => item.id === id);
    const caminhos = pessoa ? caminhosCarreira(pessoa.cargo) : [];
    if (situacao.tipo === 'fora_da_escada') return null;
    const detalhe = situacao.tipo === 'topo' ? 'Cargo mais alto do departamento'
        : situacao.tipo === 'insuficiente' ? `Faltam ${situacao.falta} para ${nomeCargo(situacao.proximo)}`
            : situacao.tipo === 'sem_vaga' ? `Sem vaga de ${nomeCargo(situacao.proximo)}`
                : `Pode pedir promoção a ${nomeCargo(situacao.proximo)}`;
    return (
        <div className="border-b border-borda px-5 py-3 text-[12px] text-secundario">
            <p>Mérito: {Math.round(carreira[id]?.merito ?? 0)}</p>
            <p className="mt-1 text-discreto">{detalhe}</p>
            {caminhos.length > 1 && <p className="mt-1 text-discreto">
                Caminhos: {caminhos.map(nomeCargo).join(' ou ')}. O funcionário escolhe seu objetivo.
            </p>}
        </div>
    );
}

function BarrasNecessidades({ necessidades }: { necessidades: Necessidades }) {
    return (
        <div className="grid grid-cols-4 gap-3 border-b border-borda px-5 py-3">
            {barras.map(({ chave, rotulo, cor }) => (
                <div key={chave} className="flex flex-col gap-1">
                    <span className="flex justify-between text-[11px] text-discreto">
                        {rotulo}
                        <span className="tabular-nums">{Math.round(necessidades[chave] ?? 0)}</span>
                    </span>
                    <progress
                        value={necessidades[chave] ?? 0}
                        max={100}
                        className={`h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-white/8 [&::-webkit-progress-value]:rounded-full ${cor}`}
                    />
                </div>
            ))}
        </div>
    );
}

type PropriedadesPainel = {
    conversando?: boolean;
    naoLidas?: number;
    funcionario: Funcionario;
    status: StatusFuncionario;
    necessidades: Necessidades;
    ausencia?: Ausencia;
    moedas: number;
    carreira: Carreira;
    pensamento?: Pensamento;
    social: EstadoSocial;
    funcionarios: Funcionario[];
    demissoes: Demissao[];
    projetos: Projeto[];
    threads: Thread[];
    trabalhos: RegistroTrabalho[];
    aprovacoes: Aprovacao[];
    aoFechar: () => void;
    aoEditar: () => void;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
};

export function Aprovacoes({ aprovacoes }: { aprovacoes: Aprovacao[] }) {
    if (aprovacoes.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 border-t border-borda p-4">
            {aprovacoes.map((aprovacao) => (
                <div key={aprovacao.id} className="rounded-lg border border-[#f0b44c]/40 bg-[#f0b44c]/8 p-3">
                    <p className="mb-3 font-mono text-[12px] break-all text-principal">{aprovacao.resumo}</p>
                    <div className="flex gap-2">
                        <Botao variante="principal" onClick={() => lumon?.responderAprovacao(aprovacao.id, true)}>
                            Aprovar
                        </Botao>
                        <Botao onClick={() => lumon?.responderAprovacao(aprovacao.id, false)}>Recusar</Botao>
                    </div>
                </div>
            ))}
        </div>
    );
}

function Demissao({ funcionario, executar, aoCancelar }: {
    funcionario: Funcionario;
    executar: PropriedadesPainel['executar'];
    aoCancelar: () => void;
}) {
    const [motivo, setMotivo] = useState('');
    const demitir = () => void executar(lumon!.demitir(funcionario.id, motivo));
    return (
        <div className="flex flex-col gap-3 border-t border-borda p-4">
            <textarea
                autoFocus
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                placeholder={`Por que ${funcionario.nome} está sendo demitido?`}
                className={`${classeEntrada} h-20 resize-none py-2`}
            />
            <div className="flex justify-end gap-2">
                <Botao onClick={aoCancelar}>Cancelar</Botao>
                <Botao variante="perigo" disabled={!motivo.trim()} onClick={demitir}>
                    Demitir
                </Botao>
            </div>
        </div>
    );
}

type PropriedadesCompositor = Pick<PropriedadesPainel, 'funcionario' | 'status' | 'executar' | 'conversando'>
    & { threadId: string; emAndamento: boolean };

function Compositor({ funcionario, status, executar, threadId, emAndamento, conversando }: PropriedadesCompositor) {
    const [texto, setTexto] = useRascunho(`lumon:rascunho:conversa:${funcionario.id}:${threadId}`);
    const [enviando, setEnviando] = useState(false);
    const ocupado = status === 'trabalhando' || status === 'bloqueado' || Boolean(conversando);

    const enviar = async () => {
        if (!texto.trim() || ocupado || enviando) return;
        setEnviando(true);
        try {
            if (await executar(lumon!.enviar(funcionario.id, texto, threadId))) setTexto('');
        } finally {
            setEnviando(false);
        }
    };
    const teclar = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
        if (evento.key !== 'Enter' || evento.shiftKey) return;
        evento.preventDefault();
        void enviar();
    };

    return (
        <div className="flex flex-col gap-2 border-t border-borda p-4">
            {ocupado && !emAndamento && <p className="text-[12px] text-discreto">
                Este funcionário está respondendo em outra conversa ou trabalhando.
            </p>}
            <div className="relative">
                <textarea
                    value={texto}
                    onChange={(evento) => setTexto(evento.target.value)}
                    onKeyDown={teclar}
                    placeholder={`Mensagem para ${funcionario.nome}`}
                    disabled={enviando}
                    className={`${classeEntrada} h-24 w-full resize-none py-2 pr-12`}
                />
                <button
                    onClick={() => (emAndamento ? void lumon?.interromper(funcionario.id) : void enviar())}
                    disabled={!emAndamento && (ocupado || enviando || !texto.trim())}
                    aria-label={emAndamento ? 'Interromper' : 'Enviar'}
                    className="absolute right-2 bottom-3 flex size-8 items-center justify-center rounded-md bg-principal text-fundo"
                >
                    {emAndamento ? <Stop size={14} weight="fill" /> : <PaperPlaneRight size={14} weight="fill" />}
                </button>
            </div>
        </div>
    );
}

/** Painel lateral do funcionário selecionado: conversa, aprovações pendentes, envio de tarefas e demissão. */
export function PainelFuncionario(propriedades: PropriedadesPainel) {
    const { funcionario, status, aprovacoes, aoFechar, aoEditar, executar } = propriedades;
    const selecao = useSelecaoThread({ threads: propriedades.threads, tipo: 'conversa',
        destinoId: funcionario.id, executar });
    const { threadId } = selecao;
    const conversa = useConversa(funcionario.id);
    const mensagens = mensagensComPausas(conversa.filter((mensagem) =>
        (mensagem.threadId ?? threadPrincipal) === threadId && mensagem.canal !== 'work'),
    propriedades.social.eventos, funcionario.id);
    const emAndamento = Boolean(propriedades.conversando)
        && (conversa.at(-1)?.threadId ?? threadPrincipal) === threadId && conversa.at(-1)?.canal !== 'work';
    const [demitindo, setDemitindo] = useState(false);
    const [decisao, setDecisao] = useState<DecisaoDiretoria | null>(null);
    const situacao = propriedades.ausencia ? nomesAusencia[propriedades.ausencia.motivo] : rotulosStatus[status];
    const [aba, setAba] = useState<Aba>('ficha');
    const trabalhando = (status === 'trabalhando' || status === 'bloqueado') && conversa.at(-1)?.canal === 'work';
    const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
    const naoLidas = propriedades.naoLidas ?? 0;
    useEffect(() => {
        if (aba === 'chat' && threadId === threadPrincipal && naoLidas > 0) {
            void lumon?.marcarConversaLida(funcionario.id);
        }
    }, [aba, threadId, naoLidas, funcionario.id]);
    return (
        <aside className="absolute top-12 right-4 bottom-24 z-10 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-borda bg-superficie shadow-xl">
            <header className="shrink-0 flex items-start justify-between gap-3 border-b border-borda px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-medium text-principal">{funcionario.nome}</h2>
                    <p className="text-[12px] text-discreto">
                        {nomeCargo(funcionario.cargo)} · {funcionario.modelo.nome}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-[12px] text-secundario">
                        <span className={`size-2 rounded-full ${coresStatus[status]}`} />
                        {situacao}
                    </p>
                </div>
                <div className="flex gap-1">
                    <MenuAcoes acoes={[
                        { nome: 'Editar', executar: aoEditar },
                        { nome: 'Conceder folga', executar: () => void executar(lumon!.concederFolga(funcionario.id)),
                            desabilitada: Boolean(propriedades.ausencia) },
                        { nome: 'Conceder incentivo', executar: () => setDecisao('incentivo') },
                        { nome: 'Sala de Descanso', executar: () => setDecisao('sala_descanso'),
                            desabilitada: Boolean(propriedades.ausencia), perigo: true },
                        { nome: 'Limpar chat', executar: () => setConfirmandoLimpeza(true),
                            desabilitada: mensagens.length === 0 },
                        { nome: 'Demitir', executar: () => setDemitindo(true), perigo: true },
                    ]} />
                    <button onClick={aoFechar} className="rounded p-1.5 text-discreto hover:text-principal" aria-label="Fechar">
                        <X size={16} />
                    </button>
                </div>
            </header>
            <div className="flex shrink-0 gap-5 border-b border-borda px-5" role="tablist" aria-label="Funcionário">
                {(Object.keys(rotulosAbas) as Aba[]).map((item) => (
                    <button key={item} role="tab" aria-selected={aba === item} onClick={() => setAba(item)}
                        className={`flex items-center gap-2 border-b-2 py-3 text-[12px] ${aba === item
                            ? 'border-[#b3ceba] text-principal' : 'border-transparent text-discreto'}`}>
                        {rotulosAbas[item]}
                        {item === 'work' && trabalhando && <span aria-label="Em andamento"
                            className="size-1.5 animate-pulse rounded-full bg-[#5fd38a]" />}
                        {item === 'chat' && naoLidas > 0 && <span aria-label={`${naoLidas} mensagens novas`}
                            className="size-1.5 rounded-full bg-[#6fa8dc]" />}
                        {item === (trabalhando ? 'work' : 'chat') && aprovacoes.length > 0
                            && <span className="text-[#f0b44c]">{aprovacoes.length}</span>}
                    </button>
                ))}
            </div>
            {aba === 'chat' && <SeletorThreads selecao={selecao}
                ativos={emAndamento ? [threadId] : []} />}
            {confirmandoLimpeza && (
                <div className="border-b border-borda p-4">
                    <p className="mb-3 text-[13px]">Apagar o histórico desta thread de {funcionario.nome}?</p>
                    <div className="flex gap-2">
                        <Botao variante="perigo" onClick={async () => {
                            if (await executar(lumon!.limparConversa(funcionario.id, threadId))) setConfirmandoLimpeza(false);
                        }}>Apagar conversa</Botao>
                        <Botao onClick={() => setConfirmandoLimpeza(false)}>Cancelar</Botao>
                    </div>
                </div>
            )}
            {aba === 'ficha' ? (
                <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                    <div className="flex items-center gap-5 px-5 py-6">
                        <RetratoFuncionario aparencia={funcionario.aparencia} grande />
                        <div className="space-y-2 text-[12px] text-secundario">
                            <p className="text-[10px] tracking-[0.18em] text-discreto uppercase">Bem estar</p>
                            <p className="text-3xl font-light text-principal">{humor(propriedades.necessidades)}
                                <span className="ml-1 text-[12px] text-discreto">/ 100</span>
                            </p>
                            <p>{nomesEstagio[estagioEsgotamento(propriedades.necessidades.esgotamento ?? 0)]}</p>
                        </div>
                    </div>
                    <BarrasNecessidades necessidades={propriedades.necessidades} />
                    <CarreiraFuncionario id={funcionario.id} equipe={propriedades.funcionarios}
                        carreira={propriedades.carreira} />
                    <FichaSocial id={funcionario.id} social={propriedades.social}
                        funcionarios={propriedades.funcionarios} demissoes={propriedades.demissoes} />
                    <PropostasFuncionario id={funcionario.id} social={propriedades.social}
                        funcionarios={propriedades.funcionarios} executar={executar} />
                    <section className="px-5 py-6">
                        <h3 className="mb-3 text-[10px] tracking-[0.18em] text-discreto uppercase">Pensamento privado</h3>
                        <p className="rounded-xl border border-borda bg-fundo/50 p-4 text-[14px] leading-relaxed
                            text-principal">{propriedades.pensamento?.texto ?? 'Ainda não registrou um pensamento.'}</p>
                        {propriedades.pensamento && <p className="mt-2 text-[11px] text-discreto">
                            Atualizado em {new Date(propriedades.pensamento.atualizadoEm).toLocaleString('pt-BR')}
                        </p>}
                    </section>
                    <div className="grid grid-cols-2 gap-4 px-5 pb-6 text-[12px] text-secundario">
                        <div><p className="mb-1 text-discreto">Modelo</p>{funcionario.modelo.nome}</div>
                        <div><p className="mb-1 text-discreto">Permissões</p>
                            Personagem do departamento</div>
                    </div>
                </div>
            ) : aba === 'chat' ? (
                <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                    <ListaMensagens mensagens={mensagens} emAndamento={emAndamento} />
                </div>
            ) : (
                <WorkFuncionario funcionario={funcionario} funcionarios={propriedades.funcionarios}
                    projetos={propriedades.projetos} threads={propriedades.threads}
                    trabalhos={propriedades.trabalhos} executar={executar} />
            )}
            <Aprovacoes aprovacoes={(aba === 'chat' && emAndamento) || (aba === 'work' && trabalhando)
                ? aprovacoes : []} />
            {demitindo ? (
                <Demissao funcionario={funcionario} executar={executar} aoCancelar={() => setDemitindo(false)} />
            ) : decisao ? (
                <AcoesDiretoria decisao={decisao} funcionario={funcionario} moedas={propriedades.moedas}
                    executar={executar} aoConcluir={() => setDecisao(null)} />
            ) : aba === 'chat' ? (
                <Compositor key={threadId} {...propriedades} threadId={threadId} emAndamento={emAndamento} />
            ) : aba === 'ficha' && (
                <div className="shrink-0 border-t border-borda p-4">
                    <Botao variante="principal" className="w-full" onClick={() => setAba('chat')}>Abrir chat</Botao>
                </div>
            )}
        </aside>
    );
}
