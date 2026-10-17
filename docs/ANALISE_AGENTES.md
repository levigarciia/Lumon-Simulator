**Análise do funcionamento dos agentes da Lumon**

Data: 17 de outubro de 2026.

Este documento preserva o diagnóstico anterior à implementação. A execução posterior e os contratos atuais
estão em `TRANSICAO_SIMULADOR.md`. As referências de linhas abaixo correspondem ao código analisado originalmente.

**Conclusão principal**

O Lumon já possui uma base própria de simulador: corpos controlados pelo processo principal, necessidades,
relações direcionais, percepção com audiência, propostas políticas, manutenção e refinamento com regras verificáveis.
Essa base merece ser preservada. A mudança de produto, entretanto, ainda não chegou a todos os contratos de execução.
Personagens de um departamento continuam sendo executados, em parte, como programadores de uma equipe de software.

A prioridade é concluir essa transição antes de ampliar o número de mecânicas. Isso exige separar personagem,
regras da partida e infraestrutura de inferência, desativar capacidades externas no fluxo atual e corrigir os pontos
em que limitações técnicas se transformam em acontecimentos ou punições dentro da ficção.

Na elaboração deste diagnóstico, as sugestões ainda não estavam implementadas. O registro da transição posterior
identifica o que passou a fazer parte do produto e quais expansões continuam futuras.

**Escopo e método**

Foram examinados os documentos de produto e os fluxos de contratação, instruções, sessões, ferramentas MCP,
Work, delegação, avaliação, percepção, relações, propostas, movimento, pausas, manutenção, persistência e reinício.
Também foram examinados os adaptadores local, Claude e Codex, componentes da interface e testes relacionados.
As referências de código abaixo usam caminhos relativos à raiz do projeto e as linhas observadas nesta análise.

Foram executados `bun run verificar`, `bun test` e `bun run build`. Todos passaram. A suíte executou 182 testes,
com 3115 verificações e nenhuma falha, distribuídos por 26 arquivos. O build avisou sobre o tamanho do bundle principal,
com aproximadamente 1,81 MB antes de compressão. Esse aviso é independente dos problemas de comportamento.

Foram realizados experimentos adicionais em memória com funções reais do projeto. Eles confirmaram aceitação de uma
quarta célula, manutenção de arquivo vencido na correção e avanço da leitura social durante a montagem do contexto.
Não foram executadas novas partidas com modelos reais, validações visuais Electron ou ensaios prolongados.
Artefatos antigos não foram tratados como resultados obtidos nesta análise. A partida salva do usuário não foi lida
nem alterada. Não foi encontrado um repositório Git na raiz de trabalho.

**Como o sistema funciona hoje**

1. A contratação cria uma identidade visual, um cargo, um modelo e a opção técnica de autonomia.
   A personalidade é gerada a partir do ID. Uma mesa livre é requisito para entrada na equipe.
2. `Escritorio` concentra o estado e conecta os serviços. `Partida` controla a geração da partida, impedindo que
   gravações antigas sobrescrevam um reinício. `Persistencia` valida e grava o estado em JSON de forma atômica.
3. `SimulacaoEscritorio` avança em passos de 100 milissegundos. Ela mantém posições, necessidades, reservas de itens,
   pausas e encontros. A cena recebe quadros e interpola os movimentos.
4. No Geral, mensagens, menções e acontecimentos alimentam uma fila. A maior parte das falas é serializada.
   Pausas e encontros podem liberar a fila enquanto a ação continua aguardando.
5. `Expediente` mantém um turno por funcionário, sessões e históricos separados por canal, projeto e thread.
   O chat individual usa conversa. O Work usa uma sessão de trabalho associada a uma pasta de Macrodados.
6. No refinamento, o jogador escolhe a duração. Um líder disponível recebe o pedido e pode delegar etapas sequenciais.
   Os participantes compartilham o arquivo e os envios reais. O delegado para ao aceitar um grupo ou completar
   quatro envios.
7. O modelo usa ferramentas MCP com identidade vinculada ao token. As ferramentas consultam e alteram a partida.
   O processo principal valida os envios, a audiência e as decisões reservadas ao jogador.
8. Encerrar a execução produz uma entrega para avaliação. Aprovação concede moedas e crédito da cota.
   Rejeição encerra a avaliação e aumenta o registro de falhas dos participantes.
   Correção abre outro trabalho vinculado.
9. Os acontecimentos alimentam a percepção individual. Ações e interpretações alteram relações.
   Propostas podem pedir demissão, troca de liderança ou afastamento de um líder, com decisão final do jogador.

Referências: `electron/services/escritorio.ts:59`, `electron/services/partida.ts:7`,
`electron/services/persistencia.ts:14`, `electron/services/simulacao.ts:80`, `electron/services/geral.ts:121`,
`electron/services/expediente.ts:52`, `electron/services/orquestracao.ts:65` e `electron/services/social.ts:43`.

**O que está alinhado e deve permanecer**

* Autoridade da simulação no processo principal, com a cena representando seu estado.
* Diferença entre narrar uma ação e executá-la por ferramenta.
* Aprovação da entrega e decisões políticas fora do poder dos funcionários.
* Audiência pública, local e reservada, com fontes e autoria preservadas.
* Pensamento privado separado da fala pública e da interpretação dos colegas.
* Relações direcionais e personalidades persistidas.
* Encontros com caminhada, uso exclusivo de itens e pausas que aguardam conclusão física.
* Recompensas ligadas ao resultado aceito e à aprovação, com proteção contra duplicação.
* Cancelamento, revogação de tokens na demissão e proteção por geração no reinício.
* Fila de inferência local liberada durante ferramentas e delegações.
* Testes controlados que verificam regras sem depender de uma resposta específica do modelo.

Esses mecanismos já resolvem problemas importantes de consistência. Uma reescrita completa perderia garantias úteis.

**Achado 1: a identidade profissional ainda pertence ao orquestrador**

Prioridade: alta. Evidência: direta no código.

`shared/funcionarios.ts:7` ainda define Desenvolvedor, Revisor, Estagiário e Pesquisador, com ordens para escrever
código, investigar repositórios, testar implementação e conferir renderização.
O líder recebe instruções de revisão de software.
Essas instruções entram nas sessões do Work e do chat individual em `shared/funcionarios.ts:138`.
No Geral a instrução completa do cargo não é usada da mesma forma, produzindo identidades diferentes entre canais.
A contratação também começa com Desenvolvedor em `src/components/Contratacao.tsx:78`.

Sugestão: definir funções do departamento, inicialmente líder e refinador, acrescentando especializações somente quando
existirem diferenças mecânicas. Separar cargo, personalidade e habilidade. Migrar identificadores antigos preservando
os nomes dos cargos nos registros históricos. Consolidar também a duplicação do catálogo em `shared/cargos.ts:1`.

Aceite: os quatro contextos, Geral, reservado, individual e Work, reconhecem a mesma função atual e nenhuma instrução
do simulador pede código, testes de software, navegador ou acesso a repositórios.

**Achado 2: o Work atual ainda ativa capacidades de programação**

Prioridade: alta. Evidência: direta no código, sem execução dessas capacidades nesta análise.

`electron/services/expediente.ts:235` escolhe o modo trabalho pela existência de projeto. Macrodados é um projeto,
portanto também entra nesse modo. No Claude, esse modo usa o preset de programação e mantém ferramentas internas;
com autonomia, pode ignorar permissões. No Codex, a autonomia de trabalho seleciona acesso amplo ao computador.
O modelo local filtra as ferramentas do refinamento, mas esse filtro é exclusivo do adaptador local.

Referências: `electron/services/harness/claude.ts:46`, `electron/services/harness/claude.ts:62`,
`electron/services/harness/codex.ts:104`, `electron/services/expediente.ts:154` e
`electron/services/harness/tipos.ts:12`.

Além disso, `adicionarProjeto` e `enviarTrabalho` permanecem invocáveis no IPC e nos serviços, embora tenham sido
retirados do painel principal. Ler histórico antigo não exige manter disponíveis novas execuções externas.
Referências: `electron/ipc.ts:43`, `electron/ipc.ts:59`, `electron/services/escritorio.ts:441` e
`electron/services/escritorio.ts:603`.

Sugestão: criar um modo explícito de personagem, com ferramentas apenas da partida, independente da existência de pasta.
Bloquear novos projetos externos e pedidos livres nas fronteiras do produto. Manter leitura e migração do histórico
num módulo de compatibilidade. Ocultar a opção de autonomia técnica da contratação atual. Se houver autonomia de
personagem no futuro, ela precisa representar iniciativa dentro do jogo, sem controlar permissões do computador.

Aceite: um personagem não consegue executar comando ou editar arquivo por nenhum provedor, mesmo se solicitado pelo
jogador no chat. O histórico antigo continua abrindo. Chamadas diretas aos métodos antigos retornam indisponibilidade.

**Achado 3: a correção de refinamento pode começar sem qualquer possibilidade de envio**

Prioridade: alta. Evidência: reprodução em memória e rastreamento do fluxo.

`corrigirEntrega` em `electron/services/orquestracao.ts:214` reaproveita o `arquivoId`.
O prazo do arquivo não é renovado.
`abrirArquivo` e `refinarArquivo`, em `electron/services/escritorio.ts:404` e `electron/services/escritorio.ts:420`,
bloqueiam o uso depois do prazo original. Assim, pedir correção após o vencimento abre uma execução que imediatamente
encontra o prazo encerrado. O motivo da correção chega ao prompt; o bloqueio principal é temporal.

Sugestão: representar uma nova rodada de correção com prazo próprio, mantendo o arquivo e a identidade usada para
evitar recompensa duplicada. Registrar rodadas, responsável pela devolução, motivo e resultados incrementais.
O prazo deve ser validado no serviço e exibido ao jogador antes do envio.

Aceite: encerrar um arquivo parcial, deixar o prazo vencer, pedir correção, aceitar um novo grupo e aprovar concede
exatamente a recompensa e a cota permitidas, inclusive após reabrir o aplicativo.

**Achado 4: falhas técnicas viram sofrimento e fracasso profissional**

Prioridade: alta. Evidência: direta no código.

`Expediente` chama `falha_ferramenta`, `recusa` e `turno_falhou` para alimentar necessidades. Em
`shared/necessidades.ts:38`, esses acontecimentos aumentam estresse e `falhasHoje`. Uma resposta técnica bem sucedida
reduz estresse por `turno_concluido`, inclusive no chat individual. Em `orquestracao.ts:354`, falha de execução também
pode virar um acontecimento social de falha.

O efeito é que problema de memória, indisponibilidade de provedor, erro no formato da chamada ou recusa de permissão
pode contaminar a avaliação de um personagem. Ao mesmo tempo, conversas individuais bem sucedidas oferecem uma
redução de estresse ligada à conclusão técnica, sem avaliar o conteúdo da conversa.

Sugestão: separar saúde do runtime, resultado de uma tentativa e consequência ficcional. Falhas de transporte devem
permitir recuperação e aparecer ao jogador sem contar como incompetência do funcionário. Uma tentativa de caixa
incorreta também deve continuar sendo exploração válida, até existir regra específica para seus efeitos emocionais.
Rejeição da Diretoria pode continuar produzindo consequência por ser uma decisão real da partida.

Aceite: indisponibilidade simulada do modelo não altera relações nem falhas profissionais. Uma rejeição real continua
registrando seus efeitos exatamente uma vez. Retentativas técnicas não duplicam ações já concluídas.

**Achado 5: há calendários com consequências diferentes para o mesmo expediente**

Prioridade: alta. Evidência: direta e cálculo reproduzido.

`shared/relogio.ts:1` converte um segundo de simulação em um minuto do escritório. O dia muda após 540 segundos,
ou nove minutos reais em execução normal. `simulacao.ts:420` então restaura energia e zera falhas e trabalho seguido.
Já a cota usa o calendário local do computador em `shared/departamento.ts:19`. O prazo do arquivo usa `Date.now()`.
Uma tarefa de 15 minutos reais atravessa mais de um dia visual, sem reiniciar a cota diária.

Não é um erro de conta: é uma decisão de produto hoje dividida entre sistemas. A cota real é explicitamente documentada.
Alterá-la exige uma decisão consciente, não uma correção silenciosa.

Sugestão: adotar um serviço de tempo que nomeie tempo da partida, calendário civil e prazos técnicos.
Preferência de produto: expediente da partida governa rotina e necessidades; desafios de duração real permanecem
identificados como tal. Se a cota continuar civil, apresentá-la como meta do dia real e separar esse conceito do turno.
Definir também suspensão, aplicativo em segundo plano, pausa global e retomada.

Aceite: uma mesma passagem de tempo possui efeitos documentados sobre energia, cota, prazo e limites sociais.
Esperar a fila do modelo não pode mudar essas regras de forma implícita.

**Achado 6: regras importantes são diferentes conforme o provedor**

Prioridade: alta. Evidência: direta nos adaptadores.

`OpcoesTurno`, em `electron/services/harness/tipos.ts:12`, declara que suas restrições só são aplicadas
pelo modelo local.
Obrigatoriedade de ferramenta, catálogo reduzido e retirada das ferramentas ao encerrar a etapa não têm a mesma
garantia nos outros adaptadores. O limite de envios do delegado está no serviço e é comum, o que é positivo.

No local, o chat individual sempre executa um turno obrigatório de ação antes de responder. Uma menção do jogador no
Geral também exige uma ferramenta e retira `nenhuma_acao` das opções. Até uma saudação pode gerar consulta ou ação
desnecessária. Referências: `expediente.ts:164`, `geral.ts:56` e `geral.ts:708`.

Sugestão: colocar permissões e condições de ação no serviço da partida. O adaptador pode melhorar a aderência ao
protocolo, mas nunca ser a única fonte de garantia. Permitir resposta ou ausência de ação quando o pedido não exige
mudança. Separar consulta, decisão e publicação, sem impor duas inferências a toda mensagem trivial.

Aceite: o mesmo roteiro tem permissões e efeitos equivalentes em local, Claude e Codex. A redação pode variar.
Uma saudação não exige ação mecânica. Uma ordem de pausa só é considerada cumprida após a pausa real.

**Achado 7: a distribuição de trabalho é excessivamente prescrita e pouco social**

Prioridade: média. Evidência: direta e interpretação de produto.

O primeiro líder disponível recebe o pedido. O prompt determina rotação entre colegas, etapa de quatro envios e
trabalho do líder ao final. A sequência foi desenhada para coordenação segura de trabalho, sem considerar relações
na seleção mecânica. Confiança, afinidade e necessidades podem influenciar o modelo pelo contexto, mas não são
regras explícitas de distribuição. Referências: `orquestracao.ts:42`, `orquestracao.ts:77` e `orquestracao.ts:139`.

Sugestão: manter uma base de distribuição justa e permitir escolhas justificadas pelo personagem, com motivos
observáveis. Excesso de carga, favoritismo, recusa e negociação precisam ser ações próprias, com validação e efeitos
definidos. A transferência atual é um bloqueio entre líder e solicitante; ainda não representa equipe ou departamento.

Paralelismo de refinamento deve ser avaliado depois. Se adotado, exige reserva de grupos e controle de envios
concorrentes. A fila única de GPU não desaparece por executar vários funcionários logicamente ao mesmo tempo.

Aceite: o jogador consegue explicar quem recebeu mais trabalho e por quê. O efeito de uma escolha social aparece
na distribuição real, sem obrigar toda preferência a virar punição ou conflito.

**Achado 8: os personagens reagem mais do que planejam**

Prioridade: média. Evidência: leitura dos acionadores atuais.

O sistema tem conversa livre, notificações, menções, pausas por instinto e instruções de personalidade. Não há um
estado de intenção duradoura que atravesse canais e turnos, com compromisso, prazo, progresso e abandono explícito.
Ambição e amizade aparecem nas instruções, mas não constituem um plano persistido de ação.

Sugestão: acrescentar poucas intenções por funcionário, ligadas a acontecimentos da partida. Exemplos: recuperar
confiança após uma cobrança, conversar com um aliado ou pedir redistribuição de carga. Cada intenção deve guardar
origem, envolvidos, próxima ação possível e condição de conclusão. Necessidades urgentes podem interrompê-la.
Decisões simples podem usar regras; chamar um modelo só quando houver escolha relevante.

Aceite: uma promessa concreta pode ser cumprida num turno posterior, cancelada com motivo ou cobrada com fonte.
Ela não reaparece indefinidamente como ordem antiga nem autoriza trabalho externo.

**Achado 9: a memória social preserva fatos recentes, mas ainda não organiza experiência duradoura**

Prioridade: média. Evidência: direta no armazenamento e na seleção de contexto.

Há até 800 acontecimentos recentes, além de evidências protegidas de propostas. O contexto pega os primeiros 15
ainda não lidos. A leitura é confirmada durante sua montagem, antes de saber se o turno terminou com sucesso.
Um acúmulo pode priorizar acontecimentos antigos pouco relevantes; um erro posterior pode consumir novidades sem
uma reação concluída. Referências: `social.ts:28`, `social.ts:70` e `social.ts:333`.

Experimento: com 16 acontecimentos públicos, a primeira montagem retornou os primeiros 15 e já avançou o marcador.
A segunda montagem retornou o evento 16, mesmo sem qualquer execução de personagem entre elas.

Sugestão: separar consulta e confirmação de leitura. Selecionar lembranças por relação com o assunto, envolvidos,
recência e importância. Preservar episódios marcantes com suas fontes e resumos privados, sem transformar uma
interpretação em fato. Uma busca simples por pessoas e tipos de evento pode vir antes de qualquer busca vetorial.

Aceite: uma demissão relevante continua lembrável após muitas falas triviais; uma conversa privada nunca aparece
para terceiros; falha antes da entrega do contexto não faz o funcionário perder definitivamente o acontecimento.

**Achado 10: limpar conversas também apaga partes da história da partida**

Prioridade: média. Evidência: direta, comportamento atualmente documentado.

`limparGeral`, em `escritorio.ts:641`, remove falas, cobranças, pausas, quebras e consertos da memória social.
As relações e cópias de evidências de propostas permanecem. Limpar Work ou chat também remove eventos órfãos.
Isso pode deixar ressentimento ou confiança sem uma lembrança consultável que explique sua origem.

Sugestão: diferenciar arquivar ou limpar a apresentação, esquecer acontecimentos e reiniciar a partida.
A limpeza visual deveria preservar episódios relevantes. Esquecimento deliberado precisa informar quais estados
serão mantidos ou recalculados. Essa é uma mudança no contrato atual e deve ser tratada explicitamente.

Aceite: limpar o painel não deixa uma proposta ou relação inexplicável. O jogador entende se está ocultando registros
ou alterando a memória dos personagens.

**Achado 11: o refinamento é verificável, mas oferece pouca variação de situação**

Prioridade: média. Evidência: direta no gerador.

Os seis grupos são plantados nas linhas A, D e G, distribuídos entre duas faixas de colunas, em
`shared/refinamento.ts:100`. A caixa é secreta e as tentativas dão retorno objetivo. Isso é uma base funcional,
mas a estrutura espacial é previsível e parte do desafio se resume a testar caixas.

A regra apresentada pede uma trinca. O esquema MCP permite até quatro células e `refinar` aceita um grupo com uma
célula extra, mesmo distante. O experimento confirmou esse aceite. Referências: `mcp.ts:151` e `refinamento.ts:178`.
Essa tolerância existe no contrato da função, portanto é um desalinhamento entre apresentação e regra, não uma
violação acidental de um validador que já exigisse exatamente três células.

Sugestão: decidir a regra de seleção e torná-la única. Variar posições válidas e dificuldade. Se a intenção for
aproximar a sensação do refinamento ficcional, experimentar sinais percebidos pelo personagem e sensibilidade
individual, com validação objetiva preservada no motor.
Não fornecer o gabarito ao modelo para fazê-lo parecer competente.

Aceite: interface, MCP e validador anunciam a mesma seleção. A dificuldade não depende de uma posição fixa nem de
uma pista secreta liberada por engano. Resultados continuam reproduzíveis a partir da semente.

**Achado 12: personalidade extrema e regras de convivência podem emitir ordens conflitantes**

Prioridade: média. Evidência: comparação das instruções.

`shared/personalidade.ts` determina que um perfil autoritário extremo trate contestação de subordinado como
insubordinação e cobre publicamente. Já `shared/social.ts:82` orienta que contestar cobrança indevida não é infração.
O cargo antigo também exige rigor sem hostilidade. O resultado depende de como cada modelo concilia essas ordens.

Sugestão: definir uma hierarquia explícita entre regras invioláveis da partida, conhecimento e preferências do
personagem. Autoritarismo pode afetar iniciativa, tom e interpretação sem criar prova de infração. Se abuso for
permitido como comportamento ficcional, registrá-lo como decisão injusta do personagem e permitir consequências.
Não apresentar uma política de proteção e uma ordem de punição automática como se fossem equivalentes.

Aceite: os perfis soam diferentes diante do mesmo fato, preservam os limites de conhecimento e não inventam uma
infração para satisfazer o traço. Discordância legítima e punição abusiva são distinguíveis no histórico.

**Achado 13: as relações mudam, mas suas consequências e recuperação ainda são limitadas**

Prioridade: média. Evidência: regras em `shared/social.ts:130` e `electron/services/social.ts:217`.

Cobranças, elogios, desculpas e reações produzem deltas relativamente fixos. O sistema já permite reconciliação,
mas não representa compromissos de reparação, confiança por assunto ou habituação a interações repetidas.
Não há evolução temporal dessas dimensões nas regras examinadas. Uma reação repetida é impedida enquanto a fonte
da interpretação continua no histórico recente; esse mecanismo não equivale a uma deduplicação permanente.

Sugestão: começar com retornos menores para repetições, episódios de conflito e reconciliação ligada a ações.
Evitar acrescentar muitas barras antes de definir efeitos observáveis. Preservar liberdade para uma cobrança
ser julgada justa e para uma amizade não determinar concordância automática.

Aceite: repetir elogios equivalentes não aumenta confiança indefinidamente com a mesma eficiência; um pedido de
desculpas tem diferença entre ser dito, aceito e acompanhado por reparação. A mesma reação identificada não duplica
efeitos após limpeza, poda ou reabertura.

**Achado 14: a documentação dos limites sociais divergiu do código**

Prioridade: média para manutenção, baixa para expansão de produto. Evidência: direta.

`docs/DINAMICA_SOCIAL.md` descreve 40 turnos sociais por dia. O código atual usa seis falas seguidas, reiniciadas por
nova mensagem do jogador ou conversa livre, com opção sem limite. Não existe esse contador diário no fluxo examinado.
Referências: `shared/geral.ts:93`, `geral.ts:241`, `geral.ts:496` e `geral.ts:561`.

Sugestão: atualizar o contrato e separar orçamento técnico de inferências, ritmo narrativo e encerramento da conversa.
Um limite técnico não precisa fazer os personagens esquecerem uma intenção ou declarar que o dia terminou.

Aceite: testes e documentação descrevem o mesmo limite. O jogador distingue silêncio voluntário, espera e orçamento
esgotado, sem transformar o painel em uma tela de configuração de inferência.

**Achado 15: resultados de ferramentas dependem de frases em português para controlar a execução**

Prioridade: média. Evidência: direta.

Há detecção de sucesso por prefixo como `Ação registrada [` e de encerramento por expressões como `Prazo encerrado`.
Algumas ferramentas sinalizam `isError`; outras devolvem falhas de negócio apenas como texto. Uma alteração de redação
pode mudar o comportamento do adaptador ou fazer uma operação recusada contar como ação concluída.
Referências: `mcp.ts:91`, `mcp.ts:177`, `expediente.ts:160` e `harness/local.ts:76`.

Sugestão: retornos estruturados com código, sucesso, efeito aplicado, evento criado e indicação de fim de etapa.
Manter uma mensagem legível para o modelo. Distinguir consulta bem sucedida, tentativa válida rejeitada e erro técnico.
Acrescentar identidade de ação e deduplicação para operações com efeito, especialmente ao recuperar um turno.

Aceite: mudar o texto apresentado não altera o estado da partida. Repetir uma chamada após falha de transporte não
duplica cobrança, gasto, proposta ou efeito de relacionamento.

**Achado 16: a sala ainda explica melhor o estado técnico do que a hierarquia**

Prioridade: média. Evidência: inspeção do componente, sem validação renderizada nesta análise.

`src/components/cena/Agente.tsx` representa caminhada, pausa, digitação, falas e alertas de bloqueio ou erro.
Esses estados não representam de forma própria o líder que aguarda um delegado, a devolução de uma etapa ou o
funcionário que aguarda avaliação. A documentação já reconhece a encenação da hierarquia como pendência.

Sugestão: dar estados próprios a coordenar, refinar, aguardar colega, aguardar avaliação e corrigir. Usar terminal,
postura e sinais discretos para expressá-los. Separar erro de serviço de estado emocional do personagem.

Aceite: um observador identifica pela sala quem distribuiu trabalho, quem está executando e quem aguarda revisão.
Os indicadores não exigem abrir logs nem expõem detalhes do harness na ficção.

**Achado 17: crescimento de histórico e custo de inferência precisam de orçamento próprio**

Prioridade: média, conforme o tamanho das partidas. Evidência: arquitetura, sem medição de carga prolongada.

O estado reúne conversas, ferramentas, trabalhos e refinamentos num único JSON. Diversas atualizações de texto
reconstroem registros e publicam o estado completo. A gravação em disco já agrupa mudanças, o que reduz escritas,
mas não elimina custo de serialização e transporte. Relações e novidades também ampliam prompts com a equipe.
O motor local mantém uma carga por vez, podendo recarregar pesos quando funcionários alternam modelos.

Sugestão: medir tamanho do estado, tempo de gravação, filas, trocas de modelo e inferências por minuto de partida.
Publicar mudanças incrementais e paginar históricos antes de substituir o armazenamento inteiro. Preferir um modelo
local compartilhado como configuração simples, mantendo personalidade nos dados de cada personagem.
Agrupar notificações por acontecimento relevante e oferecer retomada previsível após interrupção.

Aceite: uma partida longa mantém tempo de resposta e uso de memória medidos. Otimizações não vazam contexto privado,
não alteram a justiça da fila e não fazem personagens perder acontecimentos importantes.

**O que retirar do fluxo atual**

* Ordens de programação e de validação visual dos prompts atuais.
* Ferramentas de arquivo e terminal das sessões de personagens.
* Cadastro e início de novos projetos externos pelo IPC atual.
* Autonomia entendida como autorização para operar o computador.
* Obrigatoriedade universal de uma ação mecânica em mensagens triviais.
* Conversão automática de falha técnica em falha profissional e acontecimento social.
* Dependência de frases de retorno para detectar sucesso ou encerramento.
* Catálogo de cargos duplicado e vocabulário de equipe de software na contratação atual.

Contratos antigos necessários para abrir registros devem permanecer em compatibilidade. Testes que hoje validam
novas execuções do orquestrador precisam ser substituídos por testes de leitura histórica e rejeição das operações
desativadas. Preservar um teste antigo não justifica manter ativa uma capacidade incompatível com o produto.

**O que implementar, em ordem sugerida**

1. Fechar o domínio do simulador: modo personagem, catálogo único de ações, cargos atuais e bloqueio de
   execução externa.
2. Corrigir coerência: prazo de correção, regra de seleção, falhas técnicas separadas e leitura social confirmada.
3. Consolidar o tempo: regras explícitas para expediente, cota civil, prazos, pausas e suspensão.
4. Dar continuidade aos personagens: intenções pequenas persistidas, episódios lembráveis e compromissos verificáveis.
5. Fazer relações alterarem a vida: distribuição de carga, escolhas de companhia, pedidos, recusas e reconciliação.
6. Mostrar as consequências na sala: liderança, espera, devolução, reconhecimento e recuperação emocional.
7. Expandir a experiência Lumon: rituais da Diretoria, reconhecimentos coletivos, privilégios, integração de contratados
   e progressão do departamento. Definir custos, gatilhos, recuperação e representação antes de programar.

Burnout persistente, ambiente influenciando necessidades e novos departamentos são boas possibilidades posteriores.
Hoje eles aumentariam a quantidade de consequências antes de estabilizar a origem e a duração dessas consequências.
Uma segunda camada de agentes para inventar acontecimentos também deve esperar: o motor atual já pode ser a
autoridade objetiva da partida, sem exigir outro modelo para arbitrar cada regra.

**Arquitetura sugerida para evoluir sem reescrever tudo**

O personagem guarda identidade, função, personalidade, necessidades, relações, lembranças e intenções.
O serviço de decisão recebe uma percepção filtrada e produz uma ação proposta ou uma fala.
O domínio valida disponibilidade, audiência, custo, prazo e permissão; depois aplica a ação e registra seu resultado.
O distribuidor de acontecimentos entrega percepções a quem pode conhecê-las. A apresentação deriva esses resultados
para a sala e para os painéis. Os adaptadores de modelo cuidam somente de inferência, formato, conexão e cancelamento.

Na estrutura atual, isso pode ser introduzido por composição em `electron/services` e `shared`, extraindo de
`Escritorio` apenas responsabilidades coesas: trabalho de Macrodados, política de ferramentas, tempo e percepção.
Não há necessidade de uma hierarquia extensa de classes, de banco vetorial ou de substituir Electron e Three.js.
A compatibilidade fica isolada para leitura e migração. Um evento estruturado por ação deve guardar autoria,
instante da partida, audiência, fontes e efeitos mecânicos, sem substituir os testes de cada regra.

**Validação necessária para chamar essa transição de concluída**

* Contratos: todos os provedores recebem apenas capacidades de personagem e não executam operações externas.
* Ciclo de trabalho: arquivo parcial, prazo vencido, correção, reabertura e aprovação sem duplicar cota ou moedas.
* Tempo: rotina, necessidades, meta e prazo com cenários de suspensão e retomada.
* Falhas: modelo indisponível e repetição de chamada sem punição ficcional ou efeito duplicado.
* Conhecimento: fato público, relato, conversa reservada, pensamento privado e fonte desconhecida continuam distintos.
* Memória: evento importante permanece recuperável após muitas falas; falha de turno não consome leitura indevidamente.
* Personalidade: mesmos acontecimentos produzem escolhas diferentes sem modificar fatos ou capacidades.
* Política: proposta comunicada, apoio real, recusa, aprovação e saída de participante preservam autoria e evidências.
* Sala: liderança, execução, espera, correção e recuperação são compreensíveis em cenários renderizados.
* Partidas: rodar cenários com modelos reais e repetições, registrando versão do modelo, semente, contexto e ações.

Métricas úteis: ações inválidas, efeitos duplicados, contradições de conhecimento, lembranças recuperadas corretamente,
intenções cumpridas, distribuição de trabalho, tempo em fila, custo de inferência e capacidade do jogador de explicar
uma mudança de relação. Contagem de brigas ou de mensagens, isoladamente, não mede qualidade da simulação.

**Referências externas usadas na pesquisa**

O trabalho [Generative Agents](https://arxiv.org/abs/2304.03442) combina observação, memória, reflexão e planejamento
para produzir continuidade de comportamento. Ele fundamenta a sugestão de acrescentar lembranças e intenções,
mas não demonstra que os mesmos resultados ocorrerão na Lumon ou em seus modelos locais.

O trabalho [Concordia](https://arxiv.org/abs/2312.03664) distingue as ações dos personagens da autoridade que implementa
seus efeitos no ambiente. A recomendação para a Lumon é aproveitar essa separação conceitual mantendo regras
verificáveis no processo principal. Não é uma recomendação de adoção da biblioteca nem de um árbitro generativo.

**Primeira entrega recomendada**

Um conjunto restrito de mudanças que feche a transição funcional: modo personagem para todos os provedores,
cargos e instruções de Macrodados, bloqueio de novos trabalhos externos, prazo próprio para correção e separação
entre falha técnica e resultado da partida. Completar com testes dos mesmos fluxos em todos os adaptadores.
Depois disso, evoluir memória e intenção, para que a equipe passe a ter continuidade além da próxima mensagem.
