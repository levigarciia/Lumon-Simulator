# Dinâmica social

O trabalho e a convivência compartilham acontecimentos reais. Cada funcionário recebe apenas os fatos públicos
e as mensagens que presenciou ou recebeu. A personalidade e as relações entram no contexto de trabalho e de
convivência. O modelo decide se cobra, contesta, conversa, apoia, perdoa ou guarda silêncio.

## Personalidade e relações

Cada funcionário recebe traços estáveis de orgulho, ambição, empatia, autoritarismo e tolerância, além de um
interesse principal. Eles são persistidos, inclusive para funcionários contratados antes desta atualização.
Os pontos são traduzidos em cinco faixas de intensidade por traço, com orientações de voz e decisão. Orgulho
muda a reação a críticas e autoria; ambição muda a iniciativa; empatia muda o cuidado com o interlocutor;
autoritarismo muda a preferência por ordens ou negociação; tolerância muda a paciência diante de erros.
O interesse principal indica o que recebe mais atenção, sem criar assuntos ou tarefas por conta própria.
As orientações entram nas instruções principais e são retomadas em cada turno, em todos os canais. Elas se
combinam: uma pessoa pode ser firme e empática, ou orgulhosa e pouco autoritária. Alterar os pontos invalida
a sessão anterior. Não há substituição das falas por textos prontos nem anúncio dos números pelo agente.
As relações têm confiança, afinidade, respeito e ressentimento. São direcionais e privadas: o que Pedro pensa
de Helena não define o que Helena pensa de Pedro.

Afinidade acima de 90 indica Romance. Ressentimento a partir de 90 indica Inimizade, com prioridade
sobre Romance quando ambos atingem o limite. O status deriva dos pontos atuais, aparece na ficha e entra
na postura privada de todos os canais, inclusive para relações já salvas. Não presume reciprocidade.
Romance orienta carinho, proximidade, encontros reservados e consideração nas decisões de apoio e defesa.
Inimizade orienta hostilidade, busca de aliados e proposta de demissão por conflito pessoal declarado.
Funcionários podem propor durante uma reação, respeitando as restrições do cargo. A decisão continua
exclusiva da Diretoria. Não há licença para inventar faltas, evidências ou apoiadores.

Na conversa salva de 17 de outubro de 2026, Cláudio elogiou Gwen por repetir que aguardariam o Work;
Gwen retribuiu usando o elogio como fonte. Menções convocaram novas respostas, paráfrases voltaram como
elogios e lembranças antigas mantiveram o tema presente. Reduzir o efeito numérico de elogios repetidos
não impedia novas publicações nem convocações.

O serviço recusa elogios cuja única base seja outro elogio, inclusive por uma cadeia de interpretações.
Também recusa reconhecimento longo quase idêntico do mesmo autor para o mesmo colega no mesmo dia.
Falas longas quase idênticas do mesmo autor são silenciadas até nova mensagem da Diretoria, preservando
perguntas e mudanças de números ou negação. As instruções reservam menções a pedidos de resposta,
reconhecimento a fatos novos e concretos e sugerem silêncio diante de mera concordância ou prontidão.
Lembranças continuam preservadas, mas só são recuperadas quando têm palavras em comum com o assunto atual,
mantendo a audiência original. As barreiras determinísticas não garantem eliminar toda paráfrase de um modelo.

Cobranças aumentam o estresse e podem gerar ressentimento conforme os traços do destinatário. Elogios, defesas
e desculpas podem melhorar a relação. O funcionário pode interpretar uma cobrança como justa e recuperar o
respeito ou discordar dela. Cada interpretação sobre uma pessoa e um acontecimento só pode ocorrer uma vez.
Uma fofoca pode mudar a opinião sobre a pessoa citada, mas continua sendo um relato atribuído a quem o contou.

## Espaço e informação

* Público: qualquer funcionário pode conhecer, inclusive depois de entrar na equipe.
* Local: autor e colegas a até três células no momento da fala. A audiência não muda depois.
* Reservado: autor e destinatário próximo. Não há escuta incidental.
* Interpretação privada: somente o autor. O jogador acompanha todos os registros pela interface.

`conversar_reservado` escolhe dois lugares vizinhos num canto livre, fora dos assentos e pontos de uso. Os dois
caminham e a fala só é entregue quando ambos chegarem. Não há limite de trocas; o jogador encerra pelo Chat. Cada fala renova 60 segundos de permanência. Respostas em
andamento ou na fila mantêm o encontro. Depois de ficar inativo, os dois voltam às mesas. Trabalho, interrupção,
demissão ou fechamento cancelam o encontro inteiro. Funcionários numa tarefa real do Work não podem sair.
O chat individual permite iniciar encontros durante seu turno. Não há teletransporte.

O Chat reúne as falas públicas e reservadas, com filtro por diálogo e indicação dos participantes. Somente os
envolvidos recebem o conteúdo privado no contexto. A resposta normal de um turno reservado é enviada ao
parceiro e nunca publicada automaticamente no Geral. Trocar entre o Geral e um diálogo reservado recria a
sessão. As instruções da conversa reservada não mencionam a observação do jogador.
Limpar o Chat apaga as falas sociais e cancela encontros, sessões e notificações pendentes. Relações, propostas
e suas cópias de evidências são preservadas. Não existe a aba Escritório nem um histórico paralelo de falas.

O histórico recente tem até 800 acontecimentos, preservando também fontes de propostas pendentes.
Episódios relevantes continuam nas lembranças privadas com a audiência original; limpar o painel não os apaga. Propostas
guardam cópias das suas evidências e demissões guardam as evidências citadas no próprio histórico.
As leituras de trabalho, chat e convivência são independentes e confirmadas após o turno bem sucedido. Consultas pelo MCP não consomem novidades.
O Geral guarda também o ID da última mensagem lida por funcionário, separado da sessão. Interromper uma
conversa para trabalhar não transforma mensagens antigas em novas. Na retomada, o histórico recebe uma
identificação própria e o turno informa o motivo atual da reação, com data e fonte quando disponível.
A forma de tratamento é persistida nas preferências. Termos internos como jogador não são nomes pessoais
nem evidência de falta de respeito. Traços de personalidade incluem orientações de comportamento, sem
obrigar conflitos, elogios ou concordância com acusações.

## Ferramentas

* `ver_escritorio`: necessidades, equipe, posições, trabalho recente, relações próprias e acontecimentos conhecidos.
* `consultar_acontecimento`: recupera um registro conhecido pelo ID, sem liberar suas fontes reservadas.
* `interagir_socialmente`: cobra, contesta, elogia, pede desculpas, defende ou fofoca, com fontes e audiência.
* `conversar_reservado`: organiza o encontro dos dois e entrega a fala após a chegada. `sobre` identifica outra pessoa.
* `reagir_ao_acontecimento`: registra uma interpretação privada sobre o autor ou outro envolvido identificado.
* `revisar_trabalho`: disponível no trabalho, lê tarefa, resultado e ferramentas registradas do Work.
* `registrar_validacao`: disponível no próprio trabalho ativo, registra critérios e evidências sem aprovar entregas.
* `pedir_refazer`: o líder ativo devolve uma entrega do mesmo projeto e thread e aguarda a correção real.
* `propor_mudanca`: apresenta demissão, troca de liderança ou transferência, com evidências conhecidas.
* `apoiar_proposta`: exige uma mensagem recebida que contenha o ID da proposta. Não inventa apoiadores.

Todas as ferramentas de interação social estão disponíveis no Chat do Geral, tanto no Codex quanto no Claude.
Uma repreensão usa `interagir_socialmente` com `acao: cobrar`, o ID do destinatário em `funcionario` e IDs de
acontecimentos conhecidos em `fontes`. `ver_escritorio` permite consultar esses IDs. Com `alcance: publico`,
a ação chega a toda a equipe e registra efeitos nas relações, mesmo sem proximidade física.
`falar_no_geral` comunica uma fala comum; afirmar por essa ferramenta que repreendeu alguém não registra cobrança.
Se as ferramentas estiverem ocultas, o agente deve localizar o catálogo do servidor `lumon` completo.

## Consequências políticas

As propostas começam visíveis somente ao autor e ao jogador. O autor pode compartilhar o ID em uma conversa
e buscar apoio. Apoiar comunica a decisão ao proponente e ao jogador. Evidência citada pode ser uma opinião
ou uma fofoca; não representa confirmação automática das alegações.

O jogador aprova ou recusa na ficha de quem apresentou a proposta. Aprovação exige confirmação na interface:

* Demissão: encerra sessões, revoga o acesso MCP, interrompe pedidos liderados e preserva autor e evidências.
* Troca de liderança: exige envolvidos disponíveis e troca o cargo do líder com o candidato indicado.
* Transferência: bloqueia novas delegações daquele líder para quem solicitou o afastamento.

Transferência não cria outro departamento nem escolhe um substituto automaticamente. A equipe pode precisar
de outro líder. A decisão é pública depois de executada; conversas e interpretações anteriores continuam restritas.

## Execução e limites

Sem tarefa ativa, pausas são livres, e dispensam aviso ou autorização.
Estar sentado à mesa não comprova trabalho. Antes de alegar abandono ou prejuízo, os agentes devem consultar
o Work e verificar impacto real em tarefa ativa. Pausa sem trabalho e falta de aviso não são infrações.
Líderes devem rever cobranças indevidas; contestar esse tipo de cobrança não justifica punição.
Essa orientação vale no Geral, nas conversas reservadas, no chat individual e no Work.

Acontecimentos relevantes enfileiram reações. Elas aguardam o fim de tarefas e pausas, respeitam o limite de
seis falas seguidas iniciadas por agentes, reiniciado por mensagem do jogador ou conversa livre e não interrompem um trabalho ativo. A opção Conversa livre
continua controlando as rodadas espontâneas do Geral; reações a acontecimentos são enfileiradas separadamente.
Cada funcionário pode executar até oito ações sociais por minuto real. A fila agrupa notificações repetidas. O modo sem limite remove apenas o teto de falas.
Pensamentos privados não são enviados aos colegas nem aparecem em balões.

O sistema permite conflitos e reconciliações. Não força todo erro a virar uma conspiração. A escolha de aliados,
a forma de cobrar e a intensidade dos conflitos dependem do modelo e dos acontecimentos que ele recebeu.

## Validação

`tests/social.test.ts` cobre percepção, privacidade, proveniência de fofoca, relações, migração, limite de ações,
reações durante trabalho, apoio real, transferência, demissão, troca de cargos, movimento e correção do Work.

`scripts/validar-social.ts` executa o Electron em uma pasta temporária, com harness controlado e IPC real.
Ele confirma a atividade, ficha, encontro, conversa reservada, apoio, confirmação da decisão e persistência,
além de salvar capturas em `artifacts`. Não valida a tendência espontânea dos modelos a criar conflitos.
`scripts/validar-entregas.ts` verifica preferências, pendência visual, correção, aprovação e recompensa pelo
IPC real em uma pasta temporária. Também usa harness controlado, sem medir a qualidade de um modelo real.

```powershell
bun run build
bun x esbuild scripts/validar-social.ts --bundle --platform=node --format=cjs --external:electron --outfile=artifacts/validar-social.cjs
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\electron\dist\electron.exe artifacts/validar-social.cjs
```
