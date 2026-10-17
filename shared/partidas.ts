import { z } from 'zod';

export const esquemaNomeEscritorio = z.string().trim().min(1).max(60);
export const esquemaCatalogoEscritorios = z.object({
    versao: z.literal(1),
    ativoId: z.string().uuid(),
    escritorios: z.array(z.object({
        id: z.string().uuid(),
        nome: esquemaNomeEscritorio,
        criadoEm: z.iso.datetime(),
    })).min(1),
}).refine((catalogo) => catalogo.escritorios.some((item) => item.id === catalogo.ativoId)
    && new Set(catalogo.escritorios.map((item) => item.id)).size === catalogo.escritorios.length,
{ message: 'O escritório ativo deve existir e os identificadores devem ser únicos.' });

export type CatalogoEscritorios = z.infer<typeof esquemaCatalogoEscritorios>;
