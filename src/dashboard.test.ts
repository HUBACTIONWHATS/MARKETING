import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-dashboard.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_dashboard";
process.env.TEST_SCHEMA_RESET = "1";

type DashboardModule = typeof import("./dashboard.js");
type DbModule = typeof import("./db.js");

let D: DashboardModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  D = await import("./dashboard.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

const TZ = "America/Sao_Paulo";
// Data real de hoje: o fuso padrão (America/Sao_Paulo) não tem horário de
// verão, então qualquer dia serve — não precisa ser fixo.
const TODAY = new Date().toISOString().slice(0, 10);

function nowIso(): string {
  return new Date().toISOString();
}

async function makeCompany(): Promise<number> {
  companySeq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, timezone, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    `Empresa Dash ${companySeq}`,
    `empresa-dash-${companySeq}`,
    TZ,
    nowIso()
  );
  return row!.id;
}

async function makeUser(email: string): Promise<number> {
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, created_at) VALUES ('U', ?, 'x', ?) RETURNING id",
    email,
    nowIso()
  );
  return row!.id;
}

async function makeConversationWithEpisode(
  companyId: number,
  phone: string,
  startedAt: string,
  endedAt: string,
  endedByUserId: number | null
): Promise<void> {
  const contact = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C', ?, ?) RETURNING id",
    companyId,
    phone,
    nowIso()
  );
  const now = nowIso();
  const conv = await Dbm.db.get<{ id: number }>(
    `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
     VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'AGUARDANDO_CLIENTE', ?, ?) RETURNING id`,
    companyId,
    contact!.id,
    now,
    now
  );
  await Dbm.db.run(
    `INSERT INTO wait_episodes (company_id, conversation_id, started_at, ended_at, ended_reason, ended_by_user_id, created_at)
     VALUES (?, ?, ?, ?, 'RESPOSTA_HUMANA', ?, ?)`,
    companyId,
    conv!.id,
    startedAt,
    endedAt,
    endedByUserId,
    startedAt
  );
}

test("média, mediana e percentual dentro do prazo são calculados corretamente", async () => {
  const companyId = await makeCompany();
  const day = `${TODAY}T12:00:00.000Z`;
  // 3 episódios: 5, 10 e 20 minutos de espera até a resposta humana.
  await makeConversationWithEpisode(companyId, "+55 11 92222-0001", day, addMinutes(day, 5), null);
  await makeConversationWithEpisode(companyId, "+55 11 92222-0002", day, addMinutes(day, 10), null);
  await makeConversationWithEpisode(companyId, "+55 11 92222-0003", day, addMinutes(day, 20), null);

  const data = await D.computeDashboard(companyId, TZ, 10, { from: TODAY, to: TODAY, attendantUserId: null });

  assert.equal(data.firstResponse.count, 3);
  assert.equal(data.firstResponse.avgMinutes, (5 + 10 + 20) / 3);
  assert.equal(data.firstResponse.medianMinutes, 10);
  // meta = 10min: 5 e 10 estão dentro do prazo, 20 não -> 2/3 = 67%
  assert.equal(data.firstResponse.withinSlaPercent, 67);
});

test("filtro por atendente considera só episódios encerrados por aquele usuário", async () => {
  const companyId = await makeCompany();
  const userA = await makeUser("a@dash.dev");
  const userB = await makeUser("b@dash.dev");
  const day = `${TODAY}T12:00:00.000Z`;
  await makeConversationWithEpisode(companyId, "+55 11 93333-0001", day, addMinutes(day, 5), userA);
  await makeConversationWithEpisode(companyId, "+55 11 93333-0002", day, addMinutes(day, 15), userB);

  const dataAll = await D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: null });
  assert.equal(dataAll.firstResponse.count, 2);

  const dataA = await D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: userA });
  assert.equal(dataA.firstResponse.count, 1);
  assert.equal(dataA.firstResponse.avgMinutes, 5);
});

test("espera em aberto agora conta em 'aguardando' e na maior espera, fora do filtro de período", async () => {
  const companyId = await makeCompany();
  const contact = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C', '+55 11 94444-0001', ?) RETURNING id",
    companyId,
    nowIso()
  );
  const now = nowIso();
  const conv = await Dbm.db.get<{ id: number }>(
    `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
     VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'AGUARDANDO_HUMANO', ?, ?) RETURNING id`,
    companyId,
    contact!.id,
    now,
    now
  );
  const startedAt = new Date(Date.now() - 3 * 60000).toISOString(); // 3 min atrás
  await Dbm.db.run(
    "INSERT INTO wait_episodes (company_id, conversation_id, started_at, created_at) VALUES (?, ?, ?, ?)",
    companyId,
    conv!.id,
    startedAt,
    startedAt
  );

  // período "de ontem" não deveria afetar essas métricas, pois são "agora".
  const data = await D.computeDashboard(companyId, TZ, 60, { from: "2020-01-01", to: "2020-01-01", attendantUserId: null });
  assert.equal(data.waitingNow, 1);
  assert.ok(data.longestWaitMs !== null && data.longestWaitMs >= 2 * 60000);
});

test("atendimento encerrado sem nenhuma resposta humana é contado; com resposta, não é", async () => {
  const companyId = await makeCompany();
  // Meio-dia UTC do dia de teste: sempre cai dentro da janela local do dia,
  // independente da hora real em que o teste rodar.
  const at = `${TODAY}T12:00:00.000Z`;

  const c1 = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C1', '+55 11 95555-0001', ?) RETURNING id",
    companyId,
    at
  );
  await Dbm.db.run(
    `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
     VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'ENCERRADO', ?, ?)`,
    companyId,
    c1!.id,
    at,
    at
  );

  const c2 = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C2', '+55 11 95555-0002', ?) RETURNING id",
    companyId,
    at
  );
  const conv2 = await Dbm.db.get<{ id: number }>(
    `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
     VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'ENCERRADO', ?, ?) RETURNING id`,
    companyId,
    c2!.id,
    at,
    at
  );
  await Dbm.db.run(
    "INSERT INTO messages (company_id, conversation_id, author_type, body, send_status, created_at) VALUES (?, ?, 'HUMANO', 'oi', 'ENVIADA', ?)",
    companyId,
    conv2!.id,
    at
  );

  const data = await D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: null });
  assert.equal(data.closedWithoutReply, 1);
});

test("vendas e receita somam value_cents das oportunidades ganhas no período (número, não texto)", async () => {
  const companyId = await makeCompany();
  const at = `${TODAY}T12:00:00.000Z`;
  const stage = await Dbm.db.get<{ id: number }>(
    "INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at) VALUES (?, 'Venda', 1, 1, 0, ?) RETURNING id",
    companyId,
    at
  );
  const contact = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'C', '+55 11 96666-0001', ?) RETURNING id",
    companyId,
    at
  );
  for (const value of [19900, 149000]) {
    await Dbm.db.run(
      `INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, 'Plano', ?, ?, ?, ?)`,
      companyId,
      contact!.id,
      stage!.id,
      value,
      at,
      at,
      at
    );
  }
  const data = await D.computeDashboard(companyId, TZ, 60, { from: TODAY, to: TODAY, attendantUserId: null });
  assert.equal(data.wonCount, 2);
  assert.equal(data.wonRevenueCents, 168900);
  assert.equal(typeof data.wonRevenueCents, "number");
});

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}
