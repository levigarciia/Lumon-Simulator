import { diaDoExpediente } from '../../shared/departamento';
import type { Funcionario } from '../../shared/funcionarios';
import { refina } from '../../shared/cargos';
import {
    agendaEventos, duracaoAvariaMs, escolherEvento, estresseVisita, rankingDoDia, semanasDeCasa, textoVisita,
    type TipoEventoDepartamento,
} from '../../shared/eventosDepartamento';
import { formatarPrazo, type ArquivoRefinamento } from '../../shared/refinamento';
import type { EventoSocial } from '../../shared/social';

type NovoEvento = Omit<EventoSocial, 'id' | 'sequencia' | 'criadoEm'>;
type EntregaArquivo = { ok: true; arquivoId: string; nome: string; prazo: string } | { ok: false; erro: string };

/** Acesso da agenda ao restante do escritório. */
export type RegistroAgenda = {
    funcionarios: () => Funcionario[];
    arquivos: () => ArquivoRefinamento[];
    eventos: () => EventoSocial[];
    disponivel: (id: string) => boolean;
    estressar: (id: string, delta: number) => void;
    registrar: (evento: NovoEvento) => EventoSocial;
    emitirEstado: () => void;
    podeReceberArquivo?: () => boolean;
    primeiraMetaCumprida?: () => boolean;
    entregarArquivo?: () => EntregaArquivo;
    agora?: () => Date;
    sortear?: () => number;
    /** Desligue nos testes para chamar `verificar` diretamente. */
    automatica?: boolean;
};

/**
 * Sorteia visitas da Diretoria, auditorias e avarias de terminal, e anuncia marcos de casa. Avarias impedem
 * temporariamente que o funcionário receba trabalho, consultadas por `avariado`.
 */
export class AgendaDepartamento {
    private ultimoEvento = 0;
    private avarias = new Map<string, number>();
    private temporizador: NodeJS.Timeout | null = null;

    constructor(private registro: RegistroAgenda) {
        for (const evento of registro.eventos()) {
            if (evento.tipo !== 'comunicado' || evento.autorId !== 'diretoria') continue;
            if (evento.texto.startsWith('A Diretoria entregou o arquivo ')) {
                this.ultimoEvento = Math.max(this.ultimoEvento, Date.parse(evento.criadoEm));
            }
            if (!evento.alvoId) continue;
            if (evento.texto.startsWith('O terminal de ') && evento.texto.includes('apresentou avaria.')) {
                this.avarias.set(evento.alvoId, Date.parse(evento.criadoEm) + duracaoAvariaMs);
                this.ultimoEvento = Math.max(this.ultimoEvento, Date.parse(evento.criadoEm));
            }
            if (evento.texto.startsWith('Manutenção concluída: o terminal de ')) this.avarias.delete(evento.alvoId);
        }
        if (registro.automatica !== false) {
            this.temporizador = setInterval(() => this.verificar(), agendaEventos.verificacaoMs);
        }
    }

    encerrar(): void {
        if (this.temporizador) clearInterval(this.temporizador);
    }

    avariado(id: string): boolean {
        const fim = this.avarias.get(id);
        if (fim === undefined) return false;
        return this.agora().getTime() < fim;
    }

    /** Conserva no Geral avisos de manutenção que ainda impedem o uso do terminal. */
    comunicadoAtivo(evento: EventoSocial): boolean {
        return evento.tipo === 'comunicado' && !!evento.alvoId && this.avariado(evento.alvoId)
            && evento.texto.startsWith('O terminal de ') && evento.texto.includes('apresentou avaria.');
    }

    /** Informa avarias atuais sem confundir manutenção automática de terminal com conserto de móveis. */
    contextoTerminais(): string {
        const avariados = this.registro.funcionarios().filter((pessoa) => this.avariado(pessoa.id));
        if (!avariados.length) return 'Terminais: todos operacionais. Não há manutenção de terminal pendente.';
        return 'Terminais em manutenção automática: ' + avariados.map((pessoa) => pessoa.nome).join(', ')
            + '. O reparo termina automaticamente em até três minutos. Não exige consertar_item nem moedas. '
            + 'Sem arquivo ativo no Work, não há etapas para redistribuir.';
    }

    /** Uma verificação da agenda. Marcos de casa não dependem de sorteio nem do intervalo mínimo. */
    verificar(): TipoEventoDepartamento | undefined {
        this.concluirManutencoes();
        const estabelecido = this.registro.primeiraMetaCumprida?.() ?? false;
        if (estabelecido) this.anunciarMarcos();
        const agora = this.agora().getTime();
        if (agora - this.ultimoEvento < agendaEventos.intervaloMinimoMs) return undefined;
        const tipo = escolherEvento(this.registro.sortear?.() ?? Math.random(), this.possiveis());
        if (!tipo) return undefined;
        if (tipo === 'visita_diretoria') this.visitar();
        if (tipo === 'auditoria') this.auditar();
        if (tipo === 'avaria_terminal') this.avariar();
        if (tipo === 'entrega_arquivo' && !this.entregarArquivo()) return undefined;
        this.ultimoEvento = agora;
        this.registro.emitirEstado();
        return tipo;
    }

    private possiveis(): TipoEventoDepartamento[] {
        const equipe = this.registro.funcionarios();
        const estabelecido = this.registro.primeiraMetaCumprida?.() ?? false;
        return [
            ...(estabelecido && equipe.length ? ['visita_diretoria' as const] : []),
            ...(estabelecido && this.ranking().length ? ['auditoria' as const] : []),
            ...(estabelecido && this.candidatosAvaria().length ? ['avaria_terminal' as const] : []),
            ...(this.registro.entregarArquivo && this.registro.podeReceberArquivo?.()
                ? ['entrega_arquivo' as const] : []),
        ];
    }

    private visitar(): void {
        for (const pessoa of this.registro.funcionarios()) {
            if (this.registro.disponivel(pessoa.id)) this.registro.estressar(pessoa.id, estresseVisita);
        }
        this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', texto: textoVisita,
            alcance: 'publico', ouvintes: [], fontes: [] });
    }

    private entregarArquivo(): boolean {
        const resultado = this.registro.entregarArquivo?.();
        if (!resultado?.ok) return false;
        this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', alcance: 'publico', ouvintes: [],
            fontes: [], texto: `A Diretoria entregou o arquivo ${resultado.nome} para refinamento no Work. `
                + `Prazo: ${formatarPrazo(resultado)}. O líder coordena a distribuição das etapas.` });
        return true;
    }

    private auditar(): void {
        const nomes = new Map(this.registro.funcionarios().map((pessoa) => [pessoa.id, pessoa.nome]));
        const linhas = this.ranking().map(([id, grupos], posicao) =>
            `${posicao + 1}. ${nomes.get(id) ?? 'ex funcionário'}: ${grupos} grupos aceitos`);
        this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', alcance: 'publico', ouvintes: [],
            fontes: [], texto: `Auditoria de produtividade de hoje, afixada para todos:\n${linhas.join('\n')}` });
    }

    private avariar(): void {
        const candidatos = this.candidatosAvaria();
        const sorteio = this.registro.sortear?.() ?? Math.random();
        const alvo = candidatos[Math.min(candidatos.length - 1, Math.floor(sorteio * candidatos.length))]!;
        this.avarias.set(alvo.id, this.agora().getTime() + duracaoAvariaMs);
        this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', alvoId: alvo.id, alcance: 'publico',
            ouvintes: [], fontes: [], texto: `O terminal de ${alvo.nome} apresentou avaria. A manutenção leva alguns `
                + 'três minutos e termina automaticamente, sem moedas nem consertar_item. Até lá, ele não recebe '
                + 'novas etapas de Macrodados. Só redistribuam etapas se houver arquivo ativo no Work.' });
    }

    private concluirManutencoes(): void {
        for (const [id, fim] of this.avarias) {
            if (this.agora().getTime() < fim) continue;
            this.avarias.delete(id);
            const pessoa = this.registro.funcionarios().find((funcionario) => funcionario.id === id);
            if (!pessoa) continue;
            this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', alvoId: id,
                alcance: 'publico', ouvintes: [], fontes: [], texto:
                    `Manutenção concluída: o terminal de ${pessoa.nome} está operacional. `
                    + 'Ele pode receber novas etapas quando houver arquivo ativo no Work.' });
            this.registro.emitirEstado();
        }
    }

    private anunciarMarcos(): void {
        const agora = this.agora();
        const dia = diaDoExpediente(agora);
        for (const pessoa of this.registro.funcionarios()) {
            const semanas = semanasDeCasa(pessoa.contratadoEm, agora);
            if (!semanas) continue;
            const jaAnunciado = this.registro.eventos().some((evento) => evento.tipo === 'comunicado'
                && evento.alvoId === pessoa.id && evento.texto.startsWith('Marco de casa')
                && diaDoExpediente(new Date(evento.criadoEm)) === dia);
            if (jaAnunciado) continue;
            this.registro.registrar({ tipo: 'comunicado', autorId: 'diretoria', alvoId: pessoa.id,
                alcance: 'publico', ouvintes: [], fontes: [], texto: `Marco de casa: ${pessoa.nome} completa `
                    + `${semanas} ${semanas === 1 ? 'semana' : 'semanas'} na Lumon hoje. Lembrar a data é cortesia.` });
        }
    }

    private ranking(): [string, number][] {
        return rankingDoDia(this.registro.arquivos(), diaDoExpediente(this.agora()));
    }

    private candidatosAvaria(): Funcionario[] {
        return this.registro.funcionarios().filter((pessoa) => refina(pessoa.cargo)
            && this.registro.disponivel(pessoa.id) && !this.avariado(pessoa.id));
    }

    private agora(): Date {
        return this.registro.agora?.() ?? new Date();
    }
}
