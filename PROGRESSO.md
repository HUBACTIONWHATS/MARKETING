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

## Pendências / próxima tarefa

- Aguardando a Etapa 2 (próximo comando do usuário). Não iniciar sem instrução.
