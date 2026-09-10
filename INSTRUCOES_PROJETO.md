# INSTRUÇÕES DO PROJETO — PROJETO 7 — HUB ACTION - CRM WHATSAPP

Este arquivo existe para retomar o projeto em qualquer sessão futura do Claude Code, sem repetir o briefing.

## Regras de economia (sempre válidas)

- Trabalhar em etapas pequenas, apenas conforme o comando enviado pelo usuário.
- Não implementar etapas futuras antecipadamente.
- Não dar explicações longas nem repetir o briefing.
- Ler somente os arquivos necessários para a tarefa atual.
- Preferir alteração localizada a reescrever arquivos inteiros.
- Aproveitar o código existente.
- Evitar novas dependências sem necessidade real.
- Executar verificações proporcionais ao risco (não rodar suíte completa para mudança trivial).
- Ao final de cada etapa, informar brevemente: o que mudou, como testar, pendências.
- Manter [PROGRESSO.md](PROGRESSO.md) atualizado com decisões, etapa concluída e próxima tarefa.
- Manter este arquivo atualizado se as regras mudarem.
- Se houver dificuldade técnica, explicar o problema objetivamente antes de propor mudança grande.
- Nunca afirmar que é possível trocar sozinho o modelo do Claude. Se uma tarefa exigir modelo mais avançado, indicar o motivo específico e deixar a troca a cargo do usuário.

## Restrições de custo

- Primeira versão roda 100% local: sem hospedagem, sem cartão de crédito, sem API de IA, sem serviço pago.
- Modo de demonstração simula mensagens/pedidos de atendente sem conectar WhatsApp real — sempre identificar como dados de teste.
- Não é necessário disponibilidade externa nem funcionamento com o computador desligado.
- Não escolher hospedagem agora. Na etapa de publicação, consultar preços/limites/permissão de uso comercial atuais antes de indicar plano gratuito.
- Não prometer WhatsApp real gratuito ou escala sem custo.

## Decisões de arquitetura já tomadas

Ver detalhes e justificativa em [PROGRESSO.md](PROGRESSO.md).

- Aplicação única em TypeScript/Node, servidor Express.
- Banco de dados: PostgreSQL não está instalado no ambiente local (sem `psql`, sem Docker). Alternativa leve adotada: **SQLite via `better-sqlite3`**, com migrações em SQL puro (`migrations/*.sql` + runner em `src/db.ts`). Prisma foi avaliado e descartado nesta fase: a versão instalada (`prisma@7`) é um CLI de plataforma em nuvem, não o fluxo local clássico — ver justificativa completa em [PROGRESSO.md](PROGRESSO.md). Migração futura para PostgreSQL: trocar o driver e ajustar o SQL (dialeto próximo).
- Isolamento multi-tenant aplicado no servidor via tabela `memberships` (usuário × empresa × perfil) e middleware que checa essa associação a cada requisição — nunca só por filtro de UI.

## Produto (resumo do escopo, não repetir ao usuário)

- Multiempresa (multi-tenant) com isolamento no servidor e no banco, não só na UI.
- Perfis: administrador da plataforma, administrador da empresa, atendente.
- Diferencial: medição do tempo de espera por atendimento humano (estados: automático, aguardando humano, humano, aguardando cliente, encerrado), com regras estritas de quando o cronômetro encerra (só resposta humana enviada com sucesso) e autoria rastreada (cliente/robô/humano/automação/desconhecida — nunca tratar desconhecida como humana).
- Integração futura (não implementar agora): simulado, WhatsApp oficial, robô externo, IA opcional.

## Como continuar

1. Ler [PROGRESSO.md](PROGRESSO.md) para saber a última etapa concluída e a próxima tarefa. O roteiro manual para testadores não técnicos fica em [ROTEIRO_TESTE.md](ROTEIRO_TESTE.md) — manter atualizado quando uma etapa mudar o fluxo de uso. A integração com WhatsApp real (pesquisa, limitações, checklist de conexão) fica em [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md) — nunca conectar um número real do usuário sem passar pelo checklist de lá.
2. Executar apenas a próxima tarefa indicada, salvo instrução diferente do usuário.
3. Atualizar PROGRESSO.md ao final.
