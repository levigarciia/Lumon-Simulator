**Escritórios e persistência**

As configurações permitem criar e abrir escritórios independentes. Cada novo escritório começa vazio, com
600 moedas. A troca encerra as sessões atuais e confirma a gravação antes de abrir o destino. Uma falha mantém
o escritório anterior utilizável. Recomeçar apaga somente o progresso do escritório ativo.

Todas as mensagens e decisões da interface pertencem à Diretoria. Não há nome pessoal nem forma de tratamento.
Os registros antigos recebem autoria institucional sem mudar IDs, fontes ou audiência. O conteúdo histórico das
falas é preservado; o prefixo sintético dos relatos privados é atualizado.

**Arquivos**

A raiz da pasta de dados contém `escritorios.json`, com versão, escritório ativo, nomes e datas de criação.
Cada partida fica em `escritorios/<id>/`. Seus arquivos de conversas dos provedores ficam em `geral/` nessa pasta.

O arquivo `estado.json` é um manifesto pequeno com a data da gravação e o hash de cada domínio. Os arquivos de dados
ficam em `dados/`, com o nome do domínio e o hash no nome do arquivo, formatados com indentação para leitura.

* `escritorio`: versão do estado, moedas e sala.
* `equipe`: funcionários e demissões com suas evidências históricas.
* `simulacao`: relógio, data civil, necessidades e ausências.
* `conversas`: chats individuais, Geral, threads, leituras e mensagens não lidas.
* `social`: acontecimentos, lembranças, relações, propostas, compromissos e pensamentos.
* `trabalho`: projetos históricos, execuções, arquivos de refinamento e cota diária.

A gravação reutiliza domínios iguais. Somente depois de concluir os arquivos novos substitui o manifesto por
renomeação no mesmo volume. Assim uma revisão não mistura equipe antiga com conversas novas. A captura do estado
ocorre ao agendar a gravação, sem referências mutáveis durante a escrita. Falhas deixam os dados pendentes para
nova tentativa.

`estado.anterior.json` preserva o manifesto anterior. A limpeza mantém os arquivos das duas revisões e remove os
dados de revisões mais antigas. Não há retorno automático para a revisão anterior.

**Migração e diagnóstico**

Sem catálogo, o aplicativo importa o escritório anterior como Escritório principal e copia a pasta `geral`.
O `lumon.json` original permanece intacto. Depois da importação, as gravações usam somente a nova estrutura.
Se o catálogo já existe, o aplicativo nunca importa o legado outra vez por causa de uma falha no escritório ativo.

JSON inválido, domínio ausente, divergência de hash e campos incompatíveis impedem a abertura e informam o caminho.
Falhas de validação também apresentam o campo afetado. Os arquivos permanecem disponíveis para diagnóstico,
sem substituir silenciosamente uma partida por um escritório vazio.

Para investigar, comece pelo ID ativo em `escritorios.json`, leia seu `estado.json` e siga o hash até o domínio
indicado. Uma edição manual invalida a verificação de integridade. Preserve uma cópia antes de qualquer recuperação.
Os arquivos contêm falas e pensamentos privados, portanto não devem ser publicados integralmente em relatórios.

**Validação**

`tests/persistencia.test.ts` cobre importação, isolamento das revisões, repetição de falhas, integridade e captura
do estado. `tests/partidas.test.ts` cobre troca, reabertura, isolamento, falha de catálogo e concorrência.

`scripts/validar-escritorios.ts` usa Electron, preload e IPC reais com dados temporários. Verifica criação e abertura
pelas configurações, saldo isolado, preservação do legado e autoria da Diretoria. As capturas ficam em
`artifacts/escritorios-configuracoes.png` e `artifacts/escritorios-diretoria.png`; o relatório fica em
`artifacts/escritorios-validacao.json`. O harness é controlado, sem medir comportamento de modelos reais.
