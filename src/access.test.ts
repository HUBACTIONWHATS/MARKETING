import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-access.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_access";
process.env.TEST_SCHEMA_RESET = "1";

type AccessModule = typeof import("./access.js");
type AuthModule = typeof import("./auth.js");
type DbModule = typeof import("./db.js");
type ModelsModule = typeof import("./models.js");
type SessionStoreModule = typeof import("./sessionStore.js");
type AttendanceModule = typeof import("./attendance.js");

let Ac: AccessModule;
let Au: AuthModule;
let Dbm: DbModule;
let M: ModelsModule;
let S: SessionStoreModule;
let A: AttendanceModule;

test.before(async () => {
  Ac = await import("./access.js");
  Au = await import("./auth.js");
  Dbm = await import("./db.js");
  M = await import("./models.js");
  S = await import("./sessionStore.js");
  A = await import("./attendance.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

async function makeAdmin(email: string): Promise<number> {
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES ('Hub', ?, 'x', 1, 1, ?) RETURNING id",
    email,
    new Date().toISOString()
  );
  return row!.id;
}

async function countSessions(sid: string): Promise<number> {
  const row = await Dbm.db.get<{ c: number }>("SELECT COUNT(*) c FROM sessions WHERE sid = ?", sid);
  return Number(row!.c);
}

test("convite: cria usuário + associação, é de uso único e o token não fica em claro no banco", async () => {
  const company = await M.createCompany("Cliente Convite Ltda");
  const adminId = await makeAdmin("hub1@t.dev");
  const token = await Ac.createInvite(company.id, "Novo@Cliente.com", "AGENT", adminId);

  const stored = (await Dbm.db.get<{ token_hash: string; email: string }>(
    "SELECT token_hash, email FROM access_tokens WHERE company_id = ?",
    company.id
  ))!;
  assert.notEqual(stored.token_hash, token, "o token em claro não pode ser gravado");
  assert.equal(stored.email, "novo@cliente.com", "e-mail normalizado");

  const result = await Ac.acceptInvite(token, "Maria", "senha-forte-123");
  assert.equal(result.ok, true);
  const member = await M.findMembership(result.userId!, company.id);
  assert.equal(member?.role, "AGENT");
  const user = (await M.findUserById(result.userId!))!;
  assert.equal(Au.verifyPassword("senha-forte-123", user.password_hash), true);

  const again = await Ac.acceptInvite(token, "Outro", "senha-forte-123");
  assert.equal(again.ok, false, "convite não pode ser usado duas vezes");
});

test("convite expirado ou senha curta é recusado", async () => {
  const company = await M.createCompany("Cliente Expira");
  const adminId = await makeAdmin("hub2@t.dev");
  const token = await Ac.createInvite(company.id, "x@y.com", "COMPANY_ADMIN", adminId);
  assert.equal((await Ac.acceptInvite(token, "X", "curta")).ok, false);

  await Dbm.db.run("UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'x@y.com'");
  assert.equal((await Ac.acceptInvite(token, "X", "senha-forte-123")).ok, false);
});

test("redefinição de senha: troca a senha, invalida o link e derruba sessões antigas do usuário", async () => {
  const company = await M.createCompany("Cliente Reset");
  const adminId = await makeAdmin("hub3@t.dev");
  const invite = await Ac.createInvite(company.id, "reset@y.com", "AGENT", adminId);
  const userId = (await Ac.acceptInvite(invite, "R", "senha-antiga-123")).userId!;

  await Dbm.db.run("INSERT INTO sessions (sid, sess, expires_at) VALUES ('s1', ?, ?)", JSON.stringify({ cookie: {}, userId }), Date.now() + 100000);

  const token = await Ac.createPasswordReset(userId, "reset@y.com", adminId);
  assert.equal((await Ac.completePasswordReset(token, "senha-nova-456")).ok, true);
  const user = (await M.findUserById(userId))!;
  assert.equal(Au.verifyPassword("senha-nova-456", user.password_hash), true);
  assert.equal((await Ac.completePasswordReset(token, "outra-senha-789")).ok, false, "link de uso único");
  assert.equal(await countSessions("s1"), 0, "sessão antiga derrubada");
});

test("desativar usuário apaga sessões dele; plano/suspensão ficam gravados na empresa", async () => {
  const company = await M.createCompany("Cliente Suspenso");
  const adminId = await makeAdmin("hub4@t.dev");
  await Dbm.db.run("INSERT INTO sessions (sid, sess, expires_at) VALUES ('s2', ?, ?)", JSON.stringify({ cookie: {}, userId: adminId }), Date.now() + 100000);
  await M.setUserActive(adminId, false);
  assert.equal((await M.findUserById(adminId))!.active, 0);
  assert.equal(await countSessions("s2"), 0);

  await M.updateCompanyPlan(company.id, "PILOTO", true, "piloto combinado");
  const updated = (await M.findCompanyById(company.id))!;
  assert.equal(updated.plan, "PILOTO");
  assert.equal(updated.suspended, 1);
  assert.equal(updated.plan_notes, "piloto combinado");
});

test("createCompany gera slug único mesmo com nomes repetidos", async () => {
  const a = await M.createCompany("Mesma Empresa");
  const b = await M.createCompany("Mesma Empresa");
  assert.notEqual(a.slug, b.slug);
  assert.equal(a.plan, "DEMONSTRACAO");
});

test("store de sessão no banco: grava, lê, expira e destrói", async () => {
  const store = new S.SqliteSessionStore();
  const get = (sid: string) => new Promise<unknown>((resolve, reject) => store.get(sid, (err, s) => (err ? reject(err) : resolve(s))));
  const set = (sid: string, sess: any) => new Promise<void>((resolve, reject) => store.set(sid, sess, (err) => (err ? reject(err) : resolve())));
  const destroy = (sid: string) => new Promise<void>((resolve, reject) => store.destroy(sid, (err) => (err ? reject(err) : resolve())));

  await set("sess-a", { cookie: { maxAge: 60000 }, userId: 42 });
  assert.deepEqual(((await get("sess-a")) as { userId: number }).userId, 42);

  await set("sess-b", { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, userId: 7 });
  assert.equal(await get("sess-b"), null, "sessão expirada não volta");

  await set("sess-a", { cookie: { maxAge: 60000 }, userId: 43 }); // sobrescreve (ON CONFLICT)
  assert.deepEqual(((await get("sess-a")) as { userId: number }).userId, 43);

  await destroy("sess-a");
  assert.equal(await get("sess-a"), null);
});

test("mensagem recebida com occurredAt usa o horário da origem no cronômetro, não o da chegada", async () => {
  const company = await M.createCompany("Cliente Timestamp");
  const contact = await A.findOrCreateContact(company.id, "C", "+55 11 90000-7777");
  const conv = await A.createConversation(company.id, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
  await A.addMessage({ companyId: company.id, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente", externalId: "wamid.TS", occurredAt: tenMinutesAgo });
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.started_at, tenMinutesAgo);
});

test("transação desfeita em erro: nada gravado dentro do bloco sobrevive", async () => {
  await assert.rejects(
    Dbm.db.transaction(async (tx) => {
      await tx.run(
        "INSERT INTO users (name, email, password_hash, created_at) VALUES ('R', 'rollback@y.com', 'x', ?)",
        new Date().toISOString()
      );
      throw new Error("boom");
    })
  );
  const user = await M.findUserByEmail("rollback@y.com");
  assert.equal(user, undefined, "o INSERT deveria ter sido desfeito junto com a transação");
});
