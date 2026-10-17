export const cargos = {
    lider: {
        nome: 'Líder',
        instrucao: 'Você coordena Macrodados, distribui etapas conforme disponibilidade, carga e relações e confere '
            + 'os envios reais. Justifique suas escolhas sem inventar falhas ou aprovações.',
    },
    refinador: {
        nome: 'Refinador',
        instrucao: 'Você refina Macrodados e compartilha descobertas verificadas. Sua função não envolve '
            + 'programação, arquivos externos ou terminal.',
    },
    estagiario: {
        nome: 'Estagiário',
        instrucao: 'Você é estagiário: está aprendendo a refinar Macrodados, tem menos tentativas por etapa e '
            + 'ainda não apresenta propostas formais. Pergunte, observe os colegas e aceite orientação, '
            + 'conforme sua personalidade.',
    },
    supervisor: {
        nome: 'Supervisor',
        instrucao: 'Você supervisiona o departamento em nome da Diretoria e não refina arquivos. Zela pela cota, '
            + 'pela conduta e pela doutrina de Kier. Pode conceder incentivos com conceder_incentivo e propor a '
            + 'Sala de Descanso com propor_mudanca. Use um tom cordial e institucional, mesmo ao corrigir alguém.',
    },
    conselheiro: {
        nome: 'Conselheiro de Bem estar',
        instrucao: 'Você conduz sessões de bem estar e não refina arquivos. Observe quem está estressado ou '
            + 'esgotado e use sessao_bem_estar para atendê-lo. Fale com calma, em tom clínico e institucional, '
            + 'citando a Lumon. Sessões não divulgam o que foi dito a terceiros.',
    },
} as const;

export type CargoAtual = keyof typeof cargos;
export type Cargo = CargoAtual | 'desenvolvedor' | 'revisor' | 'pesquisador';

const nomesAntigos = { desenvolvedor: 'Desenvolvedor', revisor: 'Revisor', pesquisador: 'Pesquisador' };

/** Cargos que recebem arquivos e delegações de Macrodados. */
export const cargosRefinamento: readonly CargoAtual[] = ['lider', 'refinador', 'estagiario'];

/** Converte funções antigas na equipe ativa, preservando os registros históricos. */
export function cargoAtual(cargo: Cargo): CargoAtual {
    return cargo in cargos ? cargo as CargoAtual : 'refinador';
}

/** Indica quem participa do Work. Supervisores e conselheiros atuam apenas na convivência. */
export function refina(cargo: Cargo): boolean {
    return cargosRefinamento.includes(cargoAtual(cargo));
}

/** Envios permitidos numa etapa delegada. O estagiário aprende com menos tentativas. */
export function limiteEnviosEtapa(cargo: Cargo): number {
    return cargoAtual(cargo) === 'estagiario' ? 2 : 4;
}

/** Exibe também cargos preservados nos registros anteriores a Macrodados. */
export function nomeCargo(cargo: Cargo): string {
    return cargo in cargos ? cargos[cargo as CargoAtual].nome : nomesAntigos[cargo as keyof typeof nomesAntigos];
}
