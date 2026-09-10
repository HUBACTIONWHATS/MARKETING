import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-crm.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;

type CrmModule = typeof import("./crm.js");
type DbModule = typeof import("./db.js");

let C: CrmModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  C = await import("./crm.js");
  Dbm = await import("./db.js");
  Dbm.runMigrations();
});

function makeCompany(): number {
  companySeq += 1;
  const info = Dbm.db
    .prepare("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, datetime('now'))")
    .run(`Empresa CRM ${companySeq}`, `empresa-crm-${companySeq}`);
  return Number(info.lastInsertRowid);
}

function makeContact(companyId: number, phone: string): number {
  const info = Dbm.db
    .prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'Contato Teste', ?, datetime('now'))")
    .run(companyId, phone);
  return Number(info.lastInsertRowid);
}

test("mover para etapa 'perdido' sem motivo é rejeitado", () => {
  const companyId = makeCompany();
  C.ensureDefaultPipelineStages(companyId);
  const contactId = makeContact(companyId, "+55 11 91111-0001");
  const opp = C.createOpportunity({ companyId, contactId, title: "Oportunidade 1", valueCents: 1000 });
  const lostStage = C.listStages(companyId).find((s) => s.is_lost)!;

  const result = C.moveOpportunity(companyId, opp.id, lostStage.id);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /motivo/i);
});

test("mover para 'perdido' com motivo registra motivo e fecha a oportunidade; voltar reabre", () => {
  const companyId = makeCompany();
  C.ensureDefaultPipelineStages(companyId);
  const contactId = makeContact(companyId, "+55 11 91111-0002");
  const opp = C.createOpportunity({ companyId, contactId, title: "Oportunidade 2", valueCents: 5000 });
  const stages = C.listStages(companyId);
  const lostStage = stages.find((s) => s.is_lost)!;
  const openStage = stages.find((s) => !s.is_won && !s.is_lost)!;

  const result = C.moveOpportunity(companyId, opp.id, lostStage.id, "Cliente não respondeu mais");
  assert.equal(result.ok, true);
  let updated = C.getOpportunity(companyId, opp.id)!;
  assert.equal(updated.lost_reason, "Cliente não respondeu mais");
  assert.notEqual(updated.closed_at, null);

  C.moveOpportunity(companyId, opp.id, openStage.id);
  updated = C.getOpportunity(companyId, opp.id)!;
  assert.equal(updated.lost_reason, null, "motivo deveria ser limpo ao reabrir");
  assert.equal(updated.closed_at, null, "closed_at deveria ser limpo ao reabrir");
});

test("etapas de encerramento (venda/perdido) não podem ser excluídas", () => {
  const companyId = makeCompany();
  C.ensureDefaultPipelineStages(companyId);
  const wonStage = C.listStages(companyId).find((s) => s.is_won)!;
  const result = C.deleteStage(companyId, wonStage.id);
  assert.equal(result.ok, false);
});

test("etapa com oportunidades não pode ser excluída, mas etapa vazia pode", () => {
  const companyId = makeCompany();
  C.ensureDefaultPipelineStages(companyId);
  const stages = C.listStages(companyId);
  const firstStage = stages[0];
  const contactId = makeContact(companyId, "+55 11 91111-0003");
  C.createOpportunity({ companyId, contactId, title: "Oportunidade 3", valueCents: 100 });

  const blocked = C.deleteStage(companyId, firstStage.id);
  assert.equal(blocked.ok, false);

  C.addStage(companyId, "Etapa vazia extra");
  const extra = C.listStages(companyId).find((s) => s.name === "Etapa vazia extra")!;
  const allowed = C.deleteStage(companyId, extra.id);
  assert.equal(allowed.ok, true);
});
