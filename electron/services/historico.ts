import type { EstadoSalvo } from '../../shared/estado';
import { nomeDoFuncionario, type Ferramenta, type Mensagem } from '../../shared/funcionarios';
import { categoriaAcontecimento, nomesAcontecimentos, type RegistroHistorico } from '../../shared/historico';
import type { EventoSocial } from '../../shared/social';

function acontecimentos(estado: EstadoSalvo): EventoSocial[] {
    return [...new Map([...estado.demissoes.flatMap((demissao) => demissao.historicoSocial),
        ...estado.social.propostas.flatMap((proposta) => proposta.registros),
        ...estado.social.historico, ...estado.social.lembrancas, ...estado.social.eventos]
        .map((evento) => [evento.id, evento])).values()];
}

/** Reúne registros para a Diretoria, incluindo conteúdos privados que não são expostos aos personagens. */
export function listarHistorico(estado: EstadoSalvo): RegistroHistorico[] {
    const nome = (id: string) => id === 'diretoria' ? 'Diretoria'
        : nomeDoFuncionario(id, estado.funcionarios, estado.demissoes);
    const eventos = acontecimentos(estado).filter((evento) => evento.tipo !== 'demissao'
        || !estado.demissoes.some((demissao) => demissao.funcionario.id === evento.alvoId));
    const registros: RegistroHistorico[] = eventos.map((evento) => ({
        id: evento.id, categoria: categoriaAcontecimento(evento.tipo), titulo: nomesAcontecimentos[evento.tipo],
        texto: evento.texto, data: evento.criadoEm, autor: evento.autorNome ?? nome(evento.autorId),
        alcance: evento.alcance,
    }));
    for (const demissao of estado.demissoes) registros.push({ id: demissao.id, categoria: 'equipe',
        titulo: `Demissão de ${demissao.funcionario.nome}`, texto: demissao.motivo,
        autor: demissao.demitidoPor, data: demissao.data });
    for (const [id, mensagens] of Object.entries(estado.conversas)) {
        const chat = mensagens.filter((mensagem) => mensagem.canal !== 'work');
        if (!chat.length) continue;
        registros.push({ id: `conversa:${id}`, categoria: 'conversas', titulo: `Conversa com ${nome(id)}`,
            texto: `${chat.length} mensagens privadas.`, autor: nome(id),
            funcionarioId: id, data: chat.at(-1)!.criadaEm });
    }
    for (const id of new Set([...Object.keys(estado.historicoPensamentos), ...Object.keys(estado.pensamentos)])) {
        for (const pensamento of [...(estado.historicoPensamentos[id] ?? []),
            ...(estado.pensamentos[id] ? [estado.pensamentos[id]!] : [])]) {
            if (!pensamento.id) continue;
            registros.push({ id: pensamento.id, categoria: 'pensamentos', titulo: `Pensamento de ${nome(id)}`,
                texto: pensamento.texto, data: pensamento.atualizadoEm, autor: nome(id), alcance: 'privado' });
        }
    }
    return registros.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
}

/** Apaga registros e suas cópias sociais, sem recalcular consequências já aplicadas à partida. */
export function excluirRegistros(estado: EstadoSalvo, ids: Set<string>): EstadoSalvo {
    ids = new Set(ids);
    const eventos = acontecimentos(estado);
    const demissoes = estado.demissoes.filter((demissao) => !ids.has(demissao.id));
    const removidos = estado.demissoes.filter((demissao) => ids.has(demissao.id));
    for (const evento of eventos) {
        if (evento.tipo === 'demissao' && removidos.some((demissao) => demissao.funcionario.id === evento.alvoId)) {
            ids.add(evento.id);
        }
    }
    let mudou = true;
    while (mudou) {
        mudou = false;
        for (const evento of eventos) {
            if (!ids.has(evento.id) && evento.fontes.some((fonte) => ids.has(fonte))) {
                ids.add(evento.id);
                mudou = true;
            }
        }
    }
    const manter = (evento: EventoSocial) => !ids.has(evento.id);
    const textos = [...eventos.filter((evento) => ids.has(evento.id)).map((evento) => evento.texto),
        ...Object.values(estado.pensamentos).filter((pensamento) => ids.has(pensamento.id ?? ''))
            .map((pensamento) => pensamento.texto),
        ...Object.values(estado.historicoPensamentos).flat().filter((pensamento) => ids.has(pensamento.id ?? ''))
            .map((pensamento) => pensamento.texto)];
    const referencias = [...ids, ...textos.filter((texto) => texto.length >= 24).map((texto) => texto.slice(0, 120))];
    const ferramentaMantida = (ferramenta: Ferramenta) => !referencias.some((referencia) =>
        `${ferramenta.entrada ?? ''} ${ferramenta.saida ?? ''}`.includes(referencia));
    const limparMensagem = (mensagem: Mensagem): Mensagem => ({ ...mensagem,
        ferramentas: mensagem.ferramentas.filter(ferramentaMantida),
        partes: mensagem.partes?.filter((parte) => parte.tipo !== 'ferramenta'
            || ferramentaMantida(parte.ferramenta)) });
    return { ...estado, demissoes: demissoes.map((demissao) => ({ ...demissao,
        evidencias: demissao.evidencias.filter((id) => !ids.has(id)),
        historicoSocial: demissao.historicoSocial.filter(manter) })),
    geral: estado.geral.filter((mensagem) => !ids.has(mensagem.id) && !ids.has(mensagem.eventoId ?? ''))
        .map((mensagem) => ({ ...mensagem, ferramentas: mensagem.ferramentas.filter(ferramentaMantida) }))
        .filter((mensagem) => mensagem.tipo !== 'acao' || mensagem.ferramentas.length > 0),
    conversas: Object.fromEntries(Object.entries(estado.conversas).map(([id, mensagens]) =>
        [id, mensagens.map(limparMensagem)])),
    pensamentos: Object.fromEntries(Object.entries(estado.pensamentos).filter(([, pensamento]) =>
        !ids.has(pensamento.id ?? ''))),
    historicoPensamentos: Object.fromEntries(Object.entries(estado.historicoPensamentos)
        .map(([id, pensamentos]) => [id, pensamentos.filter((pensamento) => !ids.has(pensamento.id ?? ''))])),
    social: { ...estado.social, eventos: estado.social.eventos.filter(manter),
        lembrancas: estado.social.lembrancas.filter(manter), historico: estado.social.historico.filter(manter),
        propostas: estado.social.propostas.filter((proposta) => !proposta.evidencias.some((id) => ids.has(id))
            && !eventos.some((evento) =>
            ids.has(evento.id) && evento.tipo === 'proposta' && evento.autorId === proposta.autorId
                && evento.alvoId === proposta.alvoId && evento.texto.includes(proposta.motivo)))
            .map((proposta) => ({ ...proposta, registros: proposta.registros.filter(manter),
                evidencias: proposta.evidencias.filter((id) => !ids.has(id)) })),
        intencoes: estado.social.intencoes.filter((intencao) => !ids.has(intencao.fonteId)),
        relacoes: estado.social.relacoes.map((relacao) => ({ ...relacao,
            ultimoEventoId: ids.has(relacao.ultimoEventoId) ? '' : relacao.ultimoEventoId,
            marcadores: relacao.marcadores?.filter((marcador) => !ids.has(marcador.eventoId)) })),
    } };
}

/**
 * Apaga arquivos de Macrodados do Work: trabalhos, grade e mensagens das sessões. Sem IDs, apaga todos.
 * As mensagens não guardam o trabalho, então cada arquivo ocupa o intervalo entre seu início e o do próximo,
 * o que é exato porque só um arquivo é refinado por vez. A cota do dia não muda.
 */
export function excluirArquivosWork(estado: EstadoSalvo, arquivoIds?: ReadonlySet<string>): EstadoSalvo {
    const inicios = new Map<string, number>();
    for (const trabalho of estado.trabalhos) {
        if (!trabalho.arquivoId) continue;
        const inicio = Date.parse(trabalho.criadoEm);
        inicios.set(trabalho.arquivoId, Math.min(inicios.get(trabalho.arquivoId) ?? inicio, inicio));
    }
    const ordem = [...inicios].sort((a, b) => a[1] - b[1]);
    const removidos = new Set(ordem.map(([id]) => id).filter((id) => !arquivoIds || arquivoIds.has(id)));
    const janelas = ordem.flatMap(([id, inicio], indice) => removidos.has(id)
        ? [[inicio, ordem[indice + 1]?.[1] ?? Infinity] as const] : []);
    const projetos = new Set(estado.trabalhos.filter((item) => removidos.has(item.arquivoId ?? ''))
        .map((item) => item.projetoId));
    const daJanela = (mensagem: Mensagem) => {
        const data = Date.parse(mensagem.criadaEm);
        return janelas.some(([inicio, fim]) => data >= inicio && data < fim);
    };
    const trabalhos = new Set(estado.trabalhos.filter((item) => removidos.has(item.arquivoId ?? ''))
        .map((item) => item.id));
    const nomes = [...removidos].flatMap((id) => estado.refinamentos[id]
        ? [`arquivo ${estado.refinamentos[id]!.nome}`] : []);
    const eventos = new Set(acontecimentos(estado).filter((evento) => trabalhos.has(evento.trabalhoId ?? '')
        || nomes.some((nome) => evento.texto.includes(nome))).map((evento) => evento.id));
    const semEventos = excluirRegistros(estado, eventos);
    return { ...semEventos,
        trabalhos: estado.trabalhos.filter((item) => !removidos.has(item.arquivoId ?? '')),
        refinamentos: Object.fromEntries(Object.entries(estado.refinamentos).filter(([id]) => !removidos.has(id))),
        conversas: Object.fromEntries(Object.entries(semEventos.conversas).map(([id, mensagens]) => [id,
            mensagens.filter((mensagem) => mensagem.canal !== 'work' || !projetos.has(mensagem.projetoId ?? '')
                || !daJanela(mensagem))])) };
}

/** Apaga todos os registros listados à Diretoria, incluindo os diálogos individuais, o Work e suas cópias. */
export function excluirHistoricoCompleto(estado: EstadoSalvo): EstadoSalvo {
    const conversas = listarHistorico(estado).filter((registro) => registro.categoria === 'conversas');
    const semConversas = conversas.reduce((atual, registro) =>
        apagarConversaHistorica(atual, registro.funcionarioId!), estado);
    const semRegistros = excluirRegistros(semConversas,
        new Set(listarHistorico(semConversas).map((registro) => registro.id)));
    return excluirArquivosWork(semRegistros);
}

/** Apaga um diálogo individual e suas fontes, incluindo cópias arquivadas e pensamentos registrados nele. */
export function apagarConversaHistorica(estado: EstadoSalvo, funcionarioId: string): EstadoSalvo {
    const mensagens = (estado.conversas[funcionarioId] ?? []).filter((mensagem) => mensagem.canal !== 'work');
    const trechos = mensagens.map((mensagem) => mensagem.texto.trim().slice(0, 120)).filter((texto) => texto.length >= 24);
    const ids = new Set(acontecimentos(estado).filter((evento) =>
        (evento.autorId === 'diretoria' && evento.alvoId === funcionarioId && evento.alcance === 'reservado')
        || trechos.some((trecho) => evento.texto.includes(trecho))).map((evento) => evento.id));
    const pensamentosDoChat = new Set<string>();
    for (const mensagem of mensagens) {
        for (const ferramenta of mensagem.ferramentas) {
            if (!ferramenta.resumo.includes('atualizar_pensamento') || !ferramenta.entrada) continue;
            try {
                const entrada: unknown = JSON.parse(ferramenta.entrada);
                if (entrada && typeof entrada === 'object' && 'pensamento' in entrada
                    && typeof entrada.pensamento === 'string') pensamentosDoChat.add(entrada.pensamento);
            } catch {}
        }
    }
    for (const pensamento of [...(estado.historicoPensamentos[funcionarioId] ?? []),
        ...(estado.pensamentos[funcionarioId] ? [estado.pensamentos[funcionarioId]!] : [])]) {
        if (pensamento.id && pensamentosDoChat.has(pensamento.texto)) ids.add(pensamento.id);
    }
    const proximo = excluirRegistros(estado, ids);
    return { ...proximo,
        pensamentos: Object.fromEntries(Object.entries(proximo.pensamentos).filter(([id, pensamento]) =>
            id !== funcionarioId || !pensamentosDoChat.has(pensamento.texto))),
        historicoPensamentos: { ...proximo.historicoPensamentos,
            [funcionarioId]: (proximo.historicoPensamentos[funcionarioId] ?? [])
                .filter((pensamento) => !pensamentosDoChat.has(pensamento.texto)) },
        conversas: { ...proximo.conversas, [funcionarioId]: (estado.conversas[funcionarioId] ?? [])
            .filter((mensagem) => mensagem.canal === 'work') },
        threads: proximo.threads.filter((thread) => thread.tipo !== 'conversa' || thread.destinoId !== funcionarioId),
        naoLidas: { ...proximo.naoLidas, [funcionarioId]: 0 } };
}
