# Manutenção e reinício

Os móveis usados em pausas podem quebrar: cafeteira, máquina de guloseimas, sofá e vitrola.
Mesas e decoração não sofrem desgaste. Apenas pausas concluídas contam como uso; trajetos interrompidos não contam.

Os primeiros oito usos após compra ou conserto são protegidos. No nono uso, a chance é de 1%, aumentando um ponto
percentual por uso até 20%. O estado de desgaste, o último usuário e a quebra são salvos junto ao móvel.
Mover o móvel não reinicia seu desgaste.

A quebra impede novas pausas naquele móvel e aparece na sala com o custo do reparo. Um acontecimento público
aciona a equipe sem identificar o último usuário ou orientar a atribuição de culpa. Os funcionários podem
teorizar, acusar, defender ou cobrar conforme sua personalidade e relações, usando as ferramentas sociais.
Pausas em andamento no móvel são interrompidas imediatamente, incluindo os trajetos e o diálogo dos ocupantes.
A recuperação para e o motivo da interrupção informa que o móvel quebrou. O último usuário recebe, apenas
no próprio contexto privado, a suspeita de que seu uso causou a quebra e decide se revela sua participação.
Os demais funcionários não recebem essa suspeita. Ela não confirma culpa nem atribui responsabilidade aos
outros ocupantes. O contexto privado continua disponível enquanto o móvel permanece quebrado.
Limpar o Chat do Geral remove os acontecimentos de quebra e conserto e suas notificações pendentes,
preservando o desgaste e a condição atual dos móveis.

A ferramenta `consertar_item` permite que um funcionário pague o reparo com as moedas compartilhadas do escritório.
O custo é 25% do preço de compra, arredondado para cima, com mínimo de cinco moedas. Sem saldo, o móvel continua
quebrado. Um conserto bem sucedido restaura o uso imediatamente, zera o desgaste e registra a iniciativa no Geral.
Chamadas repetidas não descontam moedas novamente.
O conserto aceita o ID ou o nome completo do móvel quando esse nome identifica um único item na sala.
Nomes são comparados sem distinguir acentos, maiúsculas ou espaços repetidos. Havendo móveis com o mesmo nome,
a ferramenta exige um dos IDs disponíveis. O conserto é imediato, sem caminhada nem pausa prévia.
Os contextos do Geral e do chat individual incluem IDs, custos e saldo quando há consertos pendentes.
A consulta `ver_escritorio` também está disponível nos turnos de ação desses canais.

Em Configurações, Recomeçar do zero pede confirmação antes de apagar a partida. O reinício encerra os agentes,
restaura as 600 moedas iniciais e remove móveis, funcionários, cadastros de projetos, identidade, necessidades,
conversas, trabalhos, refinamentos e memória social. A interface também limpa suas preferências locais.
Arquivos dos projetos e modelos de IA instalados são preservados. Sessões antigas não podem gravar sobre a nova
partida. Se a gravação falhar, o aplicativo recupera a partida anterior e informa o erro.

Validação: `bun test tests/manutencao.test.ts tests/partida.test.ts`. A validação renderizada fica em
`scripts/validar-manutencao.ts`, com dados temporários, IPC e MCP reais e sem modelos reais.
Antes da execução no Electron, compile a interface com `bun x vite build --outDir artifacts/interface-manutencao`
e o script com esbuild, usando as mesmas opções dos demais scripts de validação visual.
