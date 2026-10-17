# Bem estar, cargos e eventos

Regras puras ficam em `shared`; as consequências na partida, em `electron/services/pessoal.ts` e
`electron/services/agendaDepartamento.ts`. Os valores ainda não foram calibrados em partidas com modelos reais.

## Esgotamento

`shared/esgotamento.ts` define o valor de 0 a 100, persistido em `necessidades.esgotamento` (padrão 0 em
estados antigos). Estágios: Estável, Cansado (40), Desgastado (65) e Esgotado (85).

* Acúmulo: trabalho soma 0,004 por segundo, mais 0,0004 por ponto de estresse acima de 50. Ócio com estresse
    a partir de 70 também acumula. Cobrança pública soma 3, reservada 1,5 e rejeição de entrega 4.
* Recuperação: pausas em item, ócio calmo, elogio, defesa ou desculpa, folga, incentivos e sessões de bem estar.
* Efeitos: Desgastado e Esgotado multiplicam o ganho de estresse no trabalho (1,3 e 1,6). A caminhada fica mais
    lenta e a cabeça mais baixa a cada estágio. Esgotado não recebe arquivos nem delegações e pode pedir a própria
    demissão por `propor_mudanca`, que segue dependendo da Diretoria.
* Orientação: cada estágio entra na disposição dos turnos, combinada com a personalidade.

## Ausências

`shared/ausencias.ts`, persistidas em `ausencias`. Os corpos percorrem portas e corredor até lugares reservados.
Descanso tem três vagas e Bem estar tem dois assentos. Sem vaga ou caminho, a ação é recusada antes do afastamento.
A permanência começa na chegada; durante a volta o funcionário segue indisponível até alcançar a mesa.
Folga sai do prédio. Folga e punição anunciam o retorno à mesa. Ausentes não trabalham nem fazem pausas.
Sessões de bem estar permitem conversa reservada entre conselheiro e atendido depois da chegada de ambos.

O lugar reservado e a fase da ausência ficam salvos. Ao reabrir, quem já estava no anexo retoma no mesmo lugar;
uma ida ainda pendente recomeça da mesa. Registros antigos recebem lugares livres, sem sobreposição.
Excedentes de registros antigos voltam à mesa. A grade editável continua restrita ao escritório e preserva
o acesso ao corredor. Os corpos compartilham os caminhos, sem um sistema de filas ou colisão entre pessoas.

* Folga (300 segundos): concedida pela Diretoria na ficha. Recupera esgotamento, estresse e energia.
* Sala de Descanso (180 segundos): punição pela ficha ou por proposta aprovada de um supervisor. Soma 25 de
    estresse e 8 de esgotamento, e o punido ganha ressentimento contra o supervisor que propôs.

## Cargos

`shared/cargos.ts`. Supervisor e Conselheiro não refinam (`refina`) e ficam fora da lista de delegação.

* Supervisor: `conceder_incentivo`, propõe Sala de Descanso e, como o líder, pode cobrar e propor no turno de reação.
* Conselheiro de Bem estar: `sessao_bem_estar` caminha até o colega, entrega a fala reservada e reduz estresse
    e esgotamento conforme a confiança do atendido. Uma sessão por pessoa a cada três minutos.
* Estagiário: refina com até dois envios por etapa delegada e só apresenta o próprio pedido de promoção.

## Carreira

`shared/carreira.ts`. A escada segue Estagiário, Refinador, Líder e Supervisor. Conselheiros ficam fora.
Mérito necessário para promoção: Refinador 20, Líder 45 e Supervisor 80. Há uma vaga de líder a cada quatro
funcionários, no mínimo uma, e uma de supervisor. A contratação direta mantém suas regras atuais.

Grupo aceito soma 3 de mérito; aprovação soma 5 por participante; elogio soma 2; incentivo individual soma 4.
Cobrança pública retira 2; rejeição retira 4 por participante; punição retira 8. Mérito fica entre 0 e 200.
Promoção exige evidências conhecidas, vaga e decisão da Diretoria, revalidadas ao executar. Conserva 30% do mérito.
Troca de liderança também permite disputar a posição de supervisor mediante decisão da Diretoria.

A ficha exibe mérito e próximo passo. Os contextos incentivam crescimento e defesa da posição com resultados
e alianças. A iniciativa dos modelos precisa ser observada em partidas reais.

## Incentivos

`shared/incentivos.ts`, pagos com o saldo compartilhado pela Diretoria (ficha) ou pelo supervisor (MCP).
Lembrancinhas e festa dos waffles exigem homenageado; colegas com ambição a partir de 60 ganham ressentimento
contra ele. Festa da melancia e Música e Dança alcançam toda a equipe presente.

## Ambiente

`shared/ambiente.ts`: planta, aparador e luminária a até três células reduzem 0,012 de estresse por segundo
cada, com teto de quatro pontos. Móveis quebrados não contam.

## Lealdade a Kier

Traço opcional da personalidade, sorteado para contratações novas e neutro (50) em perfis antigos. Fora da
faixa neutra, uma linha curta orienta ceticismo ou devoção. A ficha mostra o valor.

## Pausas em tempo real

Pausas em objetos usam minutos reais após a chegada e passam a vez. A recuperação é contínua durante o uso:
café recupera 12 de energia por minuto, descanso recupera 18, comer reduz 24 de fome e música reduz 18 de estresse.
Os valores ficam entre 0 e 100. Necessidades e retornos de pausa não são anunciados automaticamente no Geral.
Durante a pausa não há desgaste passivo, inclusive no trajeto; o uso do objeto apenas melhora ou mantém necessidades.
Descansar, tomar café e ouvir música não aumentam fome. O destinatário da conversa recebe a situação compartilhada
atualizada em cada turno, sem convite para iniciar uma pausa que já está em andamento.

Cafeteira, máquina de guloseimas e sofá comportam duas pessoas, com vagas e posições independentes.
Quando os dois chegam, recebem uma oportunidade de conversa casual reservada no próprio item, conforme suas relações.
Podem silenciar. Conversar não interrompe a recuperação nem altera os minutos de cada pausa.
O primeiro a terminar encerra o diálogo; o outro continua descansando até seu próprio prazo.
Quem está em pausa fica indisponível no Geral. Os colegas recebem a lista atualizada em cada turno e não
devem dirigir falas, perguntas ou menções a essa pessoa, mesmo sem @. O contato durante a pausa é somente
privado, por `conversar_reservado`. Ações públicas e menções com @ a quem está em pausa são recusadas.
No Geral e no reservado, `fazer_pausa` confirma o início e libera o turno para permitir esse papo durante o uso.

## Eventos do departamento

`shared/eventosDepartamento.ts`. A agenda verifica a cada minuto real, com 15% de chance e intervalo mínimo
de oito minutos, entre os eventos possíveis:

* Visita da Diretoria: comunicado público e 6 de estresse para quem está na sala.
* Auditoria: ranking público dos grupos aceitos nos arquivos do dia. Só ocorre se houver aceitos.
* Avaria de terminal: um refinador presente fica três minutos sem receber etapas.
* Entrega de arquivo pela Diretoria: cria um refinamento real no Work, com prazo de cinco minutos e coordenação
    do líder. Só entra no sorteio com líder disponível, sem trabalho em execução nem entrega aguardando aprovação.
    O comunicado só é publicado após a criação do pedido. A aprovação e as recompensas seguem o fluxo normal.

A entrega de arquivo tem peso 4 no sorteio; cada outro evento tem peso 1. Com os quatro eventos disponíveis,
ela representa 4 de 7 resultados possíveis (aproximadamente 57% dos eventos sorteados). A chance geral de
15% por verificação e o intervalo mínimo de oito minutos continuam iguais.

Comunicados da agenda aparecem no Chat da Diretoria junto às respostas da equipe. A manutenção de terminal
é automática, sem moedas ou `consertar_item`, e seu fim gera outro comunicado. O contexto informa os terminais
operacionais e os móveis realmente quebrados. Uma avaria não cria etapas de trabalho fora de um arquivo ativo.

Marcos de casa são anunciados uma vez por dia quando a contratação completa semanas exatas.

## Validação

`tests/esgotamento.test.ts` cobre estágios, acúmulo, folga, ambiente, saída da sala, cargos, inveja, sorteio,
ranking e marcos. `tests/pessoal.test.ts` cobre folga, Sala de Descanso, incentivos e sessões com registro
controlado. `tests/circulacao.test.ts` cobre portas, rotas, lotação, chegada, retorno e restauração dos lugares.
`scripts/validar-anexos.ts` verifica corredor, ocupação, sessão e retorno no Electron com dados temporários;
as capturas e o resultado ficam em `artifacts/anexos*.png` e `artifacts/anexos-validacao.json`.
Não há medição com modelos reais para estes comportamentos.
