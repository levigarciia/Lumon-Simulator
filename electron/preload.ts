import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { canalEventos, type ApiLumon, type canaisLumon, type EventoLumon } from '../shared/ponte';

function invocar<Canal extends (typeof canaisLumon)[number]>(canal: Canal): ApiLumon[Canal] {
    return ((...argumentos: unknown[]) => ipcRenderer.invoke(`lumon:${canal}`, ...argumentos)) as ApiLumon[Canal];
}

const api: ApiLumon = {
    obterEstado: invocar('obterEstado'),
    reiniciar: invocar('reiniciar'),
    listarEscritorios: invocar('listarEscritorios'),
    criarEscritorio: invocar('criarEscritorio'),
    selecionarEscritorio: invocar('selecionarEscritorio'),
    aprovarEntrega: invocar('aprovarEntrega'),
    rejeitarEntrega: invocar('rejeitarEntrega'),
    corrigirEntrega: invocar('corrigirEntrega'),
    obterConversa: invocar('obterConversa'),
    obterGeral: invocar('obterGeral'),
    obterHistorico: invocar('obterHistorico'),
    excluirRegistroHistorico: invocar('excluirRegistroHistorico'),
    excluirHistoricoCompleto: invocar('excluirHistoricoCompleto'),
    excluirArquivoWork: invocar('excluirArquivoWork'),
    limparGeral: invocar('limparGeral'),
    limparConversa: invocar('limparConversa'),
    enviarGeral: invocar('enviarGeral'),
    enviarTrabalho: invocar('enviarTrabalho'),
    limparTrabalhos: invocar('limparTrabalhos'),
    interromperTrabalho: invocar('interromperTrabalho'),
    alternarConversaLivre: invocar('alternarConversaLivre'),
    alternarConversaSemLimite: invocar('alternarConversaSemLimite'),
    encerrarReservado: invocar('encerrarReservado'),
    marcarConversaLida: invocar('marcarConversaLida'),
    criarThread: invocar('criarThread'),
    renomearThread: invocar('renomearThread'),
    excluirThread: invocar('excluirThread'),
    listarModelos: invocar('listarModelos'),
    obterMotor: invocar('obterMotor'),
    iniciarRefinamento: invocar('iniciarRefinamento'),
    adicionarProjeto: invocar('adicionarProjeto'),
    contratar: invocar('contratar'),
    editar: invocar('editar'),
    demitir: invocar('demitir'),
    decidirProposta: invocar('decidirProposta'),
    concederFolga: invocar('concederFolga'),
    enviarSalaDescanso: invocar('enviarSalaDescanso'),
    concederIncentivo: invocar('concederIncentivo'),
    enviar: invocar('enviar'),
    interromper: invocar('interromper'),
    responderAprovacao: invocar('responderAprovacao'),
    comprar: invocar('comprar'),
    mover: invocar('mover'),
    vender: invocar('vender'),
    aoEvento: (ouvinte) => {
        const receber = (_evento: IpcRendererEvent, dados: EventoLumon) => ouvinte(dados);
        ipcRenderer.on(canalEventos, receber);
        return () => {
            ipcRenderer.removeListener(canalEventos, receber);
        };
    },
};

contextBridge.exposeInMainWorld('lumon', api);
