# Publicação do piloto externo (demonstração) — avaliação e instruções

Versão para revisão. **Nada foi publicado, contratado ou cadastrado em serviço externo.** Tudo abaixo depende da sua decisão e de configurações feitas por você. O piloto é de **demonstração**: conversas simuladas, identificadas como tal em todas as telas. A conexão do número comercial, o recebimento/envio reais e a integração com o robô atual continuam pendentes (ver [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md)).

## 0. Decisão tomada (autorizada): Neon (PostgreSQL gratuito) + Render (gratuito, só demonstração)

- O código passou a escolher o banco por variável de ambiente: **sem `DATABASE_URL` → SQLite local** (desenvolvimento e testes); **com `DATABASE_URL` → PostgreSQL** (piloto, na Neon). Uma única camada de acesso (`src/db.ts`), uma única implementação das regras de negócio; só o esquema (DDL) é por dialeto (`migrations/sqlite/` e `migrations/postgres/`).
- Validado: a suíte inteira (58 testes) passa no SQLite **e** num PostgreSQL real local; a aplicação inteira (login, isolamento, fluxo do robô, CRM, dashboard, sessões) foi exercitada no Postgres, inclusive **reiniciando a aplicação e o próprio banco** — tudo persistiu.
- **Render gratuito é só para demonstração externa**: o serviço **adormece após 15 min sem uso** e leva ~1 min para acordar. Por isso **não é considerado confiável para receber webhooks do WhatsApp em tempo real** — a Meta receberia timeouts durante o despertar e reentregaria depois (nada se perde e o cronômetro usa o horário da Meta, mas há atraso). Antes de conectar um número real, o serviço precisa de um plano que não adormeça.
- WhatsApp e robô continuam em modo pendente (ver CONEXAO_WHATSAPP.md).

## 1. O que o código exige de infraestrutura hoje

- **Um processo Node.js** (v20+; desenvolvido em v24) sempre ligado, servindo HTTP. Sem workers, filas ou tarefas agendadas — tudo acontece dentro da requisição.
- **Um banco**: PostgreSQL (produção/piloto, `DATABASE_URL`) **ou** um arquivo SQLite com disco persistente (`data/dev.sqlite3`, só local). Em hospedagem sem disco persistente (Render gratuito), o SQLite perderia tudo a cada deploy — por isso o Postgres.
- **HTTPS público** só é necessário para o webhook do WhatsApp real (e para o cookie de sessão seguro em produção). Para o piloto de demonstração, basta a URL que a hospedagem der.
- Sessões agora ficam no banco (tabela `sessions`) — reiniciar o servidor não desloga ninguém.
- Sem serviço de e-mail: convites e redefinição de senha são links gerados na tela que você entrega manualmente.

## 2. Hospedagem — pesquisa (setembro/2026) e opção principal

Fontes: [Render — free tier 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026), [Railway vs Render vs Fly.io](https://techsy.io/en/blog/railway-vs-render-vs-fly-io), [Fly.io alternativas após o fim do free tier](https://expresstech.io/7-fly-io-alternatives-in-2026-real-pricing-after-the-free-tier-died/), [free tiers de Postgres 2026 (Koyeb)](https://www.koyeb.com/blog/top-postgresql-database-free-tiers-in-2026), [Neon free tier](https://www.freetiers.com/directory/neon), [Supabase free tier 2026](https://agentdeals.dev/vendor/supabase), [Oracle Always Free — recursos](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Resumo do que sobrou de gratuito com uso comercial permitido:

| Serviço | Gratuito? | Uso comercial | Observação decisiva |
|---|---|---|---|
| Railway | Só crédito único de US$ 5 | — | Não é plano gratuito contínuo |
| Fly.io | Não para contas novas | — | Free tier encerrado |
| Render (web service) | Sim, 750 h/mês, sem cartão | Sim | **Dorme após 15 min sem uso; ~1 min para acordar; disco NÃO persistente** |
| Render (Postgres) | Expira em 30 dias | — | Inútil para dados de cliente |
| Neon (Postgres) | Sim, permanente, sem cartão | **Sim, explícito** | 0,5 GB por projeto, "dorme" o compute e acorda sozinho em segundos |
| Supabase (Postgres) | Sim, 500 MB | Não confirmado nos termos | Projeto pausa após 1 semana sem uso |
| Oracle Cloud Always Free (VM) | Sim, VM ARM + 200 GB disco | **Ambíguo**: termos falam em PoC/teste/"operações internas"; limites reduzidos em ago/2026 | Único com disco persistente grátis, mas exige administrar servidor (Linux, TLS, atualizações) |

### Opção principal recomendada: Render (aplicação) + Neon (banco)

- **Limites gratuitos**: Render 750 h/mês de instância (1 serviço ligado 24×7 cabe), 512 MB RAM, sem cartão; Neon 0,5 GB de dados, 100 horas de compute/mês por projeto, sem cartão.
- **Suspensão por inatividade**: Render **desliga o serviço após 15 min sem requisição** e leva ~1 min para voltar na próxima. Neon pausa o compute e retoma em segundos (transparente).
- **Webhooks e tarefas em segundo plano**: webhook do WhatsApp funciona (URL HTTPS pública), mas durante o "acordar" a Meta recebe timeout e **reentrega depois** (nossa deduplicação por `wamid` trata isso; e o cronômetro passou a usar o horário da mensagem enviado pela Meta, não o da chegada — a métrica não fica errada, só atrasa). Tarefas em segundo plano (cron/worker) não existem no gratuito — o código também não precisa delas hoje.
- **Backup e restauração**: Neon guarda histórico para restauração pontual no gratuito (retenção curta — confirmar o valor atual no painel da Neon) e permite `pg_dump` manual a qualquer momento. Render não faz backup do serviço (não há dado nele).
- **Custos separados**: hospedagem R$ 0 nesse arranjo. **WhatsApp**: cobrado pela Meta, por mensagem de template fora da janela de 24 h, exige cartão na conta comercial da Meta — não é cobrado pela hospedagem (ver CONEXAO_WHATSAPP.md). **IA**: não é usada; se um dia for, é contrato separado com o fornecedor escolhido.
- **Critérios objetivos para ir ao plano pago** (Render Starter e/ou Neon Launch — consultar preço atual nos sites na hora de decidir; não fixo valores aqui): (1) o número comercial for conectado de verdade — atraso de ~1 min ao acordar passa a atingir clientes reais; (2) banco passar de ~400 MB dos 500 MB; (3) mais de uma empresa cliente usando ao mesmo tempo com expectativa de resposta imediata; (4) necessidade de lembretes/tarefas agendadas (worker pago).

**Pré-requisito para essa opção — FEITO**: o banco foi migrado para PostgreSQL (driver `pg`, camada assíncrona, esquema em `migrations/postgres/0001_baseline.sql`). O SQLite ficou só para desenvolvimento local e testes.

### Passo a passo — criar a conta e o banco na Neon (feito por você; nada pago, sem cartão)

1. Abra **https://neon.tech** e clique em **Sign up**. Pode entrar com Google, GitHub ou e-mail. Escolha o plano **Free** (é o padrão; não pede cartão).
2. Na primeira tela, crie o projeto: nome **hubaction**, versão do Postgres a padrão (16 ou 17), região a mais próxima do Brasil que aparecer (se não houver América do Sul, **US East** serve). Confirme.
3. No painel do projeto, clique em **Connect** (ou "Connection details"). Deixe o banco padrão (`neondb`) e o usuário padrão. Copie a **connection string** que começa com `postgresql://` — ela contém a senha, é um segredo.
4. No seu computador, abra o arquivo `.env` (o mesmo onde ficaram os dados do WhatsApp) e adicione uma linha `DATABASE_URL=` seguida da string copiada. **Não me mande esse valor** e não coloque em nenhum outro arquivo.
5. Rode `npm run db:seed` — a aplicação cria as tabelas na Neon (migração `0001_baseline.sql`) e os dados de demonstração. Depois `npm run dev` e abra http://localhost:3000: agora você está usando o banco da Neon (o `/health` responde `"db":"postgres"`). Tudo o que criar fica lá, não no arquivo local.
6. Para voltar ao SQLite local, basta remover (ou comentar) a linha `DATABASE_URL` do `.env`.

Observações honestas sobre a Neon no gratuito: 0,5 GB por projeto; o "compute" desliga quando ocioso e religa sozinho em poucos segundos na primeira consulta (você pode notar 1–3 s de demora depois de um tempo parado); histórico para restauração pontual com retenção curta — confira o valor atual no painel; `pg_dump` manual funciona quando quiser um backup próprio. Se a verificação do certificado TLS falhar no seu ambiente (raro), a variável `DATABASE_SSL=no-verify` é o contorno documentado — não use `disable` com a Neon.

### Render — só depois da sua confirmação

Não configurei nada no Render. Quando você confirmar, o passo a passo será: conta gratuita (sem cartão), **Web Service** apontando para o repositório, comando de build `npm install && npm run build`, comando de start `npm start`, e as variáveis da seção 3 (incluindo `DATABASE_URL` da Neon). Reforço: o serviço gratuito **dorme** — aceitável para a demonstração externa, **não** para webhooks reais.

### Alternativa mantendo SQLite (sem migrar o banco agora)

Oracle Cloud Always Free (VM com disco persistente): funciona com o código como está, não dorme. Contras: você administra o servidor (Linux, `caddy`/Let's Encrypt para HTTPS, atualizações), os termos são orientados a PoC/uso interno — aceitável para o **piloto de demonstração**, mas eu **não** o recomendaria como base de um produto comercial vendido a terceiros sem ler os termos vigentes. Também tem backup manual (copiar `data/dev.sqlite3` — script simples).

### O plano gratuito compromete o recebimento de mensagens?

Sim, parcialmente — e isso precisa estar claro antes de conectar um número real: com o Render gratuito dormindo, a **primeira mensagem após 15 min de silêncio chega com ~1 min de atraso** (a Meta reentrega; nada se perde; o cronômetro conta pelo horário certo). Para o piloto de demonstração (simulado) isso é irrelevante. Para atendimento real, é motivo para o plano pago antes de conectar o número comercial.

## 3. Configuração de produção (feita por você, na hospedagem escolhida)

Variáveis de ambiente (nunca no código, nunca no Git):

| Variável | Obrigatória | O que é |
|---|---|---|
| `NODE_ENV=production` | Sim | Desliga simulador, seed e banner de demonstração; exige `SESSION_SECRET`; cookie seguro |
| `SESSION_SECRET` | Sim (≥ 32 caracteres) | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_BASE_URL` | Sim | Ex.: `https://hubaction.onrender.com` — usado nos links de convite/redefinição |
| `PORT` | Normalmente a hospedagem define | Porta HTTP |
| `DATABASE_URL` | Sim (piloto) | Connection string da Neon (`postgresql://...`). Sem ela, a aplicação usa SQLite local |
| `DATABASE_SSL` | Não | `require` (padrão fora de localhost); `no-verify` só se o certificado falhar; `disable` só para Postgres local |
| `DATABASE_FILE` | Só sem `DATABASE_URL` | Caminho do arquivo SQLite (desenvolvimento) |
| `WHATSAPP_*` | Não (piloto demo) | Só quando for conectar número real — ver CONEXAO_WHATSAPP.md |

**Atenção — piloto de demonstração em produção**: com `NODE_ENV=production` o simulador some (correto para clientes reais), mas o piloto é demonstrativo. Decida uma das duas formas antes de publicar: (a) publicar **sem** `NODE_ENV=production` — o banner amarelo e o simulador continuam, deixando claro que é demonstração (recomendado para o piloto); nesse caso, mesmo assim configure `SESSION_SECRET` forte; ou (b) publicar com `NODE_ENV=production` e alimentar os dados de demonstração pelo seed antes (o seed é bloqueado em produção — rodar antes de ligar a flag).

Primeiro acesso da Hub Action: crie o administrador da plataforma com o seed **ou** rode manualmente `npx tsx src/seed.ts` só uma vez antes de publicar (ele cria `admin@hubaction.dev` — troque a senha imediatamente pelo link de redefinição do painel). Os usuários de demonstração `*@empresa-a.dev` / `*@empresa-b.dev` **não devem existir no piloto externo**: crie as empresas dos clientes pelo painel e convide-os por link.

## 4. Como os clientes entram

1. Hub Action, logada como administrador da plataforma, abre **/admin** → "Criar empresa".
2. Na empresa, gera um **convite de administrador** (link) e entrega ao cliente.
3. O cliente abre o link, cria a própria senha e cai só no painel da empresa dele. Ele convida os atendentes pela tela **Configurações → Equipe**.
4. Senha esquecida: o admin da empresa (ou a Hub Action) gera um link de redefinição (vale 2 h) e entrega.
5. Plano e suspensão: **/admin** → "Salvar plano" — rótulos Demonstração / Piloto / Ativo, campo de observações, caixa "Suspender acesso". Sem preço, sem cobrança automática.

## 5. Isolamento e proteção — verificado antes de publicar

- Toda rota `/empresa/:id/...` passa por `requireCompanyAccess`: exige sessão, associação (`memberships`) e empresa não suspensa; consultas de dados sempre filtram por `company_id` (testado de novo nesta etapa: a tela de Conexão do WhatsApp da Empresa B não mostra nada da Empresa A; atendente não vê a área de administrador).
- Administrador da plataforma não entra nas telas das empresas (403) e o painel dele não mostra conteúdo de conversas.
- Senhas com bcrypt; tokens de convite/redefinição guardados como SHA-256, uso único, com validade; redefinir senha ou desativar usuário derruba as sessões dele.
- Cookie de sessão `httpOnly` + `sameSite=lax` (+ `secure` em produção); sessões no banco.
- Webhook do WhatsApp com assinatura HMAC obrigatória e deduplicação.
- Log de auditoria (`/admin/log`): login ok/falha, convites, redefinições, planos, ativação/desativação.
- Consultas SQL parametrizadas em todo o código.

**Lacunas conhecidas (não corrigidas nesta etapa, para decisão sua):** sem limite de tentativas de login (força bruta); sem proteção CSRF além do `sameSite=lax`; credenciais do WhatsApp são globais do servidor (um número real por instalação, não por empresa); sem 2FA.

## 6. Roteiro de publicação (quando você autorizar)

1. Decidir: Render+Neon (exige a migração para Postgres primeiro) **ou** VM com SQLite.
2. Criar as contas nos serviços escolhidos (você, com seu e-mail; nenhum cartão é exigido nos planos gratuitos citados).
3. Subir o código (repositório Git) e configurar as variáveis da seção 3.
4. Rodar o seed uma vez (cria a Hub Action e o funil padrão), trocar a senha da Hub Action.
5. Abrir `https://<sua-url>/health` → `{"status":"ok"}`; abrir `/login`; criar a primeira empresa cliente e o convite.
6. Testar o isolamento com dois clientes (cada um só vê o seu painel) antes de mandar convites de verdade.
7. Só depois, e em etapa própria: número de teste da Meta → número comercial (checklist de CONEXAO_WHATSAPP.md).
