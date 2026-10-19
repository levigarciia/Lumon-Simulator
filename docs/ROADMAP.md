# Roadmap do Lumon

Referência única para produto, contratos atuais, pendências e validação. Atualize a seção correspondente ao
concluir uma mudança. Regras de implementação ficam em `AGENTS.md`.

## Produto e limites

O Lumon é um simulador inspirado em Severance, com escritório 3D isométrico e modelos voxel. A Diretoria
administra o departamento e acompanha funcionários de IA trabalhando, convivendo e reagindo às suas decisões.
Macrodados é a atividade atual. Personalidade, hierarquia, relações e consequências orientam a evolução.

* O processo principal controla a partida. A cena representa o estado e interpola movimentos.
* Modelos decidem falas e iniciativas; o domínio valida permissões, audiência, custos, prazos e efeitos.
* Projetos externos, comandos e pedidos livres pertencem ao antigo orquestrador. Preserve contratos necessários
    aos registros, migrações e testes. Sessões atuais recebem apenas capacidades da partida.
* Mensagens e avaliações da interface têm autoria institucional da Diretoria, sem identidade pessoal configurável.
* Pensamentos e conversas privadas preservam sua audiência, mesmo quando o jogador pode acompanhar os registros.
* Falhas de infraestrutura não geram punições profissionais ou emocionais.
* Planejamento não equivale a implementação. Testes controlados não comprovam comportamento espontâneo
    e consistente dos modelos em partidas prolongadas.

## Implementado e contratos atuais

### Escritório, equipe e carreira

Sala com compra, posicionamento, rotação e venda de móveis; contratação, edição e demissão com histórico.
O processo principal mantém corpos, rotas, necessidades, pausas e ausências. A sala mostra refinamento,
coordenação de delegações, correção e espera pela Diretoria.

Cargos ativos: Estagiário, Refinador, Líder, Supervisor e Conselheiro de Bem estar. Os dois últimos não refinam.
Supervisor e Conselheiro não exigem nem ocupam mesas, inclusive após edição ou promoção. O Supervisor circula
em pé pela sala e faz paradas para observar. O Conselheiro permanece na Sala de Bem estar, disponível para
sessões. Pausas, encontros e ausências têm prioridade; ao terminar, cada cargo retoma seu posto.
Demissão encerra sessões e acesso MCP, interrompe trabalhos envolvidos e preserva autoria e evidências.

A carreira segue Estagiário, Refinador, Líder e Supervisor. Conselheiros ficam fora dessa escada.
Mérito vem de resultados e reconhecimento. Promoções exigem mérito, vaga, evidências conhecidas e decisão da
Diretoria, revalidados na execução. A ficha mostra mérito e próximo passo. Contratação direta tem regras próprias.
Em `propor_mudanca` com `tipo: promocao`, omitir `funcionario` usa a identidade da sessão. Um alvo explícito
continua exigindo o ID do próprio autor; recusas informam esse ID e a opção de omitir o campo. As outras propostas
continuam exigindo o alvo. O catálogo distingue solicitação e execução e orienta obter evidências conhecidas.
O histórico salvo da Kim registrava tentativas com o nome ou IDs de colegas e evidências vazias, todas recusadas,
sem criar proposta. Testes MCP em estado temporário reproduzem esses argumentos, verificam evidências, mérito,
vagas e objetivo de carreira e completam o pedido próprio até a aprovação da Diretoria. A iniciativa do modelo
real depois desta correção ainda precisa ser observada.

Referências: `shared/escritorio.ts`, `shared/cargos.ts`, `shared/carreira.ts`, `shared/atividadeDepartamento.ts`,
`electron/services/escritorio.ts` e `src/components/cena`.

### Macrodados e economia

O Geral possui Chat e Work. O Work acompanha períodos de trabalho, retomadas, histórico e avaliação de Macrodados,
sem seleção de projetos externos, pastas ou pedidos livres. A pasta de trabalho é criada automaticamente.

* Cada arquivo possui seis grupos numa grade de A1 a J8. Cada envio exige três células diferentes, consecutivas
    na horizontal e com o mesmo dígito, classificadas em uma das quatro caixas de temperamento.
* Terminal e MCP mostram grade, envios e progresso sem expor o gabarito. Seleção inválida e caixa incorreta têm
    retornos distintos. As caixas ainda não testadas são deduzidas dos envios registrados.
* Um líder disponível coordena e delega uma etapa por vez, aguardando a execução real do colega. Distribuição
    considera disponibilidade, carga e transferências. O delegado encerra ao aceitar um grupo ou atingir quatro
    envios; Estagiário tem limite de dois. O prazo pessoal bloqueia novos envios naquele período.
* Resumos de resultados usam envios registrados. Aceitação narrada pelo modelo não vale como resultado.
    O líder com período ativo pode usar `invocar_pro_work` para iniciar períodos paralelos no mesmo arquivo
    para todos os colegas livres que refinam. A convocação respeita pausas, ausências, conversas em andamento,
    terminais avariados, esgotamento, outras tarefas e transferências aprovadas, sem duplicar participações.
    Encerrar o período não completa o arquivo nem aprova a entrega. Arquivos incompletos permanecem disponíveis,
    com grade e envios preservados. O contador pessoal recomeça em cada retorno, sem renovar o prazo dos colegas.
* Refinadores, estagiários e líderes podem escolher `ir_para_work` nos canais sociais. A entrada começa somente
    depois de concluir o turno social. `sair_do_work` libera a participação para convivência; `fazer_pausa` no Work
    inicia descanso real e libera a execução. A saída do líder preserva etapas dos colegas ainda em andamento.
    Sair e iniciar descanso continuam permitidos após o prazo ou o limite de envios da etapa.
    Avisos de ócio e o retorno das pausas oferecem novas decisões, sem impor retomada nem exigir a Diretoria.
* Só um arquivo com 100% pode seguir para aprovação. Entregas parciais antigas ainda sem decisão voltam ao estado
    pendente; aprovações antigas são preservadas. A conclusão por um delegado depois da saída do líder também
    disponibiliza a entrega principal para avaliação.
* Só a Diretoria aprova. A recompensa é de oito moedas por grupo aceito e doze extras pelo arquivo completo,
    até 60 moedas. Delegações e conversas não concedem moedas.
* A cota compartilhada é de 18 grupos aprovados por dia civil local. Sua conclusão concede 30 moedas extras
    e um comunicado uma única vez por dia. Limpar o histórico não apaga a cota.
* Rejeitar encerra a avaliação sem recompensa nem correção automática. Pedir correção cria uma rodada vinculada,
    com motivo e prazo próprios, preservando o arquivo. Correção e reabertura não duplicam créditos.
* A agenda entrega arquivos automaticamente como comunicados no Geral, sem iniciar o Work. Só chega outro quando
    não há arquivo incompleto disponível. A equipe decide quando trabalhar, conversar ou descansar. A Diretoria
    ainda pode iniciar ou retomar pela interface. Consultar histórico não cria tarefas. Etapas e retomadas ficam
    no histórico; chegada, saída e decisões preservam autoria e audiência.

Referências: `shared/refinamento.ts`, `shared/departamento.ts`, `shared/trabalho.ts`,
`shared/fluxoRefinamento.ts`, `electron/services/orquestracao.ts` e `src/components/refinamento`.

Validação controlada: `tests/fluxoRefinamento.test.ts` cobre chegada sem execução automática, decisão pelo MCP,
saída voluntária, pausa real, períodos independentes, retomada do mesmo arquivo, persistência e conclusão por
delegado após saída do líder. `tests/modeloLocal.test.ts` cobre a entrada sem inferência ou chamadas posteriores.
O fluxo também testa `invocar_pro_work` pelo MCP, com vários colegas no mesmo arquivo, exclusividade da liderança,
ausência de duplicação e preservação de pausas e transferências.
Consultas e envios retornam a grade compartilhada atual e os participantes com etapa ativa. Disputar células já
aceitas por um colega atualiza o contexto sem consumir tentativas nem encerrar a participação. O líder recebe
orientação para convocar períodos paralelos, podendo refinar enquanto os colegas trabalham. O motor local alterna
inferências pela fila compartilhada e libera a fila durante ferramentas; cada funcionário mantém sua sessão.
O retorno terminal também encerra as ferramentas locais quando o último envio foi recusado, evitando manter uma
etapa esgotada aparentemente ativa. Testes controlados cobrem envios concorrentes pelo MCP, autoria, progresso,
continuidade dos colegas e resumo após recusa terminal.
Esses testes não comprovam a frequência das escolhas espontâneas dos modelos numa partida real.

### Convivência, memória e hierarquia

Geral, chat individual com threads, conversas reservadas, pensamentos privados, personalidades e relações
direcionais. Traços salvos orientam voz e decisões em todos os canais. Alterar personalidade recria as sessões.

* Falas públicas chegam à equipe; locais preservam ouvintes a até três células; reservadas chegam aos envolvidos.
    Pensamentos pertencem somente ao autor. Fontes, autoria e audiência acompanham acontecimentos e lembranças.
* Confiança, afinidade, respeito e ressentimento são direcionais. Afinidade acima de 90 indica Romance;
    ressentimento a partir de 90 indica Inimizade, com prioridade sobre Romance. Não presumem reciprocidade.
* `atualizar_pensamento` guarda a impressão privada e pode incluir `reacao`, com `acontecimento` ou `funcionario`,
    para concordar, discordar, perdoar ou desconfiar e atualizar a relação na mesma chamada. O pensamento serve
    de motivo. Sem reação, não altera relações. Fontes inválidas recusam a operação sem salvar o pensamento.
    `cobrar`, `contestar`, `elogiar`, `desculpar`, `defender` e `fofocar` comunicam ações a colegas,
    cada uma com descrição e ação próprias, sem argumento `acao`. A ferramenta separada de reação saiu do catálogo;
    pensar durante uma reação basta para encerrar a vez, sem exigir uma fala pública posterior.
    Testes controlados em `tests/social.test.ts` e `tests/decisaoSocial.test.ts` cobrem a chamada unificada,
    privacidade, validação de fontes e pessoas, repetição sem duplicar efeitos e encerramento da reação.
* Cobrança, contestação, elogio, defesa, desculpa e fofoca têm efeitos próprios. Dizer que agiu não substitui
    a ferramenta. Relatos e opiniões citados como evidência não se tornam fatos confirmados.
* Reações sobre a mesma fonte não reaplicam efeitos após poda ou reabertura. Repetições equivalentes têm efeito
    reduzido. Elogios baseados apenas em elogios e falas longas quase idênticas têm barreiras contra ciclos.
* Propostas de demissão, liderança, promoção, transferência e punição respeitam cargo e evidências.
    A decisão é exclusiva da Diretoria. Apoio exige comunicação real da proposta. Transferência bloqueia
    delegações entre envolvidos; não cria outro departamento.
* Pausa sem tarefa ativa e falta de aviso não são infrações. Estar sentado não comprova trabalho.
    Cobranças devem partir de impacto real, sem inventar faltas ou apoiadores.
    A Diretoria acolhe o tempo livre, conversas sobre qualquer assunto e pausas por vontade própria, sem exigir
    mal estar ou justificativa produtiva. Sem arquivo disponível, não há trabalho a cobrar. O contexto informa a
    cota numericamente, sem acrescentar um comunicado automático de cobrança a cada turno.
* Conversas reservadas organizam encontro e caminhada quando disponíveis. Respostas privadas não são publicadas
    no Geral. Encerramento pelo jogador e cancelamento liberam participantes e descartam respostas pendentes.
* O Geral oferece conversa livre, menções, reações e opção sem limite de falas. O modo sem limite não impede
    silêncio voluntário. Pausas, disponibilidade e encerramento continuam sendo respeitados.
* Leituras do Geral, chat e trabalho são independentes e confirmadas após conclusão bem sucedida do turno.
    `consultar` pesquisa registros conhecidos com filtros, paginação e detalhe por ID, sem consumir novidades.
* Episódios relevantes sobrevivem ao limite de acontecimentos recentes, preservando audiência e fontes.
    Limpar painéis preserva relações, memórias e evidências necessárias. Exclusão definitiva pelo Histórico remove
    registros e cópias, inclusive revisões anteriores em disco, sem recalcular efeitos já aplicados.
* `planejar_acao`, `cancelar_intencao` e `falar_com_responsavel` saíram do catálogo e recusam chamadas antigas.
    Intenções já salvas permanecem compatíveis com o estado existente.
* `conversar_reservado` usa uma descrição única nos canais sociais. `ver_escritorio` descreve o estado real
    consultado, incluindo necessidades, colegas, móveis, saldo, terminais, trabalho, cota e contexto social.
    `revisar_trabalho` incentiva consultar a última thread do Work e retorna também a cota atual, mesmo sem arquivo.
    `invocar_pro_work` mantém a restrição de liderança na política, sem repetir essa condição na descrição.
    Validação desta revisão: `bun run verificar`, 382 testes e `bun run build` passaram. A cobertura controlada
    verifica as seis ações, schemas, canais, recusa das ferramentas removidas e descrição reservada única.
    O uso espontâneo dessas ferramentas por modelos numa partida real ainda não foi observado.
* Mensagens e Work preservam texto e ferramentas na ordem de ocorrência. Registros antigos sem sequência
    recuperável são identificados, sem inventar a ordem. Pensamentos não aparecem nos balões.
    No Geral, fala e chamada real no mesmo retorno são preservadas, inclusive quando a ação encerra a participação.
    Nome de ferramenta com JSON escrito no texto exige nova tentativa pelo protocolo e não executa uma ação.

Referências: `shared/social.ts`, `shared/relacoes.ts`, `shared/personalidade.ts`, `shared/memoria.ts`,
`shared/intencoes.ts`, `shared/historicoWork.ts`, `electron/services/social.ts` e `electron/services/geral.ts`.

### Necessidades, anexos e manutenção

Energia, fome, estresse, humor e esgotamento entram na disposição dos funcionários. Esgotamento possui quatro
estágios, visíveis na ficha e na postura. Esgotados não recebem arquivos nem delegações. Folgas, incentivos,
sessões de bem estar, pausas e decoração recuperam o estado conforme as regras de cada ação.

* Movimento usa passos da simulação. Datas, cota, prazos e duração das pausas usam tempo civil.
* Pausas duram de um a quinze minutos reais após chegada ao objeto. O percurso não recupera necessidades;
    o desgaste passivo fica suspenso desde o trajeto. Durante o uso, necessidades melhoram ou permanecem estáveis.
* Cafeteira, máquina de guloseimas e sofá têm duas vagas; vitrola tem uma. Parceiros podem conversar em reservado
    no item sem interromper a recuperação. O fim de uma pausa encerra o diálogo e preserva o descanso do colega.
* Descanso e Bem estar possuem corredor, portas e vagas reservadas. A permanência começa na chegada;
    o retorno termina na mesa. Lotação e caminho bloqueado recusam a ação antes do afastamento. Folga sai do prédio.
* Supervisor concede incentivos e pode propor punição. Conselheiro conduz sessões. Custos, confiança e intervalo
    entre sessões são validados pelo domínio. A Diretoria concede folga e incentivos pela ficha.
* Móveis de pausa sofrem desgaste por uso concluído. Oito usos após compra ou conserto são protegidos;
    depois, a chance de quebra cresce de 1% até 20%. Mesas e decoração não sofrem esse desgaste.
* Quebra interrompe pausas e diálogos daquele item e bloqueia novos usos. Aciona a equipe sem revelar o último
    usuário. Somente ele recebe uma suspeita privada, sem confirmação de culpa.
* Conserto custa 25% do preço, arredondado para cima, com mínimo de cinco moedas. Usa saldo compartilhado,
    restaura o uso e zera o desgaste. Chamadas repetidas não cobram novamente.
* A agenda pode produzir visita, auditoria, avaria temporária de terminal e entrega real de arquivo ao líder.
    Marcos de contratação geram comunicados. Avaria de terminal tem recuperação automática, sem custo de reparo.

Referências: `shared/necessidades.ts`, `shared/esgotamento.ts`, `shared/ausencias.ts`, `shared/anexos.ts`,
`shared/circulacao.ts`, `shared/manutencao.ts`, `shared/eventosDepartamento.ts`,
`electron/services/simulacao.ts`, `electron/services/pessoal.ts` e `electron/services/agendaDepartamento.ts`.

### Ferramentas e modelos

Claude Agent SDK, Codex e motor local compartilham o MCP da partida, com credencial por funcionário.
Claude usa instruções próprias sem ferramentas internas; Codex desativa shell e integrações externas.
O serviço revalida origem, cargo e estado no momento da execução.

O catálogo centraliza políticas de disponibilidade e definições. `silencio` e `consultar_acontecimento` permanecem
como aliases de compatibilidade; os nomes atuais são `nenhuma_acao` e `consultar`.
Aliases não aparecem em `tools/list`. Consulta exata usa `consultar` com `acontecimento`, sem misturar filtros;
pesquisa mantém paginação e detalhes. Ambas preservam audiência e omitem impactos privados das relações.
No Geral, texto normal é fala pública. `falar_no_geral` leva falas de outros canais ao Geral, conforme a política
de disponibilidade. Capacidades privadas, sociais e de trabalho mantêm efeitos distintos.
Falas usam texto livre, sem exigir saída JSON. Argumentos estruturados pertencem às chamadas nativas de ferramenta;
o motor local envia `tools` e `tool_choice`, sem impor `response_format` ou gramática à fala.
No motor local, fragmentos de fala social atualizam a prévia durante toda a geração, sem classificar ou retirar
frases incompletas. A validação considera o texto completo e as chamadas recebidas somente depois de encerrar
o streaming. Reações obrigatórias não expõem texto. Ao concluir a geração, chamadas de ferramenta, truncamentos
e promessas sem execução retiram a prévia antes de continuar. `tests/modeloLocal.test.ts` cobre a transmissão
integral de promessas e sua validação posterior, com e sem uma chamada real na mesma resposta.
O chat individual aceita substituição e retirada dessas prévias sem interromper o turno. As partes de texto
acompanham a revisão, preservando ferramentas e sua ordem no histórico. Testes controlados em
`tests/expedienteTexto.test.ts` cobrem descarte, substituição, encurtamento e continuidade após ferramentas.

Listagem e execução usam as mesmas políticas de origem, cargo, pausa, reação e etapa ativa. O Work anuncia
consulta, refinamento, coordenação autorizada, saída e pausa. Trocar o estado depois do anúncio não autoriza uma chamada
obsoleta. O local renova a listagem em cada turno; os demais provedores também passam pela validação do servidor.

`nenhuma_acao` encerra a participação sem fala. Ações terminais descartam chamadas posteriores e não pedem texto
adicional. Resultados estruturados distinguem erro, código, audiência, efeito e encerramento. A migração mantém
compatibilidade com retornos textuais. Promessas de ação sem execução são retidas por validação linguística,
com limites de reconhecimento. Anúncios de entrada, saída e refinamento também são retidos. No Geral e no
reservado, uma promessa em texto final recebe até duas continuações na mesma sessão antes de passar a vez,
independentemente do provedor. Falas por ferramenta recusam promessas e permitem executar a ação no mesmo turno.
Após três respostas com promessa, o turno falha sem publicar a fala. Métricas agregadas acompanham
anúncio, uso, recusa, duração, repetição,
encerramento, promessas retidas e chamadas após encerramento.
Os serviços atuais devolvem resultados explícitos; métodos textuais antigos são adaptadores de compatibilidade.
Mudar a redação não altera sucesso nem erro. Os contadores ficam em memória durante a execução e são consultáveis
por `Escritorio.consultarMetricasFerramentas()`, sem ferramentas de diagnóstico oferecidas aos agentes.
Repetições usam assinaturas SHA 256; os contadores não armazenam argumentos, pensamentos nem textos de conversa.

O motor local baixa GGUF verificado por tamanho e SHA 256 e instala llama.cpp automaticamente.
Prioriza ROCm em Radeon compatíveis, com alternativas Vulkan e CPU. Um modelo fica carregado por vez;
a fila é cancelável e libera a GPU durante espera por ferramentas e delegações.
Históricos são separados por sessão, com compactação e contexto automático consultado no runtime.
Falha de memória não permite cortar o pedido nem reduzir a janela abaixo do mínimo necessário.
Modelos locais usam `enable_thinking: false` e `--reasoning-budget 0`.

Modelos e runtime ficam em `%APPDATA%\Lumon\modelos` e `%APPDATA%\Lumon\runtime`.
Catálogo, revisões, hashes e templates empacotados são definidos pelo código, sem cópias aqui.
Preparação opcional: `bun scripts/instalar-modelos.ts` e `bun scripts/baixar-modelos.ts qwen3.5-9b-q4`.

Referências: `shared/ferramentas.ts`, `shared/modelos.ts`, `electron/services/catalogoFerramentas.ts`,
`electron/services/ferramentas`, `electron/services/mcp.ts`, `electron/services/harness`,
`electron/services/motor.ts` e `electron/services/limitesMotor.ts`.

### Persistência e recuperação

Escritórios independentes começam vazios, com 600 moedas. Trocar encerra sessões e confirma a gravação antes
de abrir o destino. Reiniciar afeta a partida ativa, preserva modelos e arquivos externos e impede gravações
de sessões antigas. Falha de gravação mantém ou recupera o estado anterior e informa o erro.

* `escritorios.json`: catálogo e escritório ativo. Cada partida fica em `escritorios/<id>/`.
* `estado.json`: manifesto com hashes dos domínios. Dados ficam em `dados/`; sessões dos provedores, em `geral/`.
* Domínios: escritório, equipe, simulação, conversas, social e trabalho. Gravações reutilizam arquivos iguais
    e substituem o manifesto após concluir os novos arquivos, sem misturar revisões.
* `estado.anterior.json` preserva a revisão anterior, sem retorno automático. Exclusões definitivas eliminam
    também as revisões que ainda conteriam os registros removidos.
* Sem catálogo, o legado `lumon.json` é importado sem alterar o original. Catálogo existente impede nova
    importação automática por falha de abertura.
* JSON inválido, hash divergente ou domínio incompatível impedem abertura e informam o caminho afetado.
    Nunca substitua silenciosamente uma partida por estado vazio. Edição manual invalida a integridade.
* Diagnóstico começa pelo escritório ativo e seu manifesto. Preserve cópia antes de recuperação e não publique
    integralmente arquivos com falas e pensamentos privados.

Referências: `electron/services/persistencia.ts`, `electron/services/arquivosEstado.ts`,
`electron/services/partidas.ts` e `electron/services/partida.ts`.

## Trabalho pendente

### Estabilização técnica

* Retomar a mesma thread do Codex após interrupção. Hoje o cancelamento encerra a conexão e a abertura cria outra.
    Aceite: retomar sem perder contexto nem duplicar ações já concluídas.
* Automatizar a validação de interface de compra, posicionamento e demissão, incluindo cancelamentos e erros.
* Medir tempo de abertura, fluidez e custo de persistência em partidas extensas. Já existem importação dinâmica
    e métricas técnicas; redução de bundle não comprova melhora de tempo ou fluidez.

### Validação em partidas reais

* Calibrar esgotamento, recuperação, frequência de eventos e custo e efeito dos incentivos.
* Observar iniciativa, distribuição de trabalho, conflitos, alianças, reconciliação e progressão de carreira.
* Comparar provedores e modelos em sessões prolongadas, acompanhando repetição, recusas, memória e privacidade.
* Usar métricas de ferramentas para reduzir redundância com evidência, sem remover capacidades pela ausência
    de uso numa amostra curta.

### Evoluções de produto

Estas possibilidades ainda precisam de escopo e ordem de entrega. Não constituem implementação autorizada.
Cada uma exige regras, recuperação, representação visual e critérios de aceite antes do código.

* Aprofundar a encenação da hierarquia: cobranças, delegações e revisões compreensíveis olhando a sala.
    Os indicadores de coordenação, correção e espera já existem.
* Progressão do departamento: Ala da Perpetuidade, salas que liberam cargos e expansão da sala.
* Situações emergentes com mecânica própria: autoria contestada dos grupos refinados e facções visíveis.
* Novos departamentos e atividades coletivas, com consequências próprias além do refinamento atual.

## Validação e manutenção

Mudanças de código exigem `bun run verificar`, `bun test` e `bun run build`.
Mudanças somente documentais exigem revisão de referências, coerência com o código e `git diff --check`.
Não mantenha contagens de testes ou resultados antigos como garantia do estado atual.

* Regras e contratos: testes em `tests`, especialmente refinamento, entregas, social, transição, carreira,
    circulação, persistência, partidas e modelos locais.
* Interface e integração: `validar-refinamento.ts`, `validar-social.ts`, `validar-anexos.ts`,
    `validar-manutencao.ts`, `validar-escritorios.ts` e `validar-acoes-geral.ts` em `scripts`.
* Modelos reais: `avaliar-refinamento-local.ts`, `validar-personalidade.ts`, `validar-relacoes.ts`,
    `validar-conversa-local.ts`, `validar-modelo-local.ts` e `validar-contexto-automatico.ts` em `scripts`.

Cenários Electron usam estado temporário, IPC real e harness controlado quando indicado pelo script.
Compile o cenário com esbuild para Electron e execute com `ELECTRON_RUN_AS_NODE` ausente.
Capturas e relatórios ficam em `artifacts`. Confira o isolamento antes da execução; cenários com modelos reais
podem consultar o escritório salvo e devem preservar os dados do usuário.
Alterações no processo principal exigem reabrir o aplicativo. Atualizar o Vite só substitui a interface.
