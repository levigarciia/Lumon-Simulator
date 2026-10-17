import { join } from 'node:path';
import { homedir } from 'node:os';
import { baixarGguf } from '../electron/services/downloadModelos';
import { catalogoModelos, resolverModeloLocal } from '../shared/modelos';

const id = process.argv[2];
if (!id) {
    console.log('Uso: bun scripts/baixar-modelos.ts <modelo-id>');
    for (const item of catalogoModelos) console.log(`${item.id}: ${item.nome}`);
    process.exitCode = 1;
} else {
    const controle = new AbortController();
    process.once('SIGINT', () => controle.abort(new Error('Download interrompido.')));
    const item = resolverModeloLocal(id);
    const raiz = join(process.env.APPDATA ?? homedir(), 'Lumon', 'modelos');
    let ultimo = '';
    const caminho = await baixarGguf(raiz, item, controle.signal, (fase, recebido) => {
        const atual = `${fase}: ${Math.round(recebido / item.tamanho * 100)}%`;
        if (ultimo === atual) return;
        ultimo = atual;
        console.log(atual);
    });
    console.log(`Modelo disponível: ${caminho}`);
}
