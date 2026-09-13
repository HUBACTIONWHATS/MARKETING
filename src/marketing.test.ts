import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-marketing.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_marketing";
process.env.TEST_SCHEMA_RESET = "1";
process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.GOOGLE_CLIENT_ID = "client-id-teste";
process.env.GOOGLE_CLIENT_SECRET = "client-secret-teste";
process.env.META_APP_ID = "app-id-teste";
process.env.META_APP_SECRET = "app-secret-teste";

type Mk = typeof import("./marketingModels.js");
type Oa = typeof import("./marketingOAuth.js");
type Pr = typeof import("./marketingProviders.js");
type Sy = typeof import("./marketingSync.js");
type Cf = typeof import("./conversionFeedback.js");
type DbModule = typeof import("./db.js");

let M: Mk;
let O: Oa;
let P: Pr;
let S: Sy;
let CF: Cf;
let Dbm: DbModule;
let seq = 0;

test.before(async () => {
  M = await import("./marketingModels.js");
  O = await import("./marketingOAuth.js");
  P = await import("./marketingProviders.js");
  S = await import("./marketingSync.js");
  CF = await import("./conversionFeedback.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});
test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  seq += 1;
  return (await Dbm.db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", `Empresa MK ${seq}`, `mk-${seq}`, new Date().toISOString()))!.id;
}
async function makeUser(admin = true): Promise<number> {
  seq += 1;
  return (await Dbm.db.get<{ id: number }>("INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, 'x', ?, 1, ?) RETURNING id", `U${seq}`, `u-${seq}@t.dev`, admin ? 1 : 0, new Date().toISOString()))!.id;
}

const NOW = new Date("2026-09-15T12:00:00Z");

/** fetch falso: roteia por trecho da URL; registra chamadas. */
function fakeFetch(routes: { match: RegExp; status?: number; body: any | ((url: string, init?: any) => any) }[]) {
  const calls: { url: string; method: string }[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const r = routes.find((x) => x.match.test(url));
    if (!r) return { ok: false, status: 404, json: async () => ({ error: { message: "rota falsa não encontrada" } }), text: async () => "" };
    const body = typeof r.body === "function" ? r.body(url, init) : r.body;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

// --- Segurança dos tokens ------------------------------------------------------------------

test("tokens ficam cifrados no banco, nunca em texto puro, e a view nunca os devolve", async () => {
  const userId = await makeUser();
  const id = await M.createConnection({ provider: "META", externalUserId: "123", displayName: "Bruno", scopes: "ads_read", accessToken: "EAAB-token-super-secreto", refreshToken: null, expiresAt: null, createdByUserId: userId });
  const raw = await Dbm.db.get<any>("SELECT * FROM marketing_connections WHERE id = ?", id);
  assert.ok(!raw.encrypted_access_token.includes("EAAB-token-super-secreto"));
  const view = M.toConnectionView(raw);
  assert.equal((view as any).encrypted_access_token, undefined);
  assert.equal((view as any).encrypted_refresh_token, undefined);
  assert.equal(view.hasAccessToken, true);
  assert.ok(!JSON.stringify(view).includes("secreto"));
  const tokens = await M.decryptConnectionTokens(id);
  assert.equal(tokens.accessToken, "EAAB-token-super-secreto");
  await M.revokeConnection(id);
  assert.equal((await M.decryptConnectionTokens(id)).accessToken, null);
  assert.equal((await M.getConnection(id))!.status, "REVOGADA");
});

test("sanitizeText remove padrões de token de mensagens de erro", () => {
  const msg = P.sanitizeText("falhou com access_token=EAABsuperSecret123 e Bearer ya29.abc.def");
  assert.ok(!msg.includes("EAABsuperSecret123"));
  assert.ok(!msg.includes("ya29.abc.def"));
});

// --- OAuth state ------------------------------------------------------------------------------

test("OAuth state: uso único, provedor certo, mesmo usuário, expira; PKCE só no Google", async () => {
  const user = await makeUser();
  const other = await makeUser();
  const g = await O.createOAuthState("GOOGLE", user);
  assert.ok(g.codeChallenge, "Google usa PKCE");
  const m = await O.createOAuthState("META", user);
  assert.equal(m.codeChallenge, null);

  assert.equal((await O.consumeOAuthState("META", g.state, user)).ok, false, "state de outro provedor");
  assert.equal((await O.consumeOAuthState("GOOGLE", g.state, other)).ok, false, "outro usuário");
  const ok = await O.consumeOAuthState("GOOGLE", g.state, user);
  assert.equal(ok.ok, true);
  assert.ok(ok.codeVerifier);
  assert.equal((await O.consumeOAuthState("GOOGLE", g.state, user)).ok, false, "já usado");
  assert.equal((await O.consumeOAuthState("META", "inventado", user)).ok, false, "desconhecido");
  assert.equal((await O.consumeOAuthState("META", undefined, user)).ok, false, "ausente");

  await Dbm.db.run("UPDATE oauth_states SET expires_at = ? WHERE state = ?", new Date(Date.now() - 1000).toISOString(), m.state);
  assert.equal((await O.consumeOAuthState("META", m.state, user)).error, "state expirado");

  const url = O.buildGoogleAuthorizeUrl(O.googleOAuthConfig("https://x.test"), "st", "ch");
  assert.ok(url.includes("code_challenge_method=S256") && url.includes("access_type=offline") && url.includes("redirect_uri=https%3A%2F%2Fx.test%2Fadmin%2Fintegracoes%2Fgoogle%2Fcallback"));
  const murl = O.buildMetaAuthorizeUrl(O.metaOAuthConfig("https://x.test"), "st");
  assert.ok(murl.includes("scope=ads_read%2Cread_insights") && !murl.includes("ads_management"), "só permissões de leitura");
});

// --- Contas, vínculo e isolamento -------------------------------------------------------------

test("vincular conta a uma empresa propaga company_id para campanhas/métricas; desvincular limpa; conta só aparece para a empresa dona", async () => {
  const user = await makeUser();
  const a = await makeCompany();
  const b = await makeCompany();
  const conn = await M.createConnection({ provider: "META", externalUserId: "1", displayName: "x", scopes: "ads_read", accessToken: "t", refreshToken: null, expiresAt: null, createdByUserId: user });
  const acc = await M.upsertAccount({ connectionId: conn, provider: "META", externalAccountId: "act_1", name: "Conta 1", currency: "BRL", timezone: "America/Sao_Paulo", accountStatus: "1", isManager: false, loginCustomerId: null });
  assert.equal(await M.upsertAccount({ connectionId: conn, provider: "META", externalAccountId: "act_1", name: "Conta 1 renomeada", currency: "BRL", timezone: null, accountStatus: "1", isManager: false, loginCustomerId: null }), acc, "upsert por (provider, id externo) é idempotente");
  const camp = await M.upsertCampaign({ accountId: acc, companyId: null, provider: "META", externalId: "c1", name: "Camp", status: "ACTIVE", objective: null, campaignType: null, dailyBudgetCents: null, lifetimeBudgetCents: null, currency: "BRL", startDate: null, endDate: null });
  await M.upsertDailyMetric({ companyId: null, provider: "META", accountId: acc, campaignId: camp, adGroupId: null, adId: null, level: "CAMPAIGN", dimensionKey: "META:CAMPAIGN:act_1:c1::", metricDate: "2026-09-10", currency: "BRL", spendCents: 100, impressions: 1, reach: null, frequency: null, clicks: 1, linkClicks: null, platformConversations: null, platformLeads: null, platformConversions: null, platformConversionValueCents: null, rawMetricsJson: null });

  assert.equal((await M.setAccountSyncEnabled(acc, true)).ok, false, "não ativa sync sem empresa");
  assert.equal((await M.linkAccountToCompany(acc, a, true)).ok, true);
  assert.equal((await M.listAccountsForCompany(a)).length, 1);
  assert.equal((await M.listAccountsForCompany(b)).length, 0);
  assert.equal((await M.listCampaignsForCompany(a)).length, 1);
  assert.equal((await M.listCampaignsForCompany(b)).length, 0);
  assert.equal((await Dbm.db.get<any>("SELECT company_id FROM marketing_metrics_daily WHERE campaign_id = ?", camp)).company_id, a);

  await M.linkAccountToCompany(acc, b, false);
  assert.equal((await M.listCampaignsForCompany(a)).length, 0, "reatribuir muda a empresa dona de tudo");
  assert.equal((await M.listCampaignsForCompany(b)).length, 1);

  await M.unlinkAccount(acc);
  assert.equal((await M.listCampaignsForCompany(b)).length, 0);
  assert.equal((await M.getAccount(acc))!.sync_enabled, 0);
  assert.equal((await M.linkAccountToCompany(acc, 999999, true)).ok, false, "empresa inexistente");
});

test("upsertDailyMetric é idempotente por (dimension_key, data) — sincronizar duas vezes não duplica", async () => {
  const user = await makeUser();
  const conn = await M.createConnection({ provider: "GOOGLE", externalUserId: null, displayName: "g", scopes: "adwords", accessToken: "t", refreshToken: "r", expiresAt: null, createdByUserId: user });
  const acc = await M.upsertAccount({ connectionId: conn, provider: "GOOGLE", externalAccountId: "111", name: "G", currency: "BRL", timezone: null, accountStatus: null, isManager: false, loginCustomerId: null });
  const base = { companyId: null, provider: "GOOGLE" as const, accountId: acc, campaignId: null, adGroupId: null, adId: null, level: "ACCOUNT" as const, dimensionKey: "GOOGLE:ACCOUNT:111:::", metricDate: "2026-09-01", currency: "BRL", impressions: null, reach: null, frequency: null, clicks: null, linkClicks: null, platformConversations: null, platformLeads: null, platformConversions: null, platformConversionValueCents: null, rawMetricsJson: null };
  await M.upsertDailyMetric({ ...base, spendCents: 100 });
  await M.upsertDailyMetric({ ...base, spendCents: 250 });
  const rows = await Dbm.db.all<any>("SELECT spend_cents FROM marketing_metrics_daily WHERE dimension_key = ?", base.dimensionKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spend_cents, 250, "a segunda execução atualiza o dia revisado");
});

// --- Sincronização com API falsa -------------------------------------------------------------

function metaRoutes() {
  return [
    { match: /\/campaigns\?/, body: { data: [{ id: "C1", name: "Campanha Um", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", daily_budget: "5000" }] } },
    { match: /\/adsets\?/, body: { data: [{ id: "S1", name: "Conjunto", status: "ACTIVE", campaign_id: "C1" }] } },
    { match: /\/ads\?/, body: { data: [{ id: "A1", name: "Anúncio", status: "ACTIVE", adset_id: "S1", campaign_id: "C1" }] } },
    {
      match: /\/insights\?/,
      body: (url: string) => {
        const level = /level=campaign/.test(url) ? "campaign" : "ad";
        const days = ["2026-09-13", "2026-09-14", "2026-09-15"];
        return {
          data: days.map((d) => ({
            date_start: d,
            campaign_id: "C1",
            adset_id: level === "ad" ? "S1" : undefined,
            ad_id: level === "ad" ? "A1" : undefined,
            spend: "12.50",
            impressions: "1000",
            reach: "800",
            clicks: "40",
            inline_link_clicks: "30",
            actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "7" }, { action_type: "lead", value: "2" }],
            action_values: [{ action_type: "purchase", value: "150.00" }],
          })),
        };
      },
    },
  ];
}

test("Meta: sincronização inicial (90 dias) e incremental (7 dias) idempotentes, hierarquia campanha→conjunto→anúncio, ações mapeadas sem inventar zero", async () => {
  const user = await makeUser();
  const company = await makeCompany();
  const conn = await M.createConnection({ provider: "META", externalUserId: "1", displayName: "x", scopes: "ads_read", accessToken: "tok", refreshToken: null, expiresAt: null, createdByUserId: user });
  const acc = await M.upsertAccount({ connectionId: conn, provider: "META", externalAccountId: "act_9", name: "Conta", currency: "BRL", timezone: null, accountStatus: "1", isManager: false, loginCustomerId: null });
  await M.linkAccountToCompany(acc, company, true);
  const f = fakeFetch(metaRoutes());
  const r1 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f.impl as any, now: () => NOW });
  assert.equal(r1.ok, true, r1.error);
  assert.equal(r1.windowFrom, "2026-06-17", "primeira sincronização olha 90 dias");
  assert.equal(r1.processed, 6);
  const r2 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f.impl as any, now: () => NOW });
  assert.equal(r2.windowFrom, "2026-09-08", "seguintes só 7 dias");
  const metrics = await Dbm.db.all<any>("SELECT * FROM marketing_metrics_daily WHERE account_id = ? ORDER BY level, metric_date", acc);
  assert.equal(metrics.length, 6, "duas execuções não duplicam");
  const campRow = metrics.find((m: any) => m.level === "CAMPAIGN" && m.metric_date === "2026-09-14");
  assert.equal(campRow.spend_cents, 1250);
  assert.equal(campRow.platform_conversations, 7);
  assert.equal(campRow.platform_leads, 2);
  assert.equal(campRow.platform_conversion_value_cents, 15000);
  assert.equal(campRow.company_id, company);
  assert.equal((await Dbm.db.all("SELECT id FROM marketing_ad_groups WHERE account_id = ?", acc)).length, 1);
  assert.equal((await Dbm.db.all("SELECT id FROM marketing_ads WHERE account_id = ?", acc)).length, 1);
  const runs = await M.listSyncRuns(10);
  assert.equal(runs[0].status, "OK");
  assert.equal(runs[1].trigger_kind, "INICIAL");
  assert.ok(f.calls.every((c) => c.method === "GET"), "só leitura na Meta");
  assert.ok(!f.calls.some((c) => /\/campaigns$|budget|status=/.test(c.url) && c.method !== "GET"));
});

test("Google: OAuth troca código com PKCE, renova token expirado com refresh token, GAQL só via searchStream, campanhas e métricas por dia", async () => {
  const user = await makeUser();
  const company = await makeCompany();
  const f = fakeFetch([
    { match: /oauth2\.googleapis\.com\/token/, body: (_u: string, init: any) => (String(init.body).includes("grant_type=refresh_token") ? { access_token: "novo-token", expires_in: 3600 } : { access_token: "at", refresh_token: "rt", expires_in: 3600 }) },
    { match: /listAccessibleCustomers/, body: { resourceNames: ["customers/123"] } },
    {
      match: /googleAds:searchStream/,
      body: (_u: string, init: any) => {
        const q = JSON.parse(init.body).query as string;
        if (q.startsWith("SELECT customer.id")) return [{ results: [{ customer: { id: "123", descriptiveName: "Cliente", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false } }] }];
        if (q.startsWith("SELECT campaign.id, campaign.name")) return [{ results: [{ campaign: { id: "77", name: "Pesquisa", status: "ENABLED", advertisingChannelType: "SEARCH", startDate: "2026-01-01" }, campaignBudget: { amountMicros: "50000000" } }] }];
        if (q.startsWith("SELECT ad_group.id")) return [{ results: [{ adGroup: { id: "88", name: "Grupo", status: "ENABLED" }, campaign: { id: "77" } }] }];
        if (q.startsWith("SELECT campaign.id, segments.date")) return [{ results: [{ campaign: { id: "77" }, segments: { date: "2026-09-14" }, metrics: { costMicros: "12340000", impressions: "500", clicks: "20", conversions: 3, conversionsValue: 300.5 } }] }];
        return [{ results: [] }];
      },
    },
  ]);
  const tok = await P.googleExchangeCode(f.impl as any, "cid", "sec", "https://x.test/cb", "code", "verifier");
  assert.equal(tok.refreshToken, "rt");
  assert.ok(String((f.calls[0] as any).url).includes("oauth2"));
  const conn = await M.createConnection({ provider: "GOOGLE", externalUserId: null, displayName: "g", scopes: "adwords", accessToken: tok.accessToken, refreshToken: tok.refreshToken, expiresAt: new Date(NOW.getTime() - 1000).toISOString(), createdByUserId: user });
  const ids = await P.googleListAccessibleCustomers(f.impl as any, "at");
  assert.deepEqual(ids, ["123"]);
  const customer = await P.googleGetCustomer(f.impl as any, "at", "123", null);
  assert.equal(customer!.currency, "BRL");
  const acc = await M.upsertAccount({ connectionId: conn, provider: "GOOGLE", ...customer! });
  await M.linkAccountToCompany(acc, company, true);

  const r = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f.impl as any, now: () => NOW });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.processed, 1);
  assert.equal((await M.decryptConnectionTokens(conn)).accessToken, "novo-token", "token expirado foi renovado e regravado cifrado");
  const camp = (await M.listCampaignsForCompany(company))[0];
  assert.equal(camp.name, "Pesquisa");
  assert.equal(camp.daily_budget_cents, 5000);
  const m = await Dbm.db.get<any>("SELECT * FROM marketing_metrics_daily WHERE campaign_id = ?", camp.id);
  assert.equal(m.spend_cents, 1234);
  assert.equal(m.platform_conversions, 3);
  assert.equal(m.platform_conversion_value_cents, 30050);
  assert.equal(m.reach, null, "Google não reporta alcance diário — fica null");
  assert.ok(f.calls.filter((c) => /searchStream/.test(c.url)).every((c) => c.method === "POST"));
  assert.ok(!f.calls.some((c) => /mutate/i.test(c.url)), "nenhuma chamada de escrita");
});

test("erros da API: 401 marca reconexão necessária, 429 mantém conexão (rate limit), erro fica sanitizado na execução", async () => {
  const user = await makeUser();
  const company = await makeCompany();
  const conn = await M.createConnection({ provider: "META", externalUserId: "1", displayName: "x", scopes: "ads_read", accessToken: "EAAB-secreto", refreshToken: null, expiresAt: null, createdByUserId: user });
  const acc = await M.upsertAccount({ connectionId: conn, provider: "META", externalAccountId: "act_err", name: "Conta", currency: "BRL", timezone: null, accountStatus: "1", isManager: false, loginCustomerId: null });
  await M.linkAccountToCompany(acc, company, true);

  const f401 = fakeFetch([{ match: /./, status: 401, body: { error: { message: "Error validating access token EAAB-secreto", code: 190 } } }]);
  const r1 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f401.impl as any, now: () => NOW });
  assert.equal(r1.ok, false);
  assert.equal(r1.errorKind, "AUTH_EXPIRED");
  assert.ok(!r1.error!.includes("EAAB-secreto"), "token nunca aparece no erro");
  assert.equal((await M.getConnection(conn))!.status, "RECONEXAO_NECESSARIA");
  assert.ok((await M.listSyncRuns(1))[0].error_sanitized!.includes("Reconecte"));

  await M.setConnectionStatus(conn, "CONECTADA", null);
  const f429 = fakeFetch([{ match: /./, status: 429, body: { error: { message: "User request limit reached", code: 17 } } }]);
  const r2 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f429.impl as any, now: () => NOW });
  assert.equal(r2.errorKind, "RATE_LIMIT");
  assert.equal((await M.getConnection(conn))!.status, "CONECTADA", "rate limit não derruba a conexão");

  const fNet = fakeFetch([]);
  (fNet as any).impl = async () => {
    throw new Error("ECONNRESET");
  };
  const r3 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: (fNet as any).impl, now: () => NOW });
  assert.equal(r3.errorKind, "NETWORK");

  await M.revokeConnection(conn);
  const r4 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: f401.impl as any, now: () => NOW });
  assert.equal(r4.ok, false);
  assert.match(r4.error!, /revogada/i, "conexão revogada nunca chama a API");
});

test("conta sem empresa vinculada não sincroniza; sincronização em andamento não é duplicada", async () => {
  const user = await makeUser();
  const conn = await M.createConnection({ provider: "META", externalUserId: "1", displayName: "x", scopes: "ads_read", accessToken: "t", refreshToken: null, expiresAt: null, createdByUserId: user });
  const acc = await M.upsertAccount({ connectionId: conn, provider: "META", externalAccountId: "act_nolink", name: "C", currency: "BRL", timezone: null, accountStatus: "1", isManager: false, loginCustomerId: null });
  const r = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: fakeFetch(metaRoutes()).impl as any, now: () => NOW });
  assert.equal(r.ok, false);
  assert.match(r.error!, /sem empresa/);
  const company = await makeCompany();
  await M.linkAccountToCompany(acc, company, true);
  await M.startSyncRun({ companyId: company, provider: "META", accountId: acc, trigger: "MANUAL", windowFrom: null, windowTo: null, createdByUserId: user });
  assert.equal(await M.hasRunningSyncRun(acc), true);
  const r2 = await S.syncAccount(acc, "MANUAL", user, "https://x.test", { fetchImpl: fakeFetch(metaRoutes()).impl as any, now: () => NOW });
  assert.match(r2.error!, /em andamento/);
});

// --- Feedback de conversão (arquitetura, sem envio) -------------------------------------------

test("feedback de conversão: só cria evento para contato atribuído, idempotente, DESATIVADO até ativação explícita, nunca envia", async () => {
  const user = await makeUser();
  const company = await makeCompany();
  seq += 1;
  const contact = (await Dbm.db.get<{ id: number }>("INSERT INTO contacts (company_id, name, phone, created_at, source, attribution_confidence, attribution_provider) VALUES (?, 'L', ?, ?, 'META_ADS', 'CONFIRMADA', 'META') RETURNING id", company, `+55 11 9${seq}`, new Date().toISOString()))!.id;
  const unattributed = (await Dbm.db.get<{ id: number }>("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, 'N', ?, ?) RETURNING id", company, `+55 11 8${seq}`, new Date().toISOString()))!.id;

  const stage = (await Dbm.db.get<{ id: number }>("INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at) VALUES (?, 'Venda', 1, 1, 0, ?) RETURNING id", company, new Date().toISOString()))!.id;
  const oppId = (await Dbm.db.get<{ id: number }>("INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, created_at, updated_at) VALUES (?, ?, ?, 'Op', 100, ?, ?) RETURNING id", company, contact, stage, new Date().toISOString(), new Date().toISOString()))!.id;

  const skip = await CF.recordConversionEvent({ companyId: company, contactId: unattributed, opportunityId: null, eventType: "Purchase", eventTime: new Date().toISOString(), valueCents: 100, currency: "BRL" });
  assert.equal(skip.created, false);

  const first = await CF.recordConversionEvent({ companyId: company, contactId: contact, opportunityId: oppId, eventType: "Purchase", eventTime: new Date().toISOString(), valueCents: 100, currency: "BRL" });
  assert.equal(first.created, true);
  const dup = await CF.recordConversionEvent({ companyId: company, contactId: contact, opportunityId: oppId, eventType: "Purchase", eventTime: new Date().toISOString(), valueCents: 100, currency: "BRL" });
  assert.equal(dup.created, false);
  let events = await CF.listFeedbackEvents(company);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "DESATIVADO");
  assert.equal(events[0].provider, "META");

  await CF.setFeedbackEnabled(company, "META", true, user);
  await CF.recordConversionEvent({ companyId: company, contactId: contact, opportunityId: oppId, eventType: "QualifiedLead", eventTime: new Date().toISOString(), valueCents: null, currency: "BRL" });
  events = await CF.listFeedbackEvents(company);
  assert.equal(events.find((e) => e.event_type === "QualifiedLead")!.status, "PENDENTE");
  const processed = await CF.processPendingFeedback();
  assert.equal(processed.sent, 0, "nada é enviado nesta versão");
  assert.equal(processed.skipped, 1);
  assert.equal((await CF.listFeedbackEvents(await makeCompany())).length, 0, "eventos são por empresa");
});
