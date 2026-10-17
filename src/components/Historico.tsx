import { useEffect, useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import type { EstadoPublico } from '../../shared/estado';
import { categoriasHistorico, type RegistroHistorico } from '../../shared/historico';
import type { Resultado } from '../../shared/ponte';
import { useConversa } from '../hooks/useEscritorio';
import { lumon } from '../services/ponte';
import { ListaMensagens } from './conversa/ListaMensagens';
import { Janela } from './ui';

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dataLegivel = (data: string) => Number.isNaN(Date.parse(data)) ? '' : formatoData.format(new Date(data));

/** Arquivo da Diretoria com categorias, leitura de conversas e exclusão definitiva de registros. */
export function Historico({ estado, aoFechar, executar }: {
    estado: EstadoPublico;
    aoFechar: () => void;
    executar: (acao: Promise<Resultado>) => Promise<boolean>;
}) {
    const [registros, setRegistros] = useState<RegistroHistorico[]>([]);
    const [categoria, setCategoria] = useState('todas');
    const [busca, setBusca] = useState('');
    const [escolhidaId, setEscolhidaId] = useState<string | null>(null);
    const [confirmando, setConfirmando] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [limite, setLimite] = useState(80);
    const [erro, setErro] = useState('');
    useEffect(() => {
        let ativo = true;
        if (!lumon?.obterHistorico) {
            setErro('Reabra o Lumon para carregar o histórico atualizado.');
            return;
        }
        void lumon.obterHistorico().then((itens) => { if (ativo) setRegistros(itens); })
            .catch(() => { if (ativo) setErro('Não foi possível carregar o histórico.'); });
        return () => { ativo = false; };
    }, [estado]);
    const termo = busca.toLocaleLowerCase('pt-BR');
    const filtrados = registros.filter((registro) => (categoria === 'todas' || registro.categoria === categoria)
        && `${registro.titulo} ${registro.autor} ${registro.texto}`.toLocaleLowerCase('pt-BR').includes(termo));
    const escolhida = filtrados.find((registro) => registro.id === escolhidaId) ?? filtrados[0];
    const mensagens = useConversa(escolhida?.categoria === 'conversas' ? escolhida.funcionarioId ?? null : null);
    const excluir = async () => {
        if (!escolhida || !lumon || excluindo) return;
        setExcluindo(true);
        try {
            if (await executar(lumon.excluirRegistroHistorico(escolhida.id))) {
                setRegistros(await lumon.obterHistorico());
                setEscolhidaId(null);
                setConfirmando(false);
            }
        } finally { setExcluindo(false); }
    };
    return <Janela titulo="Histórico" aoFechar={aoFechar} largura="w-[960px] max-w-[calc(100vw-24px)]">
        <div className="flex gap-3 border-b border-borda p-3">
            <select aria-label="Categoria do histórico" value={categoria} onChange={(evento) => {
                setCategoria(evento.target.value); setConfirmando(false); setLimite(80);
            }} className="min-w-0 rounded-md border border-borda bg-fundo px-3 py-2 text-[12px] text-principal">
                <option value="todas">Todas as categorias</option>
                {Object.entries(categoriasHistorico).map(([chave, nome]) =>
                    <option key={chave} value={chave}>{nome}</option>)}
            </select>
            <input aria-label="Pesquisar histórico" placeholder="Pesquisar" value={busca} onChange={(evento) => {
                setBusca(evento.target.value); setConfirmando(false); setLimite(80);
            }} className="min-w-0 flex-1 rounded-md border border-borda bg-fundo px-3 text-[12px] text-principal" />
        </div>
        {erro ? <p className="p-5 text-[13px] text-secundario">{erro}</p>
            : <div className="grid h-[64vh] grid-cols-[minmax(180px,30%)_minmax(0,1fr)]">
                <div className="overflow-y-auto border-r border-borda">
                    <ul>
                        {filtrados.slice(0, limite).map((registro) => <li key={registro.id}>
                            <button onClick={() => { setEscolhidaId(registro.id); setConfirmando(false); }}
                                className={`w-full border-b border-borda px-4 py-3 text-left ${
                                    escolhida?.id === registro.id ? 'bg-white/6' : 'hover:bg-white/3'}`}>
                                <span className="block text-[10px] text-discreto">
                                    {categoriasHistorico[registro.categoria]} · {dataLegivel(registro.data)}
                                </span>
                                <span className="mt-1 block text-[13px] text-principal">{registro.titulo}</span>
                                <span className="mt-1 line-clamp-2 block text-[12px] text-secundario">
                                    {registro.texto}
                                </span>
                            </button>
                        </li>)}
                    </ul>
                    {filtrados.length > limite && <button onClick={() => setLimite(limite + 80)}
                        className="w-full p-3 text-[12px] text-secundario">Carregar mais</button>}
                </div>
                <div className="min-w-0 overflow-y-auto">
                    {!escolhida ? <p className="p-5 text-[13px] text-discreto">Nenhum registro encontrado.</p>
                        : <>
                            <div className="border-b border-borda p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[13px] text-principal">{escolhida.titulo}</p>
                                        <p className="mt-1 text-[11px] text-discreto">
                                            {escolhida.autor} · {dataLegivel(escolhida.data)}
                                            {escolhida.alcance && ` · ${escolhida.alcance}`}
                                        </p>
                                    </div>
                                    <button aria-label="Excluir registro" title="Excluir registro"
                                        onClick={() => setConfirmando(true)} disabled={excluindo}
                                        className="p-1 text-discreto hover:text-red-300">
                                        <Trash size={16} />
                                    </button>
                                </div>
                                {confirmando && <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px]">
                                    <span className="text-secundario">Excluir definitivamente este registro e suas cópias?</span>
                                    <button disabled={excluindo} onClick={() => void excluir()}
                                        className="text-red-300 disabled:opacity-50">
                                        {excluindo ? 'Excluindo' : 'Excluir definitivamente'}
                                    </button>
                                    <button disabled={excluindo} onClick={() => setConfirmando(false)}
                                        className="text-secundario">Cancelar</button>
                                </div>}
                                <p className="mt-4 whitespace-pre-wrap break-words text-[13px] text-principal">
                                    {escolhida.texto}
                                </p>
                            </div>
                            {escolhida.categoria === 'conversas' && <ListaMensagens
                                mensagens={mensagens.filter((mensagem) => mensagem.canal !== 'work')}
                                emAndamento={false} />}
                        </>}
                </div>
            </div>}
    </Janela>;
}
