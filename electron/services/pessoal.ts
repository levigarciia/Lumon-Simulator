import { cargoAtual, type Funcionario, type StatusFuncionario } from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import { duracaoAusencia, type Ausencia, type MotivoAusencia } from '../../shared/ausencias';
import { incentivos, invejaDoColega, type TipoIncentivo } from '../../shared/incentivos';
import type { Necessidades } from '../../shared/necessidades';
import type { EventoSocial, Personalidade } from '../../shared/social';

type NovoEvento = Omit<EventoSocial, 'id' | 'sequencia' | 'criadoEm'>;

/** Acesso do departamento pessoal ao restante do escritório. */
export type RegistroPessoal = {
    funcionarios: () => Funcionario[];
    moedas: () => number;
    debitar: (valor: number) => void;
    status: (id: string) => StatusFuncionario;
    necessidades: (id: string) => Necessidades;
    personalidade: (id: string) => Personalidade;
    confianca: (autorId: string, colegaId: string) => number;
    afastar: (id: string, ausencia: Omit<Ausencia, 'terminaEm'>, segundos: number) => string | undefined;
    ausencia: (id: string) => Ausencia | undefined;
    validarAfastamento?: (ids: string[], motivo: MotivoAusencia) => string | undefined;
    aguardarChegadaAnexos?: (ids: string[]) => Promise<boolean>;
    dispensar: (id: string) => void;
    estressar: (id: string, delta: number) => void;
    esgotar: (id: string, delta: number) => void;
    registrar: (evento: NovoEvento, notificar?: boolean) => EventoSocial;
    ajustarRelacao: (autorId: string, colegaId: string, eventoId: string,
        delta: Partial<Record<'confianca' | 'afinidade' | 'respeito' | 'ressentimento', number>>) => void;
    conversarReservado: (autorId: string, alvoId: string, texto: string) => Promise<string>;
    agora?: () => number;
};

const intervaloSessaoMs = 180000;
const efeitosSessao = { estresse: -18, esgotamento: -12 };
const efeitosSalaDescanso = { estresse: 25, esgotamento: 8, ressentimento: 15 };

const sucesso: Resultado = { ok: true };

function falha(erro: string): Resultado {
    return { ok: false, erro };
}

/**
 * Folgas, Sala de Descanso, incentivos e sessões de bem estar. Concentra as consequências calculadas por regra;
 * os personagens decidem quando pedir, propor ou reagir.
 */
export class DepartamentoPessoal {
    private ultimasSessoes = new Map<string, number>();

    constructor(private registro: RegistroPessoal) {}

    /** Tira o funcionário da sala para recuperar o esgotamento. Só a Diretoria concede, fora do trabalho. */
    concederFolga(id: string): Resultado {
        const pessoa = this.buscar(id);
        if (!pessoa) return falha('Funcionário não encontrado.');
        const bloqueio = this.afastar(pessoa, 'folga', 'diretoria', 'Folga concedida pela Diretoria.');
        if (bloqueio) return falha(bloqueio);
        this.registro.registrar({ tipo: 'folga', autorId: 'diretoria', alvoId: id,
            texto: `${pessoa.nome} recebeu folga da Diretoria e saiu da sala para se recuperar.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
        return sucesso;
    }

    /**
     * Punição formal: o funcionário passa um período fora da sala, com mais estresse e ressentimento contra
     * quem o enviou. Chamada pela Diretoria ou ao aprovar a proposta de um supervisor.
     */
    enviarSalaDescanso(id: string, motivo: string, autorId = 'diretoria', fontes: string[] = []): Resultado {
        const pessoa = this.buscar(id);
        if (!pessoa) return falha('Funcionário não encontrado.');
        if (!motivo.trim()) return falha('Informe o motivo da Sala de Descanso.');
        const bloqueio = this.afastar(pessoa, 'sala_descanso', autorId, motivo.trim());
        if (bloqueio) return falha(bloqueio);
        this.registro.estressar(id, efeitosSalaDescanso.estresse);
        this.registro.esgotar(id, efeitosSalaDescanso.esgotamento);
        const evento = this.registro.registrar({ tipo: 'punicao', autorId, alvoId: id,
            texto: `${pessoa.nome} foi levado à Sala de Descanso. Motivo: ${motivo.trim().slice(0, 400)}. `
                + 'Lá, repete a declaração de arrependimento até ser liberado.',
            alcance: 'publico', ouvintes: [], fontes });
        if (autorId !== 'diretoria') {
            this.registro.ajustarRelacao(id, autorId, evento.id, { ressentimento: efeitosSalaDescanso.ressentimento,
                afinidade: -8 });
        }
        return sucesso;
    }

    /**
     * Concede um incentivo pago com o saldo compartilhado. Individuais exigem homenageado e podem gerar inveja
     * em colegas ambiciosos; coletivos alcançam todos que estão na sala.
     */
    concederIncentivo(autorId: string, tipo: TipoIncentivo, motivo: string, alvoId?: string): Resultado {
        const incentivo = incentivos[tipo];
        if (!motivo.trim() || motivo.length > 600) return falha('Informe um motivo de até 600 caracteres.');
        if (this.registro.moedas() < incentivo.preco) return falha(`Moedas insuficientes: custa ${incentivo.preco}.`);
        const alvo = alvoId ? this.buscar(alvoId) : undefined;
        if (!incentivo.coletivo && !alvo) return falha('Escolha quem recebe o incentivo.');
        if (alvo && this.registro.ausencia(alvo.id)) return falha(`${alvo.nome} está fora da sala.`);
        if (alvo && alvo.id === autorId) return falha('Ninguém concede incentivo a si mesmo.');
        const presentes = this.registro.funcionarios().filter((pessoa) => !this.registro.ausencia(pessoa.id));
        const contemplados = incentivo.coletivo ? presentes : [alvo!];
        this.registro.debitar(incentivo.preco);
        for (const pessoa of contemplados) {
            this.registro.estressar(pessoa.id, incentivo.estresse);
            this.registro.esgotar(pessoa.id, incentivo.esgotamento);
        }
        const evento = this.registro.registrar({ tipo: 'incentivo', autorId, alvoId: alvo?.id,
            texto: `${incentivo.nome} ${alvo ? `para ${alvo.nome}` : 'para a equipe'}. Motivo: ${motivo.trim()}. `
                + `Custo: ${incentivo.preco} moedas do saldo compartilhado.`,
            alcance: 'publico', ouvintes: [], fontes: [] });
        if (!alvo) return sucesso;
        if (autorId !== 'diretoria') this.registro.ajustarRelacao(alvo.id, autorId, evento.id, { afinidade: 6 });
        for (const colega of presentes) {
            if (colega.id === alvo.id || colega.id === autorId) continue;
            const inveja = invejaDoColega(tipo, this.registro.personalidade(colega.id).ambicao);
            if (inveja) this.registro.ajustarRelacao(colega.id, alvo.id, evento.id, { ressentimento: inveja });
        }
        return sucesso;
    }

    /**
     * Sessão conduzida pelo conselheiro: os dois vão à Sala de Bem estar, conversam a sós e o atendido recupera estresse
     * e esgotamento conforme confia no conselheiro. Cada pessoa recebe no máximo uma sessão a cada três minutos.
     */
    async sessaoBemEstar(conselheiroId: string, alvoId: string, mensagem: string): Promise<string> {
        if (!mensagem.trim() || mensagem.length > 600) return 'Use uma mensagem entre 1 e 600 caracteres.';
        const conselheiro = this.buscar(conselheiroId);
        const alvo = this.buscar(alvoId);
        if (!conselheiro || cargoAtual(conselheiro.cargo) !== 'conselheiro') {
            return 'Somente o conselheiro de bem estar conduz sessões.';
        }
        if (!alvo || alvo.id === conselheiroId) return 'Escolha um colega presente pelo ID de ver_escritorio.';
        if (this.registro.ausencia(alvo.id)) return `${alvo.nome} está fora da sala.`;
        if (['trabalhando', 'bloqueado'].includes(this.registro.status(alvo.id))) {
            return `${alvo.nome} está trabalhando. Aguarde a tarefa terminar.`;
        }
        const agora = this.registro.agora?.() ?? Date.now();
        if (agora - (this.ultimasSessoes.get(alvo.id) ?? -Infinity) < intervaloSessaoMs) {
            return `${alvo.nome} acabou de ter uma sessão. Aguarde alguns minutos.`;
        }
        if (this.registro.ausencia(conselheiroId)) return 'Você já está fora da sala principal.';
        if (['trabalhando', 'bloqueado'].includes(this.registro.status(conselheiroId))) {
            return 'Termine sua tarefa antes de conduzir a sessão.';
        }
        const impedimento = this.registro.validarAfastamento?.([alvo.id, conselheiroId], 'bem_estar');
        if (impedimento) return impedimento;
        const sessao = { motivo: 'bem_estar' as const, autorId: conselheiroId, justificativa: mensagem.trim() };
        const erro = this.registro.afastar(alvo.id, sessao, duracaoAusencia.bem_estar)
            ?? this.registro.afastar(conselheiroId, sessao, duracaoAusencia.bem_estar);
        if (erro) return erro;
        const chegaram = await this.registro.aguardarChegadaAnexos?.([alvo.id, conselheiroId]);
        if (chegaram === false) return 'A sessão foi interrompida antes da chegada ao cômodo.';
        const resultado = await this.registro.conversarReservado(conselheiroId, alvo.id,
            `Sessão de bem estar: ${mensagem.trim()}`);
        if (!resultado.startsWith('Ação registrada [')) return resultado;
        this.ultimasSessoes.set(alvo.id, agora);
        const fator = 0.5 + this.registro.confianca(alvo.id, conselheiroId) / 100;
        this.registro.estressar(alvo.id, Math.round(efeitosSessao.estresse * fator));
        this.registro.esgotar(alvo.id, Math.round(efeitosSessao.esgotamento * fator));
        return `${resultado} A sessão aliviou ${alvo.nome} na medida da confiança que tem em você.`;
    }

    /** Anuncia a volta à sala depois de uma ausência. */
    retornou(id: string, ausencia: Ausencia): void {
        const pessoa = this.buscar(id);
        if (!pessoa || ausencia.motivo === 'bem_estar') return;
        this.registro.registrar({ tipo: ausencia.motivo === 'folga' ? 'folga' : 'punicao', autorId: 'sistema',
            alvoId: id, alcance: 'publico', ouvintes: [], fontes: [],
            texto: ausencia.motivo === 'folga' ? `${pessoa.nome} voltou da folga.`
                : `${pessoa.nome} foi liberado da Sala de Descanso e voltou à mesa.` });
    }

    private afastar(pessoa: Funcionario, motivo: MotivoAusencia, autorId: string, justificativa: string) {
        if (['trabalhando', 'bloqueado'].includes(this.registro.status(pessoa.id))) {
            return `Espere ${pessoa.nome} terminar a tarefa atual.`;
        }
        const erro = this.registro.afastar(pessoa.id, { motivo, autorId, justificativa }, duracaoAusencia[motivo]);
        if (!erro) this.registro.dispensar(pessoa.id);
        return erro;
    }

    private buscar(id: string): Funcionario | undefined {
        return this.registro.funcionarios().find((pessoa) => pessoa.id === id);
    }
}
