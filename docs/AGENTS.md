# Orientação para agentes

Consulte este documento antes de alterar o Lumon. Instruções do usuário têm prioridade.
`docs/ROADMAP.md` concentra produto, contratos atuais, pendências e validação. Atualize esse arquivo ao concluir
mudanças de comportamento ou planejamento. Não crie documentos paralelos para repetir o mesmo conteúdo.

## Implementação

* Use Bun, TypeScript estrito, nomes em português, quatro espaços e linhas com até 120 caracteres.
* Estilize a interface com Tailwind. Materiais da cena 3D são propriedades do Three.js.
* Preserve mudanças concorrentes. Não reinicie o aplicativo nem altere dados salvos do usuário sem necessidade
    autorizada pela tarefa. Validações devem usar estado temporário sempre que possível.
* Mantenha regras puras em `shared`, efeitos da partida em `electron/services` e apresentação em `src/components`.
    Valide entradas no IPC e permissões nos serviços, independentemente do provedor de IA.
* Sessões atuais recebem apenas ferramentas da partida. Preserve contratos externos antigos somente para
    compatibilidade. O objetivo do produto é o simulador descrito no roadmap.
* Regras fixas ficam nas instruções da sessão. O prompt do turno recebe dados variáveis e o pedido atual.
    Descreva ferramentas no catálogo MCP, evitando cópias divergentes nos prompts e provedores.
* Preserve autoria, audiência e ordem de texto e ferramentas. Não entregue pensamentos, diálogos ou fontes
    privadas a colegas sem acesso. Efeitos e resultados exigem ações reais, sem confiar em narração do modelo.
* Novas mecânicas precisam de escopo e critérios de aceite. Planejamento não equivale a funcionalidade pronta.
* Não use emojis nem traços como pontuação. Preserve a sintaxe técnica necessária.

## Validação

Mudanças de código exigem `bun run verificar`, `bun test` e `bun run build`.
Mudanças somente documentais exigem revisão de referências e `git diff --check`.
Use os cenários indicados no roadmap conforme a área alterada. Diferencie testes controlados, inspeção estática,
validação renderizada e observação de modelos reais. Não apresente resultados antigos como verificação atual.
