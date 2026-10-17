import { useEffect, useState } from 'react';
import type { CatalogoEscritorios } from '../../shared/partidas';
import type { Resultado } from '../../shared/ponte';
import { lumon } from '../services/ponte';
import { Botao, classeEntrada, Janela } from './ui';

/** Permite criar e abrir escritórios independentes ou reiniciar somente a partida ativa. */
export function Preferencias({ aoFechar, executar }: {
    aoFechar: () => void;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
}) {
    const [catalogo, setCatalogo] = useState<CatalogoEscritorios | null>(null);
    const [nome, setNome] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [confirmando, setConfirmando] = useState(false);
    const [erro, setErro] = useState('');
    useEffect(() => {
        let ativo = true;
        void lumon!.listarEscritorios().then((dados) => { if (ativo) setCatalogo(dados); })
            .catch((falha: unknown) => {
                if (ativo) setErro(falha instanceof Error ? falha.message : 'Não foi possível listar os escritórios.');
            });
        return () => { ativo = false; };
    }, []);
    const trocar = async (operacao: () => Promise<Resultado>) => {
        if (ocupado) return;
        setOcupado(true);
        try {
            if (await executar(operacao())) window.location.reload();
        } finally { setOcupado(false); }
    };
    return <Janela titulo="Configurações" aoFechar={() => { if (!ocupado) aoFechar(); }} largura="w-[460px]">
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
            <p className="text-[13px] text-secundario">
                Cada escritório tem equipe, sala e histórico próprios. A partida atual é salva antes da troca.
            </p>
            {erro && <p role="alert" className="text-[13px] text-[#e0574f]">{erro}</p>}
            {!catalogo && !erro && <p className="text-[13px] text-discreto">Carregando escritórios</p>}
            {catalogo && <div className="flex flex-col gap-2" aria-label="Escritórios salvos">
                {catalogo.escritorios.map((escritorio) => <div key={escritorio.id}
                    className="flex items-center justify-between gap-3 rounded border border-borda p-3">
                    <span className="min-w-0 break-words text-[13px] text-principal">{escritorio.nome}</span>
                    {escritorio.id === catalogo.ativoId
                        ? <span className="text-[12px] text-secundario">Atual</span>
                        : <Botao disabled={ocupado} onClick={() => void trocar(() =>
                            lumon!.selecionarEscritorio(escritorio.id))}>Abrir</Botao>}
                </div>)}
            </div>}
            <form className="flex flex-col gap-3" onSubmit={(evento) => {
                evento.preventDefault();
                void trocar(() => lumon!.criarEscritorio(nome.trim()));
            }}>
                <label className="flex flex-col gap-2 text-[13px] text-secundario">
                    Nome do novo escritório
                    <input className={classeEntrada} value={nome} maxLength={60} required disabled={ocupado}
                        onChange={(evento) => setNome(evento.target.value)} placeholder="Cenário de teste" />
                </label>
                <Botao variante="principal" type="submit" disabled={ocupado || !catalogo || !nome.trim()}>
                    {ocupado ? 'Aguarde' : 'Criar escritório'}
                </Botao>
            </form>
            <div className="flex flex-col gap-3 border-t border-borda pt-4">
                {confirmando ? <>
                    <p className="text-[13px] text-principal">
                        Apagar o progresso de
                        {` ${catalogo?.escritorios.find((item) => item.id === catalogo.ativoId)?.nome}`}?
                        Os outros escritórios serão preservados.
                    </p>
                    <div className="flex gap-2">
                        <Botao disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</Botao>
                        <Botao variante="perigo" disabled={ocupado}
                            onClick={() => void trocar(() => lumon!.reiniciar())}>
                            Apagar e recomeçar
                        </Botao>
                    </div>
                </> : <Botao variante="perigo" disabled={ocupado || !catalogo}
                    onClick={() => setConfirmando(true)}>Recomeçar este escritório</Botao>}
            </div>
        </div>
    </Janela>;
}
