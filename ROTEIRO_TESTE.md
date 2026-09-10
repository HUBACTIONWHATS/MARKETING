# Roteiro de teste — HUB ACTION CRM WhatsApp (versão local)

Tudo aqui roda só no seu computador. **Nenhuma mensagem vai para o WhatsApp de verdade** — o "cliente" e o "robô" são simulados por botões na tela. Todos os dados são fictícios (há um aviso amarelo no topo de todas as telas).

## Como iniciar

Abra o PowerShell na pasta do projeto (`HUB ACTION - CRM`) e rode:

```bash
npm run dev
```

Quando aparecer `rodando em http://localhost:3000`, abra esse endereço no navegador (funciona no celular também, se estiver na mesma rede e usar o IP do computador no lugar de `localhost`).

**Só na primeira vez** (ou para zerar os dados de teste), antes do `npm run dev`:

```bash
npm install
```

```bash
npm run db:seed
```

Para **zerar tudo** e recomeçar: feche a aplicação, apague o arquivo `data\dev.sqlite3` e rode `npm run db:seed` de novo.

## Como encerrar

Na janela onde a aplicação está rodando, aperte **Ctrl + C** (se perguntar "Terminate batch job (Y/N)?", digite `S` ou `Y` e Enter). Se por algum motivo ela não fechar:

```bash
taskkill /F /IM node.exe
```

(isso fecha *todos* os programas Node no computador — use só como último recurso.)

## Contas de teste (senha de todas: `trocar123`)

| E-mail | Quem é |
|---|---|
| `admin@empresa-a.dev` | Administrador da **Empresa Demo A** |
| `atendente@empresa-a.dev` | Atendente da Empresa Demo A |
| `admin@empresa-b.dev` | Administrador da **Empresa Demo B** |
| `atendente@empresa-b.dev` | Atendente da Empresa Demo B |
| `admin@hubaction.dev` | Administrador da plataforma (Hub Action) |

## Roteiro (uns 10 minutos)

1. **Login.** Entre com `admin@empresa-a.dev`. Você cai no Dashboard da Empresa Demo A. Tente errar a senha uma vez: deve avisar "E-mail ou senha inválidos".
2. **Isolamento.** Com esse login, troque na barra de endereço `empresa/1` por `empresa/2` (ex.: `localhost:3000/empresa/2/conversas`). Deve aparecer **"403 — Acesso negado"**. A Empresa A nunca vê nada da B.
3. **Pedido de humano.** Vá em **Conversas** → abra "Cliente Demo A". Ele já pediu atendente: no painel da direita aparece **"Aguardando agora"** com o tempo correndo. Aperte F5 algumas vezes: o tempo continua de onde estava (não zera).
4. **Robô não encerra a espera.** No painel amarelo "Simulador (dev)", clique em **"Robô responde automaticamente"**. A mensagem do robô aparece, mas o painel continua "Aguardando agora".
5. **Assumir não encerra.** Clique em **"Assumir atendimento"**. O status muda para "Em atendimento humano", mas a espera continua aberta (é assim mesmo: ninguém respondeu ao cliente ainda).
6. **Falha de envio não encerra.** Escreva uma resposta, marque **"Simular falha de envio"** e envie. A mensagem aparece tracejada com "falha no envio" e a espera continua.
7. **Resposta humana encerra.** Escreva outra resposta, sem marcar a falha, e envie. Agora o painel mostra **"Nenhuma espera em aberto"** e o status vira "Aguardando cliente". Esse é o momento que o sistema mede.
8. **Pedido por texto e negação.** Volte em Conversas, crie uma conversa de teste no formulário amarelo (nome, telefone, modo Automático). Como cliente, envie "não quero atendente, só uma dúvida" → nada acontece. Envie "quero falar com atendente" → começa a espera. Envie de novo o mesmo pedido → o tempo **não** reinicia.
9. **Encerrar.** Nessa conversa, clique em **"Encerrar atendimento"** sem responder. Ela some das pendências e conta em "Encerrados sem resposta" no Dashboard.
10. **CRM.** Vá em **CRM** → "+ Nova oportunidade": nome, telefone, título, valor, responsável, agendamento. Ela aparece em "Novo contato". Use o seletor "Mover" para levá-la até **"Venda concluída"**. Tente mover outra para **"Perdido"** sem preencher o motivo: deve recusar; preencha o motivo e tente de novo.
11. **Etapas do funil.** Em CRM → "Configurar etapas": renomeie, mude a ordem, adicione uma etapa. "Venda concluída" e "Perdido" não podem ser excluídas (de propósito).
12. **Dashboard.** Volte ao Dashboard. Confira: a venda aparece em "Vendas e receita" com o valor; "Aguardando humano" bate com o número de conversas que mostram a etiqueta amarela "espera aberta" na lista de Conversas; "Encerrados sem resposta" = 1. Cada número tem uma frase explicando a conta. Mude o período e o atendente nos filtros.
13. **Configurações.** Mude o expediente (ex.: sábado aberto). Saia e entre como `atendente@empresa-a.dev`: o atendente vê as configurações mas não consegue salvar.
14. **Reinício.** Feche a aplicação (Ctrl + C) e abra de novo com `npm run dev`. Faça login de novo (a sessão não é guardada, isso é esperado). Tudo o que você fez — mensagens, oportunidade, tempos de espera — continua lá.
15. **Outra empresa.** Entre como `admin@empresa-b.dev`: é um ambiente totalmente separado, sem nada do que você fez na Empresa A.

16. **Painel da Hub Action.** Entre como `admin@hubaction.dev`. Crie uma empresa ("Criar empresa"), gere um **convite de administrador** para um e-mail seu — aparece um link. Abra o link em outra aba/navegador anônimo, crie a senha: você entra direto no painel dessa empresa nova, sem ver as outras.
17. **Equipe.** Nessa empresa nova, em Configurações → Equipe, convide um atendente e gere um "Link de nova senha" para ele. Desative-o e confira que ele não consegue mais entrar.
18. **Plano e suspensão.** De volta ao painel da Hub Action, marque "Suspender acesso" na empresa nova e salve: o cliente passa a ver "acesso suspenso". Desmarque para liberar. Veja o **Log de auditoria** com tudo que aconteceu.
19. **Conexão do WhatsApp.** Em Configurações (como administrador da empresa), a área "Conexão do WhatsApp" mostra o modo (demonstração/teste/produção), o que está configurado e o que falta — nunca diz "conectado" sem uma verificação real com a Meta.

Qualquer coisa diferente disso é um problema — anote em qual passo aconteceu.
