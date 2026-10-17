import { z } from 'zod';

/** Identificador de modelo aceito como argumento dos CLIs. */
export const esquemaIdModelo = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);

export const provedores = { claude: 'Claude Code', codex: 'Codex', local: 'Local' } as const;

export type Provedor = 'claude' | 'codex' | 'local';

/** Tipo de capacidade do modelo. */
export type CapacidadeModelo = 'raciocinio' | 'ferramentas' | 'code';

/** Arquivo de projetor visual (para visão em modelos). */
export type ArquivoProjetor = { arquivo: string; tamanho: number; sha256: string };

/** Modelo no catálogo com informações completas. */
export type ModeloCatalogo = {
    id: string;
    familia: FamiliaModelo;
    nome: string;
    descricao: string;
    repositorio: string;
    arquivo: string;
    revisao: string;
    tamanho: number;
    sha256: string;
    capacidades: CapacidadeModelo[];
    projetorVisual?: ArquivoProjetor;
};

export type FamiliaModelo = 'qwen' | 'llama' | 'gemma' | 'deepseek';

/** Modelo para configuração do harness. */
export const esquemaModelo = z.object({
    provedor: z.enum(Object.keys(provedores) as [Provedor, ...Provedor[]]),
    id: esquemaIdModelo,
    nome: z.string().trim().min(1).max(80),
    caminho: z.string().min(1).max(500).optional(),
    tamanho: z.number().int().positive().optional(),
    catalogoId: esquemaIdModelo.optional(),
    projetorVisual: z.string().min(1).max(500).optional(),
});

export type Modelo = z.infer<typeof esquemaModelo>;

/** Catálogo de modelos locais disponíveis para o Lumon. */
export const catalogoModelos: ModeloCatalogo[] = [
    {
        id: 'qwen3.5-2b-q4',
        projetorVisual: {
            arquivo: 'mmproj-F16.gguf',
            tamanho: 668227264,
            sha256: '7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7',
        },
        familia: 'qwen',
        nome: 'Qwen3.5 2B',
        repositorio: 'unsloth/Qwen3.5-2B-GGUF',
        arquivo: 'Qwen3.5-2B-Q4_K_M.gguf',
        revisao: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
        tamanho: 1280835840,
        sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
        descricao: 'Compacto para conversas e tarefas leves.',
        capacidades: ['raciocinio', 'ferramentas', 'code'],
    },
    {
        id: 'qwen3.5-4b-q4',
        projetorVisual: {
            arquivo: 'mmproj-F16.gguf',
            tamanho: 672423616,
            sha256: 'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864',
        },
        familia: 'qwen',
        nome: 'Qwen3.5 4B',
        repositorio: 'unsloth/Qwen3.5-4B-GGUF',
        arquivo: 'Qwen3.5-4B-Q4_K_M.gguf',
        revisao: 'e87f176479d0855a907a41277aca2f8ee7a09523',
        tamanho: 2740937888,
        sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
        descricao: 'Equilíbrio para português, escrita e código.',
        capacidades: ['raciocinio', 'ferramentas', 'code'],
    },
    {
        id: 'qwen3.5-9b-q4',
        projetorVisual: {
            arquivo: 'mmproj-F16.gguf',
            tamanho: 918166080,
            sha256: 'f70dc3509053962b0d0d3ee8a7eacebf5d60aa560cad78254ae8698516ae029f',
        },
        familia: 'qwen',
        nome: 'Qwen3.5 9B',
        repositorio: 'unsloth/Qwen3.5-9B-GGUF',
        arquivo: 'Qwen3.5-9B-Q4_K_M.gguf',
        revisao: '3885219b6810b007914f3a7950a8d1b469d598a5',
        tamanho: 5680522464,
        sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
        descricao: 'Conversas, programação e tarefas mais exigentes.',
        capacidades: ['raciocinio', 'ferramentas', 'code'],
    },
    {
        id: 'qwen3-14b-q4',
        familia: 'qwen',
        nome: 'Qwen3 14B',
        repositorio: 'unsloth/Qwen3-14B-GGUF',
        arquivo: 'Qwen3-14B-Q4_K_M.gguf',
        revisao: 'a04a82c4739b3ef5fa6da7d10261db2c67dd1985',
        tamanho: 9001753984,
        sha256: '5eaa0870bd81ed3b58a630a271234cfa604e43ffb3a19cd68e54a80dd9d52a66',
        descricao: 'Mais capacidade para tarefas complexas.',
        capacidades: ['raciocinio', 'ferramentas', 'code'],
    },
    {
        id: 'llama-3.2-1b-q4',
        familia: 'llama',
        nome: 'Llama 3.2 1B',
        repositorio: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
        arquivo: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        revisao: '067b946cf014b7c697f3654f621d577a3e3afd1c',
        tamanho: 807694464,
        sha256: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
        descricao: 'Chat rápido em computadores com pouca memória.',
        capacidades: ['ferramentas'],
    },
    {
        id: 'llama-3.2-3b-q4',
        familia: 'llama',
        nome: 'Llama 3.2 3B',
        repositorio: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
        arquivo: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        revisao: '5ab33fa94d1d04e903623ae72c95d1696f09f9e8',
        tamanho: 2019377696,
        sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
        descricao: 'Conversas e instruções de uso geral.',
        capacidades: ['ferramentas'],
    },
];

export type BackendRuntime = 'cpu' | 'vulkan' | 'rocm';
export type EstadoMotor = {
    fase: 'desligado' | 'aguardando' | 'baixando' | 'verificando' | 'instalando' | 'carregando' | 'pronto' | 'erro';
    detalhe: string;
    modeloId?: string;
    progresso?: number;
    backend?: BackendRuntime;
    dispositivo?: string;
    contexto?: number;
};

const apelidos: Record<string, string> = {
    'llama3.2:1b': 'llama-3.2-1b-q4',
    'llama3.2:3b': 'llama-3.2-3b-q4',
};

/** Resolve IDs antigos de funcionários para uma edição verificável do catálogo. */
export function resolverModeloLocal(id: string): ModeloCatalogo {
    const item = catalogoModelos.find((modelo) => modelo.id === (apelidos[id] ?? id));
    if (!item) throw new Error('Modelo local indisponível. Edite o funcionário e escolha um modelo do catálogo.');
    return item;
}

/** Formata o tamanho do download para a seleção de modelos. */
export function formatarTamanho(bytes: number): string {
    return (bytes / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB';
}
