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

### Render — preparado, aguardando sua confirmação para publicar

Nada foi criado no Render ainda (nenhuma conta, nenhum serviço). O que já está pronto no repositório, para quando você confirmar:

- **[render.yaml](render.yaml)** (Blueprint): descreve o serviço pronto para importar — plano `free`, comando de build `npm install --include=dev && npm run build` (o `--include=dev` é necessário porque o `npm install` do Render roda com `NODE_ENV=production`, e sem essa flag algumas versões do `npm` pulam as `devDependencies` — o `typescript`, usado no build, é uma delas), comando de start `npm start`, verificação de saúde em `/health`, e as variáveis de ambiente (com `SESSION_SECRET` gerado automaticamente pelo próprio Render e `DATABASE_URL` marcada como "preencher manualmente", nunca gravada no arquivo).
- Passo a passo (quando você autorizar): conta gratuita no Render (sem cartão) → "New" → "Blueprint" → apontar para o repositório → o Render lê `render.yaml` sozinho → você cola a `DATABASE_URL` da Neon quando pedido → confirma. Se preferir não usar Blueprint, os mesmos valores podem ser digitados à mão em "New" → "Web Service".
- Reforço: o serviço gratuito **dorme** após 15 min sem uso — aceitável para a demonstração externa, **não** para webhooks reais.

### Reforços de segurança feitos nesta etapa (verificados, antes de publicar)

- **CSRF**: token por sessão, exigido em todo formulário (`POST`) do painel; injetado automaticamente nas telas, sem precisar editar view por view. Testado simulando o proxy do Render (`X-Forwarded-Proto: https`): formulário sem token ou com token errado → bloqueado; com token certo → passa.
- **Limite de tentativas de login**: 5 tentativas erradas por e-mail+IP em 15 min bloqueiam por 15 min (fica só em memória do processo — reinicia ao reiniciar o serviço, o que é aceitável para o piloto). Tentativa bloqueada também vai para o log de auditoria.
- **`SESSION_SECRET`**: já era exigido (≥ 32 caracteres) para iniciar em produção; o `render.yaml` pede para o próprio Render gerar um valor aleatório automaticamente (você nunca digita nem vê esse segredo).
- **Cookie de sessão seguro**: confirmado que `trust proxy` faz o Express reconhecer o HTTPS do Render (que termina o TLS antes de chegar na aplicação) e o cookie sai com `secure` ligado nesse caso.
- **Modo demonstração independente da produção**: antes, uma única variável (`NODE_ENV`) controlava ao mesmo tempo "ligar segurança de produção" e "mostrar banner/simulador de demonstração" — não dava para ter os dois ligados juntos. Agora são duas variáveis independentes: `NODE_ENV=production` (segurança) e `DEMO_MODE` (banner e simulador, ligado por padrão). O piloto no Render sobe com as duas coisas ligadas ao mesmo tempo: seguro **e** visivelmente de demonstração.
- **Seed sem risco de apagar dados**: o `npm run db:seed` nunca apaga nem recria nada — só cria uma conta se o e-mail ainda não existir; contas já existentes não têm a senha tocada, e ele não roda sozinho na inicialização do serviço (só quando você rodar manualmente, uma vez).
- **Senhas de demonstração deixam de ser previsíveis no banco remoto**: no SQLite local continuam fixas (`trocar123`, só no seu computador). No Postgres (Neon, potencialmente público) o seed agora gera uma senha aleatória diferente para cada conta nova e mostra cada uma só uma vez no terminal — ou você pode escolher a senha de cada conta por variável de ambiente (`PLATFORM_ADMIN_PASSWORD`, `DEMO_A_ADMIN_PASSWORD`, `DEMO_A_AGENT_PASSWORD`, `DEMO_B_ADMIN_PASSWORD`, `DEMO_B_AGENT_PASSWORD`) na hora de rodar o seed.
- **`.env` e credenciais**: confirmado que `.env` está no `.gitignore` e nunca foi commitado (só existe `.env.example`, sem valores reais).

### Alternativa mantendo SQLite (sem migrar o banco agora)

Oracle Cloud Always Free (VM com disco persistente): funciona com o código como está, não dorme. Contras: você administra o servidor (Linux, `caddy`/Let's Encrypt para HTTPS, atualizações), os termos são orientados a PoC/uso interno — aceitável para o **piloto de demonstração**, mas eu **não** o recomendaria como base de um produto comercial vendido a terceiros sem ler os termos vigentes. Também tem backup manual (copiar `data/dev.sqlite3` — script simples).

### O plano gratuito compromete o recebimento de mensagens?

Sim, parcialmente — e isso precisa estar claro antes de conectar um número real: com o Render gratuito dormindo, a **primeira mensagem após 15 min de silêncio chega com ~1 min de atraso** (a Meta reentrega; nada se perde; o cronômetro conta pelo horário certo). Para o piloto de demonstração (simulado) isso é irrelevante. Para atendimento real, é motivo para o plano pago antes de conectar o número comercial.

## 3. Configuração de produção (feita por você, na hospedagem escolhida)

Variáveis de ambiente (nunca no código, nunca no Git):

| Variável | Obrigatória | O que é |
|---|---|---|
| `NODE_ENV=production` | Sim | Liga a segurança de produção: exige `SESSION_SECRET`, cookie seguro, `trust proxy`. **Não** desliga mais o banner/simulador — isso agora é o `DEMO_MODE` (ver abaixo) |
| `DEMO_MODE` | Não (padrão: ligado) | Mostra o banner amarelo e o simulador de conversa. Deixe ligado no piloto (não defina, ou `DEMO_MODE=true`); só desligue (`DEMO_MODE=false`) quando o WhatsApp real estiver conectado — nesse caso o seed também passa a recusar rodar |
| `SESSION_SECRET` | Sim (≥ 32 caracteres) | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_BASE_URL` | Recomendado | `https://hub-action-crm-demo.onrender.com` (ponto antes de "onrender.com", **nunca** hífen) — usado em todo link absoluto (convite, redefinição, webhook). Sem ela, o código usa esse mesmo domínio como reserva fixa — mas se for definida com um valor errado, esse valor errado prevalece |
| `PORT` | Normalmente a hospedagem define | Porta HTTP |
| `DATABASE_URL` | Sim (piloto) | Connection string da Neon (`postgresql://...`). Sem ela, a aplicação usa SQLite local |
| `DATABASE_SSL` | Não | `require` (padrão fora de localhost); `no-verify` só se o certificado falhar; `disable` só para Postgres local |
| `DATABASE_FILE` | Só sem `DATABASE_URL` | Caminho do arquivo SQLite (desenvolvimento) |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_API_VERSION` | Não (piloto demo) | Globais do servidor (um webhook para todas as empresas) — só quando for conectar número real, ver CONEXAO_WHATSAPP.md |
| `CREDENTIAL_ENCRYPTION_KEY` | Não (só quando cadastrar alguma conexão) | Cifra o Access Token de cada empresa antes de gravar no banco — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Sem ela, a tela `/admin/whatsapp` não cadastra nem lê nenhuma credencial. Também cifra os tokens OAuth de Meta Ads/Google Ads |
| `META_APP_ID`, `META_APP_SECRET` | Não (só para conectar Meta Ads) | App no Meta for Developers; OAuth pede só `ads_read,read_insights`. Cadastrar no app a URI `<PUBLIC_BASE_URL>/admin/integracoes/meta/callback`. Opcionais: `META_GRAPH_API_VERSION`, `META_REDIRECT_URI`, `META_OAUTH_SCOPES` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Não (só para conectar Google Ads) | Cliente OAuth "Web application" de um projeto Google Cloud com a Google Ads API ativada (o nível de acesso vem do projeto desde 09/09/2026). Cadastrar a URI `<PUBLIC_BASE_URL>/admin/integracoes/google/callback`. Opcionais: `GOOGLE_ADS_API_VERSION` (padrão v25), `GOOGLE_ADS_DEVELOPER_TOKEN` (legado, ignorado pela API), `GOOGLE_REDIRECT_URI` |
| `MARKETING_SYNC_INTERVAL_MINUTES` | Não (padrão 60; 0 desliga) | Agendador em processo de sincronização das plataformas — só roda enquanto a instância estiver acordada (plano gratuito dorme). `MARKETING_INITIAL_LOOKBACK_DAYS` (padrão 90) e `MARKETING_RECENT_WINDOW_DAYS` (padrão 7) controlam as janelas |

**Piloto de demonstração em produção**: o piloto no Render sobe com `NODE_ENV=production` (segurança de verdade: `SESSION_SECRET` obrigatório, cookie seguro, CSRF, limite de tentativas de login) **e** `DEMO_MODE` ligado (banner amarelo e simulador continuam visíveis, deixando claro que é demonstração) ao mesmo tempo — as duas coisas não competem mais entre si.

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
- Log de auditoria (`/admin/log`): login ok/falha, convites, redefinições, planos, ativação/desativação, cadastro/teste/ativação/desativação/substituição de conexão do WhatsApp (nunca com o segredo).
- Consultas SQL parametrizadas em todo o código.
- Proteção CSRF (token por sessão em todo formulário) e limite de tentativas de login (5 por e-mail+IP a cada 15 min).
- **Credenciais do WhatsApp por empresa, cifradas** (Access Token com AES-256-GCM, chave `CREDENTIAL_ENCRYPTION_KEY` só no servidor, nunca em texto puro no banco nem de volta no navegador): cadastro/teste/ativação exclusivos do administrador geral (`/admin/whatsapp`); administrador da empresa só vê status; atendente não acessa nada disso — isolamento entre empresas testado (uma não vê nem altera a conexão da outra).

**Lacunas conhecidas (não corrigidas nesta etapa, para decisão sua):** sem 2FA.

## 6. Roteiro de publicação (quando você autorizar)

1. ~~Decidir: Render+Neon (exige a migração para Postgres primeiro) ou VM com SQLite~~ — decidido: Render+Neon.
2. ~~Criar as contas nos serviços escolhidos~~ — Neon: feito e confirmado. Render: falta você criar a conta (sem cartão).
3. **Repositório remoto (GitHub) — verificado nesta etapa: ainda não existe.** O projeto tem git local (branch `master`, com commits) mas nenhum `origin` configurado. O Render precisa de um repositório Git para o deploy (Blueprint/Web Service lê direto do GitHub). Esse é o próximo passo antes de continuar — ver mensagem de acompanhamento.
4. Subir o código para esse repositório e configurar as variáveis da seção 3 (no Render, o `render.yaml` já prepara a maioria — só falta colar a `DATABASE_URL` da Neon).
5. Rodar o seed uma vez (cria a Hub Action e o funil padrão), trocar a senha da Hub Action.
6. Abrir `https://<sua-url>/health` → `{"status":"ok"}`; abrir `/login`; criar a primeira empresa cliente e o convite.
7. Testar o isolamento com dois clientes (cada um só vê o seu painel) antes de mandar convites de verdade.
8. Só depois, e em etapa própria: número de teste da Meta → número comercial (checklist de CONEXAO_WHATSAPP.md).
