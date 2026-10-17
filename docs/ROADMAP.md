# Direção do Lumon

## Produto

O Lumon é um simulador do ambiente da Lumon inspirado em Severance. O jogador administra o departamento,
acompanha funcionários de IA e observa como trabalho, personalidade, hierarquia e convivência mudam a partida.
Macrodados é a atividade atual de trabalho. As decisões e suas consequências devem ser compreensíveis
na sala, nas relações e no histórico.

O projeto começou como um orquestrador para trabalhos reais em repositórios externos. Essa direção foi
substituída pelo simulador. A infraestrutura herdada serve à execução dos personagens e à compatibilidade
dos registros; expandir uma ferramenta geral de programação não é o objetivo atual.

## Princípios

* Consequências partem de acontecimentos da partida e das decisões de seus participantes.
* Personalidade e conhecimento individual orientam as reações. Conversas privadas mantêm sua audiência.
* O processo principal controla a simulação. A cena representa seu estado e permite entender o que aconteceu.
* Resultados mecânicos têm regras verificáveis. Os modelos decidem suas falas e ações disponíveis.
* Conflitos, alianças e reconciliações podem surgir sem obrigar todo acontecimento a produzir drama.
* Funcionalidades planejadas são identificadas como pendentes. Testes controlados não comprovam
    comportamento consistente dos modelos em partidas reais.

## Implementado

### Escritório e funcionários

Sala 3D isométrica com móveis, posicionamento, rotas, contratação, edição e demissão com histórico.
O processo principal mantém corpos, necessidades e pausas. A interface interpola os movimentos.
Energia, fome, estresse e humor entram no contexto dos funcionários. Pausas podem ser iniciadas por ferramenta
por decisão dos funcionários, respeitando trabalho ativo, disponibilidade dos itens e encontros.

### Continuidade dos personagens

Funções ativas de Líder e Refinador, sessões sem capacidades externas e bloqueio de pedidos livres.
Leitura social confirmada após conclusão, episódios privados preservados e até três compromissos por funcionário.
Compromissos retomam no ócio, são cumpridos somente por ação real e aparecem na ficha.
Falhas técnicas não geram punições ficcionais. Necessidades e cota compartilham a virada civil do dia.
Correções possuem rodada e prazo próprios. A sala distingue coordenação, correção e espera pela Diretoria.

### Trabalho de Macrodados

O jogador escolhe a duração do refinamento. Um líder disponível recebe o trabalho e pode delegar etapas.
O Terminal acompanha a grade e os envios sem expor o gabarito. O Histórico mantém as avaliações.
O Geral não oferece seleção de projetos externos, pastas, threads ou pedidos livres no Work.

A aprovação manual concede oito moedas por grupo aceito e doze extras por arquivo completo, até 60 por arquivo.
A cota diária compartilhada é de 18 grupos aprovados. Sua conclusão gera um comunicado da Diretoria e
30 moedas extras uma única vez por dia. Delegações, correções e reabertura não duplicam os créditos.
Rejeição e pedido de correção têm efeitos distintos e preservam o vínculo com a entrega.

### Convivência e hierarquia

Geral, chat individual, conversas reservadas com caminhada, pensamentos privados, personalidades e relações
direcionais. Cobranças, elogios, contestações, fofocas, defesas e desculpas registram fontes e audiência.
Os funcionários podem interpretar acontecimentos e propor demissão, troca de liderança ou transferência.
Essas propostas dependem da decisão do jogador. Transferência bloqueia delegações do líder indicado;
não cria outro departamento. Demissão encerra o funcionário e preserva autoria e evidências.

### Economia e manutenção

Moedas compartilhadas permitem comprar móveis e pagar reparos. Móveis de pausa sofrem desgaste por uso
concluído e podem quebrar. A quebra bloqueia novas pausas naquele item; o conserto restaura seu uso e registra
a iniciativa. Quebras acionam a equipe sem revelar o último usuário, com interpretação livre sobre culpa.
Limpar o Geral remove os registros de manutenção. Reiniciar a partida preserva modelos instalados
e arquivos externos. Detalhes em `MANUTENCAO.md`.

### Bem estar, cargos e eventos

Detalhes em `BEM_ESTAR.md`. Esgotamento acumulado com quatro estágios visíveis na ficha e na sala, folga e
Sala de Descanso fora da sala, decoração que alivia o estresse, cargos de Supervisor, Conselheiro de Bem estar
e Estagiário, incentivos pagos, lealdade a Kier e eventos sorteados (visita, auditoria, avaria e marco de casa).

### Anexos e carreira

Sala de Descanso e Sala de Bem estar possuem portas abertas e um corredor conectado ao escritório.
O processo principal controla o trajeto completo, reserva lugares distintos e mantém os funcionários
indisponíveis até voltarem às mesas. A permanência começa ao chegar, e a sessão espera ambos os participantes.
Lotação e caminho bloqueado recusam a ação. Folga continua acontecendo fora do prédio.

A carreira segue Estagiário, Refinador, Líder e Supervisor. O Conselheiro permanece fora dessa escada.
Grupos aceitos, aprovações e reconhecimento alteram o mérito salvo. Promoções exigem mérito, vaga,
evidências conhecidas e aprovação da Diretoria. A ficha mostra mérito e próximo passo. Os contextos
incentivam crescimento e defesa da posição com resultados e alianças, sem inventar falhas dos colegas.
Essa orientação não garante que os modelos tomem iniciativa em toda conversa.

## Evolução pendente

Os itens abaixo são possibilidades de evolução, sem ordem de entrega ou implementação autorizada.
Cada mudança precisa de escopo, regras de recuperação, representação visual e validação definidos antes do código.

* Encenação da hierarquia: delegações, cobranças e espera por revisão compreensíveis olhando a sala.
* Progressão do departamento: Ala da Perpetuidade, salas que destravam cargos e expansão da sala.
* Situações emergentes com mecânica própria: autoria contestada de grupos refinados e facções visíveis.
* Calibrar taxas de esgotamento, frequência de eventos e efeitos de incentivos em partidas com modelos reais.

As relações e propostas existentes são a base para avaliar novas consequências sociais. Sua intensidade e
consistência ainda precisam ser observadas em partidas com modelos reais. As sugestões não constituem
mecânicas prontas nem alteram automaticamente as regras atuais de trabalho ou convivência.

## Pendências técnicas

* Medir abertura e fluidez após a separação da cena e da contratação por importação dinâmica.
* Automatizar a validação de interface para compra, posicionamento e demissão.
* No Codex, retomar a thread após interrupção em vez de abrir uma conversa nova.
* Manter contratos antigos de projetos e histórico identificados como compatibilidade, sem reintroduzir
    trabalho externo no fluxo atual do simulador.

## Validação

Execute `bun run verificar`, `bun test` e `bun run build` nas mudanças de código.
Os cenários Electron usam dados temporários e harness controlado para validar regras e interface.
Os cenários com modelos reais complementam essa cobertura, sem garantir comportamento em toda partida.
Consulte `AGENTS.md`, `DINAMICA_SOCIAL.md`, `MODELOS.md` e `MANUTENCAO.md` para contratos e limites específicos.
