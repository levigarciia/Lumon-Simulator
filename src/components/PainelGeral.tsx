import { ChatsCircle, Cloud, Infinity as IconeInfinito, PaperPlaneRight, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SituacaoGeral, EstadoPublico } from '../../shared/estado';
import type { Aprovacao, Projeto, Funcionario } from '../../shared/funcionarios';
import { autorSistema, autorUsuario, falasDoChat, type FalaChat, type MensagemGeral } from '../../shared/geral';
import type { Resultado } from '../../shared/ponte';
import { limparHistorico, lumon } from '../services/ponte';
import { Ferramentas } from './conversa/ListaMensagens';
import { Botao, classeEntrada } from './ui';
import { MenuAcoes } from './MenuAcoes';
import { PainelWork } from './PainelWork';
import type { RegistroTrabalho } from '../../shared/trabalho';

import type { Thread } from '../../shared/threads';
import { RetratoFuncionario } from './RetratoFuncionario';
import { ImpactosRelacao } from './social/ImpactosRelacao';
import type { EstadoSocial } from '../../shared/social';

const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
const rotulosEtapa = {
    preparando: 'está preparando a resposta',
    aguardando_motor: 'está aguardando o motor',
    processando: 'está processando a conversa',
    reagindo: 'está reagindo à conversa',
    escrevendo: 'está escrevendo',
    executando_acao: 'está realizando uma ação',
};

type PropriedadesPainelGeral = {
    mensagens: MensagemGeral[];
    funcionarios: Funcionario[];
    projetos: Projeto[];
    threads: Thread[];
    trabalhos: RegistroTrabalho[];
    refinamentos: EstadoPublico['refinamentos'];
    cota: EstadoPublico['cota'];
    aprovacoes: Aprovacao[];
    situacao: SituacaoGeral;
    social: EstadoSocial;
    aoFechar: () => void;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
};

function Fala({ mensagem, autor, funcionario, nome }: {
    mensagem: FalaChat; autor: string; funcionario?: Funcionario; nome: (id: string) => string;
}) {
    if (mensagem.autorId === autorSistema) {
        return <p className="text-center text-[11px] text-discreto">{mensagem.texto}</p>;
    }
    const daDiretoria = mensagem.autorId === autorUsuario;
    const pensamento = mensagem.tipo === 'pensamento';
    const classeBalao = pensamento
        ? 'border border-dashed border-[#a9baca]/60 bg-transparent italic text-secundario'
        : daDiretoria ? 'bg-[#294943] text-principal' : 'bg-[#20373d] text-principal';
    return (
        <div className={`flex items-start gap-2 ${daDiretoria ? 'justify-end' : ''}`}>
            {!daDiretoria && funcionario && <span className="shrink-0 pt-1" role="img"
                aria-label={`Retrato de ${autor}`}>
                <RetratoFuncionario aparencia={funcionario.aparencia} tamanho="pequeno" />
            </span>}
            <div className={`flex min-w-0 flex-1 flex-col gap-1 ${daDiretoria ? 'items-end' : 'items-start'}`}>
            <span className="flex items-center gap-1.5 text-[11px] text-discreto">
                {autor} · {formatoHora.format(new Date(mensagem.criadaEm))}
                {pensamento && <><Cloud size={12} /><span>Pensamento</span></>}
            </span>
            {mensagem.participantes && <span className="text-[10px] text-[#b3ceba]">
                Reservado: {autor} e {mensagem.destinatarioNome ?? 'colega'}
            </span>}
            {mensagem.acao && <span className="text-[10px] font-medium text-[#e0b25c]">{mensagem.acao}</span>}
            {mensagem.alcance === 'local' &&<span className="text-[10px] text-discreto">Presencial</span>}
            {mensagem.texto && (
                <p
                    aria-label={pensamento ? `Pensamento de ${autor}` : undefined}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] whitespace-pre-wrap ${classeBalao}`}
                >
                    {mensagem.texto}
                </p>
            )}
            {mensagem.impactosRelacao && <ImpactosRelacao impactos={mensagem.impactosRelacao} nome={nome} />}
            {mensagem.ferramentas.length > 0 && (
                <div className="max-w-[85%] -mt-1">
                    <Ferramentas ferramentas={mensagem.ferramentas} />
                </div>
            )}
            </div>
        </div>
    );
}

/**
 * Canal com a equipe inteira. Sem menções, todos respondem; com `@Nome`, só quem foi citado. A conversa livre
 * deixa os agentes falando entre si até ficarem em silêncio ou atingirem o limite, que pode ser desativado.
 */
export function PainelGeral({ mensagens, funcionarios, situacao, aoFechar, executar,
    trabalhos, aprovacoes, social, refinamentos, cota }: PropriedadesPainelGeral) {
    const [texto, setTexto] = useState('');
    const [aba, setAba] = useState<'chat' | 'work'>('chat');
    const [conversa, setConversa] = useState('todas');
    const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
    const fim = useRef<HTMLDivElement>(null);
    const nomes = new Map(funcionarios.map((funcionario) => [funcionario.id, funcionario.nome]));
    const escrevendo = situacao.falandoId ? nomes.get(situacao.falandoId) : undefined;
    const falas = falasDoChat([...mensagens, ...(situacao.falasEmAndamento ?? [])], social.eventos);
    const textoEmAndamento = situacao.falasEmAndamento?.map((fala) => fala.texto).join('');
    const chaveConversa = (fala: FalaChat) => fala.participantes ? [...fala.participantes].sort().join(':') : 'geral';
    const reservadas = new Map(falas.filter((fala) => fala.participantes).map((fala) => [chaveConversa(fala),
        fala.participantes!.map((id) => nomes.get(id) ?? 'Ex funcionário').join(' e ')]));
    const visiveis = falas.filter((fala) => conversa === 'todas' || chaveConversa(fala) === conversa);
    useEffect(() => {
        void fim.current?.scrollIntoView({ block: 'end' });
    }, [mensagens, falas.length, textoEmAndamento, escrevendo, conversa, aba]);

    const enviar = async () => {
        if (!texto.trim()) return;
        if (await executar(lumon!.enviarGeral(texto))) setTexto('');
    };
    const teclar = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
        if (evento.key !== 'Enter' || evento.shiftKey) return;
        evento.preventDefault();
        void enviar();
    };

    return (
        <aside className={`absolute top-12 right-4 bottom-24 z-10 flex max-w-[calc(100vw-2rem)]
            flex-col rounded-2xl border border-borda bg-superficie shadow-xl
            ${aba === 'work' ? 'w-[520px]' : 'w-[420px]'}`}>
            <header className="shrink-0 flex items-start justify-between gap-3 border-b border-borda px-5 py-4">
                <div>
                    <h2 className="text-[15px] font-medium text-principal">Geral</h2>
                    <p className="text-[12px] text-discreto">{aba === 'chat' ? 'A sala de convivência'
                        : 'Refinamento de Macrodados'}</p>
                </div>
                <div className="flex gap-1">
                    {aba === 'chat' && <MenuAcoes acoes={[{ nome: 'Limpar histórico', executar: () => setConfirmandoLimpeza(true),
                        desabilitada: falas.length === 0 }]} />}
                    <button onClick={aoFechar} className="rounded p-1.5 text-discreto hover:text-principal" aria-label="Fechar">
                        <X size={16} />
                    </button>
                </div>
            </header>
            <div className="flex shrink-0 items-center justify-between border-b border-borda px-5">
                <div role="tablist" aria-label="Geral" className="flex gap-5">
                    {(['chat', 'work'] as const).map((item) => (
                        <button key={item} role="tab" aria-selected={aba === item}
                            onClick={() => { setAba(item); setConfirmandoLimpeza(false); }}
                            className={`border-b-2 py-3 text-[12px] ${aba === item
                                ? 'border-[#b3ceba] text-principal' : 'border-transparent text-discreto'}`}>
                            {item === 'chat' ? 'Chat' : 'Work'}
                        </button>
                    ))}
                </div>
                {aba === 'chat' && <div className="flex items-center gap-3">
                    <button aria-label="Conversa sem limite de turnos" aria-pressed={situacao.semLimite}
                        title={situacao.semLimite ? 'Sem limite de turnos' : 'Remover limite de turnos'}
                        onClick={() => void executar(lumon!.alternarConversaSemLimite(!situacao.semLimite))}
                        className={`rounded p-1.5 ${situacao.semLimite
                            ? 'bg-[#294943] text-[#b3ceba]' : 'text-discreto hover:text-principal'}`}>
                        <IconeInfinito size={18} />
                    </button>
                    <button
                        disabled={situacao.encerrando}
                        title={situacao.semLimite ? 'Sem limite de turnos'
                            : `${situacao.falasRestantes} falas entre agentes até sua próxima mensagem`}
                        onClick={() => void executar(lumon!.alternarConversaLivre(!situacao.conversaAtiva))}
                        className="flex items-center gap-2 text-[11px] text-secundario disabled:opacity-60">
                        <ChatsCircle size={14} /> {situacao.encerrando ? 'Encerrando conversa'
                            : situacao.conversaAtiva ? 'Encerrar conversa' : 'Conversa livre'}
                    </button>
                </div>}
            </div>
            {confirmandoLimpeza && (
                <div className="border-b border-borda bg-fundo p-4">
                    <p className="mb-3 text-[13px] text-principal">
                        {aba === 'chat' ? 'Apagar o histórico e encerrar as respostas pendentes do Chat?'
                            : 'Apagar o histórico do Work? Os chats individuais serão preservados.'}
                    </p>
                    <div className="flex gap-2">
                        <Botao variante="perigo" onClick={async () => {
                            if (await executar(aba === 'chat' ? limparHistorico() : lumon!.limparTrabalhos())) setConfirmandoLimpeza(false);
                        }}>Apagar conversa</Botao>
                        <Botao onClick={() => setConfirmandoLimpeza(false)}>Cancelar</Botao>
                    </div>
                </div>
            )}
            {aba === 'work' ? (
                <PainelWork funcionarios={funcionarios} trabalhos={trabalhos}
                    aprovacoes={aprovacoes} executar={executar} refinamentos={refinamentos} cota={cota} />
            ) : <>
            <div className="border-b border-borda px-5 py-3">
                <select aria-label="Filtrar conversa" value={conversa}
                    onChange={(evento) => setConversa(evento.target.value)} className={`${classeEntrada} w-full`}>
                    <option value="todas">Todas as conversas</option>
                    <option value="geral">Geral</option>
                    {[...reservadas].map(([id, nome]) => <option key={id} value={id}>Reservado: {nome}</option>)}
                </select>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5" role="tabpanel">
                {visiveis.length === 0 && <p className="text-[13px] text-discreto">Ninguém falou nada ainda.</p>}
                {visiveis.map((mensagem) => (
                    <Fala
                        key={mensagem.id}
                        mensagem={mensagem}
                        nome={(id) => nomes.get(id) ?? social.eventos.find((evento) => evento.autorId === id)?.autorNome
                            ?? 'Ex funcionário'}
                        funcionario={funcionarios.find((pessoa) => pessoa.id === mensagem.autorId)}
                        autor={mensagem.autorId === autorUsuario ? 'Diretoria'
                            : (mensagem.autorNome ?? nomes.get(mensagem.autorId) ?? 'Ex funcionário')}
                    />
                ))}
                {escrevendo && <p role="status" className="animate-pulse text-[12px] text-discreto">
                    {situacao.etapaResposta ? `${escrevendo} ${rotulosEtapa[situacao.etapaResposta]}`
                        : 'Reabra o Lumon para atualizar o chat.'}
                </p>}
                <div ref={fim} />
            </div>
            {situacao.reservadosAtivos?.includes(conversa) && <div className="border-t border-borda p-4">
                <Botao variante="perigo" className="w-full" onClick={() => {
                    const [funcionarioId, colegaId] = conversa.split(':');
                    void executar(lumon!.encerrarReservado(funcionarioId!, colegaId!));
                }}>Encerrar conversa</Botao>
            </div>}
            {(conversa === 'todas' || conversa === 'geral') && <div className="relative border-t border-borda p-4">
                <textarea
                    value={texto}
                    onChange={(evento) => setTexto(evento.target.value)}
                    onKeyDown={teclar}
                    placeholder="Fale com todos ou cite alguém com @Nome"
                    className={`${classeEntrada} h-20 w-full resize-none py-2 pr-12`}
                />
                <button
                    onClick={() => void enviar()}
                    disabled={!texto.trim()}
                    aria-label="Enviar"
                    className="absolute right-6 bottom-7 flex size-8 items-center justify-center rounded-md bg-principal text-fundo"
                >
                    <PaperPlaneRight size={14} weight="fill" />
                </button>
            </div>}
            </>}
        </aside>
    );
}
