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
