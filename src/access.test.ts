import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-access.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;

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
  Dbm.runMigrations();
});

function makeAdmin(email: string): number {
  const info = Dbm.db
    .prepare("INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES ('Hub', ?, 'x', 1, 1, datetime('now'))")
    .run(email);
  return Number(info.lastInsertRowid);
}

test("convite: cria usuário + associação, é de uso único e o token não fica em claro no banco", () => {
  const company = M.createCompany("Cliente Convite Ltda");
  const adminId = makeAdmin("hub1@t.dev");
  const token = Ac.createInvite(company.id, "Novo@Cliente.com", "AGENT", adminId);

  const stored = Dbm.db.prepare("SELECT token_hash, email FROM access_tokens").get() as { token_hash: string; email: string };
  assert.notEqual(stored.token_hash, token, "o token em claro não pode ser gravado");
  assert.equal(stored.email, "novo@cliente.com", "e-mail normalizado");

  const result = Ac.acceptInvite(token, "Maria", "senha-forte-123");
  assert.equal(result.ok, true);
  const member = M.findMembership(result.userId!, company.id);
  assert.equal(member?.role, "AGENT");
  const user = M.findUserById(result.userId!)!;
  assert.equal(Au.verifyPassword("senha-forte-123", user.password_hash), true);

  const again = Ac.acceptInvite(token, "Outro", "senha-forte-123");
  assert.equal(again.ok, false, "convite não pode ser usado duas vezes");
});

test("convite expirado ou senha curta é recusado", () => {
  const company = M.createCompany("Cliente Expira");
  const adminId = makeAdmin("hub2@t.dev");
  const token = Ac.createInvite(company.id, "x@y.com", "COMPANY_ADMIN", adminId);
  assert.equal(Ac.acceptInvite(token, "X", "curta").ok, false);

  Dbm.db.prepare("UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'x@y.com'").run();
  assert.equal(Ac.acceptInvite(token, "X", "senha-forte-123").ok, false);
});

test("redefinição de senha: troca a senha, invalida o link e derruba sessões antigas do usuário", () => {
  const company = M.createCompany("Cliente Reset");
  const adminId = makeAdmin("hub3@t.dev");
  const invite = Ac.createInvite(company.id, "reset@y.com", "AGENT", adminId);
  const userId = Ac.acceptInvite(invite, "R", "senha-antiga-123").userId!;

  Dbm.db.prepare("INSERT INTO sessions (sid, sess, expires_at) VALUES ('s1', ?, ?)").run(JSON.stringify({ cookie: {}, userId }), Date.now() + 100000);

  const token = Ac.createPasswordReset(userId, "reset@y.com", adminId);
  assert.equal(Ac.completePasswordReset(token, "senha-nova-456").ok, true);
  const user = M.findUserById(userId)!;
  assert.equal(Au.verifyPassword("senha-nova-456", user.password_hash), true);
  assert.equal(Ac.completePasswordReset(token, "outra-senha-789").ok, false, "link de uso único");
  assert.equal((Dbm.db.prepare("SELECT COUNT(*) c FROM sessions WHERE sid = 's1'").get() as { c: number }).c, 0, "sessão antiga derrubada");
});

test("desativar usuário apaga sessões dele; plano/suspensão ficam gravados na empresa", () => {
  const company = M.createCompany("Cliente Suspenso");
  const adminId = makeAdmin("hub4@t.dev");
  Dbm.db.prepare("INSERT INTO sessions (sid, sess, expires_at) VALUES ('s2', ?, ?)").run(JSON.stringify({ cookie: {}, userId: adminId }), Date.now() + 100000);
  M.setUserActive(adminId, false);
  assert.equal(M.findUserById(adminId)!.active, 0);
  assert.equal((Dbm.db.prepare("SELECT COUNT(*) c FROM sessions WHERE sid = 's2'").get() as { c: number }).c, 0);

  M.updateCompanyPlan(company.id, "PILOTO", true, "piloto combinado");
  const updated = M.findCompanyById(company.id)!;
  assert.equal(updated.plan, "PILOTO");
  assert.equal(updated.suspended, 1);
  assert.equal(updated.plan_notes, "piloto combinado");
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

  await destroy("sess-a");
  assert.equal(await get("sess-a"), null);
});

test("mensagem recebida com occurredAt usa o horário da origem no cronômetro, não o da chegada", () => {
  const company = M.createCompany("Cliente Timestamp");
  const contact = A.findOrCreateContact(company.id, "C", "+55 11 90000-7777");
  const conv = A.createConversation(company.id, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
  A.addMessage({ companyId: company.id, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente", externalId: "wamid.TS", occurredAt: tenMinutesAgo });
  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.started_at, tenMinutesAgo);
});
