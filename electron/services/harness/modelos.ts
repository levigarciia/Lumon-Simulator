import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { esquemaIdModelo, type Modelo, catalogoModelos } from '../../../shared/modelos';

/** Apelidos que o Claude Code resolve sozinho para a versão mais recente de cada família. */
const modelosClaude: Modelo[] = [
    { provedor: 'claude', id: 'opus', nome: 'Claude Opus' },
    { provedor: 'claude', id: 'sonnet', nome: 'Claude Sonnet' },
    { provedor: 'claude', id: 'haiku', nome: 'Claude Haiku' },
];

const esquemaCacheCodex = z.object({
    models: z.array(
        z.object({
            slug: z.string(),
            display_name: z.string().optional(),
            visibility: z.string().optional(),
            priority: z.number().optional(),
        }),
    ),
});

/** Modelos visíveis no cache que o Codex mantém com a conta, na ordem de prioridade do próprio CLI. */
export function interpretarCacheCodex(conteudo: string): Modelo[] {
    const validado = esquemaCacheCodex.safeParse(JSON.parse(conteudo));
    if (!validado.success) return [];
    return validado.data.models
        .filter((modelo) => modelo.visibility === 'list' && esquemaIdModelo.safeParse(modelo.slug).success)
        .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
        .map((modelo) => ({ provedor: 'codex', id: modelo.slug, nome: modelo.display_name || modelo.slug }));
}

/** Modelos de provedores externos. */
export const modelosExternos = [...modelosClaude, ...interpretarCacheCodex('[]')];

/** Oferece as edições que podem ser preparadas automaticamente no primeiro envio. */
export async function listarModelosLocais(): Promise<Modelo[]> {
    return catalogoModelos.map((item) => ({ provedor: 'local', id: item.id, nome: item.nome }));
}

/** Combina o catálogo local com os modelos disponíveis nos CLIs oficiais. */
export async function listarModelos(pastaUsuario = homedir()): Promise<Modelo[]> {
    let codex: Modelo[] = [];
    try {
        const cache = await readFile(join(pastaUsuario, '.codex', 'models_cache.json'), 'utf8');
        codex = interpretarCacheCodex(cache);
    } catch {}
    return [...modelosClaude, ...codex, ...(await listarModelosLocais())];
}
