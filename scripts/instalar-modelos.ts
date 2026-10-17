import { join } from 'node:path';
import { homedir } from 'node:os';
import { instalarRuntime } from '../electron/services/instalador';
import { detectarBackend } from '../electron/services/dispositivosMotor';

const controle = new AbortController();
process.once('SIGINT', () => controle.abort(new Error('Instalação interrompida.')));
const backend = await detectarBackend(controle.signal);
const executavel = await instalarRuntime(join(process.env.APPDATA ?? homedir(), 'Lumon', 'runtime'),
    backend, controle.signal, (progresso) => console.log(`Instalando ${backend.toUpperCase()}: ${progresso}%`));
console.log(`Motor disponível: ${executavel}`);
