/**
 * Central de Marketing da empresa (Meta Ads + Google Ads + CRM): quem vê, o que
 * o menu mostra, o que aparece com cada combinação de provedores conectados,
 * isolamento entre empresas e os blocos novos do BI/insights. Usa as MESMAS
 * funções das rotas reais (auth.ts, bi.ts, insights.ts, views) com mocks
 * mínimos de req/res, no mesmo padrão de auth.test.ts e bi.test.ts.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-marketing-center.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_mc";
process.env.TEST_SCHEMA_RESET = "1";
process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

type Auth = typeof import("./auth.js");
type Bi = typeof import("./bi.js");
type Ins = typeof import("./insights.js");
type Mk = typeof import("./marketingModels.js");
type Crm = typeof import("./crm.js");
type Models = typeof import("./models.js");
type Views = typeof import("./views.js");
type VM = typeof import("./viewsMarketing.js");
type Shell = typeof import("./shellContext.js");
type DbModule = typeof import("./db.js");

let A: Auth;
let B: Bi;
let I: Ins;
let M: Mk;
let C: Crm;
let Mo: Models;
let V: Views;
let VM: VM;
let S: Shell;
let Dbm: DbModule;
let seq = 0;
const TZ = "America/Sao_Paulo";
const daysAgo = (n: number, h = 12) => new Date(Date.UTC(2026, 8, 15 - n, h)).toISOString();

test.before(async () => {
  A = await import("./auth.js");
  B = await import("./bi.js");
  I = await import("./insights.js");
  M = await import("./marketingModels.js");
  C = await import("./crm.js");
  Mo = await import("./models.js");
  V = await import("./views.js");
  VM = await import("./viewsMarketing.js");
  S = await import("./shellContext.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});
test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(name = "Empresa MC"): Promise<number> {
  seq += 1;
  const id = (await Dbm.db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", `${name} ${seq}`, `mc-${seq}`, daysAgo(60)))!.id;
  await C.ensureDefaultPipelineStages(id);
  return id;
}
async function makeUser(isPlatformAdmin = false): Promise<number> {
  seq += 1;
  return (await Dbm.db.get<{ id: number }>("INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, 'x', ?, 1, ?) RETURNING id", `Usuário ${seq}`, `mc-${seq}@t.dev`, isPlatformAdmin ? 1 : 0, daysAgo(60)))!.id;
}
async function makeMembership(userId: number, companyId: number, role: "COMPANY_ADMIN" | "AGENT", canViewMarketing = 0): Promise<void> {
  await Dbm.db.run("INSERT INTO memberships (user_id, company_id, role, can_view_marketing, created_at) VALUES (?, ?, ?, ?, ?)", userId, companyId, role, canViewMarketing, daysAgo(60));
}
async function makeAccount(companyId: number, provider: "META" | "GOOGLE"): Promise<number> {
  const connectionId = await M.createConnection({ provider, externalUserId: "u", displayName: "Conta", scopes: "ads_read", accessToken: "tok", refreshToken: null, expiresAt: null, createdByUserId: 1 });
  seq += 1;
  const accountId = await M.upsertAccount({ connectionId, provider, externalAccountId: `${provider}-${seq}`, name: `Conta ${provider} ${seq}`, currency: "BRL", timezone: TZ, accountStatus: "1", isManager: false, loginCustomerId: null });
  await M.linkAccountToCompany(accountId, companyId, true);
  return accountId;
}
async function makeCampaign(companyId: number, accountId: number, provider: "META" | "GOOGLE", name: string, spendPerDay: number, days: number, extra: { conversions?: number | null; conversations?: number | null } = {}): Promise<{ id: number; externalId: string }> {
  seq += 1;
  const externalId = `camp-${seq}`;
  const id = await M.upsertCampaign({ accountId, companyId, provider, externalId, name, status: "ACTIVE", objective: null, campaignType: null, dailyBudgetCents: null, lifetimeBudgetCents: null, currency: "BRL", startDate: null, endDate: null });
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2026, 8, 15 - d)).toISOString().slice(0, 10);
    await M.upsertDailyMetric({
      companyId, provider, accountId, campaignId: id, adGroupId: null, adId: null, level: "CAMPAIGN",
      dimensionKey: `${provider}:CAMPAIGN:${accountId}:${externalId}::`, metricDate: date, currency: "BRL",
      spendCents: spendPerDay, impressions: 1000, reach: provider === "META" ? 800 : null, frequency: null, clicks: 50, linkClicks: null,
      platformConversations: extra.conversations ?? (provider === "META" ? 5 : null), platformLeads: null,
      platformConversions: extra.conversions ?? (provider === "GOOGLE" ? 4 : null), platformConversionValueCents: null, rawMetricsJson: null,
    });
  }
  await Dbm.db.run("INSERT INTO marketing_ad_groups (company_id, account_id, campaign_id, provider, external_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)", companyId, accountId, id, provider, `ag-${seq}`, `Grupo ${seq}`, daysAgo(1), daysAgo(1));
  return { id, externalId };
}
async function makeLead(companyId: number, source: "META_ADS" | "GOOGLE_ADS" | "ORGANICO", campaignExt: string | null, won: boolean, valueCents = 10000): Promise<void> {
  seq += 1;
  const contactId = (await Dbm.db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at, source, attribution_confidence, attribution_provider, external_campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    companyId, `Lead ${seq}`, `+55 11 9${String(seq).padStart(4, "0")}-2222`, daysAgo(3), source, source === "ORGANICO" ? "NAO_ATRIBUIDA" : "CONFIRMADA", source === "META_ADS" ? "META" : source === "GOOGLE_ADS" ? "GOOGLE" : null, campaignExt
  ))!.id;
  const stageName = won ? "Venda concluída" : "Qualificado";
  const stage = (await Dbm.db.get<{ id: number }>("SELECT id FROM pipeline_stages WHERE company_id = ? AND name = ?", companyId, stageName))!.id;
  await Dbm.db.run(
    "INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, created_at, updated_at, closed_at, qualified_at) VALUES (?, ?, ?, 'Op', ?, ?, ?, ?, ?)",
    companyId, contactId, stage, valueCents, daysAgo(3), daysAgo(3), won ? daysAgo(1) : null, daysAgo(2)
  );
}

function mockReqRes(userId: number | undefined, companyId: number) {
  const req: any = { params: { companyId: String(companyId) }, session: { userId, destroy(cb: () => void) { cb(); } } };
  let statusCode: number | undefined;
  let body: string | undefined;
  const res: any = { locals: {}, redirect() {}, status(code: number) { statusCode = code; return this; }, send(b?: string) { body = b; return this; } };
  return { req, res, status: () => statusCode, body: () => body };
}
async function gate(userId: number | undefined, companyId: number): Promise<{ allowed: boolean; status?: number; membershipRole?: string | null; body?: string }> {
  const m = mockReqRes(userId, companyId);
  let next = false;
  await A.requireMarketingAccess(m.req, m.res, () => { next = true; });
  return { allowed: next, status: m.status(), membershipRole: m.res.locals.membership ? m.res.locals.membership.role : null, body: m.body() };
}

async function pageBase(companyId: number, userId: number, opts: { role?: "COMPANY_ADMIN" | "AGENT"; isPlatformAdmin?: boolean; channel?: "ALL" | "META_ADS" | "GOOGLE_ADS"; demo?: boolean } = {}) {
  const company = (await Mo.findCompanyById(companyId))!;
  const user = (await Mo.findUserById(userId))!;
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const filters = { ...B.EMPTY_FILTERS, channel: opts.channel ?? "ALL" } as const;
  const bi = await B.computeCompanyBi(companyId, TZ, period, filters);
  const accounts = await M.listAccountsForCompany(companyId);
  return {
    company, user, role: opts.role ?? "COMPANY_ADMIN", isPlatformAdmin: opts.isPlatformAdmin ?? false, canViewMarketing: true, accounts,
    provenance: { media: (accounts.length ? "real" : "none") as "real" | "demo" | "none", crm: (opts.demo ? "demo" : "real") as "real" | "demo" },
    masterMetric: "investimento", channelMetric: "leads", bi,
    filterOptions: { campaigns: await M.listCampaignsForCompany(companyId), members: [], stages: [] }, m1: "investimento", m2: "receita" as string | null, sort: null,
    attention: await I.buildAttention(companyId, bi, undefined, new Date("2026-09-15T15:00:00Z")), funnel: I.executiveFunnel(bi.current),
  };
}

// --- Permissões ---------------------------------------------------------------------------

test("marketingAccessAllowed: administrador geral sempre (mesmo como atendente ou sem vínculo); administrador da empresa; atendente só com capability", () => {
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 1 }, null), true);
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 1 }, { role: "AGENT", can_view_marketing: 0 }), true);
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 0 }, { role: "COMPANY_ADMIN", can_view_marketing: 0 }), true);
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 0 }, { role: "AGENT", can_view_marketing: 1 }), true);
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 0 }, { role: "AGENT", can_view_marketing: 0 }), false);
  assert.equal(A.marketingAccessAllowed({ is_platform_admin: 0 }, null), false);
});

test("requireMarketingAccess: matriz — administrador geral (com vínculo de atendente ou sem vínculo) passa; atendente comum 403; admin da empresa B não entra na A; empresa suspensa bloqueia quem depende do vínculo", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const platformAdmin = await makeUser(true);
  await makeMembership(platformAdmin, companyA, "AGENT"); // o caso real: admin.geral vinculado como Atendente
  const adminA = await makeUser();
  await makeMembership(adminA, companyA, "COMPANY_ADMIN");
  const agentA = await makeUser();
  await makeMembership(agentA, companyA, "AGENT");
  const agentAWithCap = await makeUser();
  await makeMembership(agentAWithCap, companyA, "AGENT", 1);
  const adminB = await makeUser();
  await makeMembership(adminB, companyB, "COMPANY_ADMIN");

  const pa = await gate(platformAdmin, companyA);
  assert.equal(pa.allowed, true, `administrador geral com vínculo de atendente passa (status=${pa.status} body=${(pa.body ?? "").replace(/s+/g, " ").slice(0, 300)})`);
  assert.equal(pa.membershipRole, "AGENT", "o vínculo continua sendo o de atendente (papel efetivo para edições)");
  const paB = await gate(platformAdmin, companyB);
  assert.equal(paB.allowed, true, "administrador geral sem vínculo também passa");
  assert.equal(paB.membershipRole, null);
  assert.equal((await gate(adminA, companyA)).allowed, true);
  const ag = await gate(agentA, companyA);
  assert.equal(ag.allowed, false);
  assert.equal(ag.status, 403);
  assert.match(ag.body ?? "", /Sem acesso aos relatórios de mídia paga/);
  assert.equal((await gate(agentAWithCap, companyA)).allowed, true, "atendente com can_view_marketing=1 passa");
  const cross = await gate(adminB, companyA);
  assert.equal(cross.allowed, false, "admin da empresa B não vê marketing da A");
  assert.equal(cross.status, 403);
  assert.equal((await gate(undefined, companyA)).allowed, false, "sem sessão não passa");
  assert.equal((await gate(agentA, 999999)).status, 404, "empresa inexistente → 404");

  await Dbm.db.run("UPDATE companies SET suspended = 1 WHERE id = ?", companyA);
  assert.equal((await gate(adminA, companyA)).status, 403, "empresa suspensa bloqueia o administrador da empresa");
  assert.equal((await gate(platformAdmin, companyA)).allowed, true, "administrador geral continua vendo (é ele quem suspende)");
  await Dbm.db.run("UPDATE companies SET suspended = 0 WHERE id = ?", companyA);
});

test("providerNavStatuses: Meta conectado / Google não conectado / reconexão necessária, só a partir das contas da empresa", () => {
  assert.deepEqual(S.providerNavStatuses([]), { META: "NAO_CONECTADO", GOOGLE: "NAO_CONECTADO" });
  assert.deepEqual(S.providerNavStatuses([{ provider: "META", connection_status: "CONECTADA" }]), { META: "CONECTADO", GOOGLE: "NAO_CONECTADO" });
  assert.deepEqual(S.providerNavStatuses([{ provider: "GOOGLE", connection_status: "EXPIRADA" }]), { META: "NAO_CONECTADO", GOOGLE: "RECONEXAO" });
});

// --- Menu ----------------------------------------------------------------------------------

test("menu da empresa: OPERAÇÃO / MARKETING (Visão Geral, Meta Ads ● conectado, Google Ads ○ não conectado, Campanhas, Funil & Conversão) / GESTÃO; atendente sem capability não vê Marketing; administrador geral aparece com o rótulo certo", async () => {
  const companyId = await makeCompany();
  const userId = await makeUser(true);
  const company = (await Mo.findCompanyById(companyId))!;
  const user = (await Mo.findUserById(userId))!;
  const nav = { canViewMarketing: true, isPlatformAdmin: true, providers: { META: "CONECTADO", GOOGLE: "NAO_CONECTADO" } as const };
  const html = V.appShell({ company, user, role: "AGENT", active: "marketing/meta", body: "x", nav });
  for (const item of ["Dashboard", "Conversas", "CRM", "Visão Geral", "Meta Ads", "Google Ads", "Campanhas", "Funil &amp; Conversão", "Inteligência", "Alertas", "Relatórios", "Configurações"]) {
    assert.ok(html.includes(`<span>${item}</span>`), `item ${item}`);
  }
  assert.ok(html.includes(">Operação</div>") && html.includes(">Marketing</div>") && html.includes(">Gestão</div>"), "três grupos");
  assert.match(html, /marketing\/meta"[^>]*class="active"/, "Meta Ads é o item ativo");
  assert.match(html, /marketing\/meta[\s\S]*?nav-status on/, "Meta com ponto 'conectado'");
  assert.match(html, /marketing\/google[\s\S]*?nav-status off/, "Google com ponto 'não conectado' — o item existe mesmo sem conexão");
  assert.ok(html.includes("Administrador geral (Hub Action)"), "rótulo do administrador geral, não 'Atendente'");
  assert.ok(!html.includes("&middot; Atendente<"));

  const agentUser = (await Mo.findUserById(await makeUser(false)))!;
  const hidden = V.appShell({ company, user: agentUser, role: "AGENT", active: "dashboard", body: "x", nav: { ...nav, canViewMarketing: false, isPlatformAdmin: false } });
  assert.ok(!hidden.includes("<span>Meta Ads</span>"), "atendente sem capability não vê o grupo Marketing");
  assert.ok(hidden.includes("<span>Relatórios</span>") && hidden.includes("&middot; Atendente"));
});

// --- BI: série por provedor, KPIs de conversão, custo x qualidade por canal ------------------

test("computeCompanyBi: dailyByProvider separa Meta e Google; Google não conectado fica sem série e sem investimento (nunca zero inventado); KPIs de conversão da plataforma", async () => {
  const companyId = await makeCompany();
  const meta = await makeAccount(companyId, "META");
  const camp = await makeCampaign(companyId, meta, "META", "Meta A", 2000, 5);
  await makeLead(companyId, "META_ADS", camp.externalId, true, 30000);
  await makeLead(companyId, "META_ADS", camp.externalId, false);
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const bi = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  assert.equal(bi.dailyByProvider.META.filter((d) => d.spendCents !== null).length, 5, "5 dias com investimento Meta");
  assert.ok(bi.dailyByProvider.GOOGLE.every((d) => d.spendCents === null), "Google sem conta: investimento diário null, não zero");
  const g = bi.providers.find((p) => p.provider === "GOOGLE")!;
  const m = bi.providers.find((p) => p.provider === "META")!;
  assert.equal(g.connected, false);
  assert.equal(g.platform.hasSpendData, false);
  assert.equal(g.kpis.cpl, null);
  assert.equal(m.connected, true);
  assert.equal(m.platform.spendCents, 10000);
  assert.equal(m.platform.reach, 4000, "alcance Meta somado");
  assert.equal(m.kpis.platformConversionRate, null, "Meta não reporta conversões → taxa null");

  const google = await makeAccount(companyId, "GOOGLE");
  await makeCampaign(companyId, google, "GOOGLE", "Google B", 1000, 5, { conversions: 4 });
  const bi2 = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  const g2 = bi2.providers.find((p) => p.provider === "GOOGLE")!;
  assert.equal(g2.connected, true);
  assert.equal(g2.platform.platformConversions, 20);
  assert.equal(g2.kpis.platformConversionRate, 20 / 250, "conversões ÷ cliques");
  assert.equal(g2.kpis.costPerPlatformConversion, 5000 / 20, "investimento ÷ conversões");
  assert.equal(g2.platform.reach, null, "Google não fornece alcance → null (tela mostra —)");
  assert.equal(bi2.dailyByProvider.GOOGLE.filter((d) => d.spendCents !== null).length, 5);
  assert.equal(bi2.current.platform.spendCents, 15000, "investimento total = Meta + Google");
});

test("channelCostQuality: canal com CPL maior mas CAC menor é apontado como cliente mais barato; com um só provedor investindo, diz que a comparação depende do outro", async () => {
  const companyId = await makeCompany();
  const meta = await makeAccount(companyId, "META");
  const google = await makeAccount(companyId, "GOOGLE");
  const cm = await makeCampaign(companyId, meta, "META", "Meta", 1000, 10); // R$ 100
  const cg = await makeCampaign(companyId, google, "GOOGLE", "Google", 1800, 10); // R$ 180
  for (let i = 0; i < 10; i++) await makeLead(companyId, "META_ADS", cm.externalId, i < 1, 50000); // CPL R$10, 1 cliente → CAC R$100
  for (let i = 0; i < 10; i++) await makeLead(companyId, "GOOGLE_ADS", cg.externalId, i < 3, 50000); // CPL R$18, 3 clientes → CAC R$60
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const bi = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  const cq = I.channelCostQuality(bi.providers);
  assert.equal(cq.cheapestLead, "META");
  assert.equal(cq.cheapestCustomer, "GOOGLE");
  assert.ok(cq.facts.some((f) => f.includes("Google Ads tem CPL maior que Meta Ads") && f.includes("CAC menor")), cq.facts.join(" | "));

  const only = await makeCompany();
  const m2 = await makeAccount(only, "META");
  const c2 = await makeCampaign(only, m2, "META", "Só Meta", 1000, 3);
  await makeLead(only, "META_ADS", c2.externalId, false);
  const cq2 = I.channelCostQuality((await B.computeCompanyBi(only, TZ, period, B.EMPTY_FILTERS)).providers);
  assert.equal(cq2.cheapestLead, null);
  assert.ok(cq2.facts.some((f) => f.startsWith("Só Meta Ads tem investimento")));
});

test("precisa de atenção: 'Google Ads não conectado' vira fato de INTEGRAÇÃO (informativo) e fatos de campanha carregam o provedor", async () => {
  const companyId = await makeCompany();
  const meta = await makeAccount(companyId, "META");
  await makeCampaign(companyId, meta, "META", "Gasta sem lead", 20000, 3); // R$ 600 sem lead → crítico
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const bi = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  const items = await I.buildAttention(companyId, bi, undefined, new Date("2026-09-15T15:00:00Z"));
  const google = items.find((i) => i.fact.startsWith("Google Ads não conectado"));
  assert.ok(google && google.channel === "INTEGRACAO" && google.severity === "INFORMACAO");
  assert.ok(!items.some((i) => i.fact.startsWith("Meta Ads não conectado")));
  const camp = items.find((i) => i.fact.includes("Gasta sem lead"));
  assert.ok(camp && camp.channel === "META", "fato de campanha marcado com o provedor da campanha");
  const html = VM.attentionBlock(items);
  assert.ok(html.includes("Integração</div>") && html.includes("Meta Ads</div>"), "agrupado por canal");
});

// --- Telas: cenários de conexão, estado vazio do Google, isolamento -------------------------

test("telas: nenhum conectado / só Meta / só Google / ambos — a central renderiza sem erro, Meta e Google sempre aparecem, '—' onde o provedor não fornece, e o Google sem conta mostra estado vazio (nunca 404) com CTA por papel", async () => {
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const admin = await makeUser(false);
  const platformAdmin = await makeUser(true);

  // nenhum conectado
  const none = await makeCompany("Nenhum");
  await makeMembership(admin, none, "COMPANY_ADMIN");
  const b0 = await pageBase(none, admin);
  const h0 = VM.marketingOverviewPage(b0, I.channelCostQuality(b0.bi.providers));
  assert.ok(h0.includes("Investimento Meta Ads") && h0.includes("Investimento Google Ads") && h0.includes("Meta Ads — não conectado") && h0.includes("Google Ads — não conectado"));
  assert.ok(h0.includes("Nenhuma conta Meta Ads está vinculada") && h0.includes("Nenhuma conta Google Ads está vinculada"));

  // só Meta
  const onlyMeta = await makeCompany("Só Meta");
  await makeMembership(admin, onlyMeta, "COMPANY_ADMIN");
  const acc = await makeAccount(onlyMeta, "META");
  const camp = await makeCampaign(onlyMeta, acc, "META", "Corte", 2000, 5);
  await makeLead(onlyMeta, "META_ADS", camp.externalId, true, 20000);
  const b1 = await pageBase(onlyMeta, admin, { demo: true });
  const h1 = VM.marketingOverviewPage(b1, I.channelCostQuality(b1.bi.providers));
  assert.ok(h1.includes("Meta Ads — dados reais") && h1.includes("CRM — dados de demonstração") && h1.includes("híbrido"), "procedência e marcação híbrida quando mistura fontes");
  assert.ok(h1.includes("Investimento Meta Ads") && h1.includes("R$ 100,00"), "investimento Meta no card");
  assert.ok(h1.includes('data-tip="Google Ads não conectado — sem investimento a mostrar (nunca estimado)."'));
  assert.ok(h1.includes("Meta Ads x Google Ads") && h1.includes("Investimento por dia") && h1.includes("Performance por canal") && h1.includes("Custo x qualidade por canal"));
  assert.ok(h1.includes(">Alcance<") && h1.includes("Conv. plataforma"), "tabela master com Alcance e Conv. plataforma");
  const gEmpty = VM.marketingProviderPage({ ...(await pageBase(onlyMeta, admin, { channel: "GOOGLE_ADS" })) }, "GOOGLE", []);
  assert.ok(gEmpty.includes("Google Ads ainda não conectado") && gEmpty.includes("Entre em contato com a Hub Action."), "empty state Google para administrador da empresa");
  const gEmptyAdmin = VM.marketingProviderPage({ ...(await pageBase(onlyMeta, platformAdmin, { channel: "GOOGLE_ADS", isPlatformAdmin: true, role: "AGENT" })) }, "GOOGLE", []);
  assert.ok(gEmptyAdmin.includes("Configurar integração") && gEmptyAdmin.includes('href="/admin/integracoes"'), "administrador geral vê o botão de configurar");
  const metaPage = VM.marketingProviderPage(await pageBase(onlyMeta, admin, { channel: "META_ADS" }), "META", (await M.listAccountsForCompany(onlyMeta)).filter((a) => a.provider === "META"));
  assert.ok(metaPage.includes("Alcance") && metaPage.includes("Frequência") && metaPage.includes("Investimento por campanha") && metaPage.includes("Contas vinculadas"), "dashboard Meta com KPIs próprios");
  assert.ok(!metaPage.includes("Custo por conversão"), "KPI exclusivo do Google não aparece no Meta");

  // só Google
  const onlyGoogle = await makeCompany("Só Google");
  await makeMembership(admin, onlyGoogle, "COMPANY_ADMIN");
  const gacc = await makeAccount(onlyGoogle, "GOOGLE");
  await makeCampaign(onlyGoogle, gacc, "GOOGLE", "Busca", 1500, 5, { conversions: 2 });
  const gPage = VM.marketingProviderPage(await pageBase(onlyGoogle, admin, { channel: "GOOGLE_ADS" }), "GOOGLE", (await M.listAccountsForCompany(onlyGoogle)).filter((a) => a.provider === "GOOGLE"));
  assert.ok(gPage.includes("Conversões") && gPage.includes("Taxa de conversão") && gPage.includes("Custo por conversão") && gPage.includes("CPC médio"), "dashboard Google com KPIs próprios");
  assert.ok(!gPage.includes(">Alcance<") || gPage.includes("—"), "alcance não fornecido pelo Google fica em branco");
  const mEmpty = VM.marketingProviderPage(await pageBase(onlyGoogle, admin, { channel: "META_ADS" }), "META", []);
  assert.ok(mEmpty.includes("Meta Ads ainda não conectado"));

  // ambos
  const both = await makeCompany("Ambos");
  await makeMembership(admin, both, "COMPANY_ADMIN");
  const bm = await makeAccount(both, "META");
  const bg = await makeAccount(both, "GOOGLE");
  await makeCampaign(both, bm, "META", "M1", 1000, 5);
  await makeCampaign(both, bg, "GOOGLE", "G1", 1000, 5);
  const b3 = await pageBase(both, admin);
  const h3 = VM.marketingOverviewPage(b3, I.channelCostQuality(b3.bi.providers));
  assert.ok(h3.includes("Meta Ads — dados reais") && h3.includes("Google Ads — dados reais"));
  assert.ok((h3.match(/legend-item/g) ?? []).length >= 5, "gráfico mestre (Meta, Google) e investimento (Total, Meta, Google) com legendas");
  const campaigns = VM.marketingCampaignsPage(b3);
  assert.ok(campaigns.includes("M1") && campaigns.includes("G1") && campaigns.includes("chip-meta") && campaigns.includes("chip-google"), "tabela master com os dois provedores");
});

test("isolamento multiempresa: campanha, grupos e métricas da empresa A não aparecem para a empresa B nem por id direto", async () => {
  const a = await makeCompany("A");
  const b = await makeCompany("B");
  const accA = await makeAccount(a, "META");
  const campA = await makeCampaign(a, accA, "META", "Só da A", 1000, 3);
  assert.equal(await M.getCampaignForCompany(b, campA.id), undefined, "id de campanha da A pedido no contexto da B → não existe (rota responde 404)");
  assert.deepEqual(await M.listAdGroupsForCampaign(b, campA.id), [], "grupos da campanha da A não vazam para a B");
  assert.ok((await M.getCampaignForCompany(a, campA.id))?.name === "Só da A");
  const period = B.resolvePeriod("30d", {}, TZ, new Date("2026-09-15T15:00:00Z"));
  const biB = await B.computeCompanyBi(b, TZ, period, B.EMPTY_FILTERS);
  assert.equal(biB.campaigns.length, 0);
  assert.equal(biB.providers.find((p) => p.provider === "META")!.connected, false, "a conta da A não conta como conectada para a B");
  assert.equal(biB.current.platform.hasSpendData, false);
});
