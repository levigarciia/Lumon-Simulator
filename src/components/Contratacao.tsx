import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import {
    cargos, cargoAtual,
    estilosCabelo,
    paletaCabelo,
    paletaGravata,
    paletaPele,
    provedores,
    type Aparencia,
    type Cargo,
    type Contratacao as DadosContratacao,
    type Funcionario,
    type Modelo,
} from '../../shared/funcionarios';
import type { Resultado } from '../../shared/ponte';
import { catalogoModelos, formatarTamanho } from '../../shared/modelos';
import { lumon } from '../services/ponte';
import { Boneco, usePartesBoneco } from './cena/Boneco';
import { Amostras, Botao, Campo, classeEntrada, Janela, Segmentos } from './ui';

const aparenciaInicial: Aparencia = {
    pele: paletaPele[2],
    cabelo: paletaCabelo[0],
    estiloCabelo: 'curto',
    gravata: paletaGravata[0],
};

function BonecoGirando({ aparencia }: { aparencia: Aparencia }) {
    const grupo = useRef<Group>(null);
    const partes = usePartesBoneco();
    useFrame((_, intervalo) => {
        if (grupo.current) grupo.current.rotation.y += intervalo * 0.6;
    });
    return (
        <group ref={grupo} position={[0, -0.6, 0]}>
            <Boneco aparencia={aparencia} partes={partes} />
        </group>
    );
}

function Previa({ aparencia }: { aparencia: Aparencia }) {
    return (
        <Canvas camera={{ position: [0, 0.1, 3.3], fov: 35 }} className="rounded-lg bg-black/25">
            <ambientLight intensity={1.1} />
            <directionalLight position={[2, 3, 3]} intensity={1.4} />
            <BonecoGirando aparencia={aparencia} />
        </Canvas>
    );
}

function chaveModelo(modelo: Modelo): string {
    return `${modelo.provedor}:${modelo.id}`;
}

type PropriedadesContratacao = {
    mesaLivre: boolean;
    aoFechar: () => void;
    aoAbrirLoja: () => void;
    executar: (operacao: Promise<Resultado>) => Promise<boolean>;
    /** Funcionário a editar. Sem ele, a tela contrata alguém novo. */
    editando?: Funcionario;
};

function incluirModeloAtual(lista: Modelo[], atual: Modelo | undefined): Modelo[] {
    if (!atual || lista.some((modelo) => chaveModelo(modelo) === chaveModelo(atual))) return lista;
    return [atual, ...lista];
}

/**
 * Tela de contratação e de edição: aparência com prévia 3D, nome, cargo, modelo e autonomia. Na edição, os
 * campos começam com os dados atuais e o modelo em uso aparece mesmo que tenha saído do catálogo.
 */
export function Contratacao({ mesaLivre, aoFechar, aoAbrirLoja, executar, editando }: PropriedadesContratacao) {
    const [modelos, setModelos] = useState<Modelo[]>(() => incluirModeloAtual([], editando?.modelo));
    const [nome, setNome] = useState(editando?.nome ?? '');
    const [cargo, setCargo] = useState<Cargo>(cargoAtual(editando?.cargo ?? 'refinador'));
    const [modeloChave, setModeloChave] = useState(editando ? chaveModelo(editando.modelo) : '');
    const [aparencia, setAparencia] = useState(editando?.aparencia ?? aparenciaInicial);

    useEffect(() => {
        void lumon?.listarModelos().then((lista) => {
            setModelos(incluirModeloAtual(lista, editando?.modelo));
            setModeloChave((atual) => atual || (lista[0] ? chaveModelo(lista[0]) : ''));
        });
    }, [editando]);

    const modelo = modelos.find((candidato) => chaveModelo(candidato) === modeloChave);
    const mudarAparencia = (mudanca: Partial<Aparencia>) => setAparencia((atual) => ({ ...atual, ...mudanca }));
    const podeSalvar = !!nome.trim() && !!modelo && (!!editando || mesaLivre);
    const salvar = async () => {
        if (!modelo) return;
        const dados: DadosContratacao = { nome, cargo, modelo, aparencia, autonomia: false };
        const operacao = editando ? lumon!.editar(editando.id, dados) : lumon!.contratar(dados);
        if (await executar(operacao)) aoFechar();
    };

    return (
        <Janela titulo={editando ? 'Editar funcionário' : 'Contratar funcionário'} aoFechar={aoFechar} largura="w-[820px]">
            <div className="grid grid-cols-[260px_1fr] gap-6 p-6">
                <div className="h-[420px]">
                    <Previa aparencia={aparencia} />
                </div>
                <div className="flex flex-col gap-5">
                    <Campo rotulo="Nome">
                        <input
                            autoFocus
                            value={nome}
                            maxLength={32}
                            onChange={(evento) => setNome(evento.target.value)}
                            className={classeEntrada}
                        />
                    </Campo>
                    <Campo rotulo="Cargo">
                        <Segmentos
                            opcoes={Object.fromEntries(Object.entries(cargos).map(([chave, dados]) => [chave, dados.nome])) as Record<Cargo, string>}
                            valor={cargo}
                            aoMudar={setCargo}
                        />
                    </Campo>
                    <Campo rotulo="Modelo">
                        <select value={modeloChave} onChange={(evento) => setModeloChave(evento.target.value)} className={classeEntrada}>
                            {Object.entries(provedores).map(([provedor, rotulo]) => (
                                <optgroup key={provedor} label={rotulo}>
                                    {modelos
                                        .filter((candidato) => candidato.provedor === provedor)
                                        .map((candidato) => (
                                            <option key={chaveModelo(candidato)} value={chaveModelo(candidato)}>
                                                {candidato.nome}
                                            </option>
                                        ))}
                                </optgroup>
                            ))}
                        </select>
                    </Campo>
                    {modelo?.provedor === 'local' && (
                        <p className="text-[12px] text-discreto">
                            Preparação automática no primeiro envio.
                            {(() => {
                                const item = catalogoModelos.find((candidato) => candidato.id === modelo.id);
                                return item ? ` Download de ${formatarTamanho(item.tamanho)}.` : '';
                            })()} ROCm é priorizado nas Radeon compatíveis.
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-5">
                        <Campo rotulo="Pele">
                            <Amostras cores={paletaPele} valor={aparencia.pele} aoMudar={(pele) => mudarAparencia({ pele })} />
                        </Campo>
                        <Campo rotulo="Cabelo">
                            <Amostras cores={paletaCabelo} valor={aparencia.cabelo} aoMudar={(cabelo) => mudarAparencia({ cabelo })} />
                        </Campo>
                        <Campo rotulo="Penteado">
                            <Segmentos
                                opcoes={estilosCabelo}
                                valor={aparencia.estiloCabelo}
                                aoMudar={(estiloCabelo) => mudarAparencia({ estiloCabelo })}
                            />
                        </Campo>
                        <Campo rotulo="Gravata">
                            <Amostras cores={paletaGravata} valor={aparencia.gravata} aoMudar={(gravata) => mudarAparencia({ gravata })} />
                        </Campo>
                    </div>

                    <footer className="mt-auto flex items-center justify-end gap-2">
                        {editando && (
                            <span className="mr-auto text-[12px] text-discreto">
                                Salvar reinicia a sessão do harness. O histórico continua.
                            </span>
                        )}
                        {!editando && !mesaLivre && (
                            <>
                                <span className="mr-auto text-[12px] text-[#f0b44c]">Não há mesa livre.</span>
                                <Botao onClick={aoAbrirLoja}>Abrir loja</Botao>
                            </>
                        )}
                        <Botao variante="principal" disabled={!podeSalvar} onClick={() => void salvar()}>
                            {editando ? 'Salvar' : 'Contratar'}
                        </Botao>
                    </footer>
                </div>
            </div>
        </Janela>
    );
}
