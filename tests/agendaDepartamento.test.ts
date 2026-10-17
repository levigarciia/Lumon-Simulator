import { expect, test } from 'bun:test';
import { AgendaDepartamento, type RegistroAgenda } from '../electron/services/agendaDepartamento';
import { falasDoChat } from '../shared/geral';
import { duracaoAvariaMs } from '../shared/eventosDepartamento';
import type { EventoSocial } from '../shared/social';
import type { Funcionario } from '../shared/funcionarios';

test('entrega de arquivo só participa do sorteio quando pode iniciar e só anuncia após sucesso', () => {
    const eventos: EventoSocial[] = [];
    let disponivel = true;
    let sucesso = false;
    let entregas = 0;
    let agora = new Date('2026-10-17T08:00:00.000Z');
    const registro: RegistroAgenda = {
        funcionarios: () => [], arquivos: () => [], eventos: () => eventos, disponivel: () => true,
        podeReceberArquivo: () => disponivel,
        entregarArquivo: () => {
            entregas++;
            return sucesso ? { ok: true, arquivoId: 'arquivo', nome: 'Halcyon', prazo: agora.toISOString() }
                : { ok: false, erro: 'Líder indisponível.' };
        },
        estressar: () => {}, emitirEstado: () => {}, automatica: false, agora: () => agora, sortear: () => 0,
        registrar: (dados) => {
            const evento = { ...dados, id: 'entrega', sequencia: 1, criadoEm: agora.toISOString() };
            eventos.push(evento);
            return evento;
        },
    };
    const agenda = new AgendaDepartamento(registro);
    expect(agenda.verificar()).toBeUndefined();
    expect(eventos).toHaveLength(0);
    sucesso = true;
    expect(agenda.verificar()).toBe('entrega_arquivo');
    expect(eventos[0]?.texto).toContain('Halcyon para refinamento no Work');
    expect(agenda.verificar()).toBeUndefined();
    const reaberta = new AgendaDepartamento(registro);
    expect(reaberta.verificar()).toBeUndefined();
    agora = new Date(agora.getTime() + 8 * 60000);
    disponivel = false;
    expect(reaberta.verificar()).toBeUndefined();
    expect(entregas).toBe(2);
});

test('avaria aparece no chat, expira sem consulta e anuncia manutenção concluída uma vez', () => {
    let agora = new Date('2026-10-17T08:00:37.090Z');
    const pessoa: Funcionario = {
        id: 'jamal', nome: 'Jamal', cargo: 'refinador', mesaId: 'mesa', autonomia: false,
        contratadoEm: agora.toISOString(), modelo: { provedor: 'local', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    };
    const eventos: EventoSocial[] = [];
    const registro: RegistroAgenda = {
        primeiraMetaCumprida: () => true,
        funcionarios: () => [pessoa], arquivos: () => [], eventos: () => eventos,
        disponivel: () => true, estressar: () => {}, emitirEstado: () => {}, automatica: false,
        agora: () => agora, sortear: () => 0.1,
        registrar: (dados) => {
            const evento = { ...dados, id: String(eventos.length + 1), sequencia: eventos.length + 1,
                criadoEm: agora.toISOString() };
            eventos.push(evento);
            return evento;
        },
    };
    const agenda = new AgendaDepartamento(registro);
    expect(agenda.verificar()).toBe('avaria_terminal');
    expect(agenda.avariado('jamal')).toBe(true);
    expect(agenda.contextoTerminais()).toContain('Não exige consertar_item nem moedas');
    const chat = falasDoChat([], eventos);
    expect(chat).toHaveLength(1);
    expect(chat[0]?.acao).toBe('Comunicado da Diretoria');
    expect(chat[0]?.texto).toContain('Só redistribuam etapas se houver arquivo ativo');
    agora = new Date(agora.getTime() + duracaoAvariaMs);
    agenda.verificar();
    expect(agenda.avariado('jamal')).toBe(false);
    expect(agenda.contextoTerminais()).toContain('todos operacionais');
    expect(falasDoChat([], eventos)).toHaveLength(2);
    expect(eventos[1]?.texto).toContain('Manutenção concluída');
    agenda.verificar();
    expect(eventos).toHaveLength(2);
    const reaberta = new AgendaDepartamento(registro);
    reaberta.verificar();
    expect(reaberta.avariado('jamal')).toBe(false);
    expect(eventos.filter((evento) => evento.texto.startsWith('Manutenção concluída'))).toHaveLength(1);
});

test('reabertura recupera avaria antiga e comunica o fim após o prazo', () => {
    let agora = new Date('2026-10-17T08:01:00.000Z');
    const eventos: EventoSocial[] = [{
        id: 'avaria', sequencia: 1, tipo: 'comunicado', autorId: 'diretoria', alvoId: 'jamal',
        texto: 'O terminal de Jamal apresentou avaria. A manutenção leva alguns minutos.',
        alcance: 'publico', ouvintes: [], fontes: [], criadoEm: '2026-10-17T08:00:00.000Z',
    }];
    const agenda = new AgendaDepartamento({
        funcionarios: () => [{ id: 'jamal', nome: 'Jamal', cargo: 'refinador' } as Funcionario],
        arquivos: () => [], eventos: () => eventos, disponivel: () => true, estressar: () => {},
        emitirEstado: () => {}, automatica: false, agora: () => agora, sortear: () => 0.99,
        registrar: (dados) => {
            const evento = { ...dados, id: 'fim', sequencia: 2, criadoEm: agora.toISOString() };
            eventos.push(evento);
            return evento;
        },
    });
    expect(agenda.avariado('jamal')).toBe(true);
    agora = new Date('2026-10-17T08:03:00.000Z');
    agenda.verificar();
    expect(agenda.avariado('jamal')).toBe(false);
    expect(eventos[1]?.texto).toContain('terminal de Jamal está operacional');
});
