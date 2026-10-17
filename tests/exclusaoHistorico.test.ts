import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apagarConversaHistorica, excluirRegistros, listarHistorico } from '../electron/services/historico';
import { Persistencia } from '../electron/services/persistencia';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import type { EventoSocial } from '../shared/social';

function preparar() {
    const estado = estadoInicial();
    const id = randomUUID();
    estado.demissoes = [{ id: randomUUID(), funcionario: {
        id, nome: 'Gepeto', cargo: 'refinador', mesaId: 'mesa', autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }, motivo: 'Motivo público da demissão.', demitidoPor: 'Diretoria', data: new Date().toISOString(),
    evidencias: [], historicoSocial: [] }];
    const texto = 'Conversa privada que deve desaparecer definitivamente.';
    estado.conversas[id] = [{ id: randomUUID(), autor: 'usuario', texto, criadaEm: '', ferramentas: [] }];
    const fonte: EventoSocial = { id: randomUUID(), tipo: 'fala', sequencia: 1, autorId: 'diretoria', alvoId: id,
        texto: `Relato da Diretoria no chat individual, não verificado: ${texto}`,
        criadoEm: new Date().toISOString(), alcance: 'reservado', ouvintes: [id], fontes: [] };
    const reacao: EventoSocial = { ...fonte, id: randomUUID(), tipo: 'reacao', autorId: id,
        texto: 'Interpretei essa conversa.', fontes: [fonte.id], sequencia: 2 };
    estado.social.eventos = [fonte, reacao];
    estado.social.historico = [fonte];
    estado.social.lembrancas = [fonte];
    estado.social.sequencia = 2;
    estado.demissoes[0]!.historicoSocial = [fonte];
    return { estado, id, fonte, texto };
}

test('arquivo geral categoriza conversas e demissões sem misturar o diálogo à decisão', () => {
    const { estado } = preparar();
    const registros = listarHistorico(estado);
    expect(registros.some((registro) => registro.categoria === 'conversas')).toBe(true);
    const demissao = registros.find((registro) => registro.titulo === 'Demissão de Gepeto')!;
    expect(demissao.categoria).toBe('equipe');
    expect(demissao.texto).toBe('Motivo público da demissão.');
});

test('exclusão remove cópias, fontes derivadas e evidências preservando a demissão e outros registros', () => {
    const { estado, id, texto } = preparar();
    const apagado = apagarConversaHistorica(estado, id);
    expect(apagado.conversas[id]).toEqual([]);
    expect(apagado.social.eventos).toEqual([]);
    expect(apagado.social.historico).toEqual([]);
    expect(apagado.social.lembrancas).toEqual([]);
    expect(apagado.demissoes[0]?.historicoSocial).toEqual([]);
    expect(apagado.demissoes[0]?.motivo).toBe('Motivo público da demissão.');
    expect(JSON.stringify(apagado)).not.toContain(texto);
    expect(esquemaEstado.safeParse(apagado).success).toBe(true);
    expect(estado.conversas[id]).toHaveLength(1);
    const semDemissao = excluirRegistros(apagado, new Set([apagado.demissoes[0]!.id]));
    expect(semDemissao.demissoes).toEqual([]);
});

test('exclusão definitiva elimina os domínios antigos que ainda continham o diálogo', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-exclusao-'));
    try {
        const persistencia = new Persistencia(pasta);
        const { estado, id, texto } = preparar();
        persistencia.salvar(estado);
        await persistencia.descarregar();
        persistencia.salvar(apagarConversaHistorica(estado, id));
        await persistencia.esquecerRevisoes();
        expect((await persistencia.carregar()).conversas[id]).toEqual([]);
        expect(await readdir(pasta)).not.toContain('estado.anterior.json');
        for (const arquivo of await readdir(join(pasta, 'dados'))) {
            expect(await readFile(join(pasta, 'dados', arquivo), 'utf8')).not.toContain(texto);
        }
    } finally { await rm(pasta, { recursive: true, force: true }); }
});

test('apagar pensamento remove também sua cópia no registro de ferramenta da conversa', () => {
    const { estado, id } = preparar();
    const pensamento = { id: randomUUID(), texto: 'Não quero manter este pensamento privado.', atualizadoEm: '' };
    estado.pensamentos[id] = pensamento;
    estado.conversas[id]![0]!.ferramentas.push({ id: 'ferramenta', resumo: 'atualizar_pensamento',
        estado: 'concluida', entrada: JSON.stringify({ pensamento: pensamento.texto }) });
    const apagado = excluirRegistros(estado, new Set([pensamento.id]));
    expect(apagado.pensamentos[id]).toBeUndefined();
    expect(apagado.conversas[id]![0]!.ferramentas).toEqual([]);
    expect(JSON.stringify(apagado)).not.toContain(pensamento.texto);
});
