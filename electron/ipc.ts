import type { Partidas } from './services/partidas';
import { esquemaNomeEscritorio } from '../shared/partidas';
import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { tiposItem } from '../shared/escritorio';
import { esquemaContratacao } from '../shared/funcionarios';
import { tiposIncentivo } from '../shared/incentivos';
import { canaisLumon, type ApiLumon, type Resultado } from '../shared/ponte';
import type { Escritorio } from './services/escritorio';
import { listarModelos } from './services/harness/modelos';
import { obterMotorLocal } from './services/motor';

import { esquemaThread } from '../shared/threads';

const id = z.string().min(1).max(80);
const celula = z.object({ x: z.number().int().min(0).max(64), z: z.number().int().min(0).max(64) });
const rotacao = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const texto = z.string().trim().min(1).max(20000);
const motivo = z.string().trim().min(1).max(500);

type Manipuladores = { [canal in (typeof canaisLumon)[number]]: (...argumentos: unknown[]) => ReturnType<ApiLumon[canal]> };

/** Registra os canais IPC. Cada argumento vindo da interface é validado antes de chegar ao escritório. */
export function registrarIpc(
    origem: Escritorio | (() => Escritorio),
    janela: () => BrowserWindow | null,
    reiniciar?: () => Promise<Resultado>,
    partidas?: Pick<Partidas, 'listar' | 'criar' | 'selecionar' | 'excluirRegistroHistorico'>,
): void {
    const obter = typeof origem === 'function' ? origem : () => origem;
    const manipuladores: Manipuladores = {
        reiniciar: async () => reiniciar ? reiniciar() : { ok: false, erro: 'Reinício indisponível nesta sessão.' },
        listarEscritorios: async () => {
            if (!partidas) throw new Error('Catálogo indisponível nesta sessão.');
            return partidas.listar();
        },
        criarEscritorio: async (nome) => partidas ? partidas.criar(esquemaNomeEscritorio.parse(nome))
            : { ok: false, erro: 'Catálogo indisponível nesta sessão.' },
        selecionarEscritorio: async (escritorioId) => partidas ? partidas.selecionar(z.string().uuid().parse(escritorioId))
            : { ok: false, erro: 'Catálogo indisponível nesta sessão.' },
        obterEstado: async () => obter().publico(),
        aprovarEntrega: async (trabalhoId) => obter().aprovarEntrega(id.parse(trabalhoId)),
        rejeitarEntrega: async (trabalhoId, razao) => obter().rejeitarEntrega(id.parse(trabalhoId),
            z.string().trim().min(1).max(2000).parse(razao)),
        corrigirEntrega: async (trabalhoId, razao) => obter().corrigirEntrega(id.parse(trabalhoId),
            z.string().trim().min(1).max(2000).parse(razao)),
        obterConversa: async (funcionarioId) => obter().conversa(id.parse(funcionarioId)),
        obterGeral: async () => obter().mensagensGeral(),
        obterHistorico: async () => obter().obterHistorico(),
        excluirRegistroHistorico: async (registroId) => partidas
            ? partidas.excluirRegistroHistorico(z.string().min(1).max(120).parse(registroId))
            : obter().excluirRegistroHistorico(z.string().min(1).max(120).parse(registroId)),
        limparGeral: async () => obter().limparGeral(),
        limparConversa: async (funcionarioId, threadId) =>
            obter().limparConversa(id.parse(funcionarioId), id.optional().parse(threadId)),
        enviarGeral: async (conteudo) => obter().enviarGeral(texto.parse(conteudo)),
        enviarTrabalho: async (projetoId, conteudo, threadId) =>
            obter().enviarTrabalho(id.parse(projetoId), texto.parse(conteudo), id.optional().parse(threadId)),
        limparTrabalhos: async (threadId, projetoId) =>
            obter().limparTrabalhos(id.optional().parse(threadId), id.optional().parse(projetoId)),
        interromperTrabalho: async (threadId, projetoId) =>
            obter().interromperTrabalho(id.optional().parse(threadId), id.optional().parse(projetoId)),
        alternarConversaLivre: async (ativa) => obter().alternarConversaLivre(z.boolean().parse(ativa)),
        alternarConversaSemLimite: async (ativa) => obter().alternarConversaSemLimite(z.boolean().parse(ativa)),
        encerrarReservado: async (funcionarioId, colegaId) =>
            obter().encerrarReservado(id.parse(funcionarioId), id.parse(colegaId)),
        marcarConversaLida: async (funcionarioId) => obter().marcarConversaLida(id.parse(funcionarioId)),
        criarThread: async (thread) => obter().criarThread(esquemaThread.parse(thread)),
        renomearThread: async (threadId, titulo) =>
            obter().renomearThread(id.parse(threadId), z.string().trim().min(1).max(80).parse(titulo)),
        excluirThread: async (threadId) => obter().excluirThread(id.parse(threadId)),
        listarModelos: async () => listarModelos(),
        obterMotor: async () => obterMotorLocal().estado,
        iniciarRefinamento: async (minutos) =>
            obter().iniciarRefinamento(z.number().int().min(1).max(60).parse(minutos)),
        adicionarProjeto: async () => ({ ok: false, erro: 'Projetos externos são somente histórico.' }),
        contratar: async (dados) => obter().contratar(esquemaContratacao.parse(dados)),
        editar: async (funcionarioId, dados) =>
            obter().editar(id.parse(funcionarioId), esquemaContratacao.parse(dados)),
        demitir: async (funcionarioId, razao) => obter().demitir(id.parse(funcionarioId), motivo.parse(razao)),
        decidirProposta: async (propostaId, aprovar) =>
            obter().decidirProposta(id.parse(propostaId), z.boolean().parse(aprovar)),
        concederFolga: async (funcionarioId) => obter().concederFolga(id.parse(funcionarioId)),
        enviarSalaDescanso: async (funcionarioId, razao) =>
            obter().enviarSalaDescanso(id.parse(funcionarioId), motivo.parse(razao)),
        concederIncentivo: async (tipo, razao, funcionarioId) => obter().concederIncentivo(
            z.enum(tiposIncentivo).parse(tipo), motivo.parse(razao), id.optional().parse(funcionarioId)),
        enviar: async (funcionarioId, conteudo, threadId) =>
            obter().enviar(id.parse(funcionarioId), texto.parse(conteudo), id.optional().parse(threadId)),
        interromper: async (funcionarioId) => obter().interromper(id.parse(funcionarioId)),
        responderAprovacao: async (aprovacaoId, aprovada) =>
            obter().responderAprovacao(id.parse(aprovacaoId), z.boolean().parse(aprovada)),
        comprar: async (tipo, posicao, giro) =>
            obter().comprar(z.enum(tiposItem).parse(tipo), celula.parse(posicao), rotacao.parse(giro)),
        mover: async (itemId, posicao, giro) => obter().mover(id.parse(itemId), celula.parse(posicao), rotacao.parse(giro)),
        vender: async (itemId) => obter().vender(id.parse(itemId)),
    };
    for (const canal of canaisLumon) {
        ipcMain.handle(`lumon:${canal}`, (_evento, ...argumentos: unknown[]) => manipuladores[canal](...argumentos));
    }
}
