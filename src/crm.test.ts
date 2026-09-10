import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-crm.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_crm";
process.env.TEST_SCHEMA_RESET = "1";

type CrmModule = typeof import("./crm.js");
type DbModule = typeof import("./db.js");

let C: CrmModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  C = await import("./crm.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  companySeq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    `Empresa CRM ${companySeq}`,
    `empresa-crm-${companySeq}`,
    new Date().toISOString()
  );
  return row!.id;
}

async function makeContact(companyId: number, phone: string): Promise<number> {
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'Contato Teste', ?, ?) RETURNING id",
    companyId,
    phone,
    new Date().toISOString()
  );
  return row!.id;
}

test("mover para etapa 'perdido' sem motivo é rejeitado", async () => {
  const companyId = await makeCompany();
  await C.ensureDefaultPipelineStages(companyId);
  const contactId = await makeContact(companyId, "+55 11 91111-0001");
  const opp = await C.createOpportunity({ companyId, contactId, title: "Oportunidade 1", valueCents: 1000 });
  const lostStage = (await C.listStages(companyId)).find((s) => s.is_lost)!;

  const result = await C.moveOpportunity(companyId, opp.id, lostStage.id);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /motivo/i);
});

test("mover para 'perdido' com motivo registra motivo e fecha a oportunidade; voltar reabre", async () => {
  const companyId = await makeCompany();
  await C.ensureDefaultPipelineStages(companyId);
  const contactId = await makeContact(companyId, "+55 11 91111-0002");
  const opp = await C.createOpportunity({ companyId, contactId, title: "Oportunidade 2", valueCents: 5000 });
  const stages = await C.listStages(companyId);
  const lostStage = stages.find((s) => s.is_lost)!;
  const openStage = stages.find((s) => !s.is_won && !s.is_lost)!;

  const result = await C.moveOpportunity(companyId, opp.id, lostStage.id, "Cliente não respondeu mais");
  assert.equal(result.ok, true);
  let updated = (await C.getOpportunity(companyId, opp.id))!;
  assert.equal(updated.lost_reason, "Cliente não respondeu mais");
  assert.notEqual(updated.closed_at, null);

  await C.moveOpportunity(companyId, opp.id, openStage.id);
  updated = (await C.getOpportunity(companyId, opp.id))!;
  assert.equal(updated.lost_reason, null, "motivo deveria ser limpo ao reabrir");
  assert.equal(updated.closed_at, null, "closed_at deveria ser limpo ao reabrir");
});

test("etapas de encerramento (venda/perdido) não podem ser excluídas", async () => {
  const companyId = await makeCompany();
  await C.ensureDefaultPipelineStages(companyId);
  const wonStage = (await C.listStages(companyId)).find((s) => s.is_won)!;
  const result = await C.deleteStage(companyId, wonStage.id);
  assert.equal(result.ok, false);
});

test("etapa com oportunidades não pode ser excluída, mas etapa vazia pode", async () => {
  const companyId = await makeCompany();
  await C.ensureDefaultPipelineStages(companyId);
  const stages = await C.listStages(companyId);
  const firstStage = stages[0];
  const contactId = await makeContact(companyId, "+55 11 91111-0003");
  await C.createOpportunity({ companyId, contactId, title: "Oportunidade 3", valueCents: 100 });

  const blocked = await C.deleteStage(companyId, firstStage.id);
  assert.equal(blocked.ok, false);

  await C.addStage(companyId, "Etapa vazia extra");
  const extra = (await C.listStages(companyId)).find((s) => s.name === "Etapa vazia extra")!;
  const allowed = await C.deleteStage(companyId, extra.id);
  assert.equal(allowed.ok, true);
});

test("reordenar etapas troca as posições dentro de uma transação", async () => {
  const companyId = await makeCompany();
  await C.ensureDefaultPipelineStages(companyId);
  const before = await C.listStages(companyId);
  await C.reorderStage(companyId, before[1].id, "up");
  const after = await C.listStages(companyId);
  assert.equal(after[0].id, before[1].id);
  assert.equal(after[1].id, before[0].id);
});
