import { refina } from './cargos';
import type { Sala } from './escritorio';
import type { Funcionario } from './funcionarios';

/** Mantém os donos de mesas existentes e atribui mesas livres a quem perdeu a sua. */
export function reconciliarMesas(funcionarios: Funcionario[], sala: Sala): Funcionario[] {
    const mesas = new Set(sala.itens.filter((item) => item.tipo === 'mesa').map((item) => item.id));
    const ocupadas = new Set<string>();
    const comMesa = new Set<Funcionario>();
    for (const funcionario of funcionarios) {
        if (!refina(funcionario.cargo) || !mesas.has(funcionario.mesaId)
            || ocupadas.has(funcionario.mesaId)) continue;
        ocupadas.add(funcionario.mesaId);
        comMesa.add(funcionario);
    }
    const livres = [...mesas].filter((id) => !ocupadas.has(id));
    let proxima = 0;
    const reconciliados = funcionarios.map((funcionario) => {
        if (!refina(funcionario.cargo)) return funcionario.mesaId ? { ...funcionario, mesaId: '' } : funcionario;
        if (comMesa.has(funcionario)) return funcionario;
        const mesaId = livres[proxima];
        if (!mesaId) return funcionario;
        proxima++;
        return { ...funcionario, mesaId };
    });
    return reconciliados.some((atual, indice) => atual !== funcionarios[indice]) ? reconciliados : funcionarios;
}
