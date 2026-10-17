import { Stop } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Funcionario, Projeto } from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import { threadPrincipal, type Thread } from '../../shared/threads';
import type { RegistroTrabalho } from '../../shared/trabalho';
import { lumon } from '../services/ponte';
import { HistoricoWork } from './conversa/HistoricoWork';
import { FaixaThreads, type ItemThread } from './conversa/SeletorThreads';
import { Botao } from './ui';

type Grupo = ItemThread & { projetoId: string; threadId: string; trabalhos: RegistroTrabalho[] };

function chaveGrupo(trabalho: RegistroTrabalho): string {
    return `${trabalho.projetoId}:${trabalho.threadId ?? threadPrincipal}`;
}

function agruparPorThread(trabalhos: RegistroTrabalho[], projetos: Projeto[], threads: Thread[]): Grupo[] {
    const grupos = new Map<string, Grupo>();
    for (const trabalho of trabalhos) {
        const chave = chaveGrupo(trabalho);
        const grupo = grupos.get(chave);
        if (grupo) {
            grupo.trabalhos.push(trabalho);
            grupo.ativo ||= trabalho.estado === 'trabalhando';
            continue;
        }
        const projeto = projetos.find((item) => item.id === trabalho.projetoId)?.nome ?? 'Projeto removido';
        const thread = threads.find((item) => item.id === trabalho.threadId)?.titulo ?? 'Principal';
        grupos.set(chave, { id: chave, titulo: `${projeto} · ${thread}`, trabalhos: [trabalho], excluivel: true,
            projetoId: trabalho.projetoId, threadId: trabalho.threadId ?? threadPrincipal,
            ativo: trabalho.estado === 'trabalhando' });
    }
    return [...grupos.values()].reverse();
}

function excluirGrupo(grupo: Grupo, threads: Thread[]): Promise<Resultado> {
    const existe = threads.some((thread) => thread.id === grupo.threadId);
    return existe ? lumon!.excluirThread(grupo.threadId) : lumon!.limparTrabalhos(grupo.threadId, grupo.projetoId);
}

/** Mostra as tarefas reais que o funcionário executou no Work, separadas por projeto e thread. */
export function WorkFuncionario({ funcionario, funcionarios, projetos, threads, trabalhos, executar }: {
    funcionario: Funcionario;
    funcionarios: Funcionario[];
    projetos: Projeto[];
    threads: Thread[];
    trabalhos: RegistroTrabalho[];
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const chave = `lumon:work-funcionario:${funcionario.id}`;
    const [selecao, setSelecao] = useState(() => localStorage.getItem(chave) ?? '');
    const grupos = agruparPorThread(trabalhos.filter((item) => item.funcionarioId === funcionario.id),
        projetos, threads);
    if (!grupos.length) {
        return <p className="p-5 text-[13px] leading-relaxed text-discreto">
            {funcionario.nome} ainda não recebeu tarefas do Work.
        </p>;
    }
    const atual = grupos.find((grupo) => grupo.id === selecao) ?? grupos.find((grupo) => grupo.ativo) ?? grupos[0]!;
    const selecionar = (id: string) => {
        localStorage.setItem(chave, id);
        setSelecao(id);
    };
    return <>
        <FaixaThreads itens={grupos} selecionado={atual.id} aoSelecionar={selecionar} aoExcluir={(id) => {
            const grupo = grupos.find((item) => item.id === id);
            if (grupo) void executar(excluirGrupo(grupo, threads));
        }} />
        <HistoricoWork key={atual.id} trabalhos={atual.trabalhos} funcionarios={funcionarios} executar={executar} />
        {atual.ativo && <div className="shrink-0 border-t border-borda p-4">
            <Botao className="w-full" onClick={() => void lumon?.interromper(funcionario.id)}>
                <Stop size={14} weight="fill" /> Interromper tarefa
            </Botao>
        </div>}
    </>;
}
