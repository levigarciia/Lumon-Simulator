**Transição dos agentes para personagens**

Implementação de 17 de outubro de 2026. O diagnóstico original está em `ANALISE_AGENTES.md`.

**Domínio atual**

Os cargos ativos são Líder e Refinador. Cargos antigos continuam legíveis nos registros históricos.
Carregar ou editar a equipe converte funções antigas para Refinador e desliga a autonomia técnica.
Todos os canais usam as instruções da função atual. A contratação não oferece permissões de computador.

As sessões são de personagem, inclusive no Work. Claude recebe instruções próprias e nenhuma ferramenta interna.
Codex recebe sandbox de leitura, shell e integrações externas desativados; pedidos externos de aprovação são negados.
O motor local só anuncia ferramentas MCP da partida. Projetos e pedidos livres são recusados no serviço e no IPC.
O histórico antigo continua consultável; os testes de contratos antigos usam diretamente o núcleo de compatibilidade.

O servidor MCP valida a origem e o estado atual ao receber uma chamada. Um token de trabalho sem refinamento ativo
não autoriza ações. O estado terminal da etapa e a publicação são metadados estruturados, independentes da mensagem
legível. As restrições de inferência do motor local complementam as regras comuns do serviço.

**Trabalho e tempo**

O líder disponível com menos pedidos anteriores recebe o próximo arquivo. A lista de colegas prioriza menor carga
no pedido, bem estar e confiança. O líder escolhe a distribuição, mas não pode concentrar etapas num colega quando
existe uma alternativa disponível com duas etapas a menos. Transferências continuam sendo respeitadas.

Os seis grupos podem aparecer em qualquer linha. Cada envio exige exatamente três células diferentes do grupo.
Os resultados e o gabarito continuam separados. Um delegado tem até quatro envios ou um grupo aceito por etapa.

Correções mantêm a identidade do arquivo e registram uma rodada com motivo, horário e prazo próprios.
O prazo novo repete a duração escolhida inicialmente. Arquivos antigos sem duração registrada usam cinco minutos.
Um líder precisa estar disponível antes de preparar a rodada. Recompensa e cota continuam únicas por arquivo.

A data, a virada das necessidades e a cota usam o dia civil local. O relógio ativo dos corpos continua separado:
o movimento avança com os passos da simulação. As pausas usam minutos reais de uso, contados após chegar ao objeto,
e recuperam necessidades gradualmente até o prazo civil, inclusive ao retomar após suspensão. O percurso não recupera.
O funcionário fica indisponível durante a pausa e passa a vez, sem anúncio automático de retorno.
Os prazos de refinamento também usam tempo civil. O antigo ciclo de nove minutos não restaura energia nem apaga falhas.

Falhas de inferência, transporte, ferramentas e permissões não alteram necessidades ou reputação.
Uma rejeição real da Diretoria continua produzindo seu efeito emocional e profissional uma única vez.
Falhas técnicas não geram acontecimentos sociais de incompetência. Sucesso de um chat não concede alívio artificial.

**Memória e intenções**

Montar o contexto prepara uma leitura; o fim bem sucedido do turno confirma seu marcador.
Trabalho, chat individual e Geral usam marcadores separados. Consultar não consome novidades.

Episódios relevantes são preservados fora dos 800 acontecimentos recentes. Seus registros mantêm autoria,
fontes e audiência. A seleção de lembranças considera envolvidos, importância e palavras do assunto atual.
Resultados antigos de trabalho não são reapresentados como novidade do Geral.
Limpar um painel remove a apresentação recente, mas preserva episódios que explicam relações e propostas.
Limpar o Geral arquiva também comunicados encerrados e propostas, sem cancelar decisões pendentes na ficha.
Avisos de manutenção de terminal e de arquivos em trabalho continuam visíveis enquanto estiverem ativos.
O arquivo social preserva autoria e audiência, inclusive na poda dos acontecimentos recentes.
`consultar` pesquisa acontecimentos, demissões, memórias e pensamentos privados do próprio autor.
Oferece filtros por pessoa, assunto, tipo e período, com páginas de cinco resumos por padrão.
Detalhes completos exigem consulta de um registro por vez. A pesquisa não consome novidades nem encerra a vez.
Os pensamentos anteriores ficam salvos quando o autor registra um novo, sem entrar nos contextos dos colegas.
O contexto apresenta até seis novidades por lote, com prévias de até 240 caracteres e fontes consultáveis.
Só confirma a leitura do lote apresentado. Essa consulta não transforma registros antigos em pedidos atuais.
`reagir_ao_acontecimento` aceita nome completo ou ID da pessoa. Sem fonte explícita, usa o acontecimento
conhecido mais recente envolvendo ela e informa a fonte escolhida. Nomes duplicados exigem ID.
O painel Histórico reúne equipe, trabalho, convivência, escritório, comunicados, pensamentos e conversas.
A Diretoria pode excluir registros e suas cópias de consulta. A exclusão remove também as revisões anteriores
da persistência, sem recalcular efeitos que já ocorreram na partida. Conversas ficam separadas das demissões.
Interpretações e ações sobre a mesma fonte não reaplicam efeitos depois da poda ou reabertura.
Interações equivalentes sobre fontes diferentes têm efeito menor quando repetidas no mesmo dia.

`planejar_acao` mantém até três compromissos privados por funcionário, ligados a uma fonte conhecida e a um colega.
Os objetivos iniciais são conversar, reconciliar, defender e elogiar. Uma intenção só se cumpre quando a ação
correspondente é registrada com aquele destinatário. Pensar ou dizer que pretende agir não a conclui.
`cancelar_intencao` exige autoria e motivo. A saída de um envolvido cancela o compromisso.
Os avisos periódicos oferecem oportunidades de retomada no ócio, no máximo uma a cada dois minutos por funcionário,
respeitando a fila social e seus limites. A ficha mostra compromissos pendentes, cumpridos e cancelados.

Personalidade continua modificando tom e escolhas. Discordância legítima não passa a ser infração por autoritarismo.
Cumprimentos simples com menção não abrem um turno artificial de ação. O chat individual responde num único turno,
podendo executar ferramentas quando necessário. Menções com pedidos concretos continuam tendo reação e resposta.

**Apresentação e desempenho**

A sala identifica coordenação de um delegado, refinamento, correção, pausa e espera pela Diretoria.
A identidade e o cargo histórico de funcionários demitidos continuam disponíveis.
A cena e a contratação são carregadas por importação dinâmica. A persistência mede tamanho e duração das gravações.
O motor mede inferências, espera, processamento e cargas de modelos, sem expor dados de contexto aos colegas.

**Validação e limites**

Execute `bun run verificar`, `bun test` e `bun run build`.
`tests/transicaoSimulador.test.ts` cobre migração, bloqueio externo, catálogo dos provedores, correção vencida,
calendário civil, geração variada, leitura confirmada, memória privada, compromissos e estados da sala.
Os cenários Electron de refinamento e convivência usam estado temporário, IPC real e harness controlado.
Eles não medem a consistência de modelos reais em partidas prolongadas.

Verificação desta entrega: TypeScript aprovado, 198 testes aprovados e build concluído.
Os cenários Electron de refinamento e convivência passaram; a ficha de compromissos foi inspecionada renderizada.
O bundle principal passou de aproximadamente 1,81 MB para 1,55 MB antes de compressão. O aviso de chunk grande
permanece. Tempo de abertura e fluidez em partidas extensas ainda exigem medição; não foram inferidos pelo tamanho.

Burnout, novos departamentos e novas atividades coletivas continuam evoluções de produto, sem implementação
nesta transição. A pesquisa original propôs essas expansões para depois da estabilização dos contratos.
