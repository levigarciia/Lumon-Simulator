import { estadoInicial, type EstadoSalvo } from '../../shared/estado';
import type { EventoLumon, Resultado } from '../../shared/ponte';
import { Escritorio } from './escritorio';
import type { Persistencia } from './persistencia';

/** Controla a troca de partidas e impede que sessões antigas sobrescrevam um escritório reiniciado. */
export class Partida {
    private escritorio: Escritorio;
    private geracao = 0;
    private reiniciando = false;
    private estado: EstadoSalvo;

    constructor(
        estado: EstadoSalvo,
        private persistencia: Pick<Persistencia, 'salvar' | 'descarregar'>,
        private emitir: (evento: EventoLumon) => void,
        private pastaGeral: string,
    ) {
        this.estado = estado;
        this.escritorio = this.criar(estado);
    }

    /** Obtém a partida atual para cada chamada IPC, sem reutilizar serviços de uma partida encerrada. */
    obter(): Escritorio {
        if (this.reiniciando) throw new Error('Aguarde o reinício do escritório.');
        return this.escritorio;
    }

    /** Encerra os agentes e confirma a gravação do estado inicial antes de liberar a nova partida. */
    async reiniciar(): Promise<Resultado> {
        if (this.reiniciando) return { ok: false, erro: 'O escritório já está reiniciando.' };
        this.reiniciando = true;
        const anterior = this.estado;
        this.geracao++;
        this.escritorio.encerrar();
        try {
            const novo = estadoInicial();
            this.persistencia.salvar(novo);
            await this.persistencia.descarregar();
            this.escritorio = this.criar(novo);
            return { ok: true };
        } catch (erro) {
            this.escritorio = this.criar(anterior);
            this.persistencia.salvar(this.estado);
            return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível reiniciar.' };
        } finally {
            this.reiniciando = false;
        }
    }

    /** Interrompe a partida atual ao fechar o aplicativo. */
    encerrar(): void {
        this.escritorio.encerrar();
        this.geracao++;
    }

    /** Reconstrói os serviços após uma troca recusada sem aceitar retornos das sessões encerradas. */
    reabrir(): void {
        this.escritorio = this.criar(this.estado);
    }

    private criar(estado: EstadoSalvo): Escritorio {
        this.estado = estado;
        const geracao = this.geracao;
        return new Escritorio(estado, (atual) => {
            if (geracao !== this.geracao) return;
            this.estado = atual;
            this.persistencia.salvar(atual);
        }, (evento) => {
            if (geracao === this.geracao) this.emitir(evento);
        }, this.pastaGeral);
    }
}
