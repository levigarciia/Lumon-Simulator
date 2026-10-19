import { useEffect, useRef } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import type { Funcionario } from '../../../shared/funcionarios';
import { organizarHistoricoWork, type EntradaWork } from '../../../shared/historicoWork';
import type { RegistroTrabalho } from '../../../shared/trabalho';
import { useConversa } from '../../hooks/useEscritorio';
import { threadPrincipal } from '../../../shared/threads';
import { Resposta } from './ListaMensagens';
import { RetratoFuncionario } from '../RetratoFuncionario';
import { AvaliacaoEntrega } from './AvaliacaoEntrega';
import type { Resultado } from '../../../shared/ponte';

const rotulos = {
    trabalhando: 'Em andamento', pausado: 'Período encerrado, arquivo preservado',
    concluido: 'Execução encerrada', falhou: 'Falhou', interrompido: 'Interrompido',
};

function RespostaAnterior({ trabalho }: { trabalho: RegistroTrabalho }) {
    const mensagens = useConversa(trabalho.funcionarioId);
    const pedido = mensagens.findIndex((mensagem) => mensagem.autor === 'usuario' && mensagem.canal === 'work'
        && mensagem.projetoId === trabalho.projetoId
        && (mensagem.threadId ?? threadPrincipal) === (trabalho.threadId ?? threadPrincipal)
        && mensagem.criadaEm >= trabalho.criadoEm && mensagem.texto.endsWith(trabalho.tarefa));
    const resposta = pedido >= 0 ? mensagens[pedido + 1] : undefined;
    return <Resposta emAndamento={trabalho.estado === 'trabalhando'} mensagem={resposta?.autor === 'funcionario'
        ? resposta : { id: trabalho.id, autor: 'funcionario', texto: trabalho.resultado,
            ferramentas: [], criadaEm: trabalho.criadoEm }} />;
}

function Entrada({ entrada, ultima, funcionarios, ocupado, executar }: {
    entrada: EntradaWork; ultima: boolean; funcionarios: Funcionario[];
    ocupado: boolean; executar?: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const { trabalho, partes, tipo } = entrada;
    const pedido = tipo === 'pedido';
    const solicitante = trabalho.solicitante?.nome ?? 'Solicitante não registrado';
    const daDiretoria = pedido && !trabalho.solicitante?.id && solicitante === 'Diretoria';
    const autorId = pedido ? trabalho.solicitante?.id : trabalho.funcionarioId;
    const aparenciaSalva = pedido ? trabalho.solicitante?.aparencia : trabalho.aparencia;
    const aparencia = aparenciaSalva ?? funcionarios.find((pessoa) => pessoa.id === autorId)?.aparencia;
    const data = partes[0]?.criadaEm ?? trabalho.criadoEm;
    return <article data-work-tipo={tipo} data-work-autor={pedido ? solicitante : trabalho.nome}
        data-work-origem={daDiretoria ? 'usuario' : 'funcionario'}
        className={`flex min-w-0 items-start gap-2 ${daDiretoria ? 'ml-12 max-w-[85%] self-end' : 'self-start w-full'}`}>
        {!daDiretoria && <span className="shrink-0 pt-1" role="img"
            aria-label={`Retrato de ${pedido ? solicitante : trabalho.nome}`}>
            {aparencia ? <RetratoFuncionario aparencia={aparencia} tamanho="pequeno" />
                : <UserCircle size={32} className="text-discreto" />}
        </span>}
        <div data-work-bolha className={`min-w-0 flex-1 rounded-xl border border-borda px-3 py-3
            ${daDiretoria ? 'bg-[#294943]' : 'bg-fundo/40'}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
            <strong className="text-secundario">
                {pedido ? `${solicitante} para ${trabalho.nome}` : trabalho.nome}
            </strong>
            <time dateTime={data} title={new Date(data).toLocaleString('pt-BR')} className="text-discreto">
                {new Date(data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </time>
        </div>
        {pedido ? <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-principal">{trabalho.tarefa}</p>
            : partes.length ? <Resposta emAndamento={false} mensagem={{
                id: entrada.id, autor: 'funcionario', texto: '', ferramentas: [], partes, criadaEm: data,
            }} /> : <RespostaAnterior trabalho={trabalho} />}
        {!pedido && ultima && <p className={`mt-3 text-[11px] ${trabalho.estado === 'falhou'
            ? 'text-[#eda599]' : 'text-discreto'}`}>{trabalho.falhaTecnica
                ? 'Serviço de IA indisponível' : rotulos[trabalho.estado]}</p>}
        {!pedido && ultima && trabalho.estado !== 'trabalhando' && trabalho.estado !== 'concluido'
            && partes.length > 0 && <p className="mt-2 text-[12px] text-[#eda599]">{trabalho.resultado}</p>}
        {!pedido && ultima && <AvaliacaoEntrega trabalho={trabalho} ocupado={ocupado} executar={executar} />}
        </div>
    </article>;
}

/** Exibe pedidos, decisões, ferramentas e retomadas na ordem salva, inclusive após o fim do trabalho. */
export function HistoricoWork({ trabalhos, funcionarios, executar,
    mensagemVazia = 'Envie um pedido para a equipe começar nesta conversa.' }: {
    trabalhos: RegistroTrabalho[]; funcionarios: Funcionario[];
    executar?: (operacao: Promise<Resultado>) => Promise<boolean>;
    mensagemVazia?: string;
}) {
    const entradas = organizarHistoricoWork(trabalhos);
    const rolagem = useRef<HTMLDivElement>(null);
    const acompanhar = useRef(true);
    useEffect(() => {
        if (acompanhar.current && rolagem.current) rolagem.current.scrollTop = rolagem.current.scrollHeight;
    }, [trabalhos]);
    const ultimas = new Map(entradas.filter((entrada) => entrada.tipo === 'resposta')
        .map((entrada) => [entrada.trabalho.id, entrada.id]));
    return <div ref={rolagem} role="tabpanel" aria-label="Histórico do Work"
        onScroll={() => {
            const elemento = rolagem.current;
            if (elemento) acompanhar.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 80;
        }} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!entradas.length && <p className="text-[13px] leading-relaxed text-discreto">
            {mensagemVazia}
        </p>}
        {entradas.map((entrada) => <Entrada key={entrada.id} entrada={entrada} funcionarios={funcionarios}
            ocupado={trabalhos.some((item) => item.estado === 'trabalhando')} executar={executar}
            ultima={ultimas.get(entrada.trabalho.id) === entrada.id} />)}
    </div>;
}
