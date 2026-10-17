import { CheckCircle, CircleNotch, Prohibit, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Ferramenta, Mensagem } from '../../../shared/funcionarios';

const iconesFerramenta: Record<Ferramenta['estado'], React.ReactNode> = {
    rodando: <CircleNotch size={12} className="animate-spin text-secundario" />,
    concluida: <CheckCircle size={12} className="text-[#5fd38a]" />,
    falhou: <XCircle size={12} className="text-[#e0574f]" />,
    recusada: <Prohibit size={12} className="text-[#f0b44c]" />,
};

const classeMarkdown =
    'text-[13px] leading-relaxed text-principal [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
    '[&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:my-2 ' +
    '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/30 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_a]:underline';

/** Linhas das ferramentas usadas numa resposta, com o estado de cada uma. Também usada no canal Geral. */
export function Ferramentas({ ferramentas }: { ferramentas: Ferramenta[] }) {
    if (ferramentas.length === 0) return null;
    return (
        <ul className="my-2 flex flex-col gap-1">
            {ferramentas.map((ferramenta) => (
                <li key={ferramenta.id} className="min-w-0 font-mono text-[11px] text-secundario">
                    <details className="rounded-md border border-borda/60 bg-black/10 px-2 py-1.5">
                        <summary className="flex cursor-pointer items-start gap-2">
                            <span className="mt-0.5 shrink-0">{iconesFerramenta[ferramenta.estado]}</span>
                            <span className="min-w-0 break-words">{ferramenta.resumo}</span>
                        </summary>
                        <div className="mt-2 space-y-3 border-t border-borda/60 pt-2">
                            <p>Estado: {ferramenta.estado}</p>
                            {ferramenta.iniciadaEm && <p>Início: {
                                new Date(ferramenta.iniciadaEm).toLocaleString('pt-BR')
                            }</p>}
                            {ferramenta.concluidaEm && <p>Fim: {
                                new Date(ferramenta.concluidaEm).toLocaleString('pt-BR')
                            }</p>}
                            {ferramenta.entrada && <div><p className="mb-1 text-discreto">Entrada</p>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                                    {ferramenta.entrada}
                                </pre>
                            </div>}
                            {ferramenta.saida && <div><p className="mb-1 text-discreto">Retorno</p>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                                    {ferramenta.saida}
                                </pre>
                            </div>}
                        </div>
                    </details>
                </li>
            ))}
        </ul>
    );
}

export function Resposta({ mensagem, emAndamento }: { mensagem: Mensagem; emAndamento: boolean }) {
    return (
        <div>
            {mensagem.partes?.length ? mensagem.partes.map((parte) => parte.tipo === 'ferramenta'
                ? <Ferramentas key={parte.id} ferramentas={[parte.ferramenta]} />
                : <div key={parte.id} className={classeMarkdown}>
                    <Markdown remarkPlugins={[remarkGfm]}>{parte.texto}</Markdown>
                </div>) : <>
            {mensagem.texto && (
                <div className={classeMarkdown}>
                    <Markdown remarkPlugins={[remarkGfm]}>{mensagem.texto}</Markdown>
                </div>
            )}
            {mensagem.ferramentas.length > 0 && <details className="mt-3 text-[11px] text-discreto">
                <summary className="cursor-pointer">Ferramentas do registro anterior (sequência não salva)</summary>
                <Ferramentas ferramentas={mensagem.ferramentas} />
            </details>}
            </>}
            {emAndamento && !mensagem.texto && mensagem.ferramentas.length === 0 && (
                <p className="animate-pulse text-[13px] text-discreto">Pensando</p>
            )}
            {mensagem.erro && <p className="mt-2 text-[12px] text-[#e0574f]">{mensagem.erro}</p>}
        </div>
    );
}

/** Conversa entre a Diretoria e um funcionário, com ferramentas do harness e erros reais. */
export function ListaMensagens({ mensagens, emAndamento }: { mensagens: Mensagem[]; emAndamento: boolean }) {
    const fim = useRef<HTMLDivElement>(null);
    const ultima = mensagens.findLast((mensagem) => mensagem.tipo !== 'pausa');
    useEffect(() => {
        void fim.current?.scrollIntoView({ block: 'end' });
    }, [ultima?.texto, ultima?.ferramentas.length, mensagens.length]);
    if (mensagens.length === 0) return <p className="p-5 text-[13px] text-discreto">Nenhuma tarefa ainda.</p>;
    return (
        <div className="flex flex-col gap-5 p-5">
            {mensagens.map((mensagem) =>
                mensagem.tipo === 'pausa' ? (
                    <p key={mensagem.id} className="text-[12px] text-discreto" role="status">
                        {mensagem.texto}
                    </p>
                ) : mensagem.autor === 'usuario' ? (
                    <p
                        key={mensagem.id}
                        className="ml-10 self-end rounded-lg bg-white/8 px-3 py-2 text-[13px] whitespace-pre-wrap text-principal"
                    >
                        {mensagem.texto}
                    </p>
                ) : (
                    <Resposta key={mensagem.id} mensagem={mensagem} emAndamento={emAndamento && mensagem === ultima} />
                ),
            )}
            <div ref={fim} />
        </div>
    );
}
