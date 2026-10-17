import type { BackendRuntime } from '../../shared/modelos';

/** Deixa o runtime escolher a janela do modelo e ajustar as camadas à memória disponível. */
export function argumentosContextoAutomatico(
    backend: BackendRuntime, contextoTentado = 0, contextoMinimo = 2048,
): string[] {
    if (!Number.isSafeInteger(contextoMinimo) || contextoMinimo < 2048) {
        throw new Error('Contexto mínimo inválido.');
    }
    return [
        ...(contextoTentado ? ['-c', String(contextoTentado)] : []),
        '-ngl', backend === 'cpu' ? '0' : 'auto', '--fit', 'on',
        '--fit-ctx', String(contextoMinimo), '--fit-target', '1024',
    ];
}

/** Aceita somente o tamanho de janela realmente informado pelo servidor carregado. */
export function contextoDoServidor(propriedades: unknown): number {
    const contexto = (propriedades as { default_generation_settings?: { n_ctx?: number } } | null)
        ?.default_generation_settings?.n_ctx;
    if (!Number.isSafeInteger(contexto) || contexto! < 2048) {
        throw new Error('O motor não informou um contexto válido.');
    }
    return contexto!;
}

/** Reduz uma tentativa que falhou por memória, sem reduzir o espaço necessário ao pedido atual. */
export function contextoAposFalha(registro: string, contextoTentado: number, contextoMinimo = 2048): number | null {
    if (!/out of memory|failed to allocate|cannot allocate|unable to allocate|not enough memory|ErrorOutOfDeviceMemory/i
        .test(registro)) return null;
    const reservado = Number(registro.match(/\bn_ctx\s*=\s*(\d+)/)?.[1]);
    const treinado = Number(registro.match(/n_ctx_train\s*=\s*(\d+)/)?.[1]);
    const anterior = contextoTentado || (reservado >= 2048 ? reservado : treinado);
    if (!Number.isSafeInteger(anterior) || anterior <= contextoMinimo) return null;
    return Math.max(contextoMinimo, Math.floor(anterior / 2));
}
