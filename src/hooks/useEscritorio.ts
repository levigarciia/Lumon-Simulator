import { useEffect, useState } from 'react';
import type { EstadoPublico } from '../../shared/estado';
import type { Mensagem } from '../../shared/funcionarios';
import type { MensagemGeral } from '../../shared/geral';
import { falasNosBaloes, type FalaBalao } from '../../shared/baloes';
import { lumon } from '../services/ponte';
import { criarSimulacao, receberQuadro, type Simulacao } from '../store/simulacao';
import type { EventoSocial } from '../../shared/social';


/** Simulação alimentada pelos quadros do processo principal. O objeto é estável; só o conteúdo muda. */
export function useSimulacao(): Simulacao {
    const [simulacao] = useState(criarSimulacao);
    useEffect(() => {
        if (!lumon) return;
        return lumon.aoEvento((evento) => {
            if (evento.tipo === 'simulacao') receberQuadro(simulacao, evento.quadro);
        });
    }, [simulacao]);
    return simulacao;
}

/** Mensagens do canal Geral, atualizadas a cada fala. */
export function useGeral(): MensagemGeral[] {
    const [mensagens, setMensagens] = useState<MensagemGeral[]>([]);
    useEffect(() => {
        if (!lumon) return;
        const cancelar = lumon.aoEvento((evento) => {
            if (evento.tipo === 'geral') setMensagens(evento.mensagens);
        });
        void lumon.obterGeral().then(setMensagens);
        return cancelar;
    }, []);
    return mensagens;
}

/** Última fala recente de cada funcionário, para o balão sobre a cabeça. Some depois de alguns segundos. */
export function useFalasRecentes(
    mensagens: MensagemGeral[], eventos: EventoSocial[] = [],
): Record<string, FalaBalao> {
    const [agora, setAgora] = useState(() => Date.now());
    useEffect(() => {
        const temporizador = setInterval(() => setAgora(Date.now()), 250);
        return () => clearInterval(temporizador);
    }, []);
    return falasNosBaloes(mensagens, eventos, agora);
}

/** Estado público do escritório, atualizado a cada evento do processo principal. */
export function useEscritorio(): EstadoPublico | null {
    const [estado, setEstado] = useState<EstadoPublico | null>(null);
    useEffect(() => {
        if (!lumon) return;
        const cancelar = lumon.aoEvento((evento) => {
            if (evento.tipo === 'estado') setEstado(evento.estado);
        });
        void lumon.obterEstado().then(setEstado);
        return cancelar;
    }, []);
    return estado;
}

/** Conversa de um funcionário, ativo ou demitido, acompanhando o texto enquanto o harness responde. */
export function useConversa(funcionarioId: string | null): Mensagem[] {
    const [conversa, setConversa] = useState<{ id: string; mensagens: Mensagem[] } | null>(null);
    useEffect(() => {
        if (!lumon || !funcionarioId) return;
        let ativo = true;
        const cancelar = lumon.aoEvento((evento) => {
            if (evento.tipo === 'conversa' && evento.funcionarioId === funcionarioId) {
                setConversa({ id: funcionarioId, mensagens: evento.mensagens });
            }
        });
        void lumon.obterConversa(funcionarioId).then((mensagens) => {
            if (ativo) setConversa({ id: funcionarioId, mensagens });
        });
        return () => {
            ativo = false;
            cancelar();
        };
    }, [funcionarioId]);
    return conversa && conversa.id === funcionarioId ? conversa.mensagens : [];
}
