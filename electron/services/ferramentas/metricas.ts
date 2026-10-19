import type { OrigemFerramenta } from '../../../shared/ferramentas';
import { createHash } from 'node:crypto';

const observadores = new Map<string, () => void>();
const descartes = new Map<string, (nome: string) => void>();

/** Liga a sessão local à métrica privada do servidor sem oferecer ferramentas de diagnóstico aos agentes. */
export function observarPromessas(url: string, observar: (() => void) | undefined): void {
    if (observar) observadores.set(url, observar);
    else observadores.delete(url);
}

/** Vincula descartes de lotes à mesma medição das recusas recebidas pelo MCP. */
export function observarDescartes(url: string, observar: ((nome: string) => void) | undefined): void {
    if (observar) descartes.set(url, observar);
    else descartes.delete(url);
}

/** Conta uma chamada que o harness descartou depois de encerrar a participação. */
export function registrarChamadaDescartada(url: string | undefined, nome: string): void {
    if (url) descartes.get(url)?.(nome);
}

/** Conta uma promessa retida pelo harness, sem armazenar seu texto. */
export function registrarPromessaRetida(url?: string): void {
    if (url) observadores.get(url)?.();
}

export type MedidaFerramenta = {
    nome: string; origem: OrigemFerramenta; anunciada: number; chamadas: number; recusas: number;
    duracaoMs: number; repeticoes: number; encerramentos: number; aposEncerramento: number; promessasRetidas: number;
};

/** Mantém contadores agregados sem armazenar argumentos, conversas ou pensamentos privados. */
export class MetricasFerramentas {
    private medidas = new Map<string, MedidaFerramenta>();
    private anteriores = new Map<string, string>();

    private medida(nome: string, origem: OrigemFerramenta): MedidaFerramenta {
        const chave = origem + ':' + nome;
        let medida = this.medidas.get(chave);
        if (!medida) {
            medida = { nome, origem, anunciada: 0, chamadas: 0, recusas: 0, duracaoMs: 0,
                repeticoes: 0, encerramentos: 0, aposEncerramento: 0, promessasRetidas: 0 };
            this.medidas.set(chave, medida);
        }
        return medida;
    }

    /** Conta uma capacidade efetivamente entregue pela listagem MCP. */
    anunciar(nome: string, origem: OrigemFerramenta): void { this.medida(nome, origem).anunciada++; }

    /** Mede uma tentativa e compara somente sua assinatura com a anterior do mesmo autor e canal. */
    iniciar(nome: string, origem: OrigemFerramenta, argumentos: unknown, ator: string): () => void {
        const medida = this.medida(nome, origem);
        medida.chamadas++;
        const chave = ator + ':' + origem;
        const assinatura = createHash('sha256').update(JSON.stringify({ nome, argumentos })).digest('hex');
        if (this.anteriores.get(chave) === assinatura) medida.repeticoes++;
        this.anteriores.set(chave, assinatura);
        const inicio = performance.now();
        return () => { medida.duracaoMs += performance.now() - inicio; };
    }

    /** Registra o desfecho técnico depois da resposta estruturada. */
    concluir(nome: string, origem: OrigemFerramenta, erro: boolean, terminal: boolean, aposEncerramento = false): void {
        const medida = this.medida(nome, origem);
        if (erro) medida.recusas++;
        if (terminal && !erro) medida.encerramentos++;
        if (aposEncerramento) medida.aposEncerramento++;
    }

    /** Conta a retenção de uma fala sem armazenar seu conteúdo. */
    reterPromessa(origem: OrigemFerramenta): void { this.medida('decisao_do_turno', origem).promessasRetidas++; }

    /** Conta tentativas de um lote descartadas pelo harness após a ação terminal. */
    descartar(nome: string, origem: OrigemFerramenta): void {
        const medida = this.medida(nome, origem);
        medida.chamadas++;
        medida.recusas++;
        medida.aposEncerramento++;
    }

    /** Libera assinaturas quando a credencial do funcionário é revogada. */
    revogar(ator: string): void {
        for (const chave of this.anteriores.keys()) if (chave.startsWith(ator + ':')) this.anteriores.delete(chave);
    }

    /** Entrega uma cópia dos contadores para diagnóstico do aplicativo. */
    consultar(): MedidaFerramenta[] { return structuredClone([...this.medidas.values()]); }
}
