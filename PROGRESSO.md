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
- Aguardando a Etapa 3 (próximo comando do usuário). Não iniciar sem instrução.
