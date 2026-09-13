import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-bi.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_bi";
process.env.TEST_SCHEMA_RESET = "1";
process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

type Bi = typeof import("./bi.js");
type Ins = typeof import("./insights.js");
type Al = typeof import("./alerts.js");
type Mk = typeof import("./marketingModels.js");
type Crm = typeof import("./crm.js");
type DbModule = typeof import("./db.js");

let B: Bi;
let I: Ins;
let AL: Al;
let M: Mk;
let C: Crm;
let Dbm: DbModule;
let seq = 0;
const TZ = "America/Sao_Paulo";

test.before(async () => {
  B = await import("./bi.js");
  I = await import("./insights.js");
  AL = await import("./alerts.js");
  M = await import("./marketingModels.js");
  C = await import("./crm.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});
test.after(async () => {
  await Dbm.db.close();
});

const now = new Date("2026-09-15T15:00:00Z");
const today = "2026-09-15";
const daysAgo = (n: number, h = 12) => new Date(Date.UTC(2026, 8, 15 - n, h)).toISOString();

async function makeCompany(): Promise<number> {
  seq += 1;
  const id = (await Dbm.db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", `Empresa BI ${seq}`, `bi-${seq}`, daysAgo(60)))!.id;
  await C.ensureDefaultPipelineStages(id);
  return id;
}
async function makeUser(companyId: number, role = "AGENT"): Promise<number> {
  seq += 1;
  const id = (await Dbm.db.get<{ id: number }>("INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, 'x', 0, 1, ?) RETURNING id", `Atendente ${seq}`, `at-${seq}@t.dev`, daysAgo(60)))!.id;
  await Dbm.db.run("INSERT INTO memberships (user_id, company_id, role, created_at) VALUES (?, ?, ?, ?)", id, companyId, role, daysAgo(60));
  return id;
}
async function makeContact(companyId: number, createdAt: string, source: string, confidence: string, campaignExt: string | null = null): Promise<number> {
  seq += 1;
  return (
    await Dbm.db.get<{ id: number }>(
      "INSERT INTO contacts (company_id, name, phone, created_at, source, attribution_confidence, attribution_provider, external_campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      companyId,
      `Lead ${seq}`,
      `+55 11 9${String(seq).padStart(4, "0")}-1111`,
      createdAt,
      source,
      confidence,
      source === "META_ADS" ? "META" : source === "GOOGLE_ADS" ? "GOOGLE" : null,
      campaignExt
    )
  )!.id;
}
async function stageByName(companyId: number, name: string): Promise<number> {
  return (await Dbm.db.get<{ id: number }>("SELECT id FROM pipeline_stages WHERE company_id = ? AND name = ?", companyId, name))!.id;
}
async function makeOpportunity(companyId: number, contactId: number, opts: { createdAt: string; qualifiedAt?: string | null; scheduledAt?: string | null; attendedAt?: string | null; wonAt?: string | null; valueCents?: number; responsible?: number | null }): Promise<number> {
  const stage = await stageByName(companyId, opts.wonAt ? "Venda concluída" : opts.qualifiedAt ? "Qualificado" : "Novo contato");
  return (
    await Dbm.db.get<{ id: number }>(
      "INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, responsible_user_id, scheduled_at, created_at, updated_at, closed_at, qualified_at, attended_at) VALUES (?, ?, ?, 'Op', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      companyId,
      contactId,
      stage,
      opts.valueCents ?? 0,
      opts.responsible ?? null,
      opts.scheduledAt ?? null,
      opts.createdAt,
      opts.createdAt,
      opts.wonAt ?? null,
      opts.qualifiedAt ?? null,
      opts.attendedAt ?? null
    )
  )!.id;
}
async function makeAccount(companyId: number, provider: "META" | "GOOGLE", currency = "BRL"): Promise<{ accountId: number; connectionId: number }> {
  const connectionId = await M.createConnection({ provider, externalUserId: "u", displayName: "Conta", scopes: "ads_read", accessToken: "tok", refreshToken: null, expiresAt: null, createdByUserId: 1 });
  seq += 1;
  const accountId = await M.upsertAccount({ connectionId, provider, externalAccountId: `${provider}-${seq}`, name: `Conta ${seq}`, currency, timezone: TZ, accountStatus: "1", isManager: false, loginCustomerId: null });
  await M.linkAccountToCompany(accountId, companyId, true);
  return { accountId, connectionId };
}
async function makeCampaignWithSpend(companyId: number, accountId: number, provider: "META" | "GOOGLE", name: string, spendPerDayCents: number, days: number, currency = "BRL", impressions = 1000, clicks = 50): Promise<{ id: number; externalId: string }> {
  seq += 1;
  const externalId = `camp-${seq}`;
  const id = await M.upsertCampaign({ accountId, companyId, provider, externalId, name, status: "ACTIVE", objective: "MESSAGES", campaignType: null, dailyBudgetCents: 5000, lifetimeBudgetCents: null, currency, startDate: null, endDate: null });
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2026, 8, 15 - d)).toISOString().slice(0, 10);
    await M.upsertDailyMetric({
      companyId,
      provider,
      accountId,
      campaignId: id,
      adGroupId: null,
      adId: null,
      level: "CAMPAIGN",
      dimensionKey: `${provider}:CAMPAIGN:${accountId}:${externalId}::`,
      metricDate: date,
      currency,
      spendCents: spendPerDayCents,
      impressions,
      reach: null,
      frequency: null,
      clicks,
      linkClicks: null,
      platformConversations: provider === "META" ? 5 : null,
      platformLeads: null,
      platformConversions: null,
      platformConversionValueCents: null,
      rawMetricsJson: null,
    });
  }
  return { id, externalId };
}

// --- Fórmulas puras ------------------------------------------------------------------------

test("ratio nunca divide por zero e deltaPercent trata ausência como null (não zero)", () => {
  assert.equal(B.ratio(10, 0), null);
  assert.equal(B.ratio(10, null), null);
  assert.equal(B.ratio(null, 5), null);
  assert.equal(B.ratio(10, 4), 2.5);
  assert.equal(B.deltaPercent(120, 100), 20);
  assert.equal(B.deltaPercent(80, 100), -20);
  assert.equal(B.deltaPercent(10, 0), null);
  assert.equal(B.deltaPercent(null, 100), null);
});

test("deriveKpis: CPL, CAC, ROAS, taxas e ticket com as fórmulas pedidas; sem investimento tudo fica '—' (null)", () => {
  const platform = B.aggregatePlatform([{ provider: "META", account_id: 1, campaign_id: 1, level: "CAMPAIGN", metric_date: today, currency: "BRL", spend_cents: 100000, impressions: 10000, reach: 8000, frequency: null, clicks: 500, link_clicks: null, platform_conversations: 100, platform_leads: null, platform_conversions: null, platform_conversion_value_cents: null } as any]);
  const crm = { conversations: 100, leads: 40, qualified: 25, appointments: 18, attendances: 12, sales: 8, newCustomers: 8, revenueCents: 480000, attributedLeads: 40, attributedSales: 8, attributedRevenueCents: 480000, confirmedLeads: 40, probableLeads: 0, unattributedLeads: 0 };
  const k = B.deriveKpis(platform, crm);
  assert.equal(k.costPerConversation, 1000);
  assert.equal(k.cpl, 2500);
  assert.equal(k.cplQualified, 4000);
  assert.equal(Math.round(k.costPerAppointment!), 5556);
  assert.equal(Math.round(k.costPerAttendance!), 8333);
  assert.equal(k.cac, 12500);
  assert.equal(k.roasCrm, 4.8);
  assert.equal(k.ticketCents, 60000);
  assert.equal(k.qualificationRate, 0.625);
  assert.equal(k.closeRate, 0.32);
  assert.equal(platform.ctr, 0.05);
  assert.equal(platform.cpc, 200);
  assert.equal(platform.cpm, 10000);
  assert.equal(platform.frequency, 1.25);

  const empty = B.aggregatePlatform([]);
  const k2 = B.deriveKpis(empty, { ...crm, leads: 0, sales: 0, newCustomers: 0, qualified: 0 });
  assert.equal(k2.cpl, null);
  assert.equal(k2.cac, null);
  assert.equal(k2.roasCrm, null);
  assert.equal(k2.closeRate, null);
  assert.equal(empty.hasSpendData, false);
  assert.equal(empty.impressions, null, "métrica não reportada fica null, não zero");
});

test("resolvePeriod: presets, período anterior de mesma duração, mês atual x mesmo trecho do mês anterior, personalizado invertido", () => {
  const p30 = B.resolvePeriod("30d", {}, TZ, now);
  assert.deepEqual(p30.current, { from: "2026-08-17", to: "2026-09-15" });
  assert.deepEqual(p30.previous, { from: "2026-07-18", to: "2026-08-16" });
  const p7 = B.resolvePeriod("7d", {}, TZ, now);
  assert.deepEqual(p7.current, { from: "2026-09-09", to: "2026-09-15" });
  assert.deepEqual(p7.previous, { from: "2026-09-02", to: "2026-09-08" });
  const mes = B.resolvePeriod("mes_atual", {}, TZ, now);
  assert.deepEqual(mes.current, { from: "2026-09-01", to: "2026-09-15" });
  assert.deepEqual(mes.previous, { from: "2026-08-01", to: "2026-08-15" });
  const passado = B.resolvePeriod("mes_passado", {}, TZ, now);
  assert.deepEqual(passado.current, { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(passado.previous, { from: "2026-07-01", to: "2026-07-31" });
  const custom = B.resolvePeriod("personalizado", { from: "2026-09-10", to: "2026-09-01" }, TZ, now);
  assert.deepEqual(custom.current, { from: "2026-09-01", to: "2026-09-10" });
  assert.equal(B.resolvePeriod("qualquer", {}, TZ, now).preset, "30d");
  assert.equal(B.resolvePeriod("personalizado", { from: "x" }, TZ, now).preset, "30d");
  assert.equal(B.resolvePeriod("hoje", {}, TZ, now).previousLabel, "ontem");
});

// --- BI com banco: funil, atribuição, campanhas, canais, isolamento ------------

test("computeCompanyBi liga investimento → leads → qualificados → vendas por campanha e canal, sem misturar conversões da plataforma", async () => {
  const companyId = await makeCompany();
  const agent = await makeUser(companyId);
  const { accountId } = await makeAccount(companyId, "META");
  const camp = await makeCampaignWithSpend(companyId, accountId, "META", "Corte Premium", 10000, 10); // R$ 100/dia x 10 = R$ 1.000
  const gAcc = await makeAccount(companyId, "GOOGLE");
  await makeCampaignWithSpend(companyId, gAcc.accountId, "GOOGLE", "Pesquisa Barbearia", 5000, 10); // R$ 500

  // 4 leads Meta confirmados nesta campanha, 2 orgânicos, 1 desconhecido
  const leads: number[] = [];
  for (let i = 0; i < 4; i++) leads.push(await makeContact(companyId, daysAgo(5), "META_ADS", "CONFIRMADA", camp.externalId));
  for (let i = 0; i < 2; i++) leads.push(await makeContact(companyId, daysAgo(4), "ORGANICO", "PROVAVEL"));
  leads.push(await makeContact(companyId, daysAgo(3), "DESCONHECIDA", "NAO_ATRIBUIDA"));
  // 2 qualificados Meta, 1 venda Meta R$ 600, 1 venda orgânica R$ 200
  await makeOpportunity(companyId, leads[0], { createdAt: daysAgo(5), qualifiedAt: daysAgo(4), scheduledAt: daysAgo(3), attendedAt: daysAgo(2), wonAt: daysAgo(1), valueCents: 60000, responsible: agent });
  await makeOpportunity(companyId, leads[1], { createdAt: daysAgo(5), qualifiedAt: daysAgo(4), responsible: agent });
  await makeOpportunity(companyId, leads[4], { createdAt: daysAgo(4), qualifiedAt: daysAgo(3), wonAt: daysAgo(1), valueCents: 20000, responsible: agent });

  const period = B.resolvePeriod("30d", {}, TZ, now);
  const bi = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  const c = bi.current;
  assert.equal(c.platform.spendCents, 150000);
  assert.equal(c.crm.leads, 7);
  assert.equal(c.crm.qualified, 3);
  assert.equal(c.crm.appointments, 1);
  assert.equal(c.crm.attendances, 1);
  assert.equal(c.crm.sales, 2);
  assert.equal(c.crm.revenueCents, 80000);
  assert.equal(c.crm.attributedSales, 1, "só a venda do lead Meta é atribuída a anúncios");
  assert.equal(c.crm.attributedRevenueCents, 60000);
  assert.equal(c.crm.unattributedLeads, 1);
  assert.equal(c.kpis.cpl, 150000 / 7);
  assert.equal(c.kpis.cac, 75000, "investimento total ÷ 2 clientes novos");
  assert.equal(c.kpis.roasCrm, 60000 / 150000, "ROAS CRM usa só receita atribuída");
  assert.equal(c.platform.platformConversations, 50, "conversas da plataforma (Meta) ficam separadas dos leads do CRM");

  const metaRow = bi.campaigns.find((r) => r.campaign.name === "Corte Premium")!;
  assert.equal(metaRow.platform.spendCents, 100000);
  assert.equal(metaRow.crm.leads, 4);
  assert.equal(metaRow.crm.sales, 1);
  assert.equal(metaRow.kpis.cpl, 25000);
  assert.equal(metaRow.kpis.cac, 100000);
  const googleRow = bi.campaigns.find((r) => r.campaign.name === "Pesquisa Barbearia")!;
  assert.equal(googleRow.crm.leads, 0);
  assert.equal(googleRow.kpis.cpl, null, "sem lead atribuído: CPL indisponível, não zero");

  const meta = bi.providers.find((p) => p.provider === "META")!;
  const google = bi.providers.find((p) => p.provider === "GOOGLE")!;
  assert.equal(meta.crm.leads, 4);
  assert.equal(google.platform.spendCents, 50000);
  assert.equal(google.crm.leads, 0);
  const organico = bi.channels.find((r) => r.source === "ORGANICO")!;
  assert.equal(organico.spendCents, null, "canal orgânico não tem investimento");
  assert.equal(organico.crm.sales, 1);

  // Filtro por canal reflete em tudo.
  const onlyMeta = await B.computeCompanyBi(companyId, TZ, period, { ...B.EMPTY_FILTERS, channel: "META_ADS" });
  assert.equal(onlyMeta.current.crm.leads, 4);
  assert.equal(onlyMeta.current.platform.spendCents, 100000);
  assert.equal(onlyMeta.daily.length, 30);
  assert.equal(onlyMeta.daily.reduce((s, d) => s + (d.spendCents ?? 0), 0), 100000);

  // Filtro por campanha.
  const onlyCamp = await B.computeCompanyBi(companyId, TZ, period, { ...B.EMPTY_FILTERS, campaignId: camp.id });
  assert.equal(onlyCamp.current.crm.leads, 4);

  // Atendente.
  const att = bi.attendants.find((a) => a.userId === agent)!;
  assert.equal(att.sales, 2);
  assert.equal(att.revenueCents, 80000);
  assert.equal(att.closeRate, 2 / 3);
  assert.equal(bi.attendantMatrix[0].bySource.META_ADS.sales, 1);
  assert.equal(bi.attendantMatrix[0].bySource.ORGANICO.sales, 1);
});

test("isolamento: a empresa B não vê investimento, campanhas nem leads da empresa A (e vice-versa)", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const accA = await makeAccount(a, "META");
  await makeCampaignWithSpend(a, accA.accountId, "META", "Só da A", 10000, 3);
  await makeContact(a, daysAgo(1), "META_ADS", "CONFIRMADA");
  const period = B.resolvePeriod("30d", {}, TZ, now);
  const biB = await B.computeCompanyBi(b, TZ, period, B.EMPTY_FILTERS);
  assert.equal(biB.current.platform.hasSpendData, false);
  assert.equal(biB.campaigns.length, 0);
  assert.equal(biB.current.crm.leads, 0);
  assert.equal(biB.hasAnyIntegration, false);
  assert.equal((await M.listAccountsForCompany(b)).length, 0);
  assert.equal((await M.listCampaignsForCompany(b)).length, 0);
  assert.equal(await M.getCampaignForCompany(b, (await M.listCampaignsForCompany(a))[0].id), undefined);
});

test("moedas diferentes na mesma empresa: sinalizadas, nunca somadas em silêncio", async () => {
  const companyId = await makeCompany();
  const acc1 = await makeAccount(companyId, "META", "BRL");
  const acc2 = await makeAccount(companyId, "GOOGLE", "USD");
  await makeCampaignWithSpend(companyId, acc1.accountId, "META", "BRL camp", 1000, 2, "BRL");
  await makeCampaignWithSpend(companyId, acc2.accountId, "GOOGLE", "USD camp", 1000, 2, "USD");
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("7d", {}, TZ, now), B.EMPTY_FILTERS);
  assert.equal(bi.current.platform.mixedCurrency, true);
  assert.deepEqual([...bi.current.platform.currencies].sort(), ["BRL", "USD"]);
});

test("empresa sem integração e sem dados: tudo '—'/zero sem quebrar, e comparação com período anterior sem base", async () => {
  const companyId = await makeCompany();
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("7d", {}, TZ, now), B.EMPTY_FILTERS);
  assert.equal(bi.hasAnyIntegration, false);
  assert.equal(bi.hasAnyCrmData, false);
  assert.equal(bi.current.kpis.cpl, null);
  assert.equal(bi.current.kpis.roasCrm, null);
  assert.equal(B.deltaPercent(bi.current.crm.leads, bi.previous.crm.leads), null);
  const health = await I.healthScore(companyId, bi, null, now);
  assert.equal(health.semaphore, "CINZA");
  assert.equal(health.score, null);
  assert.ok(I.executiveSummary(bi).includes("Nenhuma conta de anúncios"));
});

test("fuso horário: lead criado às 23h em São Paulo (02h UTC do dia seguinte) conta no dia local certo", async () => {
  const companyId = await makeCompany();
  await makeContact(companyId, "2026-09-16T01:30:00Z", "SITE", "PROVAVEL"); // 22:30 de 15/09 em SP
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("personalizado", { from: "2026-09-15", to: "2026-09-15" }, TZ, now), B.EMPTY_FILTERS);
  assert.equal(bi.current.crm.leads, 1);
  const biNext = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("personalizado", { from: "2026-09-16", to: "2026-09-16" }, TZ, now), B.EMPTY_FILTERS);
  assert.equal(biNext.current.crm.leads, 0);
});

// --- Inteligência --------------------------------------------------------------------------

test("projectMonth: atingimento, faltam, média diária necessária e projeção linear transparentes", async () => {
  const companyId = await makeCompany();
  const c = await makeContact(companyId, daysAgo(10), "ORGANICO", "PROVAVEL");
  await makeOpportunity(companyId, c, { createdAt: daysAgo(10), qualifiedAt: daysAgo(9), wonAt: daysAgo(2), valueCents: 5248000 });
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("mes_atual", {}, TZ, now), B.EMPTY_FILTERS);
  const p = I.projectMonth(bi.current, { revenue_cents: 8000000, new_customers: null, leads: null, qualified_leads: null, appointments: null, attendances: null, max_cac_cents: null, max_cpl_cents: null, min_roas: null, planned_monthly_spend_cents: null }, TZ, now);
  const rev = p.items[0];
  assert.equal(p.daysElapsed, 15);
  assert.equal(p.daysRemaining, 15);
  assert.equal(rev.actual, 5248000);
  assert.equal(rev.attainment, 0.656);
  assert.equal(rev.remaining, 2752000);
  assert.equal(Math.round(rev.neededPerDay!), 183467);
  assert.equal(Math.round(rev.projected!), 10496000);
  assert.ok(p.headline!.includes("acima da meta"));
});

test("detectBottlenecks: só aponta 'possível gargalo' com amostra >= 10 e conversão baixa", () => {
  const snap = (clicks: number | null, conv: number, qual: number, appt: number, att: number, sales: number) =>
    ({
      period: { from: today, to: today },
      platform: { ...B.aggregatePlatform([]), clicks },
      crm: { conversations: conv, leads: conv, qualified: qual, appointments: appt, attendances: att, sales, newCustomers: sales, revenueCents: 0, attributedLeads: 0, attributedSales: 0, attributedRevenueCents: 0, confirmedLeads: 0, probableLeads: 0, unattributedLeads: 0 },
      kpis: B.deriveKpis(B.aggregatePlatform([]), { conversations: conv, leads: conv, qualified: qual, appointments: appt, attendances: att, sales, newCustomers: sales, revenueCents: 0, attributedLeads: 0, attributedSales: 0, attributedRevenueCents: 0, confirmedLeads: 0, probableLeads: 0, unattributedLeads: 0 }),
    }) as any;
  const found = I.detectBottlenecks(snap(1000, 50, 5, 4, 3, 3));
  assert.ok(found.some((b) => b.fromLabel === "Cliques" && b.hypothesis.startsWith("Possível gargalo")));
  assert.ok(found.some((b) => b.fromLabel === "Conversas"));
  assert.equal(I.detectBottlenecks(snap(null, 5, 1, 0, 0, 0)).length, 0, "amostra pequena não gera gargalo");
  assert.equal(I.detectBottlenecks(snap(100, 60, 40, 30, 25, 12)).length, 0, "funil saudável não gera gargalo");
});

test("precisa de atenção + alertas: campanha gastando sem lead, dedupe por dia, status por empresa", async () => {
  const companyId = await makeCompany();
  const { accountId } = await makeAccount(companyId, "META");
  await makeCampaignWithSpend(companyId, accountId, "META", "Sem lead", 20000, 3); // R$ 600 sem nenhum lead
  const period = B.resolvePeriod("7d", {}, TZ, now);
  const bi = await B.computeCompanyBi(companyId, TZ, period, B.EMPTY_FILTERS);
  const items = await I.buildAttention(companyId, bi, I.DEFAULT_THRESHOLDS, now);
  const semLead = items.find((i) => i.metric === "investimento_sem_lead");
  assert.ok(semLead, "deveria alertar investimento sem lead atribuído");
  assert.equal(semLead!.severity, "CRITICO");
  assert.match(semLead!.fact, /R\$\s600,00/); // Intl usa espaço não separável depois de "R$"

  await AL.evaluateAlerts(companyId, bi, now);
  await AL.evaluateAlerts(companyId, bi, now);
  const open = await AL.listAlerts(companyId, "ABERTO");
  assert.equal(open.filter((a) => a.metric === "investimento_sem_lead").length, 1, "mesmo fato no mesmo dia não duplica");

  const other = await makeCompany();
  assert.equal((await AL.listAlerts(other, "TODOS")).length, 0, "alertas são por empresa");
  assert.equal(await AL.updateAlertStatus(other, open[0].id, "RESOLVIDO", null), false, "outra empresa não altera o alerta");
  assert.equal(await AL.updateAlertStatus(companyId, open[0].id, "RESOLVIDO", null), true);
  assert.equal((await AL.listAlerts(companyId, "RESOLVIDO")).length, 1);

  // Limiar configurável: com limiar alto, o alerta some.
  await AL.saveThreshold(companyId, "spendWithoutLeadCents", 100000);
  const t = await AL.thresholdsFor(companyId);
  assert.equal(t.spendWithoutLeadCents, 100000);
  const items2 = await I.buildAttention(companyId, bi, t, now);
  assert.ok(!items2.some((i) => i.metric === "investimento_sem_lead"));
});

test("costVsQuality: a campanha de menor CPL não é automaticamente a melhor", async () => {
  const companyId = await makeCompany();
  const { accountId } = await makeAccount(companyId, "META");
  const cheap = await makeCampaignWithSpend(companyId, accountId, "META", "Barata", 8000, 10); // R$ 800
  const good = await makeCampaignWithSpend(companyId, accountId, "META", "Cara mas boa", 9000, 10); // R$ 900
  for (let i = 0; i < 100; i++) {
    const c = await makeContact(companyId, daysAgo(3), "META_ADS", "CONFIRMADA", cheap.externalId);
    if (i < 3) await makeOpportunity(companyId, c, { createdAt: daysAgo(3), qualifiedAt: daysAgo(2), wonAt: daysAgo(1), valueCents: 10000 });
  }
  for (let i = 0; i < 50; i++) {
    const c = await makeContact(companyId, daysAgo(3), "META_ADS", "CONFIRMADA", good.externalId);
    if (i < 12) await makeOpportunity(companyId, c, { createdAt: daysAgo(3), qualifiedAt: daysAgo(2), wonAt: daysAgo(1), valueCents: 10000 });
  }
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("30d", {}, TZ, now), B.EMPTY_FILTERS); // cobre os 10 dias de gasto
  const cq = I.costVsQuality(bi.campaigns);
  assert.equal(cq.cheapest!.campaign.name, "Barata");
  assert.equal(cq.bestCac!.campaign.name, "Cara mas boa");
  assert.ok(cq.text!.includes("Não classifique campanhas só pelo CPL"));
  assert.equal(cq.cheapest!.kpis.cpl, 800); // R$ 8,00
  assert.equal(cq.bestCac!.kpis.cac, 7500); // R$ 75,00
});

test("score de lead, leads quentes, oportunidades paradas e telefone mascarado", async () => {
  const companyId = await makeCompany();
  const hot = await makeContact(companyId, daysAgo(2), "META_ADS", "CONFIRMADA");
  await makeOpportunity(companyId, hot, { createdAt: daysAgo(2), qualifiedAt: daysAgo(1), scheduledAt: daysAgo(0), attendedAt: daysAgo(0) }); // 5+10+25+25+40 = 105
  const cold = await makeContact(companyId, daysAgo(1), "DESCONHECIDA", "NAO_ATRIBUIDA"); // 5
  const scored = await I.scoreLeads(companyId, now);
  const h = scored.find((s) => s.contactId === hot)!;
  const c = scored.find((s) => s.contactId === cold)!;
  assert.equal(h.score, 105);
  assert.equal(h.temperature, "ALTA_INTENCAO");
  assert.equal(c.score, 5);
  assert.equal(c.temperature, "FRIO");
  assert.ok(!h.phoneMasked.includes("9000-"), "telefone precisa sair mascarado");
  assert.ok(I.hotLeads(scored).some((l) => l.contactId === hot));
  assert.ok(!I.hotLeads(scored).some((l) => l.contactId === cold));

  // Parada: qualificada sem interação há 30h.
  const stale = await makeContact(companyId, daysAgo(5), "SITE", "PROVAVEL");
  await makeOpportunity(companyId, stale, { createdAt: daysAgo(5), qualifiedAt: daysAgo(4), valueCents: 30000 });
  await Dbm.db.run("INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at) VALUES (?, ?, 'SIMULADO', 'AUTOMATICO', 'HUMANO', ?, ?)", companyId, stale, daysAgo(5), daysAgo(2));
  const convId = (await Dbm.db.get<{ id: number }>("SELECT id FROM conversations WHERE contact_id = ?", stale))!.id;
  await Dbm.db.run("INSERT INTO messages (company_id, conversation_id, author_type, body, send_status, created_at) VALUES (?, ?, 'HUMANO', 'oi', 'ENVIADA', ?)", companyId, convId, daysAgo(2));
  const stalled = I.stalledOpportunities(await I.scoreLeads(companyId, now), undefined, now);
  assert.ok(stalled.some((s) => s.lead.contactId === stale && /qualificado/i.test(s.reason)));
  // Isolamento: outra empresa não vê esses leads.
  assert.equal((await I.scoreLeads(await makeCompany(), now)).length, 0);
});

test("healthScore: fórmula transparente com componentes e semáforo vermelho quando há integração quebrada", async () => {
  const companyId = await makeCompany();
  const { accountId, connectionId } = await makeAccount(companyId, "META");
  await makeCampaignWithSpend(companyId, accountId, "META", "C", 1000, 5);
  for (let i = 0; i < 10; i++) {
    const c = await makeContact(companyId, daysAgo(3), "META_ADS", "CONFIRMADA");
    await makeOpportunity(companyId, c, { createdAt: daysAgo(3), qualifiedAt: daysAgo(2), wonAt: i < 4 ? daysAgo(1) : null, valueCents: 10000 });
  }
  const bi = await B.computeCompanyBi(companyId, TZ, B.resolvePeriod("7d", {}, TZ, now), B.EMPTY_FILTERS);
  const h1 = await I.healthScore(companyId, bi, null, now);
  assert.ok(h1.score !== null);
  assert.equal(h1.components.length, 5);
  assert.ok(h1.components.every((c) => c.explanation.length > 0));
  await M.setConnectionStatus(connectionId, "RECONEXAO_NECESSARIA", "token expirado");
  const h2 = await I.healthScore(companyId, bi, null, now);
  assert.equal(h2.semaphore, "VERMELHO");
  assert.ok(h2.reasons.some((r) => r.includes("reconexão")));
});

test("moveOpportunity grava qualified_at/attended_at uma vez e informa os marcos alcançados", async () => {
  const companyId = await makeCompany();
  const c = await makeContact(companyId, daysAgo(1), "SITE", "PROVAVEL");
  const opp = await C.createOpportunity({ companyId, contactId: c, title: "X", valueCents: 100 });
  const r1 = await C.moveOpportunity(companyId, opp.id, await stageByName(companyId, "Qualificado"));
  assert.deepEqual(r1.reached, { qualified: true, attended: false, won: false });
  const r2 = await C.moveOpportunity(companyId, opp.id, await stageByName(companyId, "Compareceu"));
  assert.deepEqual(r2.reached, { qualified: false, attended: true, won: false });
  const r3 = await C.moveOpportunity(companyId, opp.id, await stageByName(companyId, "Venda concluída"));
  assert.deepEqual(r3.reached, { qualified: false, attended: false, won: true });
  const row = await C.getOpportunity(companyId, opp.id);
  assert.ok(row!.qualified_at && row!.attended_at && row!.closed_at);
  // Voltar de etapa não apaga os marcos.
  await C.moveOpportunity(companyId, opp.id, await stageByName(companyId, "Novo contato"));
  const back = await C.getOpportunity(companyId, opp.id);
  assert.ok(back!.qualified_at && back!.attended_at);
  assert.equal(back!.closed_at, null);
});
