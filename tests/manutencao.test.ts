import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Escritorio } from '../electron/services/escritorio';
import { SimulacaoEscritorio } from '../electron/services/simulacao';
import { esquemaEstado, estadoInicial } from '../shared/estado';
import { registrarUso, custoConserto, repararItem } from '../shared/manutencao';
import type { ItemPosicionado } from '../shared/escritorio';
import { falasDoChat } from '../shared/geral';
import type { Funcionario } from '../shared/funcionarios';
import { necessidadesIniciais } from '../shared/necessidades';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cafe: ItemPosicionado = {
    id: 'cafe', tipo: 'aparador_cafe', celula: { x: 9, z: 0 }, rotacao: 0,
};

function equipe(): Funcionario[] {
    return ['Ana', 'Bia'].map((nome, indice) => ({
        id: nome, nome, cargo: 'desenvolvedor', mesaId: `mesa${indice}`, autonomia: false, contratadoEm: '',
        modelo: { provedor: 'codex', id: 'modelo', nome: 'Modelo' },
        aparencia: { pele: '#e3b48f', cabelo: '#141210', estiloCabelo: 'curto', gravata: '#121212' },
    }));
}

test('desgaste protege oito usos, cresce gradualmente e reinicia após reparo', () => {
    let item = cafe;
    for (let uso = 0; uso < 8; uso++) item = registrarUso(item, 'Ana', 0);
    expect(item.quebrado).toBe(false);
    item = registrarUso(item, 'Ana', 0);
    expect(item.quebrado).toBe(true);
    expect(item.ultimoUsuarioId).toBe('Ana');
    expect(registrarUso(item, 'Bia', 0)).toBe(item);
    expect(registrarUso({ ...cafe, usos: 100 }, 'Ana', 0.2).quebrado).toBe(false);
    expect(registrarUso(repararItem(item), 'Bia', 0).quebrado).toBe(false);
    expect(custoConserto(item)).toBe(23);
    expect(() => registrarUso(cafe, 'Ana', 1)).toThrow();
    expect(() => registrarUso(cafe, '', 0)).toThrow();
});

test('salvamento antigo aceita desgaste e preserva móveis quebrados ao reabrir', () => {
    const estado = estadoInicial();
    estado.sala.itens = [cafe];
    expect(esquemaEstado.parse(estado).sala.itens[0]?.quebrado).toBeUndefined();
    estado.sala.itens = [registrarUso({ ...cafe, usos: 8 }, 'Ana', 0)];
    expect(esquemaEstado.parse(JSON.parse(JSON.stringify(estado))).sala.itens[0]).toEqual(estado.sala.itens[0]);
});

test('quebra ao concluir um uso cancela a outra pausa e mantém a suspeita privada', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe();
    estado.sala.itens = [
        ...estado.funcionarios.map((pessoa, indice): ItemPosicionado => ({
            id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
        })), { ...cafe, usos: 100 },
    ];
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-quebra-compartilhada-'));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    const simulacao = escritorio['simulacao'];
    let agora = 0;
    let conversa: AbortSignal | undefined;
    simulacao['registro'].agoraPausaMs = () => agora;
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (_prompt, _ouvinte, sinal) => {
            conversa = sinal;
            await new Promise<void>((resolver) => sinal.addEventListener('abort', () => resolver(), { once: true }));
        }, encerrar: () => {},
    });
    const sorteio = Math.random;
    try {
        const ana = simulacao.pedirPausa('Ana', 'cafe', 1);
        const bia = simulacao.pedirPausa('Bia', 'cafe', 5);
        for (let passo = 0; passo < 300; passo++) simulacao.avancar(0.1);
        await Bun.sleep(20);
        expect(conversa?.aborted).toBe(false);
        Math.random = () => 0;
        agora = 60000;
        simulacao.avancar(0.1);
        Math.random = sorteio;
        expect(await ana).toContain('Pausa concluída');
        expect(await bia).toContain('Pausa interrompida: Cafeteira quebrou');
        expect(simulacao.emPausa('Ana')).toBe(false);
        expect(simulacao.emPausa('Bia')).toBe(false);
        expect(simulacao.ocupantes().size).toBe(0);
        expect(simulacao.agentes().find((agente) => agente.id === 'Bia')?.atividade).not.toBe('cafe');
        expect(conversa?.aborted).toBe(true);
        expect(escritorio['contextoGeral']('Ana')).toContain('Provavelmente foi você quem causou a quebra');
        expect(escritorio['contextoGeral']('Bia')).not.toContain('Provavelmente foi você');
        expect(escritorio['contextoTurno']('Ana')).toContain('Você decide se conta');
        const publicos = escritorio.publico().social.eventos.filter((evento) => evento.alcance === 'publico');
        expect(publicos.some((evento) => evento.texto.includes('Provavelmente foi você'))).toBe(false);
        expect(publicos.find((evento) => evento.tipo === 'pausa' && evento.autorId === 'Bia'
            && evento.texto.includes('Motivo:'))?.texto).toContain('Cafeteira quebrou');
        const energia = simulacao.necessidadesDe('Bia').energia;
        agora = 300000;
        simulacao.avancar(0.1);
        expect(simulacao.necessidadesDe('Bia').energia).toBeLessThanOrEqual(energia);
        expect(escritorio.publico().sala.itens.find((item) => item.id === 'cafe')?.usos).toBe(101);
    } finally {
        Math.random = sorteio;
        escritorio.encerrar();
    }
});

test('quebra impede pausas por ferramenta', async () => {
    const sala = { ...estadoInicial().sala, itens: [{ ...cafe, quebrado: true }] };
    const simulacao = new SimulacaoEscritorio({
        sala: () => sala, funcionarios: () => equipe().slice(0, 1), statusTrabalho: () => 'ocioso',
        relogioInicial: 0, necessidadesIniciais: { Ana: { ...necessidadesIniciais, energia: 0 } },
        gravar: () => {}, emitirQuadro: () => {}, emitirEstado: () => {}, automatica: false,
    });
    try {
        expect(simulacao.temItem('cafe')).toBe(false);
        const retorno = await simulacao.pedirPausa('Ana', 'cafe', 1);
        expect(retorno).toContain('quebrados');
        expect(retorno).toContain('Cafeteira [ID cafe]');
        expect(retorno).toContain('consertar_item');
        expect(retorno).not.toContain('compre');
        simulacao.avancar(0.1);
        expect(simulacao.ocupantes().size).toBe(0);
    } finally { simulacao.encerrar(); }
});

test('pausa pelo MCP distingue item ausente, quebrado e alternativa funcionando', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe();
    estado.sala.itens = [];
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-pausa-quebrada-mcp-'));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    const cliente = new Client({ name: 'teste-pausa-quebrada', version: '1' });
    try {
        const url = await escritorio['mcp'].urlDe('Ana', 'geral');
        await cliente.connect(new StreamableHTTPClientTransport(new URL(url)));
        const pedirPausa = () => cliente.callTool({ name: 'fazer_pausa',
            arguments: { atividade: 'cafe', minutos: 5 } });
        const ausente = await pedirPausa();
        expect(ausente.isError).toBe(true);
        expect(JSON.stringify(ausente.content)).toContain('Não há nenhum item');
        escritorio['estado'].sala = { ...estado.sala, itens: [{ ...cafe, quebrado: true }] };
        const quebrada = await pedirPausa();
        expect(quebrada.isError).toBe(true);
        expect(quebrada.structuredContent).toMatchObject({ codigo: 'pausa_recusada', terminal: false });
        expect(JSON.stringify(quebrada.content)).toContain('quebrados');
        expect(JSON.stringify(quebrada.content)).toContain('Cafeteira [ID cafe]');
        expect(JSON.stringify(quebrada.content)).toContain('consertar_item');
        expect(JSON.stringify(quebrada.content)).not.toContain('Não há nenhum item');
        expect(escritorio['simulacao'].emPausa('Ana')).toBe(false);
        escritorio['estado'].sala = { ...estado.sala, itens: [
            { ...cafe, quebrado: true }, { ...cafe, id: 'cafe_funcionando', celula: { x: 6, z: 0 } },
        ] };
        const iniciada = await pedirPausa();
        expect(iniciada.isError).toBe(false);
        expect(iniciada.structuredContent).toMatchObject({ codigo: 'pausa_iniciada', terminal: true });
        expect(escritorio['simulacao'].ocupantes().get('cafe_funcionando')).toContain('Ana');
    } finally { await cliente.close(); escritorio.encerrar(); }
});

test('uso completo gera quebra com fonte real e conserto desconta o saldo uma única vez', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe();
    estado.sala.itens = [
        ...estado.funcionarios.map((pessoa, indice): ItemPosicionado => ({
            id: pessoa.mesaId, tipo: 'mesa', celula: { x: 3 + indice * 3, z: 4 }, rotacao: 0,
        })), { ...cafe, usos: 100 },
    ];
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-manutencao-'));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    const turnos: string[] = [];
    escritorio['geral']['abrirSessao'] = () => ({
        enviar: async (prompt) => { turnos.push(prompt); }, encerrar: () => {},
    });
    const sorteio = Math.random;
    try {
        const retorno = escritorio['simulacao'].pedirPausa('Ana', 'cafe', 1);
        escritorio['simulacao']['registro'].agoraPausaMs = () => escritorio['simulacao'].segundosAtuais() * 1000;
        Math.random = () => 0;
        for (let passo = 0; passo < 1000; passo++) escritorio['simulacao'].avancar(0.1);
        expect(await retorno).toContain('Pausa concluída');
        expect(escritorio.publico().sala.itens.find((item) => item.id === 'cafe')?.quebrado).toBe(true);
        const quebra = escritorio.publico().social.eventos.find((evento) => evento.tipo === 'quebra')!;
        expect(quebra.alvoId).toBeUndefined();
        expect(quebra.texto).not.toContain('Ana');
        expect(quebra.texto).not.toContain('culpa');
        expect(escritorio['contextoGeral']('Bia')).not.toContain('último usuário');
        await Bun.sleep(20);
        expect(turnos).toHaveLength(2);
        expect(turnos.every((prompt) => prompt.includes(quebra.id))).toBe(true);
        expect(falasDoChat([], [quebra])[0]?.acao).toBe('Móvel quebrado');
        expect(escritorio['social'].interagir('Bia', 'Ana', 'contestar',
            'Aposto que foi você que quebrou a cafeteira.', 'publico', [quebra.id]))
            .toContain('Ação registrada');
        const saldo = escritorio.publico().moedas;
        expect(escritorio.consertarItem('inexistente', 'cafe')).toContain('não encontrado');
        expect(escritorio.consertarItem('Bia', 'cafe')).toContain('Conserto concluído');
        expect(escritorio.publico().moedas).toBe(saldo - 23);
        expect(escritorio.consertarItem('Ana', 'cafe')).toContain('não precisa');
        expect(escritorio.publico().moedas).toBe(saldo - 23);
        expect(escritorio['simulacao'].temItem('cafe')).toBe(true);
        expect(escritorio.publico().social.eventos.filter((evento) => evento.tipo === 'conserto')).toHaveLength(1);
        expect(escritorio.limparGeral().ok).toBe(true);
        expect(escritorio.publico().social.eventos.some((evento) =>
            ['quebra', 'conserto', 'pausa', 'contestar'].includes(evento.tipo))).toBe(false);
        escritorio['estado'].moedas = 0;
        escritorio['estado'].sala.itens = escritorio['estado'].sala.itens.map((item) =>
            item.id === 'cafe' ? { ...item, quebrado: true } : item);
        expect(escritorio.consertarItem('Bia', 'cafe')).toContain('Moedas insuficientes');
        expect(escritorio.publico().moedas).toBe(0);
        expect(escritorio.limparGeral().ok).toBe(true);
        expect(escritorio.publico().sala.itens.find((item) => item.id === 'cafe')?.quebrado).toBe(true);
        expect(escritorio['simulacao'].temItem('cafe')).toBe(false);
    } finally {
        Math.random = sorteio;
        escritorio.encerrar();
    }
});

test('conserto pelo MCP aceita nome único e repetição por ID não cobra novamente', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe();
    const maquina: ItemPosicionado = { ...cafe, id: 'maquina_123', tipo: 'maquina_guloseimas', quebrado: true };
    estado.sala.itens = [maquina];
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-conserto-mcp-'));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    const cliente = new Client({ name: 'teste-conserto', version: '1' });
    try {
        await cliente.connect(new StreamableHTTPClientTransport(await escritorio['mcp'].urlDe('Ana', 'geral')
            .then((url) => new URL(url))));
        const saldo = escritorio.publico().moedas;
        const contexto = escritorio['contextoGeral']('Ana');
        expect(contexto).toContain('Consertos pendentes: Máquina de guloseimas [ID maquina_123]');
        expect(contexto).toContain(`Moedas do escritório: ${saldo}`);
        expect(escritorio['contextoTurno']('Ana')).toContain('[ID maquina_123]');
        expect(escritorio['simulacao'].temItem('comendo')).toBe(false);
        const resultado = await cliente.callTool({ name: 'consertar_item',
            arguments: { item: '  MAQUINA de   guloseimas  ' } });
        expect(resultado.isError).toBe(false);
        expect(JSON.stringify(resultado.content)).toContain('Conserto concluído');
        expect(escritorio.publico().moedas).toBe(saldo - 40);
        expect(escritorio.publico().sala.itens[0]).toMatchObject({ quebrado: false, usos: 0 });
        expect(escritorio['simulacao'].temItem('comendo')).toBe(true);
        const repetida = await cliente.callTool({ name: 'consertar_item', arguments: { item: maquina.id } });
        expect(repetida.isError).toBe(false);
        expect(escritorio.publico().moedas).toBe(saldo - 40);
        expect(escritorio.publico().social.eventos.filter((evento) => evento.tipo === 'conserto')).toHaveLength(1);
    } finally { await cliente.close(); escritorio.encerrar(); }
});

test('nome ambíguo exige ID e nome desconhecido orienta a consulta sem gastar moedas', async () => {
    const estado = estadoInicial();
    estado.funcionarios = equipe();
    estado.sala.itens = ['primeira', 'segunda'].map((id, indice) => ({
        ...cafe, id, tipo: 'maquina_guloseimas', quebrado: true, celula: { x: 4 + indice * 2, z: 0 },
    }));
    const pasta = await mkdtemp(join(tmpdir(), 'lumon-conserto-ambiguo-'));
    const escritorio = new Escritorio(estado, () => {}, () => {}, pasta);
    escritorio['geral']['abrirSessao'] = () => ({ enviar: async () => {}, encerrar: () => {} });
    try {
        const saldo = escritorio.publico().moedas;
        expect(escritorio.consertarItem('Ana', 'Máquina de guloseimas')).toContain('Use o ID: primeira, segunda');
        expect(escritorio.consertarItem('Ana', 'inexistente')).toContain('Consulte ver_escritorio');
        expect(escritorio.publico().moedas).toBe(saldo);
        expect(escritorio.publico().sala.itens.every((item) => item.quebrado)).toBe(true);
        expect(escritorio.consertarItem('Ana', 'segunda')).toContain('Conserto concluído');
        expect(escritorio.publico().sala.itens.find((item) => item.id === 'primeira')?.quebrado).toBe(true);
        expect(escritorio.publico().sala.itens.find((item) => item.id === 'segunda')?.quebrado).toBe(false);
    } finally { escritorio.encerrar(); }
});
