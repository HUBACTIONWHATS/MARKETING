import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-dashboard.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;

type DashboardModule = typeof import("./dashboard.js");
type DbModule = typeof import("./db.js");

let D: DashboardModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  D = await import("./dashboard.js");
  Dbm = await import("./db.js");
  Dbm.runMigrations();
});

const TZ = "America/Sao_Paulo";
// Data real de hoje: o fuso padrão (America/Sao_Paulo) não tem horário de
// verão, então qualquer dia serve — não precisa ser fixo.
const TODAY = new Date().toISOString().slice(0, 10);

function makeCompany(): number {
  companySeq += 1;
  const info = Dbm.db
    .prepare(
      "INSERT INTO companies (name, slug, timezone, created_at) VALUES (?, ?, ?, datetime('now'))"
    )
    .run(`Empresa Dash ${companySeq}`, `empresa-dash-${companySeq}`, TZ);
  return Number(info.lastInsertRowid);
}

function makeUser(email: string): number {
  const info = Dbm.db
    .prepare("INSERT INTO users (name, email, password_hash, created_at) VALUES ('U', ?, 'x', datetime('now'))")
    .run(email);
  return Number(info.lastInsertRowid);
}

function makeConversationWithEpisode(
  companyId: number,
  phone: string,
  startedAt: string,
  endedAt: string,
  endedByUserId: number | null
): void {
  const contact = Dbm.db
    .prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C', ?, datetime('now'))")
    .run(companyId, phone);
  const contactId = Number(contact.lastInsertRowid);
  const now = new Date().toISOString();
  const conv = Dbm.db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'AGUARDANDO_CLIENTE', ?, ?)`
    )
    .run(companyId, contactId, now, now);
  const convId = Number(conv.lastInsertRowid);
  Dbm.db
    .prepare(
      `INSERT INTO wait_episodes (company_id, conversation_id, started_at, ended_at, ended_reason, ended_by_user_id, created_at)
       VALUES (?, ?, ?, ?, 'RESPOSTA_HUMANA', ?, ?)`
    )
    .run(companyId, convId, startedAt, endedAt, endedByUserId, startedAt);
}

test("média, mediana e percentual dentro do prazo são calculados corretamente", () => {
  const companyId = makeCompany();
  const day = `${TODAY}T12:00:00.000Z`;
  // 3 episódios: 5, 10 e 20 minutos de espera até a resposta humana.
  makeConversationWithEpisode(companyId, "+55 11 92222-0001", day, addMinutes(day, 5), null);
  makeConversationWithEpisode(companyId, "+55 11 92222-0002", day, addMinutes(day, 10), null);
  makeConversationWithEpisode(companyId, "+55 11 92222-0003", day, addMinutes(day, 20), null);

  const data = D.computeDashboard(companyId, TZ, 10, { from: TODAY, to: TODAY, attendantUserId: null });

  assert.equal(data.firstResponse.count, 3);
  assert.equal(data.firstResponse.avgMinutes, (5 + 10 + 20) / 3);
  assert.equal(data.firstResponse.medianMinutes, 10);
  // meta = 10min: 5 e 10 estão dentro do prazo, 20 não -> 2/3 = 67%
  assert.equal(data.firstResponse.withinSlaPercent, 67);
});

test("filtro por atendente considera só episódios encerrados por aquele usuário", () => {
  const companyId = makeCompany();
  const userA = makeUser("a@dash.dev");
  const userB = makeUser("b@dash.dev");
  const day = `${TODAY}T12:00:00.000Z`;
  makeConversationWithEpisode(companyId, "+55 11 93333-0001", day, addMinutes(day, 5), userA);
  makeConversationWithEpisode(companyId, "+55 11 93333-0002", day, addMinutes(day, 15), userB);

  const dataAll = D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: null });
  assert.equal(dataAll.firstResponse.count, 2);

  const dataA = D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: userA });
  assert.equal(dataA.firstResponse.count, 1);
  assert.equal(dataA.firstResponse.avgMinutes, 5);
});

test("espera em aberto agora conta em 'aguardando' e na maior espera, fora do filtro de período", () => {
  const companyId = makeCompany();
  const contact = Dbm.db
    .prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C', '+55 11 94444-0001', datetime('now'))")
    .run(companyId);
  const contactId = Number(contact.lastInsertRowid);
  const now = new Date().toISOString();
  const conv = Dbm.db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'AGUARDANDO_HUMANO', ?, ?)`
    )
    .run(companyId, contactId, now, now);
  const convId = Number(conv.lastInsertRowid);
  const startedAt = new Date(Date.now() - 3 * 60000).toISOString(); // 3 min atrás
  Dbm.db
    .prepare(
      "INSERT INTO wait_episodes (company_id, conversation_id, started_at, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(companyId, convId, startedAt, startedAt);

  // período "de ontem" não deveria afetar essas métricas, pois são "agora".
  const data = D.computeDashboard(companyId, TZ, 60, { from: "2020-01-01", to: "2020-01-01", attendantUserId: null });
  assert.equal(data.waitingNow, 1);
  assert.ok(data.longestWaitMs !== null && data.longestWaitMs >= 2 * 60000);
});

test("atendimento encerrado sem nenhuma resposta humana é contado; com resposta, não é", () => {
  const companyId = makeCompany();
  // Meio-dia UTC do dia de teste: sempre cai dentro da janela local do dia,
  // independente da hora real em que o teste rodar.
  const at = `${TODAY}T12:00:00.000Z`;

  const c1 = Dbm.db.prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C1', '+55 11 95555-0001', ?)").run(companyId, at);
  const conv1 = Dbm.db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'ENCERRADO', ?, ?)`
    )
    .run(companyId, Number(c1.lastInsertRowid), at, at);
  void conv1;

  const c2 = Dbm.db.prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C2', '+55 11 95555-0002', ?)").run(companyId, at);
  const conv2 = Dbm.db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'ENCERRADO', ?, ?)`
    )
    .run(companyId, Number(c2.lastInsertRowid), at, at);
  Dbm.db
    .prepare(
      "INSERT INTO messages (company_id, conversation_id, author_type, body, send_status, created_at) VALUES (?, ?, 'HUMANO', 'oi', 'ENVIADA', ?)"
    )
    .run(companyId, Number(conv2.lastInsertRowid), at);

  const data = D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: null });
  assert.equal(data.closedWithoutReply, 1);
});

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}
