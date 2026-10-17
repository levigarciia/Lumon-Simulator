import { expect, test } from 'bun:test';
import { recuperarPartes } from '../electron/services/recuperarHistorico';
import type { Mensagem } from '../shared/funcionarios';
import { recuperarHistoricoCodex } from '../electron/services/recuperarHistorico';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estadoInicial, esquemaEstado } from '../shared/estado';

const mensagem: Mensagem = {
    id: 'resposta', autor: 'funcionario', texto: 'Vou verificar.\n\nEncontrei o arquivo.',
    criadaEm: '2026-10-16T13:00:00Z',
    ferramentas: [{ id: 'ferramenta', resumo: 'Read', estado: 'concluida' }],
};

function eventos() {
    return [
        { timestamp: '2026-10-16T13:00:01Z', type: 'event_msg', payload: {
            type: 'item_completed', turn_id: 'turno', item: { type: 'AgentMessage', id: 'antes',
                content: [{ type: 'Text', text: 'Vou verificar.' }] },
        } },
        { timestamp: '2026-10-16T13:00:02Z', type: 'event_msg', payload: {
            type: 'item_completed', turn_id: 'turno', item: { type: 'Reasoning', id: 'privado',
                content: [{ type: 'Text', text: 'Raciocínio privado que não deve ser importado.' }] },
        } },
        { timestamp: '2026-10-16T13:00:04Z', type: 'event_msg', payload: {
            type: 'item_completed', turn_id: 'turno', started_at_ms: Date.parse('2026-10-16T13:00:03Z'),
            item: { type: 'CommandExecution', id: 'ferramenta', command: 'Get-Content arquivo.txt',
                aggregated_output: 'Conteúdo do arquivo.' },
        } },
        { timestamp: '2026-10-16T13:00:05Z', type: 'event_msg', payload: {
            type: 'item_completed', turn_id: 'turno', item: { type: 'AgentMessage', id: 'depois',
                content: [{ type: 'Text', text: 'Encontrei o arquivo.' }] },
        } },
    ];
}

test('recupera a sequência antiga por IDs e texto exatos sem importar raciocínios privados', () => {
    const partes = recuperarPartes(mensagem, eventos());
    expect(partes?.map((parte) => parte.tipo)).toEqual(['texto', 'ferramenta', 'texto']);
    expect(partes?.[1]).toMatchObject({ tipo: 'ferramenta', criadaEm: '2026-10-16T13:00:03.000Z',
        ferramenta: { entrada: 'Get-Content arquivo.txt', saida: 'Conteúdo do arquivo.' } });
    expect(JSON.stringify(partes)).not.toContain('Raciocínio privado');
    expect(mensagem.partes).toBeUndefined();
});

test('recusa correspondências incompletas, outros turnos e respostas que já têm sequência', () => {
    expect(recuperarPartes({ ...mensagem, texto: 'Outra resposta.' }, eventos())).toBeNull();
    expect(recuperarPartes({ ...mensagem, ferramentas: [
        ...mensagem.ferramentas, { id: 'ausente', resumo: 'Read', estado: 'concluida' },
    ] }, eventos())).toBeNull();
    expect(recuperarPartes({ ...mensagem, partes: [
        { id: 'atual', tipo: 'texto', texto: mensagem.texto, criadaEm: mensagem.criadaEm },
    ] }, eventos())).toBeNull();
    const misturados = eventos();
    misturados[3]!.payload.turn_id = 'outro';
    expect(recuperarPartes(mensagem, misturados)).toBeNull();
});

test('recupera sessões com cabeçalho grande e mantém a sequência do Work ao persistir novamente', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-recuperacao-'));
    try {
        const dia = join(pasta, '2026', '10', '16');
        await mkdir(dia, { recursive: true });
        await writeFile(join(dia, 'sessao.jsonl'), [
            { type: 'session_meta', payload: { cwd: 'D:/projeto', contexto: 'a'.repeat(30000) } }, ...eventos(),
        ].map((evento) => JSON.stringify(evento)).join('\n'));
        const estado = estadoInicial();
        const projetoId = '11111111-1111-4111-8111-111111111111';
        estado.projetos = [{ id: projetoId, nome: 'Projeto', pasta: 'D:\\projeto' }];
        estado.conversas.pessoa = [
            { ...mensagem, id: 'pedido', autor: 'usuario', texto: 'Confira.',
                projetoId, canal: 'work', ferramentas: [] },
            { ...mensagem, projetoId, canal: 'work' },
        ];
        estado.trabalhos = [{ id: 'trabalho', pedidoId: 'pedido', funcionarioId: 'pessoa', nome: 'Cláudio',
            projetoId, tarefa: 'Confira.', resultado: mensagem.texto, estado: 'concluido',
            criadoEm: mensagem.criadaEm }];
        expect(await recuperarHistoricoCodex(estado, pasta)).toBe(true);
        const salvo = esquemaEstado.parse(JSON.parse(JSON.stringify(estado)));
        expect(salvo.conversas.pessoa?.[1]?.partes?.map((parte) => parte.tipo))
            .toEqual(['texto', 'ferramenta', 'texto']);
        expect(salvo.trabalhos[0]?.eventos?.map((evento) => evento.parte.tipo))
            .toEqual(['texto', 'ferramenta', 'texto']);
        expect(salvo.trabalhos[0]?.eventos?.map((evento) => evento.ordem)).toEqual([2, 3, 4]);
        expect(await recuperarHistoricoCodex(salvo, pasta)).toBe(false);
    } finally {
        await rm(pasta, { recursive: true, force: true });
    }
});
