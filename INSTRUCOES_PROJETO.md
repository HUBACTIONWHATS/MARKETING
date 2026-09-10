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
- Banco de dados: PostgreSQL não está instalado no ambiente local (sem `psql`, sem Docker). Alternativa leve adotada por enquanto: **SQLite** (via driver a definir quando o primeiro módulo de dados for implementado), migrável para PostgreSQL depois trocando a connection string / provider do ORM. Nenhum ORM foi instalado ainda — será adicionado só quando houver necessidade real de persistência.

## Produto (resumo do escopo, não repetir ao usuário)

- Multiempresa (multi-tenant) com isolamento no servidor e no banco, não só na UI.
- Perfis: administrador da plataforma, administrador da empresa, atendente.
- Diferencial: medição do tempo de espera por atendimento humano (estados: automático, aguardando humano, humano, aguardando cliente, encerrado), com regras estritas de quando o cronômetro encerra (só resposta humana enviada com sucesso) e autoria rastreada (cliente/robô/humano/automação/desconhecida — nunca tratar desconhecida como humana).
- Integração futura (não implementar agora): simulado, WhatsApp oficial, robô externo, IA opcional.

## Como continuar

1. Ler [PROGRESSO.md](PROGRESSO.md) para saber a última etapa concluída e a próxima tarefa.
2. Executar apenas a próxima tarefa indicada, salvo instrução diferente do usuário.
3. Atualizar PROGRESSO.md ao final.
