import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-attribution.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_attribution";
process.env.TEST_SCHEMA_RESET = "1";

type Attr = typeof import("./attribution.js");
type DbModule = typeof import("./db.js");

let A: Attr;
let Dbm: DbModule;
let seq = 0;

test.before(async () => {
  A = await import("./attribution.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});
test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  seq += 1;
  return (await Dbm.db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", `Empresa Attr ${seq}`, `attr-${seq}`, new Date().toISOString()))!.id;
}
async function makeContact(companyId: number): Promise<number> {
  seq += 1;
  return (await Dbm.db.get<{ id: number }>("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, ?, ?, ?) RETURNING id", companyId, `Contato ${seq}`, `+55 11 9${seq}000-0000`, new Date().toISOString()))!.id;
}

test("sem nenhum sinal: origem desconhecida, não atribuída (nunca inventa origem)", () => {
  assert.deepEqual(A.classifyAttribution({}), { source: "DESCONHECIDA", confidence: "NAO_ATRIBUIDA", provider: null });
});

test("ctwa_clid / fbclid / gclid são atribuição CONFIRMADA ao provedor certo", () => {
  assert.deepEqual(A.classifyAttribution({ ctwaClid: "abc" }), { source: "META_ADS", confidence: "CONFIRMADA", provider: "META" });
  assert.deepEqual(A.classifyAttribution({ fbclid: "x" }), { source: "META_ADS", confidence: "CONFIRMADA", provider: "META" });
  assert.deepEqual(A.classifyAttribution({ gclid: "g" }), { source: "GOOGLE_ADS", confidence: "CONFIRMADA", provider: "GOOGLE" });
  assert.deepEqual(A.classifyAttribution({ wbraid: "w" }), { source: "GOOGLE_ADS", confidence: "CONFIRMADA", provider: "GOOGLE" });
});

test("UTM só dá atribuição PROVÁVEL e respeita o meio pago", () => {
  assert.deepEqual(A.classifyAttribution({ utmSource: "facebook", utmMedium: "cpc" }), { source: "META_ADS", confidence: "PROVAVEL", provider: "META" });
  assert.deepEqual(A.classifyAttribution({ utmSource: "google", utmMedium: "cpc" }), { source: "GOOGLE_ADS", confidence: "PROVAVEL", provider: "GOOGLE" });
  assert.equal(A.classifyAttribution({ utmSource: "google", utmMedium: "organic" }).source, "ORGANICO");
  assert.equal(A.classifyAttribution({ utmSource: "instagram" }).source, "INSTAGRAM");
  assert.equal(A.classifyAttribution({ utmSource: "newsletter", utmMedium: "email" }).source, "OUTROS");
});

test("origem declarada à mão é PROVÁVEL, nunca confirmada", () => {
  assert.deepEqual(A.classifyAttribution({ declaredSource: "INDICACAO" }), { source: "INDICACAO", confidence: "PROVAVEL", provider: null });
  assert.equal(A.classifyAttribution({ declaredSource: "DESCONHECIDA" }).confidence, "NAO_ATRIBUIDA");
});

test("parseWhatsAppReferral lê o formato oficial e ignora lixo", () => {
  const s = A.parseWhatsAppReferral({ source_url: "https://fb.me/x?utm_campaign=corte", source_id: "12345", source_type: "ad", headline: "Corte Premium", ctwa_clid: "CLID" });
  assert.ok(s);
  assert.equal(s!.ctwaClid, "CLID");
  assert.equal(s!.externalAdId, "12345");
  assert.equal(s!.referralHeadline, "Corte Premium");
  assert.equal(s!.utmCampaign, "corte");
  assert.equal(A.parseWhatsAppReferral(null), null);
  assert.equal(A.parseWhatsAppReferral({ foo: "bar" }), null);
  assert.equal(A.parseWhatsAppReferral({ source_type: "post", source_id: "9" }), null, "post sem url/clid não é evidência de anúncio");
});

test("parseUtmFromUrl extrai utm_* e ids de clique; URL inválida vira null", () => {
  const s = A.parseUtmFromUrl("https://site.com/?utm_source=google&utm_medium=cpc&gclid=G1");
  assert.equal(s?.utmSource, "google");
  assert.equal(s?.gclid, "G1");
  assert.equal(A.parseUtmFromUrl("isso não é url"), null);
  assert.equal(A.parseUtmFromUrl("https://site.com/sem-parametros"), null);
});

test("applyContactAttribution: primeiro toque vence; provável não sobrescreve confirmada; escopado por empresa", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const contact = await makeContact(companyA);

  await A.applyContactAttribution(companyA, contact, { ctwaClid: "C1", externalAdId: "AD1" });
  let row = await Dbm.db.get<any>("SELECT * FROM contacts WHERE id = ?", contact);
  assert.equal(row.source, "META_ADS");
  assert.equal(row.attribution_confidence, "CONFIRMADA");
  assert.equal(row.external_ad_id, "AD1");

  await A.declareContactSource(companyA, contact, "INDICACAO");
  row = await Dbm.db.get<any>("SELECT * FROM contacts WHERE id = ?", contact);
  assert.equal(row.source, "META_ADS", "declaração manual não pode sobrescrever atribuição confirmada");

  // Empresa B não altera contato da A (company_id no WHERE).
  await A.applyContactAttribution(companyB, contact, { gclid: "G" });
  row = await Dbm.db.get<any>("SELECT * FROM contacts WHERE id = ?", contact);
  assert.equal(row.source, "META_ADS");

  // Não atribuída não apaga nada.
  const c2 = await makeContact(companyA);
  await A.declareContactSource(companyA, c2, "SITE");
  await A.applyContactAttribution(companyA, c2, {});
  assert.equal((await Dbm.db.get<any>("SELECT source FROM contacts WHERE id = ?", c2)).source, "SITE");
});
