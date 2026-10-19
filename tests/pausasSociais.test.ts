import { expect, test } from 'bun:test';
import { Escritorio } from '../electron/services/escritorio';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import { falasDoChat, mensagensComPausas } from '../shared/geral';
import type { Funcionario } from '../shared/funcionarios';
import { necessidadesIniciais } from '../shared/necessidades';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('pausa persiste sem agendar turnos e permite companhia por decisão própria', async () => {
    const estado = estadoInicial();
    const ana = randomUUID();
    const bia = randomUUID();
    estado.funcionarios = ['Ana', 'Bia'].map((nome, indice): Funcionario => ({
        id: indice === 0 ? ana : bia, nome, cargo: 'desenvolvedor', mesaId: `mesa${indice}`,
        autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
    estado.sala.itens = [
        { id: 'mesa0', tipo: 'mesa', celula: { x: 3, z: 4 }, rotacao: 0 },
        { id: 'mesa1', tipo: 'mesa', celula: { x: 6, z: 4 }, rotacao: 0 },
        { id: 'lanche0', tipo: 'maquina_guloseimas', celula: { x: 9, z: 0 }, rotacao: 0 },
        { id: 'lanche1', tipo: 'maquina_guloseimas', celula: { x: 12, z: 0 }, rotacao: 0 },
    ];
    estado.necessidades = { [ana]: { ...necessidadesIniciais, fome: 73 } };
    const escritorio = new Escritorio(estado, () => {}, () => {}, 'C:/temporario');
    const cliente = new Client({ name: 'pausa-indisponivel', version: '1' });
    const turnos: string[] = [];
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (prompt) => { turnos.push(prompt); },
        encerrar: () => {},
    });
    try {
        escritorio['simulacao']['registro'].agoraPausaMs = () => escritorio['simulacao'].segundosAtuais() * 1000;
        const pausaAna = escritorio['simulacao'].pedirPausa(ana, 'comendo', 5);
        escritorio['simulacao'].avancar(0.1);
        await Bun.sleep(20);
        for (let passo = 0; passo < 30; passo++) await Promise.resolve();
        expect(turnos).toEqual([]);
        const contexto = escritorio['contextoGeral'](bia);
        expect(contexto).toContain(`Indisponíveis no Geral por pausa: Ana [ID ${ana}]`);
        expect(contexto).toContain('mesmo sem @');
        expect(contexto).toContain('conversar_reservado');
        expect(escritorio['simulacao'].podeResponderSocialmente(ana)).toBe(false);
        const mensagensAntes = escritorio.mensagensGeral().length;
        expect(escritorio['geral'].falarDoAgente(bia, '@Ana, você já comeu?')).toContain('indisponível');
        expect(escritorio.mensagensGeral()).toHaveLength(mensagensAntes);
        const url = await escritorio['mcp'].urlDe(bia, 'geral');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        for (const alcance of ['publico', 'local']) {
            const resposta = await cliente.callTool({ name: 'elogiar', arguments: {
                funcionario: ana, mensagem: 'Bom trabalho.', alcance, fontes: [],
            } });
            expect(JSON.stringify(resposta)).toContain('Converse somente em particular');
        }
        expect(escritorio.publico().social.eventos.some((evento) => evento.tipo === 'elogiar')).toBe(false);
        const fonte = escritorio.publico().social.eventos.find((evento) => evento.tipo === 'pausa')!;
        expect(fonte.texto).toContain('via ferramenta');
        const retorno = escritorio['simulacao'].pedirPausa(bia, 'comendo', 5);
        expect([...escritorio['simulacao'].ocupantes().values()].flat().sort()).toEqual([ana, bia].sort());
        for (let passo = 0; passo < 3500; passo++) escritorio['simulacao'].avancar(0.1);
        expect(await retorno).toContain('Pausa concluída');
        expect(await pausaAna).toContain('Pausa concluída');
        expect(escritorio['contextoGeral'](bia)).toContain('ninguém está em pausa');
        expect(escritorio['simulacao'].podeResponderSocialmente(ana)).toBe(true);
        await Bun.sleep(20);
        expect(turnos.every((prompt) => prompt.includes('Oportunidade de conversa à toa'))).toBe(true);
        const salvo = esquemaEstado.parse(JSON.parse(JSON.stringify(escritorio['estado'])));
        const pausas = salvo.social.eventos.filter((evento) => evento.tipo === 'pausa');
        expect(pausas).toHaveLength(4);
        expect(pausas.some((evento) => evento.texto.includes('via ferramenta'))).toBe(true);
        expect(falasDoChat([], salvo.social.eventos).filter((fala) => fala.acao === 'Pausa')).toHaveLength(4);
        expect(mensagensComPausas([], salvo.social.eventos, ana)).toHaveLength(2);
        expect(mensagensComPausas([], salvo.social.eventos, bia)).toHaveLength(2);
        expect(escritorio.conversa(ana)).toEqual([]);
    } finally { await cliente.close(); escritorio.encerrar(); }
});
