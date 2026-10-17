# Modelos locais

Escolha um modelo no grupo Local ao contratar ou editar um funcionário. O primeiro envio baixa o GGUF,
confere tamanho e SHA 256, instala o motor oficial e carrega o modelo. Os próximos envios reutilizam a carga.
O Qwen3.5 9B está disponível na edição Q4_K_M, com aproximadamente 5,3 GB de download.

A Lumon usa llama.cpp em Windows x64. Nas Radeon RX 6000 e RX 7000, prioriza ROCm e a GPU dedicada.
Se ROCm não conseguir iniciar, tenta Vulkan. Nas demais GPUs reconhecidas, usa Vulkan; sem GPU, usa CPU.
A barra inferior mostra download, verificação, carregamento e backend ativo.
O pacote Radeon b10327 é usado em ROCm por reconhecer a RX 7700 XT na validação real. A distribuição ROCm 10.0
b11521 não enumerou dispositivos neste computador. Os pacotes de CPU e Vulkan usam b11521.

Os arquivos ficam em `%APPDATA%\Lumon\modelos` e `%APPDATA%\Lumon\runtime`.
O servidor usa porta aleatória em loopback e uma chave criada a cada carga. Fechar a Lumon encerra o processo.
O contexto é automático, como no motor da Selene. A carga inicial não fixa `-c`: o runtime escolhe a janela
do modelo e ajusta camadas e memória com `--fit on`. O aplicativo consulta `/props` e usa o contexto realmente
carregado, sem impor um teto de 16384 tokens. Se a alocação falhar por memória, reduz a tentativa progressivamente.
O pedido atual determina um mínimo de espaço para instruções, ferramentas e resposta. Se a carga já aberta
for menor, o motor recarrega com uma janela suficiente antes de inferir, ajustando as camadas à memória.
Uma falha de memória não autoriza diminuir esse mínimo nem cortar o pedido. Outros erros não provocam
tentativas de redução. Cancelamento e fechamento encerram a preparação em andamento.
Não é necessário instalar compiladores, iniciar um servidor manualmente ou configurar Ollama.

Cada funcionário tem seu histórico, mas a GPU mantém apenas um modelo carregado. Inferências entram em uma fila
cancelável. Ferramentas, aprovações, pausas e delegações liberam a fila enquanto aguardam, permitindo que o colega
execute seu turno. Trocar de modelo descarrega os pesos anteriores.

Antes de cada inferência, o histórico é compactado automaticamente ao atingir 85% do orçamento de entrada.
O orçamento considera a janela realmente carregada, as ferramentas e uma reserva proporcional para a resposta.
O próprio modelo resume o histórico em blocos, sem raciocínio nem ferramentas. Instruções, pedido atual e pares
recentes de chamadas e resultados são preservados. As mensagens originais continuam no histórico do aplicativo;
o resumo é usado na sessão e reconstruído quando necessário ao reabrir a conversa.
Falhas e cancelamentos restauram o contexto anterior ao turno. Antes de compactar, o harness solicita a expansão
necessária ao pedido atual. Se a máquina não comportar essa janela, o motor informa a limitação de memória.
Se a geração atingir o limite de saída, há uma nova tentativa automática sem raciocínio e com
todo o espaço restante. Chamadas de ferramentas cortadas não são executadas.

No Geral, uma fala publicada por `falar_no_geral` encerra o turno do motor local. O canal também recusa uma
segunda publicação no mesmo turno, antes de gravar mensagens ou disparar menções e acontecimentos sociais.
Uma pausa real permite uma nova fala após o retorno. A próxima mensagem recebida inicia outro turno normalmente.
Respostas em texto normal são publicadas automaticamente para toda a equipe ao terminar o turno, com menções
e percepção social. A ferramenta `falar_no_geral` é opcional, para falar antes de aguardar outra ferramenta.
Somente `atualizar_pensamento` salva impressões privadas na ficha, visíveis ao próprio agente e ao jogador.
Colegas não veem o pensamento nem recebem notificações. Tarefas concluídas e pensamentos antigos não são
injetados a cada turno do Geral; o histórico original continua salvo.
O cenário `bun scripts/validar-conversa-local.ts` verifica esse fluxo com Qwen3.5 4B e grava
`artifacts/conversa-local-validacao.json`, sem modificar o escritório salvo do usuário.

O modo de conversa recebe somente ferramentas MCP do escritório. O produto atual é um simulador:
o trabalho oferecido no Geral é o refinamento de Macrodados, sem pedidos livres para projetos externos.
As capacidades de arquivos e comandos abaixo pertencem à infraestrutura herdada do orquestrador e aos seus
cenários técnicos de validação; não definem o fluxo atual do jogador.

As sessões atuais usam o modo personagem em todos os canais. Arquivos e comandos não são anunciados.
Claude recebe sistema próprio e ferramentas internas vazias. Codex desativa shell e integrações externas.
O servidor MCP valida origem e estado da etapa independentemente do provedor.
Contratos antigos de arquivos permanecem apenas nos testes e na compatibilidade, sem acesso pelo produto atual.

Para preparar o motor antes do primeiro envio:

```powershell
bun scripts/instalar-modelos.ts
```

Para baixar um modelo antecipadamente:

```powershell
bun scripts/baixar-modelos.ts qwen3.5-9b-q4
```

Esses scripts usam os mesmos serviços do aplicativo. Revisões, tamanhos e hashes ficam em `shared/modelos.ts`.
O catálogo inclui Qwen3.5 2B, 4B e 9B, Qwen3 14B e Llama 3.2 1B e 3B.
Modelos antigos com IDs sem correspondência precisam ser selecionados novamente na edição do funcionário.

Os modelos Qwen3.5 usam o template oficial distribuído em `assets/templates/qwen35.jinja`, proveniente de
`Qwen/Qwen3.5-9B`, revisão `c202236235762e1c871ad0ccb60c8ee5ba337b9a`.
SHA 256: `a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715`.
O template é empacotado com a aplicação e sobrescreve o template incorporado no GGUF durante a carga.

Execute `bun run verificar`, `bun test` e `bun run build` para validar o código.
O cenário `bun scripts/validar-modelo-local.ts` usa Qwen3.5 9B e ROCm reais, verifica uma consulta MCP,
cancelamento, retomada e encerramento, e grava `artifacts/modelo-local-validacao.json`.
O cenário `scripts/validar-modelo-local-desktop.ts` usa Electron com estado temporário, IPC real,
contratação, leitura, aprovação e escrita no projeto de teste. Seus relatórios e capturas ficam em `artifacts`.
`scripts/validar-contexto-automatico.ts` reproduz o envio de `Oi` pelo IPC com personalidade e catálogo de
ferramentas completos. Usa Qwen3.5 9B real, estado isolado e salva a janela efetiva e a resposta em
`artifacts/contexto-automatico.json`, além de uma captura da conversa.

A validação local confirmou Qwen3.5 9B em ROCm na Radeon RX 7700 XT: consulta MCP, cancelamento, retomada,
contratação pelo IPC, leitura de arquivo, aprovação de escrita e conteúdo final salvo no projeto temporário.
