/**
 * Autorização — matriz completa para as áreas exclusivas do administrador
 * geral (/admin e /admin/whatsapp, ambas atrás de requirePlatformAdmin):
 * visitante, atendente e administrador de empresa são bloqueados; só
 * administrador geral da plataforma passa. Testa a MESMA função usada pelas
 * rotas reais (server.ts), com um mock mínimo de req/res — mesmo padrão já
 * usado em whatsapp.test.ts, sem precisar subir um servidor HTTP de verdade.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-auth.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_auth";
process.env.TEST_SCHEMA_RESET = "1";

type AuthModule = typeof import("./auth.js");
type DbModule = typeof import("./db.js");

let Auth: AuthModule;
let Dbm: DbModule;
let seq = 0;

test.before(async () => {
  Auth = await import("./auth.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  seq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    `Empresa Auth ${seq}`,
    `empresa-auth-${seq}`,
    new Date().toISOString()
  );
  return row!.id;
}

async function makeUser(isPlatformAdmin: boolean): Promise<number> {
  seq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, ?, 1, ?) RETURNING id",
    `Usuário Auth ${seq}`,
    `usuario-auth-${seq}@teste.dev`,
    "hash-nao-usado-neste-teste",
    isPlatformAdmin ? 1 : 0,
    new Date().toISOString()
  );
  return row!.id;
}

async function makeMembership(userId: number, companyId: number, role: "COMPANY_ADMIN" | "AGENT"): Promise<void> {
  await Dbm.db.run(
    "INSERT INTO memberships (user_id, company_id, role, created_at) VALUES (?, ?, ?, ?)",
    userId,
    companyId,
    role,
    new Date().toISOString()
  );
}

/** Mock mínimo de Request/Response — só o que requireAuth/requirePlatformAdmin realmente usam. */
function mockReqRes(userId: number | undefined) {
  const req: any = {
    session: {
      userId,
      destroy(cb: () => void) {
        cb();
      },
    },
  };
  let statusCode: number | undefined;
  let redirectedTo: string | undefined;
  let sentBody: string | undefined;
  const res: any = {
    locals: {},
    redirect(url: string) {
      redirectedTo = url;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    send(body?: string) {
      sentBody = body;
      return this;
    },
  };
  return { req, res, getStatus: () => statusCode, getRedirect: () => redirectedTo, getBody: () => sentBody };
}

async function runGate(userId: number | undefined): Promise<{ allowed: boolean; status?: number; redirect?: string }> {
  const { req, res, getStatus, getRedirect } = mockReqRes(userId);
  let nextCalled = false;
  await Auth.requirePlatformAdmin(req, res, () => {
    nextCalled = true;
  });
  return { allowed: nextCalled, status: getStatus(), redirect: getRedirect() };
}

// --- Matriz de autorização: /admin e /admin/whatsapp (requirePlatformAdmin) -

test("visitante (sem sessão) é redirecionado para /login, nunca passa", async () => {
  const result = await runGate(undefined);
  assert.equal(result.allowed, false);
  assert.equal(result.redirect, "/login");
});

test("atendente (AGENT de uma empresa, sem privilégio geral) recebe 403, nunca passa", async () => {
  const companyId = await makeCompany();
  const agentId = await makeUser(false);
  await makeMembership(agentId, companyId, "AGENT");

  const result = await runGate(agentId);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
});

test("administrador de empresa (COMPANY_ADMIN, sem privilégio geral) recebe 403, nunca passa", async () => {
  const companyId = await makeCompany();
  const companyAdminId = await makeUser(false);
  await makeMembership(companyAdminId, companyId, "COMPANY_ADMIN");

  const result = await runGate(companyAdminId);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
});

test("administrador de empresa com MAIS de uma empresa (várias memberships) continua recusado — o privilégio geral nunca vem de membership", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const userId = await makeUser(false);
  await makeMembership(userId, companyA, "COMPANY_ADMIN");
  await makeMembership(userId, companyB, "COMPANY_ADMIN");

  const result = await runGate(userId);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
});

test("administrador geral da plataforma (is_platform_admin=1) passa, mesmo sem nenhuma membership", async () => {
  const platformAdminId = await makeUser(true);
  const result = await runGate(platformAdminId);
  assert.equal(result.allowed, true);
  assert.equal(result.status, undefined, "não deveria ter enviado status de bloqueio");
});

test("usuário desativado (active=0), mesmo sendo administrador geral, é barrado antes de chegar em requirePlatformAdmin (sessão derruba em requireAuth)", async () => {
  seq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, 1, 0, ?) RETURNING id",
    `Admin Desativado ${seq}`,
    `admin-desativado-${seq}@teste.dev`,
    "hash-nao-usado-neste-teste",
    new Date().toISOString()
  );
  const result = await runGate(row!.id);
  assert.equal(result.allowed, false);
  assert.equal(result.redirect, "/login", "usuário desativado deveria ser tratado como sessão inválida, não 403");
});

test("usuário inexistente (sessão com id que não existe mais) é tratado como sessão inválida", async () => {
  const result = await runGate(999999);
  assert.equal(result.allowed, false);
  assert.equal(result.redirect, "/login");
});
