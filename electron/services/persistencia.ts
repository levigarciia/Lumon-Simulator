import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { esquemaEstado, estadoInicial, type EstadoSalvo } from '../../shared/estado';
import { migrarAutoriaDiretoria } from '../../shared/diretoria';
import { esquecerRevisoesAnteriores, gravarDominios, lerDominios, lerJson } from './arquivosEstado';
import { recuperarHistoricoCodex } from './recuperarHistorico';

const atrasoGravacaoMs = 400;

/** Mantém revisões atômicas por domínio e importa o JSON antigo sem modificá-lo. */
export class Persistencia {
    readonly metricas = { bytes: 0, gravacoes: 0, duracaoMs: 0 };
    private pendente: EstadoSalvo | null = null;
    private temporizador: NodeJS.Timeout | null = null;
    private gravacao: Promise<void> = Promise.resolve();
    private revisao = 0;

    constructor(private pasta: string) {}

    /** Confirma a exclusão e elimina revisões antigas que ainda poderiam conter os registros apagados. */
    async esquecerRevisoes(): Promise<void> {
        await this.descarregar();
        await esquecerRevisoesAnteriores(this.pasta);
    }

    /** Valida os dados sem reiniciar silenciosamente um escritório quando houver corrupção. */
    async carregar(migrar = true): Promise<EstadoSalvo> {
        await mkdir(this.pasta, { recursive: true });
        const atual = await lerDominios(this.pasta);
        if (atual) return migrarAutoriaDiretoria(atual);
        const arquivo = join(this.pasta, 'lumon.json');
        const legado = await lerJson(arquivo);
        if (legado === undefined) return estadoInicial();
        const validado = esquemaEstado.safeParse(legado);
        if (!validado.success) throw new Error(`Estado inválido em ${arquivo}: ${validado.error.message}`);
        const estado = migrarAutoriaDiretoria(validado.data);
        if (!migrar) return estado;
        if (await recuperarHistoricoCodex(estado)) {
            await writeFile(join(this.pasta, `lumon.antes-historico-${Date.now()}.json`),
                JSON.stringify(legado, null, 4), { flag: 'wx' });
        }
        this.salvar(estado);
        await this.descarregar();
        return estado;
    }

    /** Agrupa mudanças próximas e captura uma cópia imutável durante a escrita. */
    salvar(estado: EstadoSalvo): void {
        this.pendente = structuredClone(estado);
        this.revisao++;
        if (this.temporizador) return;
        this.temporizador = setTimeout(() => {
            void this.descarregar().catch((erro: unknown) => {
                console.error('Não foi possível salvar o escritório. Os dados continuam pendentes.', erro);
            });
        }, atrasoGravacaoMs);
    }

    /** Confirma as gravações antes de encerrar ou trocar de escritório, permitindo repetir falhas. */
    async descarregar(): Promise<void> {
        if (this.temporizador) clearTimeout(this.temporizador);
        this.temporizador = null;
        const estado = this.pendente;
        this.pendente = null;
        if (!estado) return this.gravacao;
        const revisao = this.revisao;
        this.gravacao = this.gravacao.catch(() => {}).then(async () => {
            try {
                const inicio = performance.now();
                this.metricas.bytes = await gravarDominios(this.pasta, estado);
                this.metricas.gravacoes++;
                this.metricas.duracaoMs = performance.now() - inicio;
            } catch (erro) {
                if (this.revisao === revisao && !this.pendente) this.pendente = estado;
                throw erro;
            }
        });
        return this.gravacao;
    }
}
