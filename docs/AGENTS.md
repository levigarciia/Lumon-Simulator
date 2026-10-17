# Orientação para agentes

Consulte este documento antes de alterar o Lumon. As instruções fornecidas pelo usuário têm prioridade.

## Transição dos personagens

Consulte também `docs/TRANSICAO_SIMULADOR.md` para os contratos atuais de execução, memória, tempo e compromissos.
Cargos ativos são Líder, Refinador, Estagiário, Supervisor e Conselheiro de Bem estar; os dois últimos não
refinam. Esgotamento, ausências, incentivos e eventos estão em `docs/BEM_ESTAR.md`. Sessões de todos os canais têm apenas capacidades da partida.
Projetos externos e pedidos livres são recusados no IPC e no serviço. Os registros antigos permanecem legíveis.
A autonomia técnica dos dados antigos não concede permissões. Falhas de infraestrutura não punem personagens.
A virada diária das necessidades usa o mesmo calendário civil local da cota.

## Produto

O Lumon é um simulador do ambiente da Lumon inspirado em Severance, apresentado como um escritório 3D.
A Diretoria administra o departamento e acompanha funcionários de IA trabalhando, convivendo e reagindo às
decisões da Diretoria. Personalidades, relações, hierarquia, necessidades e consequências dentro da partida
são o centro do produto. Macrodados é a atividade atual de trabalho dos funcionários.

O projeto começou como um orquestrador para trabalhos reais em pastas e repositórios externos. Essa direção
foi substituída pelo simulador. A infraestrutura de agentes sustenta os personagens; contratos antigos de
projetos, arquivos e comandos permanecem por compatibilidade técnica e histórica. Sua presença no código
não autoriza reintroduzir trabalho externo como objetivo do produto. Novas funcionalidades devem aprofundar
a vida no departamento e suas consequências observáveis.

O Work do Geral é dedicado exclusivamente às simulações de Macrodados. A interface oferece duração, início,
interrupção, histórico e avaliação do refinamento, sem seleção de projetos, adição de pastas, threads ou pedidos
livres. Os contratos de trabalho por projeto descritos abaixo permanecem para compatibilidade e leitura dos
registros antigos, que não são apagados nem exibidos nesse painel. A pasta de Macrodados é criada automaticamente.
Macrodados também é o único projeto atual para os agentes. `ver_escritorio` não lista projetos externos salvos;
as instruções do Geral, reservado, chat individual e Work tratam referências antigas como histórico inativo.
O Terminal acompanha a grade e a última seleção dos agentes, sem mostrar o gabarito. O Histórico mantém as
avaliações. A cota diária de 18 grupos é compartilhada, avança somente na aprovação de arquivos e fica salva
independentemente do histórico. Delegações e correções não duplicam o crédito de um arquivo. O calendário local
define cada expediente diário. `shared/departamento.ts` reúne essas regras e a projeção visual segura.
Comunicados e o manual do departamento trazem a doutrina ficcional de Kier. Ao atingir a cota, a Diretoria
registra um anúncio público e concede 30 moedas extras uma única vez por dia, junto à aprovação que atinge
a meta. A cota também aparece nas consultas de arquivo e escritório dos agentes.

Qualquer pessoa deve entender, olhando a sala, quem lidera, quem trabalha, quem está bloqueado e quem mandou
refazer o trabalho de quem. O harness vem da Selene (`D:/Saas/Selene`): Claude Agent SDK e `codex app-server`,
com a credencial mantida nos CLIs oficiais.

Decisões do usuário:

* Visual 3D com Three.js e `@react-three/fiber`, câmera ortográfica isométrica e modelos voxel.
* O Work é dedicado ao refinamento de Macrodados, com prazo, delegação, avaliação e cota do departamento.
* A demissão tem efeito na partida: encerra o agente e grava quem foi demitido, por quem, o motivo e o vínculo
    com o histórico de trabalho que levou à decisão. O usuário pode contratar novos agentes.
* Progressão: moedas por refinamento aprovado, loja, edição do layout, pausas e manutenção dos móveis.
* Novas consequências exigem definição e implementação próprias. Ideias discutidas não são funcionalidades prontas.

## Planejamento

O estado atual e as pendências estão em `docs/ROADMAP.md`. As antigas fases do orquestrador não definem mais
o escopo. Descanso e Bem estar possuem anexos com corredor e navegação. Ala da Perpetuidade e expansão seguem pendentes.

## Contratos

* `shared/escritorio.ts`: catálogo e preços, rotação, células ocupadas, pontos de uso e `validarSala`.
* `shared/funcionarios.ts`: cargos, aparência, modelos, mensagens, demissões e instruções ao harness.
* `shared/estado.ts`: estado salvo, estado público e economia.
* `shared/ponte.ts`: métodos do preload e eventos. Cada canal é validado com zod em `electron/ipc.ts`.
* `shared/agentes.ts`: corpo dos funcionários na sala; quem tem tarefa real fica preso à mesa.
* `shared/anexos.ts` e `shared/circulacao.ts`: lugares, portas e rotas entre escritório e anexos.
    O processo principal reserva três lugares de Descanso e dois de Bem estar, sem reposicionar outros ocupantes.
    A sessão valida os dois participantes antes de afastar e espera a chegada. O retorno termina na mesa.
    `scripts/validar-anexos.ts` verifica a cena Electron com dados temporários e sem modelos reais.
* `electron/services/escritorio.ts`: dono do estado do jogo; valida, salva e publica cada mudança.
* `electron/services/expediente.ts`: turnos reais, sessões por funcionário e projeto, aprovações e status.
* `electron/services/orquestracao.ts`: pedidos do Work encaminhados ao líder, delegações sequenciais no mesmo
    projeto, resultados reais devolvidos pelo MCP e cancelamento dos participantes.
* `shared/trabalho.ts`: pedidos com solicitante identificado e eventos persistidos do Work, além dos
    pensamentos privados.
* `shared/diretoria.ts`: autoria institucional de todos os inputs e migração das autorias antigas.
    Não existe identidade pessoal nem preferência de tratamento nas configurações.
* `shared/historicoWork.ts`: ordem global dos pedidos, textos e ferramentas, com retomadas em novas entradas.
* `electron/services/harness`: Claude Agent SDK e `codex app-server` com processo dedicado por funcionário.
* `electron/services/motor.ts`: motor llama.cpp compartilhado, download verificado, instalação automática,
    prioridade ROCm nas Radeon compatíveis e fila cancelável liberada durante ferramentas e delegações.
    O contexto inicial é escolhido pelo runtime, sem teto fixo. `/props` informa a janela efetiva. O harness
    calcula o mínimo para instruções, ferramentas e pedido atual antes da compactação, e o motor amplia a
    carga quando necessário. Falhas de memória reduzem tentativas sem passar abaixo desse mínimo.
    `electron/services/limitesMotor.ts` concentra os argumentos automáticos e a validação dos limites.
* `electron/services/harness/local.ts`: histórico por sessão, SSE e ferramentas MCP reais. Sessões atuais recebem somente ferramentas da partida; arquivos e comandos pertencem apenas à compatibilidade.
    Turnos sociais comuns do Geral e reservado usam saída JSON com schema: `fala`, `acao` ou `silencio`.
    A decisão de ação exige ferramenta autorizada e argumentos, sem texto público, e aguarda o retorno real.
    Somente a decisão de fala validada chega ao Chat. JSON inválido e ações não autorizadas falham sem publicação.
    Turnos de reação usam o mesmo JSON restrito a ações, executam a ferramenta real e encerram após uma ação
    confirmada, sem pedir resumo. Pausas encerram a vez e devolvem apenas o estado privado após o uso.
    Interpretações privadas podem preceder uma interação pública ou nenhuma_acao. Consultas podem anteceder a ação.
    Uma saída truncada tem uma única nova tentativa,
    com teto de 2048 tokens; respostas parciais não executam ferramentas nem são publicadas.
    O catálogo e os contratos únicos ficam em `shared/modelos.ts`. Uso e validação em `docs/MODELOS.md`.
* `electron/services/persistencia.ts`: estado separado por domínio, com revisão atômica e validação por arquivo.
    `electron/services/partidas.ts` controla escritórios independentes e o catálogo `escritorios.json`.
    O `lumon.json` antigo é importado sem alteração. Consulte `docs/PERSISTENCIA.md`.
* `shared/manutencao.ts`: desgaste dos móveis de pausa e custo do reparo. Oito usos completos são protegidos;
    depois, a chance aumenta um ponto percentual por uso, limitada a 20%. Móveis quebrados não aceitam pausas.
    `consertar_item` usa o saldo compartilhado e registra a iniciativa do funcionário. Quebra e conserto são
    acontecimentos públicos. A quebra aciona a equipe sem revelar o último usuário; suspeitas e acusações são
    livres conforme a personalidade. Limpar o Geral remove esses registros. Detalhes em `docs/MANUTENCAO.md`.
* `electron/services/partida.ts`: reinício pelas configurações, com confirmação na interface, encerramento dos
    serviços e gravação do estado inicial. A geração da partida bloqueia gravações e eventos de sessões antigas.
* `electron/services/simulacao.ts`: relógio único; corpos, necessidades, pausas pedidas e avisos periódicos para funcionários livres.
    Pausas usam o relógio civil e duram de 1 a 15 minutos reais após chegar ao item, com recuperação gradual
    proporcional ao uso. Avançar passos de movimento não antecipa seu fim. O Geral passa a vez sem anúncio de volta.
    A próxima avaliação privada de necessidades espera dois minutos após terminar a pausa.
    Cafeteira, máquina de guloseimas e sofá têm duas vagas reservadas em posições distintas; vitrola mantém uma.
    Quando dois ocupantes chegam ao mesmo item, o Geral oferece uma conversa reservada opcional e leve.
    Os corpos permanecem no item e continuam recuperando necessidades com prazos independentes.
    A pausa congela o desgaste passivo desde o trajeto. Durante o uso, cada necessidade melhora ou fica estável;
    café, sofá e música não aumentam fome. O contexto de cada turno reservado informa que ambos já estão no item,
    com o nome do parceiro, sem reapresentar uma nova necessidade de iniciar pausa.
    Só o parceiro de pausa pode receber respostas reservadas; falas públicas e saídas para terceiros são recusadas.
    O fim ou a interrupção de uma pausa encerra o diálogo sem cancelar o descanso restante do colega.
    A quebra do item interrompe todas as suas pausas e informa o motivo. Só o último usuário recebe a suspeita
    privada de ter causado a quebra e decide se conta. Cada encontro de pausa tem sessão e histórico próprios;
    a situação física confirmada encerra o contexto de cada resposta, sem importar falas recentes do Geral.
    Conversas reservadas pelo MCP levam os dois participantes para um canto livre e aguardam a chegada.
    O chat individual
    permite esse deslocamento durante seu turno; tarefas reais do Work continuam impedindo a saída da mesa.
    Interrupção cancela o encontro sem entregar a fala. O relato do jogador no chat individual fica reservado
    ao destinatário como fonte não verificada. Pedidos atuais prevalecem sobre assuntos antigos do Geral.
    Ambos permanecem no encontro enquanto houver resposta em andamento ou na fila. Cada fala renova 60 segundos
    de permanência. Sem atividade, os dois retornam às mesas. Uma tarefa ou interrupção libera ambos.
    No chat individual, `conversar_reservado` só retorna quando a conversa privada termina: silêncio de um
    dos dois, encerramento pelo jogador ou dois minutos sem fala. Durante a espera, as falas do autor saem
    do diálogo reservado do Geral; o retorno traz a transcrição e o autor responde no mesmo chat.
    Conversas reservadas não têm limite de trocas nem consomem o limite de falas do Geral. Com um diálogo
    reservado filtrado e ativo, o Chat mostra Encerrar conversa (`encerrarReservado`): descarta as respostas na
    fila, interrompe a que está em andamento, libera a espera do chat individual e devolve os dois às mesas.
    Não existe `encontrar_colega`: `conversar_reservado` já caminha até o colega e entrega a fala.
    Limpar o Work, o chat individual ou excluir uma thread remove da memória social os acontecimentos
    órfãos (trabalhos apagados e relatos de mensagens apagadas), preservando evidências de propostas pendentes.
* `electron/services/mcp.ts`: servidor MCP HTTP em 127.0.0.1 com token por funcionário. Ferramentas
    `ver_escritorio`, `fazer_pausa`, `atualizar_pensamento` e `falar_no_geral`. No Geral e reservado, a pausa confirma
    o início e passa a vez, deixando o corpo ocupado até seu prazo. Work e chat individual aguardam a conclusão.
    Pensamentos são privados para o funcionário e visíveis ao jogador na ficha, sem acesso pelos colegas.
* `electron/services/geral.ts`: canal Geral; sessões de conversa com ferramentas do escritório.
    Todas as ferramentas dos turnos públicos, de reação e reservados aparecem no Chat como registros de ação,
    com estado, entrada, retorno e horários, usando a mesma apresentação do chat individual. Registros de ação
    são exclusivos da interface do jogador: não entram na transcrição dos colegas, nos balões nem geram falas
    ou acontecimentos sociais. Ações reservadas acompanham o filtro do respectivo diálogo. Interrupção e
    reabertura encerram ferramentas pendentes para evitar indicadores permanentes de execução.
    O indicador distingue preparação, espera pelo motor compartilhado, processamento, reação, escrita e ação.
    Se a interface receber um turno sem etapa de um backend antigo, orienta reabrir o aplicativo em vez de
    inferir preparação. O Vite atualiza a interface, mas alterações no processo principal exigem reabrir o Lumon.
    Limpar ou encerrar libera o turno imediatamente; conclusões antigas não alteram uma conversa nova.
    O motor local interrompe requisições sem resposta inicial ou sem novos dados por três minutos, liberando
    a fila com erro explícito. Marcadores terminais SSE concluem a leitura sem aguardar o fechamento HTTP.
    O Chat exibe o texto público durante a geração. Prévias ficam somente no estado enviado à interface,
    sem persistência, notificações ou acontecimentos sociais até a conclusão da fala. Reflexões e respostas
    reservadas não entram nessa prévia pública. Falha, limpeza, silêncio ou ação explícita descartam a prévia.
    O painel oferece modo sem limite de turnos e mostra Encerrar conversa sempre que houver atividade ou fila,
    inclusive após mensagens do jogador. Encerrar descarta próximos turnos e aguarda as falas ou ações em andamento,
    mostrando Encerrando conversa até concluírem, sem apagar o histórico. O modo sem limite
    remove apenas o teto de falas; os agentes continuam podendo silenciar e encerrar a conversa naturalmente.
    Oferece menções com `@Nome`, conversa livre em rodadas e limite de falas seguidas entre agentes, zerado por uma
    nova mensagem do jogador ou ao ligar a conversa livre. Quem o jogador cita responde primeiro.
    A fila prioriza pedidos diretos do jogador e, entre os demais turnos disponíveis, quem teve menos vezes
    desde a última mensagem do jogador ou ativação da conversa livre. Menções repetidas entre dois colegas
    não adiam indefinidamente os demais. O aviso de limite aparece uma vez até o jogador retomar a conversa.
    Cada fala de agente guarda o `eventoId` social, exibido como fonte na transcrição. Quem é citado pelo jogador
    ou por um colega passa antes por um turno de reação que não publica texto livre, mas permite ações públicas.
    Menções promovem a reação e
    a resposta do citado ao começo da fila, aproveitando turnos pendentes sem duplicar falas. A fala em andamento
    termina antes da convocação; indisponíveis aguardam. No harness local, `OpcoesTurno` limita as
    ferramentas às reações privadas e `interagir_socialmente`, com cobrança reservada à liderança quando não há
    pedido direto da Diretoria. Divergências e reparações favorecem o Geral; intimidades ficam reservadas.
    Uma ação pública substitui a resposta pendente para evitar duplicação. Reserva e chat individual recebem as falas recentes do
    Geral como contexto. O fim de um turno do chat individual desfaz encontros sem conversa reservada pendente.
    O chat individual responde diretamente num turno, podendo agir quando necessário.
    Cumprimentos com menção não exigem uma etapa artificial. `nenhuma_acao` continua disponível fora do Work.
    Explicações devem vir na própria resposta, sem promessas de explicar depois. No Geral e reservado, brevidade
    não impõe limite de três frases: a resposta deve completar a explicação pedida.
    No Geral, o texto normal já é a fala pública e `falar_no_geral` não é oferecido. Turnos reservados usam a
    origem MCP `reservado` e, como o chat individual e o Work, recebem `falar_no_geral` para levar uma fala ao
    Geral sem encerrar a resposta a quem conversa com eles. Assim os agentes transitam entre Geral
    (texto normal), conversa a sós (`conversar_reservado`) e canais individuais (`falar_no_geral`).
    Quem é citado no Geral responde mesmo durante uma tarefa do Work, inclusive o líder aguardando uma
    delegação; o corpo continua na mesa. Turnos espontâneos de quem trabalha seguem aguardando o fim da tarefa.
    Conversas reservadas também acontecem durante o Work: quem trabalha conversa da mesa, sem caminhar, e o
    Work oferece `conversar_reservado`. Apenas o líder recebe `falar_com_responsavel` (fora do chat individual).
    O serviço revalida o cargo antes de gravar uma iniciativa no chat individual principal, no máximo uma a cada
    dois minutos por líder. Os demais encaminham assuntos ao líder, inclusive no Geral, e só respondem à Diretoria
    quando ela os procura diretamente. A ferramenta descarta a sessão ociosa desse chat para o próximo turno
    ler a mensagem. O campo salvo `naoLidas` conta
    essas mensagens: a lista da equipe mostra o número e a aba Chat um ponto. Abrir o Chat na thread principal
    (`marcarConversaLida`) ou limpar essa conversa zera o contador.
    `interagir_socialmente` comunica ações conforme a audiência escolhida e registra efeitos nas relações.
    Ações públicas, elogios e cobranças bem sucedidos encerram a participação no Geral. Na reação, substituem a
    resposta pública pendente. A execução local descarta chamadas posteriores no mesmo lote e não pede texto extra.
    Texto normal de resposta é publicado automaticamente como fala no Geral,
    com menções e percepção social, quando o agente ainda não publicou uma fala ou ação social no turno.
    Pensamentos privados exigem `atualizar_pensamento`. Só o próprio funcionário e o jogador leem esse registro
    na ficha. Colegas não recebem notificações, menções nem acesso ao pensamento. Não há conversão automática
    de respostas em pensamentos. Respostas vazias e o marcador de silêncio não publicam mensagens.
    A ferramenta `silencio` encerra a vez no Geral ou reservado sem publicar fala, pensamento ou acontecimento.
    No harness local, seu retorno encerra a inferência sem pedir resumo. Variantes isoladas como `Silêncio.`
    também são descartadas; frases que apenas mencionam silêncio continuam sendo falas normais.
    O contexto social não injeta o último trabalho concluído nem pensamentos antigos como assunto atual.
    A lista de trabalhos e seus acontecimentos inclui somente execuções em andamento no Geral.
    `revisar_trabalho` permite consulta explícita do histórico no Geral, reservado, chat individual e Work,
    sem liberação de colegas. Sem ID, ou com um valor que não é ID, consulta o último pedido principal de
    Macrodados em texto legível, com etapas, avaliação e envios, sem gabarito nem pensamentos privados.
    Essa consulta, `ver_escritorio` e o contexto social dizem explicitamente quando não há arquivo em andamento:
    só a Diretoria inicia trabalho, pela interface ou pelo evento de entrega de arquivo, então ninguém deve assumir,
    distribuir ou cobrar etapas inexistentes.
    `ver_escritorio` descreve quem está em conversa reservada e com quem, em vez de pausa. Fontes ou
    acontecimentos inválidos em ferramentas sociais retornam os IDs conhecidos mais recentes.
    No harness local, o texto que acompanha apenas consultas ou ferramentas com erro é narração e não é
    publicado. Se o agente encerrar com uma fala que anuncia uma ação (`anunciaAcao`) sem ter agido no turno,
    recebe uma única inferência extra para executar a ferramenta, evitando que o próximo colega cobre uma
    promessa que o desenho dos turnos interrompeu. Essa consulta não injeta trabalhos antigos no contexto social.
    A consulta `ver_escritorio` retorna dados atuais, sem repetir instruções sociais ou falas já lidas.
    Estar sentado à mesa descreve o corpo; somente o status do expediente informa se há trabalho real.
    Pausas aparecem durante a execução. Durante uma pausa, a fila segue com os colegas e a
    próxima fala pode ser enviada após o término do uso do item.
* `shared/necessidades.ts`: energia, estresse, fome, humor, efeitos do tempo e dos acontecimentos do harness.
    Falhas técnicas e recusas de permissões não alteram necessidades. Elas avançam também fora do trabalho.
    Funcionários livres recebem um aviso de estado a cada dois minutos da simulação,
    sem iniciar pausas automaticamente. Trabalho, conversa, encontros, pausas e ausências adiam esses avisos.
    O funcionário decide se quer agir, pausar ou silenciar. Conversa privada aparece como Livre, sem desgaste
    de trabalho. Os avisos incluem o último pensamento privado e as relações do próprio funcionário.
    Colegas demitidos mantêm nome e indicação de demissão nas relações, no contexto e na ficha.
    Ao concluir uma pausa, o retorno sugere continuar com cuidados pendentes, por decisão do agente,
    considerando urgências atuais. Uma nova chamada de fazer_pausa confirma essa escolha.
    A disposição atual entra nos contextos do Work e sociais para orientar reações conforme a personalidade.
    Início, conclusão e interrupção de pausas geram eventos sociais públicos do tipo `pausa`, com origem
    por ferramenta. Aparecem no Geral e como acontecimentos no chat individual, sem inserir falas
    inventadas no histórico do harness. Pausas não notificam colegas nem agendam turnos. Eles podem decidir
    reagir ou usar `fazer_pausa` na mesma atividade, quando houver outro item livre, durante seus próprios turnos.
* `shared/social.ts`: personalidades, relações direcionais, audiência, acontecimentos e propostas persistidas.
* `shared/personalidade.ts`: esquema dos traços e tradução em voz, prioridades e decisões, com cinco faixas de
    intensidade por traço. A personalidade salva entra somente nas instruções da sessão do Geral, reservado,
    chat individual e Work. Mudanças no perfil recriam as sessões para descartar a instrução antiga.
* `electron/services/social.ts`: percepção individual, fontes conhecidas, relações, reações e apoio a propostas.
    Falas públicas chegam a todos; falas locais chegam ao destinatário e a quem estiver a até três células;
    reservados chegam somente aos participantes. A distância nunca bloqueia ações sociais: a caminhada até o
    colega é só encenação, e falta de caminho ou colega em pausa não impedem a entrega. Apenas interrupção e
    tarefa real do Work cancelam uma conversa reservada. Interpretações e propostas iniciais são privadas do autor e visíveis ao jogador.
    O MCP nunca recebe a ação de aprovar propostas. O jogador decide pela ficha de quem apresentou a proposta.
    Demissão preserva autoria e cópias das evidências. Troca de liderança troca cargos; transferência impede
    delegações do líder indicado para o solicitante. Detalhes em `docs/DINAMICA_SOCIAL.md`.
* `src/store/simulacao.ts`: último quadro recebido do processo principal; a cena só interpola.
* `shared/baloes.ts`: divide falas longas em partes com tempo proporcional à leitura. Balões usam fonte de
    15 pixels, mostram o progresso e permanecem até a última parte. Conversas reservadas exibem o texto ao
    jogador sem alterar sua audiência social. Pensamentos privados não aparecem nos balões.
    O indicador de resposta em andamento usa largura compacta. Ao terminar uma fala, o balão preserva o
    conteúdo durante 350 milissegundos de desaparecimento suave, mantendo o elemento montado na cena.

As ferramentas do escritório nunca pedem aprovação: no Claude, o `canUseTool` libera o prefixo `mcp__lumon__`;
no Codex, a elicitação `mcpServer/elicitation/request` do servidor `lumon` é aceita automaticamente.
* `src/components/cena`: modelos, posicionamento de móveis e composição da cena 3D.

## Interface e registros

O Geral tem duas abas: Chat mantém as conversas sociais e Work acompanha as simulações de Macrodados.
Não existe uma aba Escritório nem um histórico de falas separado. O Chat mostra falas reservadas com os
participantes identificados e permite filtrar cada diálogo. Os agentes recebem somente falas de que participaram.
Respostas privadas usam sessões separadas do Geral e são entregues ao parceiro, inclusive quando vêm em texto
normal. As instruções e os retornos de conversas reservadas não anunciam observação pelo jogador. Limpar o Chat
remove suas falas públicas e reservadas, cancela os encontros e descarta notificações pendentes dessas conversas.
Relações, propostas, episódios lembrados e cópias das evidências são preservados.
O chat individual permite várias threads por funcionário. A estrutura interna do Work preserva projetos e
threads para execução e compatibilidade, sem oferecer sua seleção no painel de Macrodados do Geral.
O catálogo fica em `shared/threads.ts` e no campo `threads` do estado. Mensagens e registros de trabalho
guardam `threadId`; mensagens individuais também distinguem os canais `conversa` e `work`. Registros antigos
continuam na conversa principal. Seleção e rascunhos são locais à interface, por destino e thread.
O expediente separa o contexto por projeto, canal e thread e recompõe o histórico ao recriar uma sessão.
As respostas guardam partes de texto e ferramentas na ordem de ocorrência. O Work persiste essas partes com
uma sequência global, a origem do pedido e os detalhes das ferramentas. A conclusão não substitui o histórico.
Registros anteriores preservam a resposta e recuperam as ferramentas disponíveis na conversa individual,
sem inferir uma ordem entre ferramentas e textos. Na leitura, a persistência tenta recuperar a sequência
das sessões locais do Codex com IDs de ferramentas e texto correspondentes. Só importa falas e ferramentas,
nunca raciocínios privados, e guarda uma cópia do arquivo antes da migração. Sem a sessão original,
as ferramentas antigas ficam numa seção expansível após o texto, identificada como sequência não salva.
Somente mensagens do jogador ficam alinhadas à direita. Funcionários e delegações ficam à esquerda,
com o retrato do autor. Novos registros guardam a aparência para preservar a identidade após demissões.
Cada funcionário executa um turno por vez. Pedidos do Work em threads diferentes podem usar líderes distintos;
interrupção, delegação e limpeza respeitam a thread e o projeto. O Chat social continua compartilhado.
O jogador escolhe a duração do refinamento; o trabalho é encaminhado a um líder disponível.
O fim de uma execução não aprova a entrega. Somente o jogador aprova pelo IPC.
Para os funcionários, aprovações e rejeições de entregas são decisões da Diretoria. Os acontecimentos sociais
usam a autoria `diretoria`, sem atribuir a avaliação ao jogador ou ao seu nome. Eventos antigos de avaliação
e suas cópias em evidências de propostas recebem essa autoria ao abrir o escritório.
As recompensas atuais seguem os grupos aceitos no refinamento e a cota diária, conforme a seção Validação.
Delegações e turnos individuais não concedem moedas. Registros antigos mantêm o histórico e o saldo, sem
aprovação nem recompensa retroativa. Correções ficam vinculadas à entrega anterior.
O ponto de leitura do Geral é salvo por funcionário e não pertence à sessão do harness. Ao retomar, mensagens
já lidas aparecem como histórico. Notificações informam o acontecimento que motivou a reação. Todas as mensagens
da interface são comunicados da Diretoria, inclusive em sessões já abertas.
No Work, a ferramenta `delegar` aguarda o turno real do colega antes de responder ao líder. Apenas o líder do
pedido ativo pode delegar. Ao reabrir, registros que ainda estavam em andamento são marcados como interrompidos.
A ficha abre antes do chat individual. O painel do funcionário tem as abas Ficha, Chat e Work; o Work mostra
as execuções dele agrupadas por projeto e thread, incluindo registros antigos. No chat individual, o botão de adição
cria e seleciona uma nova na hora, um duplo clique renomeia e o X exclui a thread com seu histórico
(`excluirThread`; na Principal o X limpa o histórico). O chat individual não tem projeto: roda no modo
conversa, sem arquivos nem terminal, com a origem MCP `chat`, que oferece as ferramentas do escritório e
sociais, mas não as exclusivas do Work. O produto atual não oferece pedidos livres de código.
Modelos locais rodam sempre sem raciocínio:
`enable_thinking: false` em toda requisição e `--reasoning-budget 0` no llama.cpp.
`atualizar_pensamento` registra uma impressão privada do próprio agente,
visível ao jogador e disponível apenas nos contextos sociais e de trabalho do autor. Data e hora seguem o computador;
o relógio interno da simulação move os corpos; o uso dos itens de pausa acompanha o tempo civil real.

A demissão encerra a sessão do harness, remove o funcionário e guarda o registro com motivo e autor. A conversa
do demitido continua salva e é exibida no histórico. As sessões atuais não oferecem operações externas nem pedem permissões técnicas ao jogador.

## Compatibilidade com o antigo orquestrador

Projetos externos, pedidos livres, arquivos, comandos e validação de entregas de código pertencem à infraestrutura
anterior. Preserve os contratos necessários à leitura dos registros, às migrações e aos testes existentes.
Essa preservação não define uma funcionalidade atual do simulador.

`registrar_validacao` registra critérios, evidências e pendências do próprio trabalho ativo. No fluxo antigo,
pedidos de interface exigem validação visual renderizada; sem relatório ou com critérios pendentes, a aprovação
fica bloqueada. A regra antiga concede 25 moedas por pedido aprovado, com cinco por categoria funcional e
visual verificada, até 35. Essa regra não substitui as recompensas de Macrodados.

## Instruções aos agentes

* Regras fixas ficam nas instruções da sessão; o prompt do turno leva só dados que mudam e o pedido atual.
* O comportamento de cada ferramenta é descrito apenas no MCP. Os prompts citam só a política de uso.
* `shared/relacoes.ts` calcula reações conforme personalidade e natureza da fonte. Concordância alivia mágoa
    gradualmente; perdão repara mais, e discordância de opinião não implica desconfiança. O retorno MCP mostra
    os valores anteriores e atuais e distingue reação aplicada, repetida e inválida.
    A visão privada de cada colega inclui uma postura de conversa, renovada em todos os canais a cada turno.
    Ressentimento alto produz frieza ou rispidez conforme personalidade, sem exigir conflito em toda fala.
    Concordar com um fato não apaga mágoas anteriores. Afinidade, confiança e respeito modulam proximidade,
    cautela e reconhecimento de competência. As relações de terceiros continuam inacessíveis.
    Cada reação nova registra um marcador positivo ou negativo na relação e os impactos numéricos no acontecimento.
    Valores saturados ainda recebem o marcador. O Geral mostra esses efeitos junto à ação ou fala de origem,
    com detalhes dos valores anteriores e atuais; a ficha mostra os seis sinais distintos mais recentes.
    Metadados de impactos são exclusivos do jogador e omitidos na consulta MCP dos acontecimentos.
* Necessidades são assunto privado. Saída, volta e prontidão só entram na conversa se houver pergunta ou impacto
    concreto em alguém. Falas longas idênticas do mesmo autor são silenciadas até um novo comunicado do jogador.
* O turno de trabalho recebe identidade, necessidades, pensamento anterior, colegas, relações e novidades sociais.
    Posições, itens e propostas ficam em `ver_escritorio`.
* No Claude, o modo conversa usa prompt de sistema próprio, sem o preset do Claude Code nem ferramentas internas,
    e o servidor `lumon` usa `alwaysLoad`. No Codex, as instruções seguem como `developerInstructions`.
* `tests/orcamentoPrompts.test.ts` limita o tamanho das instruções e dos prompts do Geral e do Work.

## Qualidade

TypeScript estrito, Bun, nomes em português, quatro espaços e linhas com até 120 caracteres. Estilize a
interface com Tailwind; os materiais da cena 3D são propriedades do Three.js. Não apresente funcionalidades
planejadas como prontas. Não use emojis ou traços como pontuação.

## Validação

O Work oferece trabalho simulado de Macrodados com duração escolhida pelo jogador. A grade e as tentativas
ficam em `shared/refinamento.ts` e no campo persistido `refinamentos`. O gabarito fica fora dos retornos MCP.
`abrir_arquivo` e `refinar` consultam somente o arquivo do trabalho ativo do autor. O prazo impede novos envios;
os agentes recebem a instrução de resumir ao concluir ou terminar o prazo. A recompensa é de oito moedas por
grupo aceito, com doze extras pelo arquivo completo, totalizando 60 moedas. Exige aprovação manual, uma única
vez por arquivo. O bônus diário entra na recompensa registrada da entrega que cumpre a cota. A pasta de
Macrodados fica dentro da pasta de conversas do escritório. `scripts/validar-refinamento.ts` verifica o início
pela interface com estado temporário
e harness controlado, incluindo seleção na grade, crédito da cota, comunicado, layout estreito e rejeição com motivo.
A rejeição encerra a avaliação como `reprovada`, sem abrir
correção, sem recompensa e com um fracasso registrado para cada participante. Pedir correção mantém o estado
`rejeitada` e abre uma nova tarefa vinculada. O início de trabalho e as etapas internas de delegação registram
acontecimentos sociais sem agendar falas no Geral. O encerramento principal e as decisões notificam a equipe.
No refinamento, cada delegado envia no máximo quatro tentativas ou aceita um grupo antes de devolver ao líder.
Os envios recentes são compartilhados sem o gabarito; a seleção inválida recebe orientação diferente da caixa
incorreta. Seleções reconhecidas ainda sem acerto destacam as caixas não testadas, deduzidas somente dos envios.
O líder consulta o arquivo antes de delegar e não impõe coordenadas ou caixas sem evidência. No harness local,
o catálogo do turno fica limitado às ferramentas relevantes ao refinamento e ao
escritório. Um retorno terminal da etapa retira as ferramentas e pede o resumo para evitar ações em ciclo.
As ferramentas explicam que os grupos são trincas horizontais de um mesmo dígito e que existem quatro caixas.
Delegações exigem envios reais por `refinar`. No harness local, cada inferência exige uma chamada até o retorno
terminal, com saída curta e texto publicado somente no resumo. Três respostas sem chamada interrompem o turno
com erro explícito, sem registrar os resultados narrados como tentativas.
`bun scripts/avaliar-refinamento-local.ts` reproduz a última grade salva com a equipe e personalidades atuais,
usando estado temporário, o MCP e o harness reais e o motor já carregado. Lê o escritório salvo sem alterá-lo
e grava `artifacts/refinamento-local.json`. O resultado mede esse cenário, sem garantir comportamento em toda partida.

Execute `bun run verificar`, `bun test` e `bun run build`.

A validação visual social está em `scripts/validar-social.ts`. Compile com esbuild para Electron, execute
com a variável `ELECTRON_RUN_AS_NODE` ausente e confira as imagens e `artifacts/social-validacao.json`.
Esse cenário usa harness controlado, uma pasta temporária e o IPC real. Não acessa os dados do usuário.

`bun scripts/validar-personalidade.ts` compara perfis nos mesmos assuntos com o Qwen3.5 9B local e grava
`artifacts/personalidade-validacao.json`. Usa o canal e o harness reais, sem ferramentas, sem raciocínio ampliado
e sem alterar o escritório salvo. A inspeção das falas complementa os testes de propagação das instruções;
não comprova comportamento consistente em toda conversa longa nem entre provedores diferentes.

`bun scripts/validar-relacoes.ts` compara Jamal com a relação salva e com uma relação próxima a Cláudio,
mantendo personalidade e assuntos iguais. Usa o motor local já carregado, Geral e harness reais, sem ferramentas
nem mudanças no escritório salvo. Grava `artifacts/relacoes-validacao.json`. A comparação de quatro falas evidencia
diferença de postura nesses cenários, sem garantir consistência em conversas longas.
