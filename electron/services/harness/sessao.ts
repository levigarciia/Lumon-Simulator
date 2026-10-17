import type { Funcionario } from '../../../shared/funcionarios';
import { criarSessaoClaude } from './claude';
import { criarSessaoCodex } from './codex';
import { criarSessaoLocal } from './local';
import type { ConfiguracaoSessao, SessaoAgente } from './tipos';

/** Abre a sessão no harness do provedor do funcionário. */
export function criarSessao(funcionario: Funcionario, configuracao: ConfiguracaoSessao): SessaoAgente {
    const modelo = funcionario.modelo;
    
    if (modelo.provedor === 'claude') {
        return criarSessaoClaude(configuracao);
    } else if (modelo.provedor === 'codex') {
        return criarSessaoCodex(configuracao);
    } else if (modelo.provedor === 'local') {
        return criarSessaoLocal(configuracao);
    }
    
    throw new Error(`Provedor desconhecido: ${modelo.provedor}`);
}

