# PROGRESSO — PROJETO 7 — HUB ACTION - CRM WHATSAPP

Ver regras de trabalho em [INSTRUCOES_PROJETO.md](INSTRUCOES_PROJETO.md).

## Ambiente inspecionado (2026-09-10)

- Pasta do projeto estava vazia, sem repositório git.
- Node v24.20.0 e npm 11.19.0 disponíveis.
- PostgreSQL **não instalado** (sem `psql`) e **sem Docker** disponível no ambiente. Por isso a etapa de banco de dados vai usar uma alternativa local leve (SQLite) até o ambiente permitir Postgres real, conforme autorizado no briefing ("proponha uma alternativa local leve, explicando a migração futura").

## Decisões

- **Stack**: aplicação única Node + TypeScript, servidor HTTP com Express 5. Simples, sem framework pesado, roda com um único `npm run dev`.
- **Execução em dev**: `tsx watch` (sem passo de build manual a cada mudança).
- **TypeScript**: usando `module`/`moduleResolution` = `node16` (a versão de TypeScript resolvida no ambiente exige essa combinação; `node10`/`commonjs` isolado não é mais aceito).
- **Banco de dados**: adiado. Nenhum ORM/driver instalado ainda nesta etapa — será escolhido (provavelmente Prisma, por permitir trocar SQLite → PostgreSQL só mudando o provider) quando o primeiro módulo com persistência (contatos/conversas) for implementado.
- **Sem dependências além de**: `express` (runtime) e `typescript`, `@types/express`, `@types/node`, `tsx` (dev).

## Etapa concluída: Etapa 0 — Base executável

- `package.json`, `tsconfig.json` configurados.
- `src/server.ts`: servidor Express com rota `/` (página inicial) e `/health`.
- `public/index.html`: página inicial mostrando "PROJETO 7 — HUB ACTION - CRM WHATSAPP", com indicação visual de que é ambiente local.
- Testado: `npx tsc --noEmit` sem erros; servidor sobe e responde em `/` e `/health`.

### Como testar

```bash
npm run dev
```

Depois abrir http://localhost:3000 (mostra o nome do projeto) e http://localhost:3000/health (retorna `{"status":"ok"}`).

- Repositório git inicializado e primeiro commit feito (2026-09-10).

## Fluxo de trabalho combinado com o usuário

O usuário envia as etapas uma de cada vez. Ao concluir cada etapa: resumir brevemente o que mudou, como testar, pendências — e pedir a próxima etapa. Não antecipar etapas.

## Etapa concluída: Etapa 2 — Banco, migrações, login, perfis e isolamento

### Decisões desta etapa

- **Banco/driver**: `better-sqlite3` (síncrono, estável, sem serviço externo), não Prisma. O CLI atual do Prisma instalado (`prisma@7`) mudou para um produto de plataforma em nuvem ("Prisma Developer Platform": `auth`, `project`, `deploy`, `postgres` gerenciado etc.), sem o fluxo clássico local `migrate dev` que eu conhecia com confiança — foi desinstalado para não arriscar depender de um comportamento de CLI que eu não domino nem empurrar o projeto para infraestrutura paga/nuvem nesta fase local. Migração futura para PostgreSQL continua viável: trocar o driver (`pg`) e ajustar o SQL das migrações (dialeto muito próximo).
- **Migrações**: arquivos SQL simples em `migrations/*.sql`, aplicados em ordem por um runner próprio (`src/db.ts`) que registra o que já rodou em `_migrations`. `0001_init.sql` cria `companies`, `users`, `memberships`.
- **Multi-tenant**: tabela `memberships` associa `user_id` + `company_id` + `role` (`COMPANY_ADMIN` | `AGENT`). Administrador da plataforma é uma flag (`users.is_platform_admin`), sem membership — não herda acesso às páginas operacionais de nenhuma empresa.
- **Isolamento no servidor**: middleware `requireCompanyAccess` ([src/auth.ts](src/auth.ts)) consulta `memberships` a cada request para a empresa da URL (`/empresa/:companyId/...`) e retorna 403 se não houver associação. Não é um filtro de interface — sem a linha em `memberships` não há acesso, mesmo trocando o ID na URL.
- **Autenticação**: sessão via `express-session` (cookie httpOnly, `SESSION_SECRET` de dev por padrão — trocar em produção) + senha com `bcryptjs`. Sem JWT/OAuth nesta etapa (desnecessário para o MVP local).
- **Views**: HTML gerado por funções em [src/views.ts](src/views.ts), sem engine de template (evita dependência nova sem necessidade).

### O que foi implementado

- `migrations/0001_init.sql`, `src/db.ts` (runner de migração), `src/models.ts` (consultas).
- `src/auth.ts`: hash/verificação de senha, `requireAuth`, `requirePlatformAdmin`, `requireCompanyAccess`.
- `src/views.ts`: login, 403, seletor de empresa (usuário com mais de uma empresa), painel da plataforma (lista empresas, sem conteúdo de conversas), shell com navegação (Dashboard, Conversas, CRM, Relatórios, Configurações) e estado vazio por página.
- `src/server.ts`: rotas `/login`, `/logout`, `/`, `/empresas`, `/admin`, `/empresa/:companyId/:page`.
- `src/seed.ts`: seed de desenvolvimento — bloqueado se `NODE_ENV=production` (`npm run db:seed`). Cria:
  - `admin@hubaction.dev` — administrador da plataforma
  - `admin@empresa-a.dev` / `atendente@empresa-a.dev` — Empresa Demo A
  - `admin@empresa-b.dev` / `atendente@empresa-b.dev` — Empresa Demo B
  - Senha de todos (dev): `trocar123`
- `data/` (arquivo SQLite) e `*.sqlite` já estavam no `.gitignore`.

### Verificado (via curl, servidor local)

- Login com senha errada → 401. Acesso sem sessão a `/empresa/1/dashboard` → redireciona para `/login`.
- Admin da Empresa A loga, acessa `/empresa/1/dashboard` (200) e as outras 4 páginas de navegação, todas com estado vazio correto.
- Admin da Empresa A tenta `/empresa/2/dashboard` (Empresa B) → **403**.
- Atendente da Empresa B loga, acessa `/empresa/2/dashboard` (200) e tenta `/empresa/1/dashboard` → **403**.
- Administrador da plataforma loga, acessa `/admin` (200, lista as 2 empresas) e tenta `/empresa/1/dashboard` diretamente → **403** (sem membership, como projetado).

### Como testar

```bash
npm run db:seed   # cria as 2 empresas fictícias e os usuários de teste (bloqueado em produção)
npm run dev
```

Abrir http://localhost:3000/login e entrar com um dos e-mails de teste acima (senha `trocar123`).

### Pendências / próxima tarefa

- Regra de acesso por página dentro da empresa (ex.: só `COMPANY_ADMIN` mexe em Configurações) ainda não diferenciada — hoje admin e atendente veem as mesmas 5 páginas vazias.
- Painel `/admin` mostra só a lista de empresas; saúde operacional (fila, tempo de resposta) fica para quando o diferencial de espera humana for implementado.
- Nenhum dado real de conversas/contatos ainda — próximas etapas do produto continuam vazias por design.

## Etapa concluída: Etapa 3 — Contatos, conversas, mensagens e espera humana

### Decisões desta etapa

- **Schema** (`migrations/0002_conversas.sql`): `contacts`, `conversations` (com `mode` AUTOMATICO/MANUAL e `status` AUTO/AGUARDANDO_HUMANO/HUMANO/AGUARDANDO_CLIENTE/ENCERRADO), `messages` (autoria CLIENTE/ROBO/HUMANO/AUTOMACAO/DESCONHECIDO + `send_status` ENVIADA/FALHOU), `wait_episodes` (um período de espera por atendimento humano). `companies` ganhou `timezone` e `business_hours` (JSON por dia da semana).
- **Cronômetro persistido**: todo cálculo de espera é derivado de `wait_episodes.started_at`/`ended_at` (strings ISO gravadas pelo servidor) recalculado a cada request — não existe timer no navegador. Recarregar a página sempre mostra o tempo correto. Ver [src/attendance.ts](src/attendance.ts) `summarizeWait`.
- **Regra central do diferencial** (`addMessage` em [src/attendance.ts](src/attendance.ts)): só mensagem `HUMANO` com `send_status = ENVIADA` encerra o episódio aberto. Robô/automação/autoria desconhecida nunca encerram. Assumir responsável (`assumeConversation`) só muda `assigned_user_id`/status, nunca mexe em `wait_episodes`. Pedido repetido não cria novo episódio (`startWaitIfNeeded` é idempotente enquanto há um episódio aberto). Transferência (reassumir) não apaga o acumulado porque os episódios já fechados continuam somados no total.
- **Detecção de pedido de humano por texto**: regras simples (regex) em `detectHumanRequest`, com lista de negações (“não quero atendente”, “sem atendente” etc.) que cancelam a detecção — sem IA, conforme pedido.
- **Expediente/fuso**: cálculo sem biblioteca nova, usando `Intl.DateTimeFormat` nativo do Node para converter horário de parede ↔ UTC por fuso ([src/businessHours.ts](src/businessHours.ts)). Limitação documentada no próprio arquivo: não cobre expediente que atravessa a meia-noite, e a técnica de conversão de fuso não garante precisão no instante exato de uma transição de horário de verão — irrelevante para o fuso padrão (`America/Sao_Paulo`), que não tem mais horário de verão desde 2019.
- **Simulador exclusivo de dev**: rotas `POST /empresa/:id/conversas/nova` e `.../simular/*` respondem 404 se `NODE_ENV=production`. O checkbox “simular falha de envio” no formulário de resposta do atendente também some fora de dev. O restante (caixa de entrada, abrir conversa, assumir, responder) é funcionalidade real, não simulada.
- **Configurações**: só `COMPANY_ADMIN` pode salvar (403 para `AGENT`); ambos podem visualizar.

### O que foi implementado

- [src/attendance.ts](src/attendance.ts): contatos, conversas, mensagens, episódios de espera, `detectHumanRequest`, `summarizeWait`.
- [src/businessHours.ts](src/businessHours.ts): minutos de expediente entre duas datas, por fuso.
- [src/views.ts](src/views.ts): caixa de entrada, detalhe da conversa (chat + painel de espera + simulador dev), página de configurações (fuso + expediente por dia).
- [src/server.ts](src/server.ts): rotas de conversas (listar, abrir, nova, assumir, responder, simular cliente/robô/pedir-humano) e configurações (GET/POST). Dashboard/CRM/Relatórios continuam com estado vazio (fora do escopo desta etapa).
- [src/seed.ts](src/seed.ts): cada empresa demo ganha 1 conversa de teste já com pedido de atendente pendente (dado de teste, bloqueado em produção como antes).
- [src/attendance.test.ts](src/attendance.test.ts): 9 testes automatizados (`npm test`, `node:test` nativo — sem dependência nova) cobrindo exatamente os 5 comportamentos pedidos + detecção de texto + modo manual + autoria desconhecida. Banco de teste isolado em `data/test-attendance.sqlite3` (nunca toca `dev.sqlite3`).

### Verificado

- `npm test`: 9/9 passando — robô não encerra, assumir não encerra, falha não encerra, pedido repetido não reinicia (`started_at` idêntico), resposta humana válida encerra.
- Fluxo completo via HTTP (curl): seed cria conversa "Aguardando humano" → robô responde (espera continua) → assumir (espera continua, status "Em atendimento humano") → responder com falha simulada (espera continua) → responder de verdade (espera encerra, status "Aguardando cliente").
- Página de Configurações: admin salva fuso/expediente e persiste; atendente recebe 403 ao tentar salvar.
- **Incidente durante o desenvolvimento**: a primeira versão do arquivo de teste vazou dados fictícios para `data/dev.sqlite3` (bug de hoisting de `import` estático abrindo o banco padrão antes de definir `DATABASE_FILE` de teste). Detectado, corrigido (import dinâmico dentro de `test.before`) e o banco de dev foi limpo antes de seguir. Reforça por que `data/` fica fora do git.

### Como testar

```bash
npm test          # testes automatizados do motor de espera/estado
npm run db:seed    # garante as conversas de demonstração (idempotente)
npm run dev
```

Abrir http://localhost:3000/login, entrar como `admin@empresa-a.dev` (senha `trocar123`) → Conversas → abrir a conversa de "Cliente Demo A" → usar o painel amarelo "Simulador (dev)" para robô responder / pedir atendente, e o formulário normal para assumir/responder (com opção de simular falha). Em Configurações, ajustar fuso/expediente.

### Pendências / próxima tarefa

- Autoria `AUTOMACAO` só existe no schema; nenhuma tela ainda gera mensagens com essa autoria (fica para quando houver integração/automação real).
- Nenhuma integração real de WhatsApp — continua tudo simulado, como pedido.

## Etapa concluída: Etapa 4 — CRM (funil configurável) e Dashboard

### Decisões desta etapa

- **Schema** (`migrations/0003_crm.sql`): `pipeline_stages` (funil por empresa: nome, posição, `is_won`/`is_lost`) e `opportunities` (separada de `contacts`: título, valor em centavos, `responsible_user_id`, `scheduled_at`, `lost_reason`, `closed_at`). `wait_episodes` ganhou `ended_by_user_id` (quem enviou a resposta que encerrou a espera — necessário para o filtro "atendente" do dashboard) e `companies` ganhou `sla_first_response_minutes` (meta configurável, usada no cálculo de "% dentro do prazo"). As 6 etapas padrão pedidas no briefing são semeadas automaticamente: via `INSERT ... SELECT FROM companies` na própria migração para empresas já existentes, e via `ensureDefaultPipelineStages()` ([src/crm.ts](src/crm.ts)) para empresas novas (chamada de forma defensiva também nas rotas GET do CRM).
- **Funil configurável**: `/empresa/:id/crm/etapas` permite renomear, reordenar (subir/descer) e adicionar etapas; excluir só é permitido se a etapa não tiver oportunidades. As duas etapas de encerramento do funil (`is_won`/`is_lost`) são protegidas contra exclusão — são a fonte da verdade das métricas de venda/perda do dashboard.
- **Regra de negócio**: mover uma oportunidade para uma etapa `is_lost` exige `lost_reason` (rejeitado com erro se vazio); mover para `is_won`/`is_lost` grava `closed_at`; mover de volta para uma etapa aberta limpa `lost_reason` e `closed_at` (reabre).
- **Meta de SLA no próprio Dashboard** (não em Configurações — a etapa pediu para mexer só em CRM/painel): campo "meta de 1ª resposta em minutos" editável ali mesmo por `COMPANY_ADMIN`, usado para calcular "% dentro do prazo".
- **"Encerrar atendimento"**: a Etapa 3 já tinha o estado `ENCERRADO` e a função `closeConversation`, mas nenhuma tela chamava isso — sem conversa encerrada, a métrica "encerrados sem resposta" nunca teria dado pra testar. Foi adicionado um botão na tela de conversa (mudança pequena, dentro do já existente, não uma etapa nova).
- **Fórmulas do dashboard** (texto de ajuda também aparece em cada card na tela):
  - Novos contatos / Oportunidades / Agendamentos: contagem por `created_at`/`scheduled_at` dentro do período; Oportunidades e Agendamentos filtram por responsável quando um atendente é selecionado.
  - Vendas e receita: oportunidades cuja etapa é `is_won` e `closed_at` cai no período; receita = soma de `value_cents`.
  - Pendências (não filtram por período, são "agora"): clientes aguardando humano = conversas com episódio de espera aberto neste instante; maior espera atual = o mais antigo desses episódios.
  - Espera concluída no período: só o **primeiro** episódio de cada conversa (primeira resposta humana), encerrado por `RESPOSTA_HUMANA`, com `started_at` no período. Média/mediana em minutos **corridos** (não descontam fora do expediente — simplificação assumida e explicada no texto de ajuda; o detalhe por conversa, da Etapa 3, já mostra o tempo de expediente). "% dentro do prazo" = fração desses com duração ≤ meta de SLA. Filtro de atendente usa `ended_by_user_id`.
  - Encerrados sem resposta: conversas `ENCERRADO` no período sem nenhuma mensagem `HUMANO`+`ENVIADA`. Não filtra por atendente (não houve autor).
- **Filtro de período**: datas `de`/`até` (padrão: últimos 30 dias) convertidas para UTC no fuso da empresa via `localDayRangeToUtc` (novo helper em [src/businessHours.ts](src/businessHours.ts), reaproveitando a mesma técnica de conversão de fuso da Etapa 3 — sem biblioteca nova).
- **Modo de demonstração**: Dashboard mostra um banner "dados fictícios" quando `NODE_ENV !== production` (mesmo critério `IS_DEV` já usado para o simulador). Sem dado nenhum na empresa (fora do modo dev, ou banco realmente vazio), mostra estado vazio em vez da grade de métricas.
- **Sem gráficos/bibliotecas novas**: só números, rótulos e texto de ajuda, como pedido. Nenhuma dependência nova foi instalada nesta etapa.
- **Mobile**: `@media (max-width: 720px)` faz o menu lateral virar uma barra horizontal rolável no topo e empilha o conteúdo — testado via CSS, sem framework.

### O que foi implementado

- [src/crm.ts](src/crm.ts): etapas do funil (CRUD + proteção) e oportunidades (criar, mover com regra de perda, editar responsável/valor/agendamento).
- [src/dashboard.ts](src/dashboard.ts): `computeDashboard()` com todas as métricas pedidas + filtros.
- [src/views.ts](src/views.ts): `crmPage`, `crmStagesPage`, `dashboardPage` + estilos novos (cards de métrica, seções, formulário de filtro, responsivo).
- [src/server.ts](src/server.ts): rotas de CRM (`/crm`, `/crm/oportunidades*`, `/crm/etapas*`) e Dashboard (`/dashboard` com querystring `de`/`ate`/`atendente`, `/dashboard/meta-sla`); botão/rota "Encerrar atendimento" em Conversas.
- [src/models.ts](src/models.ts): `updateSlaTarget`, `listCompanyMembers` (para os seletores de responsável/atendente).
- [src/seed.ts](src/seed.ts): 1 oportunidade de demonstração por empresa.
- Testes automatizados novos: [src/crm.test.ts](src/crm.test.ts) (regra do motivo da perda, fechar/reabrir, proteção de etapas) e [src/dashboard.test.ts](src/dashboard.test.ts) (média/mediana/% dentro do prazo, filtro por atendente, pendências "agora" ignoram período, encerrados sem resposta). Total do projeto: 17 testes (`npm test`).

### Verificado

- `npm test`: 17/17 passando.
- Isolamento entre empresas (via curl): admin da Empresa A recebe 403 em `/empresa/2/crm` e `/empresa/2/dashboard`; tentar mover (POST) uma oportunidade da Empresa B usando o ID dela pela sessão da Empresa A é rejeitado (a checagem é por `company_id` na query, não só pela rota) e a oportunidade da B não é alterada.
- Fluxo do funil: mover para "Perdido" sem motivo → 400; com motivo → salva motivo e fecha; mover oportunidade para "Venda concluída" → aparece em "Vendas e receita" do dashboard com o valor certo.
- Permissão: atendente recebe 403 ao tentar salvar a meta de SLA; administrador consegue.

### Como testar

```bash
npm test
npm run db:seed
npm run dev
```

Login `admin@empresa-a.dev` / `trocar123` → CRM (funil com 1 oportunidade de demonstração; "Configurar etapas" para editar o funil) → Dashboard (filtros de período/atendente, banner de dados fictícios em dev).

### Pendências / próxima tarefa

- Métricas de tempo de resposta usam minutos corridos, não descontam fora do expediente (assumido e explicado na tela; o detalhe por conversa já mostra a versão com expediente).
- Filtro de período usa o dia de calendário no fuso da empresa, mas a hora exata de virada de dia em transições de horário de verão não é garantida (mesma limitação já documentada em `businessHours.ts`; irrelevante para o fuso padrão).
## Etapa concluída: Etapa 5 — Revisão do fluxo local completo

Sem ampliação de escopo. Revisão feita com banco zerado, roteiro de ponta a ponta via HTTP (~60 checagens) e reinício do servidor no meio. Roteiro para pessoa não técnica: [ROTEIRO_TESTE.md](ROTEIRO_TESTE.md).

### Problemas encontrados e corrigidos

1. **`/` mostrava a página placeholder da Etapa 0** em vez de mandar para o login: o `express.static` servia `public/index.html` antes da rota. Corrigido com `{ index: false }` e remoção do arquivo (a tela de login já mostra o nome do projeto). Era o primeiro obstáculo para um testador não técnico.
2. **Encerrar uma conversa com espera aberta deixava o episódio aberto para sempre** → "Aguardando humano" e "Maior espera atual" ficavam inflados no dashboard, e a tela da conversa mostrava "Aguardando agora" mesmo encerrada. Nova migração `0004_wait_ended_reason.sql` (recria `wait_episodes`, SQLite não altera `CHECK`) com o motivo `ENCERRADO_SEM_RESPOSTA`. Isso **não** conta como resposta humana (as métricas de 1ª resposta continuam só com `RESPOSTA_HUMANA`); reabrir a conversa com novo pedido cria episódio novo. Teste automatizado adicionado.
3. **Caixa de entrada não mostrava a espera** — o dashboard dizia "1 aguardando" enquanto a lista só mostrava o status "Em atendimento humano" (após assumir). Agora cada linha exibe "espera aberta há X", usando o mesmo dado do dashboard.
4. **Ordem da caixa de entrada não mudava com mensagens novas** (só com mudança de status). `addMessage` agora atualiza `updated_at` sempre.
5. **Média/mediana no dashboard arredondavam para "0m"** respostas abaixo de 1 minuto, enquanto o detalhe da conversa mostrava segundos. Passam a usar o mesmo `formatDuration` (ex.: "3s").
6. **Agendamento da oportunidade era interpretado no fuso do servidor** e o campo de edição mostrava o horário em UTC (digitava 14:30, reabria 17:30). Agora entrada e exibição usam o fuso da empresa (`zonedTimeToUtc`, já existente).
7. **Aviso de dados fictícios** só existia no Dashboard; agora é global (topo de todas as telas, fora de produção).

### O que foi validado (tudo OK)

- Login (senha errada → 401), `/` → `/login`, admin da plataforma só vê `/admin` (403 nas empresas).
- Isolamento: Empresa A recebe 403 em conversas/CRM/dashboard da B; conversa da B pelo id na rota da A → 404; B não consegue mover oportunidade da A; contatos da A invisíveis para B; filtro de atendente da B não vaza nada na A.
- Cadastro de contato + oportunidade com valor `350,00`, responsável e agendamento 14:30 (exibe e reedita 14:30).
- Pedido de humano: mensagem comum e negação ("não quero atendente") não iniciam; pedido por texto inicia; pedido repetido não cria segundo episódio.
- Robô, assumir e falha de envio não encerram; resposta humana encerra e muda para "Aguardando cliente".
- Persistência: após reiniciar o servidor, mensagens, falha registrada, oportunidade e cronômetro (lido do banco, bateu ao segundo) continuam; indicadores idênticos antes/depois. Sessão de login expira ao reiniciar (armazenada em memória — esperado nesta fase).
- Consistência dos indicadores: contatos 4 / oportunidades 2 / agendamentos 1 / aguardando 0 (após responder e encerrar) / encerrados sem resposta 1 / 100% no prazo — todos batendo com as ações feitas; "aguardando" do dashboard = quantidade de etiquetas "espera aberta" na caixa de entrada.
- `npm test`: 18/18.

### Estado atual — o que é simulado, o que funciona, o que falta

**Simulado (só existe em modo de demonstração, some com `NODE_ENV=production`):**
- Cliente enviando mensagem, robô respondendo, clique em "Falar com atendente", falha de envio — botões no painel amarelo.
- As duas empresas, os usuários e as conversas/oportunidades iniciais (seed).

**Funcionando de verdade (lógica real, não depende do simulador):**
- Login com senha, sessão, três perfis, isolamento por empresa no servidor e no banco.
- Caixa de entrada, assumir, responder, encerrar; estados do atendimento; autoria por mensagem.
- Medição da espera por humano com todas as regras do briefing, cronômetro persistido, tempo corrido × tempo de expediente, fuso e expediente por empresa.
- Detecção de pedido de atendente por texto, com negações (regras, sem IA).
- CRM: funil configurável, oportunidade separada de contato (responsável, valor, agendamento, motivo da perda).
- Dashboard com os nove indicadores, filtros por período/atendente, meta de SLA editável.

**Falta para uso real (fora do escopo atual, não iniciar sem instrução):**
- Conexão com WhatsApp real (API oficial ou robô externo) — a interface de integração ainda não foi desenhada; nada externo é chamado hoje.
- Cadastro de empresas e usuários pela interface (hoje só via seed); troca/recuperação de senha.
- Sessões persistentes (hoje em memória: reiniciar desloga todo mundo) e `SESSION_SECRET` real; HTTPS.
- Hospedagem e banco para acesso externo (migração SQLite → PostgreSQL prevista; decidir plano só na etapa de publicação, consultando preços/limites atuais).
- Painel da plataforma com saúde operacional (hoje só lista as empresas); Relatórios por período (tela ainda vazia).
- Autoria `AUTOMACAO` e "nota interna" existem no modelo mas sem tela.
- Notificações/alertas de espera longa; anexos/mídia nas mensagens.

### Como testar

Ver [ROTEIRO_TESTE.md](ROTEIRO_TESTE.md) (iniciar: `npm run dev`; encerrar: Ctrl + C).

## Etapa concluída (parcial): Etapa 6 — Integração oficial do WhatsApp (Cloud API)

Pesquisa oficial feita, parte independente de credenciais implementada e testada. **Pausado antes de conectar ao robô/atendimento atual do usuário**, aguardando resposta sobre qual plataforma ele usa hoje e onde os atendentes respondem (pergunta obrigatória feita na conversa, ver [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md) seção 5).

### Pesquisa (fontes e resumo completo em [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md))

- Uso da Cloud API é gratuito; cobrança é por mensagem de **template** enviada fora da janela de 24h (desde jul/2025, por mensagem — não mais "por conversa"); respostas dentro da janela de 24h são grátis. Preço varia por país/categoria e muda com o tempo — não fixar número no código nem prometer valor.
- Número de teste grátis, sem cartão, até 5 destinatários autorizados. Produção exige Business Verification (documentos, 2–10 dias úteis) e, para mensagens de template, cartão de crédito cadastrado na conta comercial — decisão que fica com o usuário, não foi e não será feita por mim.
- Webhook: handshake `GET` (`hub.mode`/`hub.verify_token`/`hub.challenge`), eventos por `POST` assinado (`X-Hub-Signature-256` = HMAC-SHA256 do corpo com o App Secret), reentrega por até 7 dias se não responder 200, limite de 3 MB.
- **Achado crítico**: a Cloud API não tem nenhum conceito nativo de "mensagem enviada por robô" vs "por humano", nem evento de "transferência" — isso só é confiável se o Hub Action for o único sistema que envia as respostas (bot e humano) pelo nosso servidor. Se o atendimento continuar saindo por outro canal (app comum, outra plataforma), não dá pra garantir essa métrica — por isso a pergunta ao usuário é bloqueante antes de qualquer "conexão com o robô" dele.
- Existe "Coexistência" (2025+): manter o app comum do WhatsApp Business funcionando junto com a Cloud API no mesmo número — geralmente via um parceiro/BSP, não direto com a Meta.

### O que foi implementado (credencial-independente para construir; testado com credenciais fictícias)

- `migrations/0005_whatsapp.sql`: tabela `whatsapp_connections` (mapeia `phone_number_id` → empresa) e `messages.external_id` (deduplicação, índice único parcial).
- [src/whatsapp.ts](src/whatsapp.ts): validação de assinatura (HMAC-SHA256 + comparação em tempo constante), leitura do payload oficial documentado (texto, botão/lista interativos, tipos não suportados viram aviso em vez de se perder), envio via Graph API (recusa com erro claro sem `WHATSAPP_ACCESS_TOKEN`).
- [src/server.ts](src/server.ts): rotas `GET`/`POST /webhooks/whatsapp` (recusa sem `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` configurados, valida assinatura antes de tudo, sempre reaproveita `addMessage` — mesma detecção de pedido de humano, mesmo cronômetro, zero lógica duplicada). Rota `/conversas/:id/responder` agora envia de verdade quando o canal da conversa é `WHATSAPP_OFICIAL` (o checkbox de simular falha só vale para `SIMULADO`).
- `src/attendance.ts`: `createConversation`/`addMessage` ganharam `channel`/`externalId`; novo `findOrCreateOpenConversation` (reaproveita conversa aberta do mesmo contato em vez de criar uma por mensagem).
- `src/conectar-whatsapp.ts`: script para associar um `phone_number_id` a uma empresa (linha de comando — ainda não tem tela).
- `src/env.ts`: carrega `.env` (API nativa do Node, `process.loadEnvFile`, sem dependência nova); `.env.example` documentado; `.env` já estava no `.gitignore`.
- Testes novos: [src/whatsapp.test.ts](src/whatsapp.test.ts) (assinatura, parsing do payload oficial, deduplicação por `external_id`, reaproveitamento de conversa aberta, recusa de envio sem credencial). Total do projeto: **25 testes** (`npm test`).

### Verificado

- `npm test`: 25/25.
- Ponta a ponta com servidor real rodando e credenciais fictícias: handshake do webhook (token certo → 200 com o challenge; errado → 403); `POST` sem assinatura → 403; assinatura errada → 403; payload assinado corretamente → 200, mensagem aparece na Caixa de Entrada certa (isolada por empresa), e o pedido de atendente no texto já disparou a espera pelo motor existente; reentrega do mesmo evento (`wamid` repetido) → 200 sem duplicar (checado direto no banco: 1 linha só); número não cadastrado em nenhuma empresa → 200 com aviso no log, nada quebra.
- `.env` carregado automaticamente pelo `npm run dev`/`db:seed` sem quebrar quando o arquivo não existe (comportamento padrão, sem WhatsApp configurado).
- Simulador continua isolado: rotas `/simular/*` e o checkbox de falha simulada não foram tocados; só passam a coexistir com o canal `WHATSAPP_OFICIAL`.

### Como testar (sem número real)

Ver seção 3 de [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md) — usa só o número de teste grátis da Meta, sem cartão de crédito.

### Resposta do usuário às perguntas obrigatórias (2026-09-10)

- **Plataforma do robô atual**: já existe um robô com opções de agendamento, cancelamento e "falar com atendente" — o usuário ainda não confirmou o nome da plataforma nem se ela usa a API oficial da Meta. Ele foi explícito: **"Não altere nem desconecte meu atendimento atual. Continue apenas nas partes que não dependem dessa informação."**
- **Onde os atendentes respondem hoje**: no próprio app do WhatsApp Business (o aplicativo comum, não a Cloud API).

### O que essa resposta muda na prática

- O número real da empresa está hoje no app comum do WhatsApp Business. Migrar esse número para a Cloud API normalmente **desativa o app comum** nesse número (a não ser via "Coexistência", que passa por um parceiro/BSP — não é algo que eu configure sozinho). Ou seja: **nenhuma ação de conectar o número real deve ser feita agora**, mesmo que as credenciais estivessem em mãos — falta identificar a plataforma do robô e decidir o procedimento com o usuário (checklist da seção 4 de CONEXAO_WHATSAPP.md).
- Não havia mais nada de credencial-independente para avançar na "conexão com o robô" específico dele — o webhook oficial genérico (que não depende de qual robô ele usa) já estava pronto antes da pergunta. Por isso a etapa fica pausada aqui, exatamente como instruído.

### Pendências / próxima tarefa

- **Bloqueado aguardando o usuário confirmar**: nome da plataforma do robô atual e se ela expõe alguma forma de identificar autoria/transferência (não presumir — só usar o que a documentação dela confirmar).
- Quando o usuário quiser testar de verdade, o caminho mais seguro é o **número de teste gratuito da Meta** (seção 3 de CONEXAO_WHATSAPP.md) — totalmente separado do número real, zero risco ao atendimento atual.
- Conectar o número real da empresa só depois do checklist da seção 4 de CONEXAO_WHATSAPP.md, com autorização explícita passo a passo — não fazer isso por iniciativa própria.
- Envio de mensagens de template (fora da janela de 24h) não implementado — tem custo por envio, decisão do usuário.
- Cadastro de `phone_number_id` só por linha de comando, sem tela.
- **Diagnóstico em aberto**: a 1ª tentativa de mandar "Quero falar com atendente" pelo celular para o número de teste não chegou ao servidor (nem log, nem banco). Pedi para o usuário confirmar se a mensagem apareceu como "entregue" (2 tracinhos) no celular antes de continuar — ele mudou de assunto para esta etapa antes de responder. Retomar esse diagnóstico quando ele quiser testar o número de teste de novo.

## Etapa concluída: Etapa 7 — Adaptação ao fluxo real do robô (menu 1/2/3 + frase de transferência)

Adaptação do rastreamento de espera já existente (Etapas 3–6) ao fluxo real do robô do usuário. Não foi uma reconstrução do CRM — só a lógica de detecção de gatilho, o schema de `wait_episodes`/`conversations` e o painel da conversa foram estendidos.

### Decisões desta etapa

- **Migração `0006_gatilho_transferencia.sql`**: `conversations.pending_context` (marca "menu ativo aguardando escolha"); `messages.delivery_status` (ENTREGUE/LIDA, distinto de `send_status` que já existia); `wait_episodes` recriada (SQLite não altera `CHECK`) com `trigger_type` (`OPCAO_3` | `BOTAO_PLATAFORMA` | `MENSAGEM_ROBO` | `EVENTO_PLATAFORMA` | `TEXTO_LIVRE` | `MODO_MANUAL`) e `trigger_evidence` (trecho da mensagem que disparou, até 300 caracteres).
- **"3" só conta com o menu ativo**: `pending_context = 'MENU_PRINCIPAL'` é setado quando o robô manda uma mensagem batendo com as 3 opções do menu (normalizado — tolera acento, maiúscula, pontuação, quebra de linha, espaço invisível). A próxima mensagem do cliente sempre consome esse contexto (seja "3" ou qualquer outra coisa) — é uma janela de uma mensagem só, como pedido.
- **Frase de transferência do robô**: comparação por normalização "compacta" (tira tudo que não é letra/número, ignora maiúscula/acento) contra a frase fixa, sem o trecho opcional "Atenção: pode demorar...". Só conta se a autoria da mensagem for `ROBO` ou `AUTOMACAO` — um `CLIENTE` mandando o mesmo texto é ignorado como gatilho (não confirma transferência), mesmo que contivesse "atendente" (que normalmente dispara o gatilho de texto livre já existente da Etapa 3) — regra escrita especificamente para não confundir citação com evidência.
- **Idempotência com correção de ordem**: `startWaitIfNeeded` agora recebe o tipo/evidência do gatilho. Se a espera já está aberta, só ignora — exceto se o novo evento tem horário **anterior** ao que abriu o episódio (entrega fora de ordem), caso em que ele "ganha" e vira o gatilho registrado. Cobre a regra "preserve o primeiro gatilho válido".
- **Botão de plataforma (gatilho B)**: campo `platformSignal: "BOTAO_PLATAFORMA"` no `addMessage`, setado pelo simulador e pelo webhook do WhatsApp quando o clique é numa resposta interativa (`interactive.button_reply`/`list_reply`) cujo título bate com o detector de pedido de atendente já existente.
- **Evento de plataforma (gatilho D)**: `platformSignal: "EVENTO_PLATAFORMA"` existe no schema e no `addMessage`, mas **nenhum fornecedor atual está ligado a isso** — é só a extensibilidade pedida, sem inventar endpoint nenhum.
- **"Diferencie enviada de entregue"**: `messages.delivery_status` é preenchido a partir do campo `statuses` do webhook da Meta (que antes era ignorado), casando pelo `wamid` (`external_id`). Para isso, o envio real (`/responder` em conversa `WHATSAPP_OFICIAL`) agora grava o `wamid` retornado pela Graph API na própria mensagem.
- **Atendente autenticado**: já existia (`author_user_id`), agora aparece no balão da conversa (nome do atendente) e no painel de espera ("Responsável").
- **Painel**: nova tabela de episódios por conversa — gatilho, confiabilidade (Confirmado para A/B/C/D e modo manual; Heurística para texto livre), início, horário da 1ª resposta humana (ou "Encerrado sem resposta"), duração. Mantém o resumo agregado (corrido × expediente) que já existia.
- **Simulador**: botões antigos genéricos trocados por "Robô envia o menu inicial" e "Robô envia aviso de transferência" (textos exatos do robô real do usuário), mais um campo de texto livre para o robô e o botão de "Falar com atendente" (agora marcado como `BOTAO_PLATAFORMA`). Nada de simulado mudou de comportamento — só passou a usar o vocabulário certo.

### Seção 4 do pedido — viabilidade com o robô atual (achados, sem presumir nada)

- **Recebemos mensagens do cliente?** Sim, via o webhook oficial já implementado (Etapa 6) — confirmado funcionando com payload real da Meta.
- **Recebemos as mensagens enviadas pelo robô?** Só se o robô também enviar pela Cloud API, pelo mesmo número e com o webhook apontando para o Hub Action. O webhook da Meta só entrega no campo `messages` as mensagens que o **cliente** manda; mensagens de saída (do robô ou de humano) não aparecem ali de jeito nenhum — só uma confirmação de entrega/leitura (`statuses`, sem o texto, sem indicar autoria) para quem enviou pela mesma integração.
- **Recebemos respostas humanas enviadas fora do CRM?** Não, hoje não — o usuário confirmou que os atendentes respondem pelo aplicativo comum do WhatsApp Business, que é um sistema separado da Cloud API (a não ser via "Coexistência", que não está configurada).
- **Conseguimos distinguir as origens?** Só para o que passa pelo nosso próprio servidor (`/responder` do CRM, autor sempre autenticado — 100% confiável). Para qualquer mensagem de saída que não passe por nós, não há como saber se foi robô ou humano.
- **Há eventos de menu/transferência da plataforma?** A detecção implementada aqui é por **conteúdo da mensagem** (menu e frase fixa), não por evento estruturado — funciona assim que a mensagem chegar até nós por algum canal. Nenhum fornecedor identificado hoje expõe um evento explícito de transferência.

**Conclusão prática**: no **número de teste** (onde só o Hub Action manda e recebe), a detecção funciona de ponta a ponta — confirmado com o robô simulado e testado via HTTP na aplicação real (não só em teste automatizado). No **atendimento real atual** (robô numa plataforma ainda não identificada + atendentes no app comum do WhatsApp Business), essas regras só vão valer de verdade quando: (a) o robô também enviar pela Cloud API pelo mesmo número monitorado, ou (b) a plataforma do robô tiver uma forma própria (webhook dela) de nos contar o que envia — o que exige saber qual é essa plataforma. Até lá, o código está pronto e testado, mas **não prometo que funcione no atendimento real sem essa confirmação**.

### Testado

- 13 testes novos em [src/robo-transferencia.test.ts](src/robo-transferencia.test.ts), cobrindo exatamente os 11 cenários pedidos na seção 6 + o exemplo de aceitação (qualitativo — os horários do enunciado são ilustrativos, o teste valida a cadeia de eventos e o episódio único). Total do projeto: **38 testes** (`npm test`).
- Verificado também na aplicação real rodando (não só teste automatizado): robô manda o menu → cliente manda "3" → painel mostra "Aguardando agora" com gatilho "Opção 3 do menu" / "Confirmado"; robô manda só a frase de transferência (sem menu) → inicia com gatilho "Aviso de transferência do robô"; atendente responde → painel mostra "Nenhuma espera em aberto" e a linha da 1ª resposta humana na tabela de episódios.
- `npx tsc --noEmit` sem erros.

### Como testar

```bash
npm test                    # 38 testes automatizados
npm run db:seed             # aplica a migração 0006 no banco de demonstração
npm run dev
```

Roteiro curto (via simulador, sem depender do robô real nem do número de teste):
1. Entre como `admin@empresa-a.dev` (senha `trocar123`) → Conversas → crie uma conversa de teste.
2. No painel amarelo, clique **"Robô envia o menu inicial"**.
3. No campo "Cliente envia", digite `3` e envie → o painel da direita deve mostrar **"Aguardando agora"** com gatilho **"Opção 3 do menu"**.
4. Clique **"Robô envia aviso de transferência"** de novo (repetido) → confira que o horário de início **não muda** (mesma linha na tabela de episódios).
5. Clique **"Assumir atendimento"** → espera continua aberta.
6. Responda no formulário "Responder como atendente" → painel mostra **"Nenhuma espera em aberto"**, e a tabela de episódios ganha o horário da 1ª resposta humana e a duração.
7. Em outra conversa nova, digite no campo "Cliente envia" o texto `3` **sem** clicar antes em "Robô envia o menu inicial" → não deve iniciar espera (confere a regra "não é qualquer 3").
8. Cole a frase "Por favor aguarde, estou chamando um atendente humano para te ajudar!!" no campo "Cliente envia" → também não deve iniciar (cliente copiando a frase do robô não comprova nada).

Testar com o número de teste da Meta continua disponível (CONEXAO_WHATSAPP.md), mas depende de resolver o diagnóstico em aberto acima primeiro.

### Pendências / próxima tarefa

- Retomar o diagnóstico do número de teste (mensagem real não chegou — ver acima).
- Plataforma do robô real ainda não identificada pelo usuário — sem isso, a conexão com o atendimento real não avança (ver seção 4 acima).
- `statuses` de mensagens `FALHOU` reportadas pela Meta (depois de aceitar o envio) só geram log — não reabrem a espera automaticamente; decisão consciente, não implementada por não ter sido pedida.
- Aguardando a próxima instrução do usuário. Não iniciar nada novo sem comando.

## Etapa concluída: Etapa 8 — Preparação do piloto externo (demonstração), pronta para revisão

**Nada publicado, nenhum serviço contratado, nenhum cartão ou credencial cadastrado.** Número comercial, recebimento/envio reais e integração com o robô continuam pendentes e estão declarados assim nas telas.

### Decisões

- **Tela "Conexão do WhatsApp"** (Configurações, só `COMPANY_ADMIN`): modo Demonstração/Teste/Produção (declarado por quem conecta via `conectar-whatsapp.ts teste|producao`, nunca adivinhado), número associado, credenciais só como "configurado/não configurado" (valor nunca aparece), última mensagem real recebida e última resposta real enviada (só contam mensagens com `wamid`), botão **"Verificar agora com a Meta"** (GET real na Graph API, resultado gravado em `whatsapp_connections.last_verified_*`), pendências em linguagem simples — incluindo, sempre, "integração com o robô/atendimento atual não comprovada" — e aviso de que a tela não corrige conflitos de cadastro na Meta. Status nunca vira "Conectado" só por campo preenchido (testado: 2 de 3 credenciais → "Configuração incompleta").
- **Cadastro por convite e recuperação de acesso sem e-mail** (`migrations/0008`, [src/access.ts](src/access.ts)): tokens aleatórios, guardados como SHA-256, uso único, validade (convite 7 dias, redefinição 2 h); o link aparece uma vez na tela para quem gerou entregar. Redefinir senha ou desativar usuário derruba as sessões da pessoa.
- **Painel da Hub Action** (`/admin`): criar empresa, plano manual (Demonstração/Piloto/Ativo + observações, **sem preço, sem cobrança**), suspender acesso (bloqueado no servidor em `requireCompanyAccess`), usuários por empresa (link de nova senha, ativar/desativar), convites, situação da conexão do WhatsApp por empresa, **log de auditoria** (`/admin/log`: login ok/falha, convites, redefinições, planos, ativação).
- **Equipe** (Configurações do admin da empresa): convites de atendente/administrador, link de nova senha, ativar/desativar — só usuários da própria empresa (testado: 403/"não pertence" para usuário de outra empresa).
- **Sessões no banco** ([src/sessionStore.ts](src/sessionStore.ts)) — a MemoryStore não serve para produção; reiniciar o servidor não desloga mais.
- **Guardas de produção**: com `NODE_ENV=production` exige `SESSION_SECRET` ≥ 32 caracteres (recusa iniciar), `trust proxy`, cookie `secure`, validade de 7 dias. `PUBLIC_BASE_URL` para montar os links.
- **Cronômetro robusto a atraso de entrega**: mensagens do webhook usam o timestamp que a Meta envia (`occurredAt`), não o horário de chegada — relevante se a hospedagem gratuita "dormir".
- **Mensagens simuladas identificadas**: etiqueta "simulada" na caixa de entrada e "conversa simulada — não é WhatsApp real" no detalhe, além do banner global.
- **Hospedagem** (pesquisa com fontes em [PUBLICACAO.md](PUBLICACAO.md)): opção principal **Render (app, gratuito, dorme após 15 min) + Neon (Postgres gratuito, permanente, uso comercial explícito)** — **pré-requisito não feito: migrar SQLite → PostgreSQL** (etapa própria). Alternativa mantendo SQLite: VM Oracle Always Free (termos ambíguos para SaaS comercial; aceitável para PoC). Impacto do gratuito no recebimento explicado (atraso de ~1 min ao acordar; nada se perde; métrica correta pelo timestamp da Meta).
- **Relatórios** (item de menu) continua vazio por design — o Dashboard já cobre funil e indicadores por período.

### Verificado

- `npm test`: **51/51** (novos: convite uso único e hash, expiração, redefinição derruba sessão, desativação, store de sessão com expiração, `occurredAt`, status da conexão em 6 cenários).
- Ponta a ponta com servidor real: Hub Action cria empresa → convite de administrador → cliente cria senha pelo link → cai só na própria empresa (403 na Empresa A e em `/admin`) → vê Equipe e Conexão do WhatsApp ("Modo demonstração") → convida atendente → atendente não vê área de admin → link de nova senha funciona, sessão antiga cai, senha nova entra → desativada não loga → empresa suspensa recebe 403 e volta ao reativar → painel mostra plano e conexão → log registra tudo → sessão sobrevive ao reinício do servidor. Atendente não vê a área de conexão; Empresa B não vê a conexão da A.
- Regressão: fluxo de demonstração (contatos, conversas, transferência, cronômetro, funil, dashboard) coberto pelos 38 testes anteriores, todos passando.

### O que depende de você antes de publicar (detalhado em PUBLICACAO.md)

1. Decidir hospedagem: Render+Neon (exige eu migrar o banco para Postgres primeiro) ou VM com SQLite.
2. Criar as contas nos serviços (sem cartão nos planos gratuitos citados) e definir `SESSION_SECRET`, `PUBLIC_BASE_URL` e, se for o caso, `NODE_ENV`.
3. Decidir se o piloto sobe com banner/simulador visíveis (recomendado para demonstração) ou com `NODE_ENV=production`.
4. Trocar a senha da Hub Action e **não** levar os usuários de demonstração `*@empresa-*.dev` para o piloto externo.

### Pendências reais

- Migração SQLite → PostgreSQL (necessária para a opção principal de hospedagem).
- Sem limite de tentativas de login, sem CSRF além de `sameSite=lax`, sem 2FA; credenciais do WhatsApp globais por instalação (um número real por servidor).
- Diagnóstico da mensagem real ao número de teste ainda em aberto; plataforma do robô ainda não identificada.
- Aguardando sua revisão e autorização para a próxima etapa (migração do banco e/ou publicação).

## Etapa concluída: Etapa 9 — Migração para PostgreSQL (Neon), SQLite mantido para desenvolvimento

Autorizada pelo usuário: Neon (gratuito) para o piloto, Render gratuito **só como demonstração externa** (adormece; não confiável para webhooks em tempo real). **Nenhuma conta foi criada, nada foi publicado, nada foi pago.** WhatsApp e robô seguem pendentes.

### Decisões

- **Uma camada, dois motores** ([src/db.ts](src/db.ts)): API assíncrona única (`get/all/run/exec/transaction`), escolhida por `DATABASE_URL` (Postgres via `pg`) ou `DATABASE_FILE` (SQLite via `better-sqlite3`). Nenhuma regra de negócio foi duplicada — só o adaptador e o DDL diferem por dialeto.
- **Diferenças de dialeto ficam no adaptador**: placeholders `?` → `$n` no Postgres; `COUNT/SUM` (bigint/numeric) convertidos para número; transações com `BEGIN/COMMIT/ROLLBACK` num cliente dedicado no Postgres; no SQLite as chamadas são síncronas (resolvem em microtask, então um bloco `transaction` não intercala com outras requisições).
- **SQL portável no código**: todo INSERT que precisa do id usa `RETURNING id` (funciona nos dois); timestamps ISO sempre gravados pela aplicação (removido todo `datetime('now')`, inclusive em `createCompany`, seed e convites); parâmetros nulos comparados com `CAST(? AS INTEGER) IS NULL` (o Postgres não infere o tipo de `? IS NULL`); `sessions.expires_at` é `BIGINT` no Postgres (milissegundos estouram INTEGER de 32 bits).
- **Migrações por dialeto**: as 8 migrações antigas foram movidas para `migrations/sqlite/` (mesmos nomes — o `_migrations` do banco de demonstração continua válido); `migrations/postgres/0001_baseline.sql` é o esquema completo equivalente. Regra registrada em INSTRUCOES_PROJETO.md: migração nova = arquivo nas duas pastas.
- **Tudo virou `async`** (attendance, crm, dashboard, models, auth, access, whatsapp, sessionStore, seed, conectar-whatsapp, server): handlers do Express são `async`; `runMigrations()` é aguardado antes do `listen`; erro não tratado numa rota vira 500 genérico sem stack trace (handler de erro adicionado).
- **Teste no motor real**: `npm run test:pg` sobe um PostgreSQL de verdade (binários oficiais via `embedded-postgres`, dependência só de desenvolvimento, sem instalar nada no sistema) e roda a mesma suíte; cada arquivo de teste usa um schema próprio (`TEST_SCHEMA=test_*`, recriado a cada execução — só schemas com prefixo `test_` podem ser apagados). `npm run dev:pg` sobe um Postgres local persistente para usar a aplicação contra ele.
- **Neon**: a string de conexão entra por `DATABASE_URL` (segredo, só no `.env`/hospedagem); `sslmode`/`channel_binding` da string são ignorados e o TLS é decidido por `DATABASE_SSL` (`require` por padrão fora de localhost, com verificação de certificado). Passo a passo para o usuário criar a conta e o banco em [PUBLICACAO.md](PUBLICACAO.md).
- O workflow de conversão em paralelo (subagentes) foi recusado pelo limite de sessão; a conversão foi feita diretamente, módulo a módulo, com `tsc` e testes a cada bloco.

### Verificado

- `npx tsc --noEmit` limpo.
- **SQLite: 58/58** (`npm test`). **PostgreSQL real local: 58/58** (`npm run test:pg`) — inclusive transações com rollback, `ON CONFLICT` do store de sessão, índice único parcial de `external_id`, `RETURNING id`, `SUM` como número, filtros com parâmetro nulo.
- Ponta a ponta no Postgres com a aplicação real: seed → login das três contas → isolamento (A não vê B, B não vê A, Hub Action não entra na empresa, conversa de A inacessível pelo id para B, oportunidade de A invisível para B) → fluxo do robô (menu + "3" → espera com gatilho OPCAO_3) → CRM → dashboard → **reinício só da aplicação** (sessão e dados preservados, indicadores idênticos) → **reinício da aplicação e do banco** (conversa, cronômetro e oportunidade continuam lá).
- Banco de demonstração SQLite existente continua migrando/semeando normalmente após mover as migrações de pasta.

### Conexão com a Neon — CONFIRMADA (2026-09-10)

O usuário criou a conta/projeto na Neon e salvou `DATABASE_URL` no `.env` local (nunca visto nem solicitado por mim — só confirmei a presença da variável, sem ler o valor). Testado a partir do computador dele:
- `npm run db:seed` aplicou `migrations/postgres/0001_baseline.sql` na Neon de verdade e criou os dados de demonstração.
- `npm run dev` sobe contra a Neon (`/health` → `"db":"postgres"`).
- Login das 3 contas, isolamento (A não vê B, Hub Action não entra na empresa) e dados do seed conferidos via HTTP — tudo OK.
- Reiniciar a aplicação preservou sessão e dados (o banco em si é remoto, então isso confirma a reconexão do pool a cada start).

### Depende de você (nada disso é feito por mim)

1. ~~Criar a conta/projeto na Neon e salvar `DATABASE_URL`~~ — feito e confirmado.
2. Confirmar quando quiser que eu prepare o Render (só demonstração; adormece — não confiável para webhooks reais).

### Pendências reais

- Render não configurado (aguardando confirmação). Número comercial, recebimento/envio reais e robô: pendentes.
- `embedded-postgres` é dependência de desenvolvimento (~binários do Postgres baixados no `npm install`); não vai para produção.

## Etapa concluída: Etapa 10 — Preparação do Render (segurança + arquivos), aguardando repositório remoto

Pedido pelo usuário: preparar o Render para demonstração externa, com checklist de segurança específico e sem publicar nada até confirmação. **Nada foi criado no Render, nenhum plano pago foi ativado, nada foi publicado.**

### Decisões e o que foi implementado

- **`IS_PRODUCTION` separado de `DEMO_MODE`** ([src/server.ts](src/server.ts), [src/views.ts](src/views.ts)): antes uma única flag (`IS_DEV`, derivada de `NODE_ENV`) controlava ao mesmo tempo a segurança e a visibilidade do banner/simulador — impossível ter as duas coisas religadas junto no piloto. Agora `IS_PRODUCTION = NODE_ENV === "production"` (segurança: exige `SESSION_SECRET` ≥ 32, `trust proxy`, cookie `secure`) e `DEMO_MODE` (banner e simulador, ligado por padrão, só desliga com `DEMO_MODE=false`) são independentes. O piloto no Render sobe com as duas ligadas ao mesmo tempo.
- **CSRF** ([src/csrf.ts](src/csrf.ts)): token por sessão (`crypto.randomBytes`), exigido em todo `POST`; injetado automaticamente em qualquer resposta HTML que contenha `<form method="post"` (um monkey-patch em `res.send`) — nenhuma das ~28 views precisou ser editada individualmente. Rota do webhook do WhatsApp isenta (não é formulário, é chamado pela Meta).
- **Limite de tentativas de login** ([src/loginThrottle.ts](src/loginThrottle.ts)): 5 tentativas erradas por `ip::email` em 15 min bloqueiam por 15 min, em memória (varredura periódica própria); bloqueio gera evento `login_bloqueado` no log de auditoria.
- **Seed com senhas seguras** ([src/seed.ts](src/seed.ts), reescrito): nunca apaga nem recria nada — só cria conta se o e-mail não existir; conta já existente não tem a senha tocada. No SQLite local a senha continua fixa (`trocar123`); no Postgres (potencialmente remoto/público) gera uma senha aleatória por conta, mostrada só uma vez no terminal, ou aceita ser escolhida por variável de ambiente (`PLATFORM_ADMIN_PASSWORD`, `DEMO_A_ADMIN_PASSWORD`, `DEMO_A_AGENT_PASSWORD`, `DEMO_B_ADMIN_PASSWORD`, `DEMO_B_AGENT_PASSWORD`). Guarda de bloqueio trocada de `NODE_ENV=production` para `DEMO_MODE=false` (coerente com a separação acima).
- **Higiene de dependências para o build do Render**: `better-sqlite3` movido de `dependencies` para `optionalDependencies` em [package.json](package.json) (só é usado quando não há `DATABASE_URL`; no Render nunca é `require`'d, e assim uma eventual falha de compilação do módulo nativo não derruba o `npm install`); `engines.node` fixado em `>=20.0.0`.
- **[render.yaml](render.yaml)** (novo, Blueprint do Render): `plan: free`, `buildCommand: npm install --include=dev && npm run build` (o `--include=dev` evita que `NODE_ENV=production` durante o `npm install` pule as `devDependencies`, onde está o `typescript` do build), `startCommand: npm start`, `healthCheckPath: /health`, variáveis incluindo `SESSION_SECRET` com `generateValue: true` (o Render gera sozinho, nunca digitado por ninguém) e `DATABASE_URL`/tipo `sync: false` (nunca gravada no arquivo, preenchida manualmente no painel).
- **Verificado: `.env` nunca foi commitado** — está no `.gitignore` desde o início; só `.env.example` (sem valores) está no repositório.

### Verificado

- `npx tsc --noEmit` limpo. `npm test` (SQLite): 58/58.
- CSRF e cookie seguro testados simulando exatamente as condições do Render: `NODE_ENV=production DEMO_MODE=true` + cabeçalho `X-Forwarded-Proto: https` (o `trust proxy` faz o Express reconhecer o HTTPS do proxy do Render) — formulário sem token ou com token errado é bloqueado (403); com token certo, passa; cookie sai `secure`.
- Rate limit de login testado: 5ª tentativa errada bloqueia por 15 min e gera `login_bloqueado` no log de auditoria; `clearLoginThrottle` libera no acerto.
- Seed testado no SQLite local (com `.env` temporariamente renomeado para garantir que não tocaria a Neon de verdade): conta nova mostra senha uma vez, conta existente não tem senha alterada, reexecução é segura.
- Build real (`npm run build && npm start`) exercitado contra a Neon depois da reorganização de dependências — sobe normalmente.
- `npm install` após mover `better-sqlite3` para `optionalDependencies`: `package-lock.json` regenerado, sem quebra.
- Confirmado com `git remote -v`: **não existe repositório remoto configurado** (só local, branch `master`, com commits).

### Repositório remoto — CRIADO e código enviado (2026-09-10)

O usuário criou o repositório **privado** [github.com/HUBACTIONWHATS/MARKETING](https://github.com/HUBACTIONWHATS/MARKETING). Antes do envio, foi feita uma auditoria completa do histórico do git (13 commits, todos os arquivos, não só o estado atual) com varredura por 4 ângulos independentes (nomes de arquivo suspeitos em todo o histórico; conteúdo de todos os commits por padrões de segredo; binários/bancos rastreados; documentação e testes por dados pessoais/credenciais reais), seguida de verificação independente dos únicos 2 achados brutos:

- `scripts/pg-local.ts`: usuário/senha fixos, mas só para um Postgres **local e efêmero** de teste (nunca um banco real) — não é vazamento.
- `src/seed.ts`: senha fixa `"trocar123"` usada **só** quando o banco é SQLite local; no Postgres/Neon o seed sempre gera senha aleatória por conta — não é vazamento.

**Resultado: nenhum vazamento real confirmado.** `.env` nunca foi commitado em nenhum momento do histórico; sem arquivos `.pem/.key/.db/.sqlite`; sem credenciais/tokens/strings de conexão reais; sem dados pessoais de cliente (só os fictícios de demonstração, já conhecidos e documentados).

`origin` configurado (`https://github.com/HUBACTIONWHATS/MARKETING.git`); repositório remoto confirmado vazio antes do envio (nada para preservar); autenticação via Gerenciador de Credenciais do Windows (login oficial do GitHub, sem senha/token na conversa). `git push -u origin master` confirmado com sucesso: HEAD local e remoto idênticos (`f24cd04...`), branch rastreando `origin/master`.

### Depende de você (próxima ação, uma de cada vez)

1. ~~Criar um repositório no GitHub~~ — feito, código enviado.
2. **Próxima ação — criar a conta no Render e conectar ao GitHub** (sem cartão, plano gratuito): entrar em https://render.com, criar conta (pode ser via login do GitHub), e autorizar o Render a acessar o repositório `HUBACTIONWHATS/MARKETING` quando pedido. **Ainda não clicar em "New Blueprint"/"Apply" nem criar o Web Service** — isso já cria o serviço e inicia a implantação, que é o passo de publicação em si, ainda pendente da sua confirmação final.

### Pendências reais

- Render: nenhuma conta/serviço criado ainda (ação acima). Publicação em si aguardando sua confirmação final, como pedido.
- Número comercial, recebimento/envio reais e robô: pendentes, como já declarado nas telas.

## Etapa 11 — Primeiro deploy no Render: erro ERESOLVE (não reproduzido) e lacuna de configuração encontrada

O usuário publicou o serviço no Render (fora do fluxo combinado de "uma ação por vez" — decisão dele, registrada aqui sem julgamento). O primeiro build falhou com `npm ERESOLVE: unable to resolve dependency tree`; um novo deploy, logo em seguida, teve sucesso ("Deploy succeeded"), sem que o log de erro completo chegasse a ser compartilhado.

### Investigação do ERESOLVE

Sem o log detalhado (o npm sempre imprime, junto da mensagem, o par exato de pacotes em conflito — não recebido), tentei reproduzir localmente por 5 caminhos diferentes, todos limpos, sem erro:

1. `npm ci` (instalação limpa a partir do lockfile).
2. `npm install --include=dev` (comando exato do `render.yaml`).
3. O mesmo, com `NODE_ENV=production` como variável de ambiente real (igual ao Render).
4. O mesmo, com `--strict-peer-deps` (força o npm a recusar qualquer conflito que normalmente resolveria sozinho).
5. O mesmo, usando `npm@10` (versão mais próxima da que hospedagens costumam usar por padrão) em vez do `npm@11` local.

Revisão manual de todas as `peerDependencies` na árvore de dependências: só `pg` → `pg-native` (opcional, `peerDependenciesMeta.optional: true`, uso normal e correto). Nada indicando conflito real.

**Conclusão**: sem o log exato, não há evidência de um conflito real no projeto para corrigir — `package.json` e `package-lock.json` não foram alterados (mudar às cegas arriscaria introduzir um problema nesses arquivos, não corrigir um). Mais provável: uma falha transitória do Render (cache de build, hiccup do registro do npm) que se resolveu num novo deploy — hipótese a confirmar com o usuário.

### Verificação do site publicado (leitura, sem alterar nada)

Acessei `https://hub-action-crm-demo.onrender.com` só para conferir (GET em `/health` e `/login`, sem enviar formulário nem tentar login):

- **Cookie de sessão em produção**: confirmado `HttpOnly; Secure; SameSite=Lax` nos cabeçalhos reais de resposta — a segurança de cookie está funcionando de verdade no Render, não só no teste simulado.
- **CSRF em produção**: confirmado — o token `_csrf` está sendo injetado no formulário de login ao vivo.
- **Lacuna crítica encontrada**: `/health` responde `{"status":"ok","db":"sqlite"}` — a variável `DATABASE_URL` **não foi configurada** no painel do Render. O app caiu no SQLite local por padrão (comportamento correto do código), mas o plano gratuito do Render **não tem disco persistente**: esse banco é apagado a cada reinício/novo deploy. Como o seed nunca roda sozinho (por decisão do usuário, ver Etapa 10), **não existe nenhuma conta para login nesse site enquanto essa variável não for configurada**.

### Pendências reais

- ~~Configurar `DATABASE_URL` no painel do Render~~ — feito pelo usuário; `/health` confirmado `{"status":"ok","db":"postgres"}` depois do redeploy.
- Nenhum arquivo de código foi alterado nesta etapa. Nenhum segredo, `.env` ou dado pessoal foi tocado (só leitura de cabeçalhos HTTP públicos do próprio serviço).
- **Aviso de segurança dado ao usuário**: a connection string da Neon (com a senha) foi colada em texto puro na conversa ao configurar a variável — recomendei resetar a senha no painel da Neon depois. Não vi nem gravei esse valor em nenhum arquivo.

## Etapa concluída: Etapa 12 — Área administrativa exclusiva "Conexões do WhatsApp"

Pedido pelo usuário: uma área só do administrador geral da Hub Action para cadastrar/gerenciar a conexão oficial de cada empresa cliente, com credenciais cifradas, isolamento entre empresas testado e nada publicado/ativado de verdade. **Nenhum número real foi ativado, nenhuma mensagem foi enviada pela Meta, nenhum plano pago foi ativado.**

### Arquitetura examinada antes de mudar código (pedido explícito)

Reaproveitada em vez de duplicada: a tabela `whatsapp_connections` (já existia, Etapa 5/7), `requirePlatformAdmin`/`requireCompanyAccess` ([src/auth.ts](src/auth.ts)), `audit()` e o padrão de token de uso único em SHA-256 ([src/access.ts](src/access.ts)), a camada de banco assíncrona por dialeto ([src/db.ts](src/db.ts)), o CSRF automático por `<form method="post"` ([src/csrf.ts](src/csrf.ts)) e o padrão de rate limit em memória de [src/loginThrottle.ts](src/loginThrottle.ts). Nenhuma segunda implementação da integração com a Meta foi criada — [src/whatsapp.ts](src/whatsapp.ts) continua sendo o único lugar com essa regra de negócio, só que agora com credencial por empresa em vez de global.

### Decisões

- **O que é global (servidor) vs. por empresa (banco), redefinido**: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API_VERSION` continuam variáveis de ambiente globais (um webhook só para todas as empresas). O Access Token, WABA ID e Phone Number ID saíram do `.env` e passaram a ser por empresa, cadastrados só pela tela `/admin/whatsapp` — mudança pedida explicitamente; não é mais possível ter um único `WHATSAPP_ACCESS_TOKEN` servindo várias empresas.
- **Criptografia** ([src/credentialCrypto.ts](src/credentialCrypto.ts)): AES-256-GCM só com o módulo nativo `crypto` (sem dependência nova, mesmo padrão já usado em csrf.ts/access.ts/whatsapp.ts). Chave `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, hex ou base64) só no servidor; formato gravado `iv:authTag:cifrado`, GCM detecta qualquer adulteração ou chave errada (nunca decifra "lixo" em silêncio).
- **Ciclo de vida com status explícito e armazenado** (`whatsapp_connections.status`: Pendente/Em validação/Conectado/Erro/Desativado — [migrations/sqlite/0009_whatsapp_admin_credenciais.sql](migrations/sqlite/0009_whatsapp_admin_credenciais.sql) e o equivalente em `migrations/postgres/0002_...sql`), sempre recalculado por `computeConnectionStatus` a partir de fatos reais — nunca setado à mão. "Conectado" exige `last_verified_ok=1` e `active=1` ao mesmo tempo; "Desativado" só sai da ação explícita `deactivateConnection` (nunca é efeito colateral de cadastrar ou trocar token, senão toda conexão nova apareceria como "desativada" em vez de "em validação" — bug pego e corrigido durante os testes desta etapa).
- **Validação real contra a Meta, numa única chamada**: `GET /{waba_id}/phone_numbers` (não `/{phone_number_id}` isolado) — confirma ao mesmo tempo que o token é válido, que o Phone Number ID pertence àquele WABA ID (compatibilidade, não só existência) e traz número formatado, nome verificado e qualidade confirmados pela Meta. Só dados confirmados são salvos.
- **"Ativar" é sempre uma ação separada e posterior ao teste**: `activateConnection` recusa (com mensagem clara) se `last_verified_ok !== 1`. "Substituir credencial" também desativa a conexão e invalida a última validação — o token novo ainda não foi testado, não pode continuar valendo para enviar mensagens reais até novo teste + ativação.
- **Nunca volta ao navegador**: `toAdminViewModel` remove `access_token_encrypted` de qualquer objeto entregue à view (testado); a tela só mostra um badge "configurado"/"não configurado" e um campo em branco para digitar um valor novo.
- **Rota de verificação do lado da empresa removida** ([src/server.ts](src/server.ts)/[src/views.ts](src/views.ts)): antes o administrador da empresa podia clicar em "Verificar agora" (Etapa 8) — pedido explícito desta etapa moveu essa capacidade para exclusiva do administrador geral. O administrador da empresa continua vendo status, número conectado e data da última validação (`whatsappConnectionPanel`, agora só leitura).
- **Envio de mensagem real usa o token da própria conexão**: a rota "Responder" de uma conversa `WHATSAPP_OFICIAL` decifra o token da empresa antes de chamar `sendWhatsAppMessage` — não existe mais um token global usado por todo mundo.
- **Assinar aplicativo no WABA**: ação separada e opcional (`POST /{waba_id}/subscribed_apps`), atrás de uma caixa de confirmação explícita + log de auditoria — nunca chamada automaticamente.
- **Rate limit** ([src/actionThrottle.ts](src/actionThrottle.ts), novo — generaliza o padrão de loginThrottle.ts): "Testar conexão" e "Assinar aplicativo" limitados por IP+empresa, evitando abuso da API externa.
- **Auditoria**: `whatsapp_credencial_cadastrada`, `whatsapp_credencial_substituida`, `whatsapp_conexao_testada`, `whatsapp_conexao_ativada`, `whatsapp_conexao_desativada`, `whatsapp_app_assinado_waba` — sempre com resultado, nunca com o segredo (testado).

### O que foi implementado

- [src/credentialCrypto.ts](src/credentialCrypto.ts) (novo), [src/actionThrottle.ts](src/actionThrottle.ts) (novo).
- [migrations/sqlite/0009_whatsapp_admin_credenciais.sql](migrations/sqlite/0009_whatsapp_admin_credenciais.sql) e [migrations/postgres/0002_whatsapp_admin_credenciais.sql](migrations/postgres/0002_whatsapp_admin_credenciais.sql): `access_token_encrypted`, `verified_name`, `quality_rating`, `status` na tabela já existente.
- [src/whatsapp.ts](src/whatsapp.ts): `computeConnectionStatus`, `createCompanyConnection`, `replaceConnectionToken`, `activateConnection`, `deactivateConnection`, `testCompanyConnection`, `subscribeAppToWaba`, `toAdminViewModel`, `findConnectionByCompanyId`; `verifyPhoneNumberConnection` e `sendWhatsAppMessage` passaram a receber o token do chamador em vez de ler variável global.
- [src/server.ts](src/server.ts): seção `/admin/whatsapp` (listar, cadastrar, testar, ativar, desativar, substituir token, assinar webhook — todas `requirePlatformAdmin` + auditadas); rota antiga de verificação do lado da empresa removida; rota de resposta decifra o token da conexão.
- [src/views.ts](src/views.ts): `whatsappAdminPage` (nova, painel por empresa com instruções de webhook + botão de copiar URL — primeiro uso de um `onclick` no projeto, só `navigator.clipboard`, sem biblioteca nova); `whatsappConnectionPanel` simplificado para só leitura; link "Conexões do WhatsApp" no painel da Hub Action.
- `.env.example`, [CONEXAO_WHATSAPP.md](CONEXAO_WHATSAPP.md), [src/conectar-whatsapp.ts](src/conectar-whatsapp.ts): documentação e mensagens atualizadas para o novo fluxo (CLI continua existindo só como atalho de desenvolvimento, sem token).

### Verificado

- `npx tsc --noEmit` limpo. `npm run build` gera `dist/server.js`.
- **`npm test` (SQLite): 78/78.** **`npm run test:pg` (Postgres real local): 78/78** — migração `0002_whatsapp_admin_credenciais.sql` aplicada e testada de verdade no motor Postgres.
- Testes cobrindo cada item pedido: permissão por perfil (`requirePlatformAdmin` bloqueia usuário comum, com um mock de req/res, sem servidor HTTP — mesmo padrão dos demais testes do projeto); isolamento entre empresas (testar/ativar/desativar/ler uma conexão nunca toca a de outra); criptografia (o valor gravado nunca contém o texto original, decifra com a chave certa, falha com a errada ou adulterado); ausência do token nas respostas (`toAdminViewModel`) e nos logs de auditoria (checado por substring); validação simulada da Graph API (sucesso e falha, com `fetch` trocado temporariamente só dentro do teste — sem biblioteca nova); WABA/Phone Number incompatíveis rejeitados; roteamento do webhook por `phone_number_id` (número desconhecido e desativado tratados igual); assinatura inválida rejeitada e evento duplicado ignorado (testes já existentes, confirmados continuam passando); persistência (leitura nova depois de gravar, sem cache em memória).
- **Verificação manual de ponta a ponta com servidor real** (SQLite local descartável, `.env` real temporariamente renomeado para garantir que nada tocaria a Neon): login como Hub Action → CSRF confirmado nos formulários novos → cadastrar conexão (token nunca aparece na resposta; gravado cifrado, confirmado direto no banco) → "Testar conexão" chamou a Graph API real da Meta com token inválido de propósito e recebeu "Invalid OAuth access token" de volta, tratado sem quebrar → "Ativar" recusado antes do teste ter sucesso → "Substituir credencial" funcionou e desativou a conexão → "Assinar aplicativo" recusado sem a caixa de confirmação → login como administrador da Empresa A confirmou 403 real em `/admin/whatsapp` e a tela de Configurações mostrando só status (sem botão de verificar, sem lista de credenciais) → handshake do webhook (`GET`) continua funcionando sem alteração.

### Depende de você (para usar de verdade)

1. Gerar e configurar `CREDENTIAL_ENCRYPTION_KEY` no `.env`/Render (comando pronto no `.env.example`) — sem ela a tela não cadastra nem lê nenhuma credencial.
2. Confirmar que `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` (já existiam) continuam configurados.
3. Cadastrar a conexão de cada empresa pela tela `/admin/whatsapp` quando tiver as credenciais reais — nada disso foi feito por mim.

### Pendências reais

- Envio de mensagens de template continua não implementado (mesma pendência de antes).
- Diagnóstico do número de teste e integração com o robô/atendimento externo continuam pendentes, como já declarado nas telas.

## Etapa concluída: Etapa 13 — Administrador geral separado + matriz de autorização testada

Pedido pelo usuário (que estava logado como `admin@empresa-a.dev` e recebeu corretamente 403 em `/admin/whatsapp`): confirmar o modelo de administrador geral já existente e criar um usuário separado para essa função, sem alterar `admin@empresa-a.dev`, a Empresa A, a Empresa B ou seus usuários.

### Análise (antes de mudar código)

O papel "Administrador geral da Hub Action" já existia desde a Etapa 2: coluna `is_platform_admin` em `users`, aplicado por `requirePlatformAdmin` ([src/auth.ts](src/auth.ts)) em `/admin` e, desde a Etapa 12, também em `/admin/whatsapp/*`. Nenhuma tabela, papel ou middleware novo foi criado — reaproveitado como pedido.

### O que foi feito

- **Área renomeada**: "Painel da Hub Action" → **"Administração Hub Action"** (título da página e cabeçalho, [src/views.ts](src/views.ts)/[src/server.ts](src/server.ts)) — mesma página, mesmas rotas, mesmas funcionalidades já existentes: administrar empresas, administrar usuários, ver situação dos planos, acessar Conexões do WhatsApp.
- **Novo administrador geral, separado do original**: criado direto no banco (script de uso único, apagado depois de rodar — não fica no repositório), com senha aleatória gerada e descartada na hora (só o hash bcrypt é gravado) e um link de definição de senha de uso único (2 horas), gerado pelo mesmo mecanismo `createPasswordReset` já usado pelo resto do sistema. `admin@hubaction.dev` (o administrador original) e `admin@empresa-a.dev`/Empresa A/Empresa B foram conferidos linha a linha no banco depois — intactos.
- **[src/auth.test.ts](src/auth.test.ts) (novo)**: matriz de autorização direto contra `requirePlatformAdmin` (a mesma função das rotas reais) — visitante (redireciona para `/login`), atendente (403), administrador de empresa com uma ou várias empresas (403), administrador geral (passa), usuário desativado/inexistente (tratados como sessão inválida).

### Verificado

- `npx tsc --noEmit` limpo, `npm run build` gera `dist/server.js`.
- **85/85 testes em SQLite e em Postgres real local** (`npm run test:pg`).
- Auditoria do diff e do commit antes do push: nenhuma senha, token, connection string ou chave encontrada (só o e-mail do novo administrador, que não é segredo).

### Pendências reais

- O e-mail do novo administrador geral e o procedimento de primeiro acesso foram informados só ao usuário, fora deste arquivo (não são segredo, mas não pertencem à documentação do projeto).
- Mesmas pendências de WhatsApp/robô de sempre — nada disso foi tocado nesta etapa.

## Etapa concluída: Etapa 14 — Domínio correto nos links absolutos + diagnóstico de login

Pedido pelo usuário: links de convite estavam sendo gerados com `https://hub-action-crm-demo-onrender.com` (hífen, `DNS_PROBE_FINISHED_NXDOMAIN`) em vez de `.onrender.com` (ponto); e um usuário real (`brunopregador1@gmail.com`, atendente da empresa "BRN BARBEARIA") não conseguia entrar mesmo após redefinir a senha.

### Domínio dos links (causa raiz e correção)

Não era um bug de lógica — todo link absoluto (convite, redefinição, instruções de webhook) já passava só pela função `publicBaseUrl()` ([src/server.ts](src/server.ts)), sem nenhuma segunda implementação. O problema: sem `PUBLIC_BASE_URL` definida, o código antes caía para `req.protocol`/`req.get("host")` (dependente de cabeçalho, sujeito a comportamento de proxy) — e o valor com hífen provavelmente veio de um `PUBLIC_BASE_URL` digitado errado no painel do Render em algum momento anterior.

- **`publicBaseUrl()` simplificada**: agora usa exclusivamente `process.env.PUBLIC_BASE_URL`, e se ausente, um domínio fixo de reserva (`FALLBACK_BASE_URL = "https://hub-action-crm-demo.onrender.com"`, com comentário de alerta contra o erro de digitação) — nunca mais deriva de cabeçalho de requisição. Removida a duplicação de lógica equivalente que existia só na tela de Conexões do WhatsApp (`renderWhatsappAdmin` agora chama `publicBaseUrl()` direto, sem parâmetro repetido).
- Testado localmente (SQLite descartável): convite gerado sem `PUBLIC_BASE_URL` → `https://hub-action-crm-demo.onrender.com/convite/{token}` (formato exato pedido); com `PUBLIC_BASE_URL` definida → essa variável prevalece, como já era o comportamento correto.
- `.env.example` e `PUBLICACAO.md` atualizados com o domínio certo e aviso explícito sobre o hífen.
- **Depende de você**: se `PUBLIC_BASE_URL` estiver definida no painel do Render com o valor errado, ela continua prevalecendo sobre a correção — confira/corrija lá (a correção no código só cobre o caso de estar ausente).

### Diagnóstico do login de `brunopregador1@gmail.com`

Investigação (só leitura, direto no banco de produção) mostrou a sequência real de eventos: convite aceito → conta criada (atendente da empresa "BRN BARBEARIA", `is_platform_admin=0`) → link de redefinição gerado e usado → senha trocada com sucesso → **login bem-sucedido** (`login_ok` registrado) → duas tentativas de login falhas alguns segundos depois. Ou seja: o fluxo (geração do link, validação do token, gravação da senha com hash bcrypt, busca por e-mail, comparação de hash, criação de sessão, redirecionamento por perfil) funcionou de ponta a ponta pelo menos uma vez — nada de errado foi encontrado na lógica. As duas falhas seguintes são consistentes com senha digitada errada numa tentativa posterior (não um bug reproduzível). Redirecionamento por perfil conferido no código: administrador geral vai para `/admin`; qualquer outro perfil vai direto para o painel da própria empresa (nunca `/admin`) — já era assim, sem alteração necessária.

Mesmo sem um bug confirmado, adicionado por pedido explícito: **log de diagnóstico seguro** no `/login` (`src/server.ts`) distinguindo usuário não encontrado, senha ausente, senha incorreta, usuário inativo, vínculo (empresa) inexistente e erro de sessão — só no console do servidor (Render → Logs), nunca na resposta ao navegador nem no log de auditoria visível na tela (que continuam genéricos, de propósito, para não revelar se um e-mail existe). Nunca registra a senha nem o hash.

Nenhum usuário foi criado, duplicado ou alterado; nenhuma empresa ou conversa foi tocada.

### Verificado

- `npx tsc --noEmit` limpo, `npm run build` gera `dist/server.js`.
- 85/85 testes em SQLite e em Postgres real local (`npm run test:pg`) — nenhuma regressão.
- Diff auditado antes do commit: nenhum segredo.

### Pendências reais

- Confirmar/corrigir o valor de `PUBLIC_BASE_URL` no painel do Render, se estiver definido com o hífen.
- Se `brunopregador1@gmail.com` continuar sem conseguir entrar, os logs novos (Render → Logs) já mostram o motivo exato na próxima tentativa.

## Etapa concluída: Etapa 15 — HUB ACTION Command Center + Growth Intelligence

Pedido pelo usuário (duas missões juntas): transformar o painel num Command Center analítico (CRM + WhatsApp + Meta Ads + Google Ads, somente leitura de mídia paga) e numa camada de inteligência (metas, projeção, gargalos, atenção, score de lead, SLA, atendentes, alertas, agência). **Nenhuma campanha pode ser criada/editada/pausada pelo sistema; nada foi enviado às plataformas; nenhuma credencial Meta/Google existe ainda — as integrações ficam aguardando credenciais, validadas só com simulação das APIs.**

### Auditoria inicial (antes de mudar código)

Reaproveitado: multiempresa por `company_id` + `requireCompanyAccess`; `requirePlatformAdmin`; `audit()`; `credentialCrypto` (AES-256-GCM); `actionThrottle`; CSRF automático; camada `db.ts` por dialeto; CRM (`contacts`, `conversations`, `opportunities` com `scheduled_at`, `pipeline_stages` com `is_won/is_lost`, `wait_episodes` — base do SLA); `dashboard.ts` (mantido intacto); WhatsApp (`whatsapp_connections`, webhook). Não existia: biblioteca de gráficos, UTM/atribuição, tabelas de mídia, jobs/cron/fila (Render gratuito não tem worker), lint (não há ESLint no projeto — a verificação estática é o `tsc --strict`).

### Banco (migrações incrementais, sem DROP)

`migrations/sqlite/0010_marketing_inteligencia.sql` / `migrations/postgres/0003_marketing_inteligencia.sql` (mesmo conteúdo, só o id muda): atribuição no contato (`source`, `attribution_confidence`, `attribution_provider`, `utm_*`, `fbclid/gclid/gbraid/wbraid/ctwa_clid`, ids externos de campanha/conjunto/anúncio, `referral_*`, `attributed_at`); `pipeline_stages.is_qualified/is_attended`; `opportunities.qualified_at/attended_at` (com backfill conservador); `memberships.can_view_marketing`; tabelas `marketing_connections`, `marketing_accounts`, `marketing_campaigns`, `marketing_ad_groups`, `marketing_ads`, `marketing_metrics_daily` (chave de idempotência `dimension_key + metric_date`, índices por empresa/data/campanha/conta/provedor), `marketing_sync_runs`, `oauth_states`, `company_goals`, `alert_rules`, `alerts`, `conversion_feedback_settings`, `conversion_feedback_events`. Aplicada e testada no SQLite e no Postgres real local.

### Módulos novos

- [src/attribution.ts](src/attribution.ts): classificação determinística (CONFIRMADA por id oficial; PROVÁVEL por UTM/declaração; NÃO ATRIBUÍDA sem evidência), `parseWhatsAppReferral` (anúncio Clique-para-WhatsApp → atribuição confirmada no webhook), primeiro toque vence.
- [src/marketingOAuth.ts](src/marketingOAuth.ts): state anti-CSRF de uso único (15 min), PKCE S256 no Google, redirect URI só do servidor, escopos mínimos (`ads_read,read_insights`; `adwords`).
- [src/marketingProviders.ts](src/marketingProviders.ts): clientes SOMENTE LEITURA (Meta: OAuth + token longo, `me/adaccounts`, campanhas/conjuntos/anúncios, insights diários; Google Ads API v25: OAuth + refresh, `listAccessibleCustomers`, GAQL via `searchStream` para customer/campanhas/grupos/métricas diárias; developer token opcional e ignorado desde 09/09/2026). Erros classificados (AUTH_EXPIRED/PERMISSION/RATE_LIMIT/NETWORK) e sanitizados (nunca token). Sem nenhum método de mutação.
- [src/marketingModels.ts](src/marketingModels.ts): conexões (tokens cifrados, view sem token), contas (vínculo a UMA empresa, propagação de `company_id`), campanhas/grupos/anúncios, métricas diárias (upsert idempotente), execuções de sync, frescor dos dados.
- [src/marketingSync.ts](src/marketingSync.ts): sincronização incremental (1ª: 90 dias; depois: 7 dias revisáveis), idempotente, com registro e auditoria; renovação do token Google; agendador em processo (`MARKETING_SYNC_INTERVAL_MINUTES`) com a limitação do plano gratuito documentada e mostrada no painel.
- [src/bi.ts](src/bi.ts): períodos e comparação (hoje/7/14/30/mês atual x mesmo trecho do mês anterior/mês passado/personalizado), filtros globais (canal, campanha, atendente, etapa), fatos do CRM + métricas diárias agregados em memória (volume pequeno por empresa), fórmulas com divisão segura, séries diárias, por campanha/canal/provedor/atendente, matriz atendente x origem, SLA (média/mediana/P90/buckets, relação tempo x conversão só com n ≥ 10), moedas diferentes sinalizadas e nunca somadas.
- [src/insights.ts](src/insights.ts): metas + projeção linear transparente, funil executivo, detector de gargalos ("possível gargalo", amostra mínima), "precisa de atenção" (fato vs recomendação, limiares configuráveis), custo x qualidade, score de lead determinístico (regras no código), leads quentes, oportunidades paradas, saúde 0–100 com componentes/pesos explicados e semáforo (CINZA sem dado), resumo executivo por regras.
- [src/alerts.ts](src/alerts.ts): regras globais/por empresa, ocorrências com dedupe por dia, status (aberto/em análise/resolvido/ignorado), responsável.
- [src/conversionFeedback.ts](src/conversionFeedback.ts): fila de eventos reais do CRM (Lead/QualifiedLead/AppointmentScheduled/AppointmentAttended/Purchase) idempotente, por provedor atribuído, `DESATIVADO` até ativação explícita; **sender não implementado de propósito** (pendência: Meta CAPI / conversões importadas do Google, a implementar com a documentação atual quando houver credencial).
- [src/charts.ts](src/charts.ts): gráficos SVG server-side (linha com eixo secundário explícito, barras, funil com conversão/perda/custo acumulado, sparkline, bolhas CPL x fechamento) — sem biblioteca, sem JS, tooltips nativos, estado vazio.
- [src/viewsMarketing.ts](src/viewsMarketing.ts) e [src/viewsAdminMarketing.ts](src/viewsAdminMarketing.ts): todas as telas novas. [src/views.ts](src/views.ts): design system evoluído (tokens, grid 12, cards executivos com delta/seta/sparkline/tooltip, tabela com cabeçalho fixo, chips, abas, filtros, semáforo), menu "Performance" (Marketing/Inteligência/Alertas) para administrador da empresa ou atendente com capability, CRM com marcadores de etapa (qualificado/comparecimento), campo "Compareceu em", origem do contato com confiança e "Declarar origem".

### Rotas

Empresa: `/empresa/:id/marketing` (visão geral, gráfico com 2 métricas selecionáveis e eixo secundário, funil, Meta x Google, custo de aquisição, campanhas, atenção, última sincronização, "Atualizar agora" limitado), `/marketing/campanhas` (tabela master ordenável + bolhas custo x qualidade), `/marketing/campanhas/:id` (detalhe com hierarquia Meta campanha→conjunto→anúncio ou Google campanha→grupo, plataforma x CRM lado a lado), `/marketing/meta`, `/marketing/google`, `/marketing/funil` (gargalos + canais), `/marketing/relatorios` (resumo executivo + mudanças vs período anterior + destaques), `/inteligencia` (central de performance completa) e `/inteligencia/metas`, `/alertas` e `/alertas/:id/status`, CRM: `/crm/etapas/:id/marcadores`, `/crm/contatos/:id/origem`. Admin: `/admin/integracoes` (+ `meta|google/conectar`, `meta|google/callback`, `conexoes/:id/descobrir|revogar`, `contas/:id/vincular|desvincular|sincronizar`, `sincronizar-tudo`), `/admin/marketing` (agregado por moeda, ranking, alertas abertos, regras, sincronizações) + `/admin/alertas/regras`, `/admin/agencia` (carteira com semáforo, ordenações) + `/admin/agencia/empresa/:id`.

### Segurança e isolamento

Tokens OAuth cifrados com `CREDENTIAL_ENCRYPTION_KEY`, nunca devolvidos a views (`toConnectionView`), nunca em logs (sanitização de padrões `EAA…`, `ya29…`, `access_token=`); OAuth state de uso único ligado ao usuário que iniciou; PKCE no Google; redirect URI só do servidor; `company_id` nunca vem do navegador como prova (sempre `requireCompanyAccess`/`requirePlatformAdmin`); conta pertence a uma empresa e `company_id` é propagado a campanhas/métricas; atendente sem capability recebe 403; administrador da empresa não acessa `/admin/*`; rate limit em descobrir/sincronizar/atualizar; auditoria de OAuth iniciado/concluído/falhou, contas descobertas, vínculo/reatribuição/desvínculo, sync manual/auto/falha, revogação, metas, regras, feedback.

### Verificado

- `npx tsc --noEmit` limpo · `npm run build` gera `dist/server.js`.
- **117/117 testes em SQLite e 117/117 em Postgres real local** — novos: [src/attribution.test.ts](src/attribution.test.ts), [src/bi.test.ts](src/bi.test.ts), [src/marketing.test.ts](src/marketing.test.ts) cobrindo isolamento Meta/Google entre empresas, OAuth state/callback inválido, token cifrado e nunca retornado, conta vinculada à empresa certa e campanha à conta certa, sincronização idempotente (Meta e Google com API falsa), erro de API/rate limit/token expirado/renovação/reconexão, métricas diárias, CPL/CAC/ROAS/divisão por zero, filtro de período e comparação, campanha sem dados, empresa sem integração, moedas diferentes, fuso horário, atribuição confirmada/provável/desconhecida, metas/projeção, gargalos, atenção/alertas com dedupe e limiares, custo x qualidade, score de lead/quentes/paradas, saúde/semáforo, marcos do funil no CRM, feedback de conversão idempotente e desativado.
- Smoke test com servidor real e dados de demonstração (SQLite descartável, `.env` fora do caminho): admin da empresa vê `/marketing` (visão geral, campanhas, detalhe, meta, google, funil, resultados), `/inteligencia` (salva metas) e `/alertas`; atendente sem capability recebe 403 em `/marketing` e `/inteligencia`; admin da empresa A recebe 403 na empresa B e em `/admin/*`; administrador geral vê `/admin/integracoes`, `/admin/marketing`, `/admin/agencia` e recebe 403 nas telas operacionais da empresa; "Conectar Meta" sem credenciais mostra o que falta; callback com state falso é rejeitado; o token fictício nunca aparece no HTML; nenhum erro no log do servidor. Conferência visual das telas (cards, gráfico com eixo secundário, funil, comparativo, tabela, atenção, central de performance, integrações, agência, marketing agregado) feita no navegador — um defeito encontrado e corrigido: funil com etapa maior que a anterior mostrava "15200%"/"−15100% perdidos"; agora mostra "—" quando as etapas não são aninhadas.
- **Incidente registrado (transparência)**: ao subir o servidor de conferência visual, restaurei o `.env` cedo demais e ele conectou na Neon por alguns segundos (`db: postgres`), aplicando a migration `0003_marketing_inteligencia.sql` em produção antes do deploy. Efeito: só a migration (aditiva, a mesma que o próximo deploy aplicaria); conferido em seguida, só leitura: contagens de empresas/usuários/contatos/oportunidades intactas, zero linhas de marketing/alertas/oauth criadas, agendador desligado (`MARKETING_SYNC_INTERVAL_MINUTES=0`). Servidor derrubado e refeito no SQLite. Lição gravada na memória do assistente: manter `.env` renomeado durante toda a vida de um servidor local.

### Pendências (dependem de fora)

- Credenciais `META_APP_ID/SECRET` (app da Meta com `ads_read` — revisão da Meta para uso por terceiros), `GOOGLE_CLIENT_ID/SECRET` (projeto Google Cloud com Google Ads API + acesso Basic aprovado), URIs de callback cadastradas nos dois painéis.
- Nenhuma conexão real Meta/Google foi testada (não há credencial) — só simulação.
- Sender do feedback de conversão (Meta CAPI / Google offline conversions): arquitetura pronta, envio não implementado.
- Sincronização contínua exige plano pago no Render (instância não pode dormir).
- Sem lint configurado no projeto (só `tsc --strict`).

## Etapa concluída: Etapa 16 — Front-end visual V2 (sem mudar o funcionamento)

Pedido: evolução visual profunda do painel ao nível de SaaS premium, com a regra de ouro **não alterar o funcionamento** (backend, rotas, permissões, filtros, cálculos, dados). Restrições adicionais do usuário, respeitadas: `server.ts` intocado; nenhuma funcionalidade, botão, página, filtro ou permissão nova; `charts.ts` alterado por edições localizadas (mesmos exports, assinaturas e dados); arquitetura mantida (HTML server-side + CSS + TypeScript + SVG manual); sem "efeito de IA" (sem glow, vidro, gradientes fortes, sombras grandes).

### Auditoria visual (antes de mudar)

Sem biblioteca de gráficos nem JS no navegador (gráficos SVG em [src/charts.ts](src/charts.ts)); todo o CSS vivia num único bloco `BASE_STYLE` em [src/views.ts](src/views.ts) misturando `rem` sem escala, cores repetidas em hexadecimal, cards iguais para tudo, tabelas sem hierarquia, sidebar só texto, gráfico "linha dentro de um card" (polyline reta, grid sólido, `<title>` como único tooltip, texto do gráfico de barras minúsculo em meia coluna), funil com colunas fixas que sobrepunham texto em telas ≤ 1366 px, sem `focus-visible`, sem `prefers-reduced-motion`.

### O que mudou (só camada visual)

- **Design system** (`BASE_STYLE`): tokens `--bg-primary/--bg-secondary/--surface/--surface-hover/--border/--text-primary/--text-secondary/--text-muted/--accent/--success/--warning/--danger/--meta/--google`, `--radius-sm/md/lg`, escala de espaçamento 4/8/12/16/20/24/32, tipografia 11/12/13/14/20/26 com números tabulares; aliases dos nomes antigos mantidos; **nenhuma classe existente foi removida** (inventário conferido).
- **Shell**: sidebar com grupos "Operação"/"Performance", ícones SVG lineares (16 px, mesmo traço), item ativo discreto com barra lateral, `aria-current`; topbar fixa; botão "Sair" secundário.
- **Dashboard operacional**: cabeçalho com eyebrow/título/período, filtros em barra, seções com título-régua, cards de métrica com rótulo em caixa alta + tooltip explicativo (`.tip`) + valor 27 px + legenda completa, meta de SLA em card próprio. Mesmos números, mesmos filtros, mesmo formulário.
- **KPIs do Command Center**: seta em "chip", variação e "vs período anterior" em hierarquia própria, sparkline suave com área sutil; cards secundários mais compactos. Só usa `current/previous/spark` que já existiam.
- **Gráficos** ([src/charts.ts](src/charts.ts), API idêntica): curva monotone cúbica (passa exatamente pelos pontos, sem inventar valores), área com gradiente muito sutil só na série principal, grid tracejado discreto com linha-base sólida, eixo secundário identificado pela cor, rótulos do eixo X sem sobreposição no fim, pontos com halo, **tooltip visual em SVG** mostrado por CSS no hover (`.pt:hover .ttp`) com título DATA + linhas "métrica … valor" alinhadas, fundo sólido, borda discreta, sombra leve, sempre dentro do gráfico — os `<title>` nativos continuam (acessibilidade); barras arredondadas com trilha e hover; funil com trilha, conversão/acumulada/perda em coluna própria (não quebra mais em coluna estreita); bolhas com folga de eixo para não cortar a maior bolha; estado vazio com ícone.
- **Gráfico principal**: cabeçalho próprio (título, subtítulo com período e métricas comparadas), o mesmo formulário de seleção de métricas e altura 300.
- **Tabelas**: cabeçalho fixo em caixa alta, zebra por hover, números tabulares alinhados à direita, `hours-table` alinhada ao mesmo padrão. **Formulários**: inputs/selects com foco visível, seta própria no select, botões com estados.
- **Badges/chips/severidade/semáforo** com fundo suave por significado (verde/âmbar/vermelho/azul, Meta violeta, Google laranja).
- **Responsividade**: desktop primeiro (1920/1440/1366/1280 sem cards gigantes); ≤ 960 px → 2 colunas e blocos empilhados; ≤ 720 px → sidebar horizontal; ≤ 480 px → 1 coluna.
- **Acessibilidade/microinterações**: `focus-visible` em tudo, `prefers-reduced-motion`, transições de 140 ms só em cor/borda, tooltips também no foco do teclado.

### Verificado

- `npx tsc --noEmit` limpo · `npm run build` ok · **117/117 testes em SQLite e 117/117 em Postgres local**.
- Servidor descartável em SQLite (`.env` renomeado durante toda a vida do processo, `/health` = `sqlite`) com dados de demonstração: capturas em **1440 px e 1280 px** (Chrome headless) de login, dashboard, visão geral, campanhas, funil, resultados, inteligência, alertas, conversas, detalhe da conversa, CRM, configurações, relatórios e toda a área `/admin/*`; tooltip de hover dos gráficos implementado só com CSS (`.pt:hover .ttp`) e conferido no DOM (regra presente, grupos `.pt` com tooltip gerados para cada ponto); o navegador embutido do app não renderizou o estado de hover de forma confiável, então a conferência visual do tooltip fica a cargo do teste manual no deploy. Três defeitos visuais encontrados e corrigidos: funil sobrepondo texto em coluna estreita, rótulos "12/09 13/09" colados no eixo X, bolha/rótulo cortados na borda do gráfico de qualidade.
- Sem mudanças em `server.ts`, banco, migrações, rotas, autenticação, permissões, cálculos ou textos de dados; `git diff` limitado a `src/views.ts`, `src/charts.ts`, `src/viewsMarketing.ts` e este arquivo.

## Etapa concluída: Etapa 17 — Gráficos premium (colunas, funil, gauge) no mesmo design system

Pedido: elevar o gráfico de barras, o funil e o gauge semicircular ao nível de dashboard SaaS premium, com consistência entre os três, **sem mudar dados, cálculos, rotas, integrações ou lógica**. O usuário enviou a logo da Hub Action (H inclinado azul + seta laranja, "Marketing que gera crescimento.").

### O que mudou (só apresentação)

- **Colunas por canal** ([src/charts.ts](src/charts.ts) `barChart`, mesma assinatura + `valueLabel?` opcional): colunas verticais finas (máx. 40 unidades) com topo arredondado (4 px) e base reta numa única linha-base, valor sobre a coluna e categoria embaixo, grid em linhas finas sólidas, eixo leve, cor da coluna = identidade do canal (Meta violeta, Google laranja, demais cinza), hover realça a coluna e mostra o balão premium (categoria em caixa alta, "Leads … 150" e as demais linhas do texto de tooltip já existente). Margem esquerda maior para rótulos monetários.
- **Funil** (`funnelChart`, mesma assinatura): blocos centralizados numa trilha, rótulo + valor + custo à esquerda, conversão da etapa / acumulada / perda à direita, tom da barra escurece etapa a etapa (uma cor, escala ordinal), links das etapas preservados (a linha inteira é o `<a>`), balão HTML premium no hover/foco (etapa, quantidade, conversão, acumulada, perda, custo). **Largura em escala logarítmica**, declarada em nota no próprio componente: do anúncio à venda os volumes vão de centenas de milhares a unidades e, em escala linear, tudo abaixo do topo virava um risco ilegível. Números, taxas e perdas exibidos são exatamente os de antes.
- **Gauge** (`gaugeChart`, função nova; usada na "Saúde do marketing" da Central de Performance): arco semicircular com trilha, preenchimento na cor do estado, faixas discretas por fora com os limiares reais (40 e 70, agora nomeados como `HEALTH_THRESHOLDS` em [src/insights.ts](src/insights.ts) — mesmos valores, usados no cálculo e no desenho), valor 40 px no centro, "de 100", chip de estado, legenda das faixas, balão no hover; sem dado → "—" e cinza.
- **Consistência**: mesmo balão (fundo sólido `#0b1220`, borda `#334155`, raio 7, sombra leve, título em caixa alta, valor à direita em negrito com chave de linha na cor da série) em linha, colunas, bolhas, gauge e funil; grid sólido (sem tracejado) em todos; rótulos de eixo sempre em tom de texto (nunca na cor da série); cabeçalho de gráfico padronizado (`chartHead`: título 15 px + subtítulo) nos cards de funil, canais, performance e saúde.
- **Marca**: marca inspirada na logo (SVG plano, sem brilho) na sidebar e na tela de login com o slogan.

### Verificado

- `npx tsc --noEmit` limpo · `npm run build` ok · **117/117 testes em SQLite e 117/117 em Postgres local**.
- Capturas (Chrome headless, 1440/1280 px, servidor SQLite descartável com `.env` renomeado): funil executivo, canais, visão geral, campanha, Central de Performance, login. Ajustes feitos após a primeira captura: escala logarítmica do funil (a linear degenerava) e margem do eixo das colunas (rótulo "R$ 1.000,00" cortado).
- Revisão adversarial por agentes independentes (comportamento, visual, CSS/acessibilidade, robustez, aderência ao briefing) executada em paralelo; achados confirmados entram como ajustes na sequência.
- Sem alterações em `server.ts`, rotas, permissões, banco, integrações ou cálculos; nenhuma variável de ambiente nova. Deploy: só "Manual Deploy → Deploy latest commit" no Render.

## Etapa concluída: Etapa 18 — Central de Marketing da empresa (Meta Ads + Google Ads sempre visíveis)

Pedido: dentro do painel de uma empresa (ex.: BRN BARBEARIA) não aparecia Marketing, Meta Ads, Google Ads, campanhas, CPL/CAC/ROAS — o menu só tinha Dashboard/Conversas/CRM/Relatórios/Configurações e a topbar mostrava "admin.geral@hubaction.dev · Atendente". Integrações, OAuth, tokens, WhatsApp e dados NÃO foram tocados; Meta/Google continuam 100% somente leitura.

### Causa (auditada antes de codar)

1. **Marketing não aparecia**: o menu só recebia `canViewMarketing` em 4 rotas (marketing/inteligência/alertas/páginas vazias); em Dashboard, Conversas, CRM, Configurações o `appShell` caía no fallback "só administrador da empresa vê", e o grupo tinha só Marketing/Inteligência/Alertas — não existiam itens Meta Ads/Google Ads.
2. **Meta/Google não apareciam**: as páginas `/marketing/meta` e `/marketing/google` existiam apenas como abas internas da área de marketing, que o usuário nem alcançava.
3. **Permissão que impedia**: `requireMarketingAccess` e `canViewMarketing` (server.ts) olhavam SÓ o vínculo (`memberships.role`/`can_view_marketing`). O administrador geral (`users.is_platform_admin = 1`) estava vinculado à BRN como **Atendente** → 403 + sem menu. `requireCompanyAccess` também exige vínculo para qualquer um, e a rota genérica `/empresa/:id/:page` checava o vínculo antes de deixar `/marketing` passar.

### O que mudou

- [src/auth.ts](src/auth.ts): `marketingAccessAllowed(user, membership)` (regra única: administrador geral sempre — mesmo sem vínculo ou vinculado como atendente; administrador da empresa; atendente só com `can_view_marketing = 1`; atendente comum nunca ganha privilégio geral), `requireMarketingAccess` (agora aqui, sem depender do vínculo para o administrador geral; empresa suspensa continua bloqueando quem depende do vínculo), `effectiveRole`/`isCompanyAdmin` (edições de metas/atualizar continuam só para o administrador da empresa).
- [src/shellContext.ts](src/shellContext.ts) (novo) + middleware `app.use("/empresa/:companyId")` em [src/server.ts](src/server.ts): contexto do menu por requisição (AsyncLocalStorage) com `canViewMarketing`, `isPlatformAdmin` e o estado de cada provedor calculado a partir de `marketing_accounts.company_id` (nunca da sessão OAuth global). Não autoriza nada — só alimenta o menu em TODAS as páginas da empresa. Rota genérica `/empresa/:id/:page` deixa páginas desconhecidas seguirem antes de checar vínculo.
- [src/views.ts](src/views.ts): menu **OPERAÇÃO** (Dashboard, Conversas, CRM) · **MARKETING** (Visão Geral, Meta Ads ●/○, Google Ads ●/○, Campanhas, Funil & Conversão, Inteligência, Alertas) · **GESTÃO** (Relatórios, Configurações); ponto de status por provedor (conectado / não conectado / reconexão); rótulo "Administrador geral (Hub Action)" na topbar; CSS dos blocos novos.
- [src/bi.ts](src/bi.ts): `dailyByProvider` (Meta x Google por dia, mesmos filtros), `platformConversionRate` e `costPerPlatformConversion` (definições do provedor, ex.: Google). [src/insights.ts](src/insights.ts): `AttentionItem.channel` (META/GOOGLE/MIDIA/CRM/INTEGRACAO), fato informativo "X não conectado", `channelCostQuality` (lead/cliente mais barato e qualidade por canal, com a leitura "CPL maior mas CAC menor").
- [src/viewsMarketing.ts](src/viewsMarketing.ts): **Central de Marketing** ("Marketing — {empresa}", "Meta Ads + Google Ads + CRM + vendas"): faixa de procedência (Meta/Google — dados reais | demonstração | não conectado; CRM — demonstração enquanto `DEMO_MODE`), KPIs Investimento total/Meta/Google, Leads, Qualificados, Agendamentos, Comparecimentos, Clientes novos, Receita atribuída, CAC, ROAS (respeitam período/empresa/canal); comparativo Meta x Google completo (investimento, impressões, alcance, frequência, cliques, CTR, CPC, CPM, conversas, conversões, taxa e custo por conversão, conversas/leads/qualificados/clientes do CRM, CPL, CAC, receita atribuída, ROAS — "—" quando o provedor não fornece, nunca zero inventado); gráfico mestre Meta x Google por métrica (investimento, leads, qualificados, clientes, receita, CPL, CAC, ROAS); investimento por dia (Meta, Google, Total); funil com atalhos Todos/Meta/Google; performance por canal com métrica selecionável; custo x qualidade por canal; custo de aquisição; tabela master (Provider, Status, Campanha, Conta, Investimento, Impressões, Alcance, Cliques, CTR, CPC, CPM, Conv. plataforma, Conversas CRM, Leads, Qualif., Agend., Compar., Clientes, CPL, CAC, Receita, ROAS, Atualizado em); atenção agrupada por canal; Integrações (conta, status, última sincronização — nunca tokens). Dashboards **Meta** (`/marketing/meta`: investimento, impressões, alcance, frequência, cliques, CTR, CPC, CPM, conversas, leads, CPL, qualificados, CAC, clientes, receita, ROAS + evolução, investimento por campanha, funil, custo x qualidade, campanhas, contas) e **Google** (`/marketing/google`: investimento, impressões, cliques, CTR, CPC médio, conversões, taxa de conversão, custo por conversão, leads CRM, qualificados, CAC, clientes, receita, ROAS + os mesmos gráficos). **Provedor não conectado = estado vazio profissional, nunca 404, menu mantido**: administrador da empresa vê "Entre em contato com a Hub Action."; administrador geral vê o botão "Configurar integração" (→ /admin/integracoes). Métricas que misturam investimento real com CRM de demonstração recebem o selo **híbrido**.
- [src/viewsAdminMarketing.ts](src/viewsAdminMarketing.ts): em /admin/marketing e /admin/agencia o nome da empresa abre `/empresa/:id/marketing` (Meta + Google + CRM daquela empresa); o painel agregado continua igual.

### Rotas

Marketing: `/empresa/:id/marketing` (central), `/marketing/campanhas`, `/marketing/campanhas/:campaignId` (Meta: campanha → conjunto → anúncio; Google: campanha → grupo), `/marketing/funil`, `/marketing/relatorios`. Meta: `/empresa/:id/marketing/meta`. Google: `/empresa/:id/marketing/google`. Parâmetros GET novos, validados: `m` (métrica do gráfico mestre), `canalMetrica` (métrica por canal). Nenhuma rota de escrita em Meta/Google.

### Verificado

- `npx tsc --noEmit` limpo · `npm run build` ok · **126/126 testes em SQLite e 126/126 em Postgres local** (9 novos em [src/marketingCenter.test.ts](src/marketingCenter.test.ts): matriz de permissões com o caso real "administrador geral vinculado como atendente", sem vínculo, admin da empresa, atendente com/sem capability, admin da B na A, empresa suspensa; menu com status; BI por provedor e KPIs de conversão; custo x qualidade; atenção por canal; telas nos 4 cenários — nenhum / só Meta / só Google / ambos — com estado vazio e CTA por papel; isolamento por id direto de campanha/grupo).
- Servidor descartável (SQLite, `.env` renomeado, `/health` = sqlite) com empresa "BRN Barbearia (teste)" Meta + Google e admin geral vinculado como atendente: HTTP — admin geral sem vínculo: `/empresa/2/marketing`, `/inteligencia`, `/alertas` 200 e `/dashboard` 403 (operação continua exigindo vínculo — o conteúdo das conversas não é exposto ao administrador geral); atendente sem capability: `/marketing` 403, `/dashboard` 200; admin da B: `/empresa/1/marketing` e campanha da A 403. Capturas em 1440/1280/768 (Chrome headless) e 375 (emulação móvel no navegador embutido: 1 coluna, menu horizontal, sem rolagem lateral).
- Tentativa de revisão adversarial por agentes falhou por limite de uso da sessão; revisão manual dos pontos de risco (escape de HTML nos blocos novos, POSTs que continuam exigindo vínculo de administrador da empresa, contexto do menu por requisição).

### Pendências / observações

- `memberships.can_view_marketing` só pode ser ligado direto no banco (não há tela) — igual a antes.
- `acceptInvite` (access.ts) sobrescreve a senha de um usuário já existente que aceite um convite — apontado pela auditoria; não tratado nesta etapa.
- Em produção, para o CRM deixar de ser marcado como "demonstração", desligue `DEMO_MODE=false` no Render (nenhuma variável nova nesta etapa).

## Etapa concluída: Etapa 19 — Painel premium v3 (referência visual do cliente): dashboard consolidado, Metas, Criativos, inteligência executiva

Pedido: redesenhar a experiência ao nível de um SaaS premium seguindo a referência enviada (dark quase preto, magenta como ação/destaque, Meta violeta, Google laranja, verde só para status), com dashboard consolidado, Marketing → Visão Geral / Meta Ads / Google Ads / Conteúdo-Criativos / Inteligência / Metas, gráficos fortes e nada inventado. Trabalho em cima da arquitetura existente (rotas, backend, BI reaproveitados).

### Implementado

- **Design system v3** ([src/views.ts](src/views.ts)): paleta da referência (`--accent #ff3d84`, `--accent-2 #8b5cf6`, gradiente só em ação/seleção, superfícies #0b0b12/#15151f), sidebar fixa com cartão da empresa (nome + plano) e do usuário (nome + papel) como na referência, cards com filete gradiente (`.kpi.hero`), componentes novos: insight cards, goal cards, progress, creative grid, rank list, donut legend, heatmap, status grid, prep-note.
- **Componentes de gráfico** ([src/charts.ts](src/charts.ts)): `donutChart`, `radarChart`, `stackedBarChart`, `heatmapChart`, `progressBar`, `sparkBars` (mini-barras dos KPIs) — todos SVG server-side, com estado vazio e sem número inventado.
- **BI** ([src/bi.ts](src/bi.ts)): filtros por **objetivo** (`objetivo=`) e **conta conectada** (`conta=`) resolvidos para um conjunto de campanhas; `creatives` (anúncios com leads/clientes/receita reais por `external_ad_id` e métricas de mídia quando a sincronização gravar o nível AD — hoje vazio, mostrado como "—"); `heatmap` de conversas por dia da semana × hora (fuso da empresa) = "horário de ouro" real.
- **Navegação**: OPERAÇÃO (Dashboard, Conversas, CRM, Relatórios) · MARKETING (Visão Geral, Meta Ads ●/○, Google Ads ●/○, Campanhas, Funil & Conversão, Conteúdo / Criativos, Inteligência, Metas, Alertas) · GESTÃO (Configurações).
- **Dashboard geral** (`/empresa/:id/dashboard`, para quem vê marketing): 16 KPIs (investimento total/Meta/Google com mini-barras, leads, qualificados, agendamentos, comparecimentos, clientes, receita atribuída, CAC, CPL, ROAS, conversão do funil, tempo médio de resposta, aguardando humano, oportunidades), Meta x Google por dia, funil de aquisição, leads por atendente, horário de ouro, conversas e atendimento (donut "no prazo"), contas conectadas, por origem, campanhas melhores / que pedem atenção, metas do mês, campanhas em destaque; os blocos operacionais existentes continuam abaixo. Atendente sem capability continua vendo só o operacional.
- **Marketing — Visão Geral**: + impressões/alcance/cliques/CTR/CPC, leads e clientes por dia, radar Meta x Google, melhores/piores campanhas (regras explícitas), horário de ouro, criativos em destaque, público destaque (estrutura pronta), metas do mês, filtros objetivo e conta.
- **Meta Ads**: saúde da conta (conta, status, sincronização, período + nº de alertas), KPIs próprios, campanhas top/fracas, ranking de anúncios (leads reais por ad id), melhor horário (heatmap), público/posicionamento (estrutura pronta), comparação por período, alertas automáticos por regra. **Google Ads**: idem adaptado (conversões, taxa e custo por conversão, CPC médio); palavras-chave/termos/dispositivos como estrutura pronta (GAQL atual não os busca).
- **Inteligência**: resumo executivo em destaque, "o que está funcionando" / "o que piorou" (variações ≥ 5% em 7 dias + fatos), gargalos, recomendações, fontes e custo por resultado, onde está desperdiçando dinheiro, comparativo Meta x Google + radar, comparação entre períodos, custo x qualidade, metas, saúde, insights acionáveis, funil, horário de ouro, leads quentes, paradas, SLA, atendentes.
- **Metas** (`/empresa/:id/marketing/metas`, nova): gauges de faturamento/clientes/leads, cartões meta x realizado (progresso, faltante, ritmo necessário, projeção, gap), limites de CPL/CAC/ROAS, formulário (POST existente `/inteligencia/metas` agora volta para esta tela).
- **Conteúdo / Criativos** (`/empresa/:id/marketing/criativos`, nova): grid de anúncios (prévia por iniciais — imagem não sincronizada), ranking por leads reais, melhor/pior CTR quando houver mídia por anúncio, comparação; estado vazio quando não há anúncios. Formato (imagem/vídeo/reels/stories/feed) e engajamento: estrutura pronta, marcados como não sincronizados.

### Dados reais x preparados

Reais: tudo que vem de `marketing_metrics_daily` (campanha), CRM (leads, qualificados, agendamentos, comparecimentos, clientes, receita, atribuição por campanha e por anúncio), conversas (horário de ouro, atendimento), metas/projeção, alertas por regra. Preparados (mostrados como "sem dados ainda", nunca estimados): métricas de mídia por anúncio, formato/engajamento/prévia dos criativos, público (idade/gênero/cidade), posicionamento (feed/stories/reels), palavras-chave/termos/dispositivos do Google. Dependem de ampliar a sincronização (insights por anúncio e breakdowns na Meta; segmentos/keyword view no GAQL) — sem mudança de front.

### Verificado

- `npx tsc --noEmit` limpo · `npm run build` ok · **128/128 testes em SQLite e Postgres** (novos: filtros objetivo/conta, criativos por anúncio, heatmap, telas Metas/Criativos/dashboard, menu).
- Capturas 1440/1280 (Chrome headless, SQLite descartável): dashboard consolidado, visão geral, Meta, Google, criativos (vazio e com dados), metas, inteligência.
- Sem novas variáveis de ambiente; rotas antigas preservadas; Meta/Google 100% somente leitura.
