import { z } from 'zod';
import { limiteResposta } from './tipos';

const esquemaParte = z.object({
    error: z.object({ message: z.string() }).optional(),
    choices: z.array(z.object({
        delta: z.object({
            content: z.string().nullish(),
            tool_calls: z.array(z.object({
                index: z.number().int().nonnegative(),
                id: z.string().optional(),
                function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
            })).optional(),
        }).optional(),
        finish_reason: z.string().nullish(),
    })).optional(),
});

export type ChamadaLocal = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type RespostaLocal = { texto: string; chamadas: ChamadaLocal[]; motivo?: string };

/** Prazo sem dados do servidor, aplicado somente enquanto uma inferência ocupa o motor. */
export const limiteInatividadeMotor = 180000;

/** Lê SSE incremental, preservando UTF 8 e chamadas de ferramenta divididas entre pacotes. */
export async function lerRespostaLocal(
    resposta: Response, sinal: AbortSignal, publicar: (texto: string) => void,
    inatividadeMaxima = limiteInatividadeMotor,
): Promise<RespostaLocal> {
    if (!Number.isFinite(inatividadeMaxima) || inatividadeMaxima <= 0) {
        throw new Error('O prazo de inatividade do motor deve ser positivo.');
    }
    if (!resposta.ok) {
        throw new Error(`Motor local: HTTP ${resposta.status}. ${(await resposta.text()).slice(0, 2000)}`);
    }
    if (!resposta.body) throw new Error('O motor local retornou uma resposta vazia.');
    let texto = '';
    let tamanho = 0;
    let terminou = false;
    let motivo: string | undefined;
    const chamadas = new Map<number, ChamadaLocal>();
    const processar = (linha: string) => {
        if (!linha.startsWith('data:')) return;
        const dados = linha.slice(5).trim();
        if (dados === '[DONE]') { terminou = true; return; }
        if (!dados) return;
        const parte = esquemaParte.parse(JSON.parse(dados));
        if (parte.error) throw new Error(parte.error.message);
        const escolha = parte.choices?.[0];
        if (!escolha) return;
        if (escolha.finish_reason) { terminou = true; motivo = escolha.finish_reason; }
        const conteudo = escolha.delta?.content ?? '';
        texto += conteudo;
        tamanho += conteudo.length;
        for (const fragmento of escolha.delta?.tool_calls ?? []) {
            const chamada = chamadas.get(fragmento.index)
                ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
            if (fragmento.id) chamada.id = fragmento.id;
            chamada.function.name += fragmento.function?.name ?? '';
            chamada.function.arguments += fragmento.function?.arguments ?? '';
            tamanho += (fragmento.function?.arguments?.length ?? 0) + (fragmento.function?.name?.length ?? 0);
            chamadas.set(fragmento.index, chamada);
        }
        if (tamanho > limiteResposta) throw new Error('A resposta do modelo local excedeu o limite permitido.');
        if (conteudo) publicar(texto);
    };
    const leitor = resposta.body.getReader();
    const abortar = () => { void leitor.cancel(sinal.reason).catch(() => {}); };
    sinal.addEventListener('abort', abortar, { once: true });
    const decodificador = new TextDecoder();
    let restante = '';
    try {
        while (!terminou) {
            sinal.throwIfAborted();
            let temporizador: ReturnType<typeof setTimeout> | undefined;
            const inatividade = new Promise<never>((_resolver, rejeitar) => {
                temporizador = setTimeout(() => rejeitar(new Error(
                    'O motor local parou de enviar dados. A resposta foi interrompida para liberar a fila.',
                )), inatividadeMaxima);
            });
            const { done, value } = await Promise.race([leitor.read(), inatividade])
                .finally(() => clearTimeout(temporizador));
            restante += done ? decodificador.decode() : decodificador.decode(value, { stream: true });
            const linhas = restante.split('\n');
            restante = linhas.pop() ?? '';
            for (const linha of linhas) processar(linha.replace(/\r$/, ''));
            if (restante.length > limiteResposta) throw new Error('Pacote do motor local excedeu o limite permitido.');
            if (done) break;
        }
        if (restante) processar(restante);
        sinal.throwIfAborted();
        if (!terminou) throw new Error('A conexão com o motor terminou antes da conclusão da resposta.');
        const lista = [...chamadas.values()];
        if (motivo !== 'length' && lista.some((item) => !item.id || !item.function.name)) {
            throw new Error('O modelo retornou uma chamada de ferramenta incompleta.');
        }
        if (motivo !== 'length' && !texto.trim() && !lista.length) {
            throw new Error('O modelo local não produziu texto nem ferramentas.');
        }
        return { texto, chamadas: lista, motivo };
    } finally {
        sinal.removeEventListener('abort', abortar);
        await leitor.cancel().catch(() => {});
        leitor.releaseLock();
    }
}
