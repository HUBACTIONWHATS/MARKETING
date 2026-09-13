/**
 * Clientes SOMENTE LEITURA da Meta Marketing API e da Google Ads API.
 *
 * PROIBIÇÃO EXPRESSA: este módulo não expõe (e não implementa) nenhuma
 * operação que crie, edite, pause, publique, exclua ou altere orçamento,
 * segmentação ou anúncio. Só: troca/renovação de token OAuth, listagem de
 * contas, listagem de campanhas/grupos/anúncios e leitura de métricas.
 *
 * Referências confirmadas em setembro/2026 (ver PROGRESSO.md, Etapa 15):
 * - Meta: permissões de leitura ads_read + read_insights; versão da Graph API
 *   por variável (META_GRAPH_API_VERSION). Insights: /act_{id}/insights com
 *   level, time_increment=1 e time_range.
 * - Google Ads API v25 (julho/2026). Desde 09/09/2026 o developer token é
 *   opcional e ignorado — o nível de acesso vem do projeto Google Cloud dono
 *   das credenciais OAuth. Header `developer-token` só é enviado se
 *   GOOGLE_ADS_DEVELOPER_TOKEN estiver definido (compatibilidade), e
 *   `login-customer-id` quando a conta é acessada via conta gerenciadora (MCC).
 *   Relatórios via GoogleAdsService.searchStream (GAQL).
 *
 * `fetch` é injetável para testes (nenhum teste chama a internet).
 * Erros nunca carregam token: ver sanitizeProviderError.
 */
import { googleAdsApiVersion, metaGraphVersion } from "./marketingOAuth";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export type ProviderErrorKind = "AUTH_EXPIRED" | "PERMISSION" | "RATE_LIMIT" | "NETWORK" | "INVALID" | "UNKNOWN";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    /** Mensagem segura para guardar/mostrar ao administrador — nunca contém token. */
    public readonly sanitized: string
  ) {
    super(sanitized);
  }
}

const TOKEN_PATTERN = /(access_token|refresh_token|EAA[A-Za-z0-9]+|ya29\.[A-Za-z0-9._-]+|Bearer\s+\S+)/gi;

export function sanitizeText(text: string): string {
  return text.replace(TOKEN_PATTERN, "[removido]").slice(0, 300);
}

function classifyHttp(status: number, body: any): ProviderError {
  const metaCode = body?.error?.code;
  const metaMsg = typeof body?.error?.message === "string" ? body.error.message : "";
  const googleStatus = body?.error?.status ?? body?.[0]?.error?.status;
  const googleMsg = typeof body?.error?.message === "string" ? body.error.message : typeof body?.[0]?.error?.message === "string" ? body[0].error.message : "";
  const msg = sanitizeText(metaMsg || googleMsg || `HTTP ${status}`);
  if (status === 401 || metaCode === 190 || googleStatus === "UNAUTHENTICATED") return new ProviderError("AUTH_EXPIRED", `Autorização expirada ou revogada (${msg}). Reconecte a conta.`);
  if (status === 403 || metaCode === 10 || metaCode === 200 || googleStatus === "PERMISSION_DENIED") return new ProviderError("PERMISSION", `Sem permissão na plataforma (${msg}).`);
  if (status === 429 || metaCode === 4 || metaCode === 17 || metaCode === 32 || metaCode === 613 || googleStatus === "RESOURCE_EXHAUSTED") {
    return new ProviderError("RATE_LIMIT", `Limite de requisições da plataforma atingido (${msg}). Tente mais tarde.`);
  }
  if (status >= 400 && status < 500) return new ProviderError("INVALID", `A plataforma recusou a consulta (${msg}).`);
  return new ProviderError("UNKNOWN", `Falha ao consultar a plataforma (${msg}).`);
}

async function request(fetchImpl: FetchLike, url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<any> {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ProviderError("NETWORK", `Falha de rede ao chamar a plataforma (${sanitizeText(err instanceof Error ? err.message : String(err))}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw classifyHttp(res.status, body);
  return body;
}

// ============================================================================
// META MARKETING API (leitura)
// ============================================================================

const GRAPH = () => `https://graph.facebook.com/${metaGraphVersion()}`;

export interface MetaTokenResult {
  accessToken: string;
  expiresAt: string | null;
}

export async function metaExchangeCode(fetchImpl: FetchLike, appId: string, appSecret: string, redirectUri: string, code: string): Promise<MetaTokenResult> {
  const p = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  const body = await request(fetchImpl, `${GRAPH()}/oauth/access_token?${p.toString()}`);
  const shortToken: string = body.access_token;
  // Token longo (~60 dias) — evita reconexão a cada 1–2 horas.
  const p2 = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken });
  const long = await request(fetchImpl, `${GRAPH()}/oauth/access_token?${p2.toString()}`);
  const expiresIn = Number(long.expires_in ?? body.expires_in ?? 0);
  return { accessToken: long.access_token ?? shortToken, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null };
}

export async function metaGetMe(fetchImpl: FetchLike, token: string): Promise<{ id: string; name: string | null }> {
  const body = await request(fetchImpl, `${GRAPH()}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  return { id: String(body.id), name: body.name ?? null };
}

async function metaPaged(fetchImpl: FetchLike, firstUrl: string, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  while (url && pages < maxPages) {
    const body = await request(fetchImpl, url);
    out.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
    pages += 1;
  }
  return out;
}

export interface ProviderAccount {
  externalAccountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: string | null;
  isManager: boolean;
  loginCustomerId: string | null;
}

export async function metaListAdAccounts(fetchImpl: FetchLike, token: string): Promise<ProviderAccount[]> {
  const url = `${GRAPH()}/me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status&limit=100&access_token=${encodeURIComponent(token)}`;
  const rows = await metaPaged(fetchImpl, url);
  return rows.map((r) => ({
    externalAccountId: String(r.id), // "act_123"
    name: r.name ?? null,
    currency: r.currency ?? null,
    timezone: r.timezone_name ?? null,
    accountStatus: r.account_status !== undefined ? String(r.account_status) : null,
    isManager: false,
    loginCustomerId: null,
  }));
}

export interface ProviderCampaign {
  externalId: string;
  name: string;
  status: string | null;
  objective: string | null;
  campaignType: string | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  startDate: string | null;
  endDate: string | null;
}

export async function metaListCampaigns(fetchImpl: FetchLike, token: string, actId: string): Promise<ProviderCampaign[]> {
  const url = `${GRAPH()}/${actId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time&limit=100&access_token=${encodeURIComponent(token)}`;
  const rows = await metaPaged(fetchImpl, url);
  return rows.map((r) => ({
    externalId: String(r.id),
    name: String(r.name ?? r.id),
    status: r.effective_status ?? r.status ?? null,
    objective: r.objective ?? null,
    campaignType: null,
    dailyBudgetCents: r.daily_budget !== undefined ? Number(r.daily_budget) : null, // a Meta já devolve na menor unidade da moeda
    lifetimeBudgetCents: r.lifetime_budget !== undefined ? Number(r.lifetime_budget) : null,
    startDate: r.start_time ? String(r.start_time).slice(0, 10) : null,
    endDate: r.stop_time ? String(r.stop_time).slice(0, 10) : null,
  }));
}

export interface ProviderAdGroup {
  externalId: string;
  campaignExternalId: string;
  name: string;
  status: string | null;
}

export async function metaListAdSets(fetchImpl: FetchLike, token: string, actId: string): Promise<ProviderAdGroup[]> {
  const url = `${GRAPH()}/${actId}/adsets?fields=id,name,status,effective_status,campaign_id&limit=200&access_token=${encodeURIComponent(token)}`;
  const rows = await metaPaged(fetchImpl, url);
  return rows.map((r) => ({ externalId: String(r.id), campaignExternalId: String(r.campaign_id), name: String(r.name ?? r.id), status: r.effective_status ?? r.status ?? null }));
}

export interface ProviderAd {
  externalId: string;
  campaignExternalId: string;
  adGroupExternalId: string | null;
  name: string;
  status: string | null;
}

export async function metaListAds(fetchImpl: FetchLike, token: string, actId: string): Promise<ProviderAd[]> {
  const url = `${GRAPH()}/${actId}/ads?fields=id,name,status,effective_status,adset_id,campaign_id&limit=200&access_token=${encodeURIComponent(token)}`;
  const rows = await metaPaged(fetchImpl, url);
  return rows.map((r) => ({
    externalId: String(r.id),
    campaignExternalId: String(r.campaign_id),
    adGroupExternalId: r.adset_id ? String(r.adset_id) : null,
    name: String(r.name ?? r.id),
    status: r.effective_status ?? r.status ?? null,
  }));
}

export interface ProviderDailyMetric {
  date: string; // YYYY-MM-DD
  campaignExternalId: string | null;
  adGroupExternalId: string | null;
  adExternalId: string | null;
  spendCents: number;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  linkClicks: number | null;
  platformConversations: number | null;
  platformLeads: number | null;
  platformConversions: number | null;
  platformConversionValueCents: number | null;
  raw: Record<string, unknown>;
}

function actionValue(actions: any[] | undefined, types: string[]): number | null {
  if (!Array.isArray(actions)) return null;
  let found = false;
  let total = 0;
  for (const a of actions) {
    if (types.includes(a?.action_type)) {
      found = true;
      total += Number(a.value ?? 0);
    }
  }
  return found ? total : null;
}

/** Nomes de ação documentados pela Meta para "conversas iniciadas por mensagem" e "leads". Ausência = null (nunca zero inventado). */
const META_MESSAGING_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];
const META_LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped"];
const META_PURCHASE_ACTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

function toCents(amount: unknown): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Insights diários por campanha/conjunto/anúncio (time_increment=1). Limite da Meta: janela ≤ 37 meses; usamos janelas curtas. */
export async function metaDailyInsights(
  fetchImpl: FetchLike,
  token: string,
  actId: string,
  level: "campaign" | "adset" | "ad",
  since: string,
  until: string
): Promise<ProviderDailyMetric[]> {
  const fields = "campaign_id,adset_id,ad_id,spend,impressions,reach,frequency,clicks,inline_link_clicks,actions,action_values,date_start";
  const p = new URLSearchParams({
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields,
    limit: "500",
    access_token: token,
  });
  const rows = await metaPaged(fetchImpl, `${GRAPH()}/${actId}/insights?${p.toString()}`);
  return rows.map((r) => {
    const conversations = actionValue(r.actions, META_MESSAGING_ACTIONS);
    const leads = actionValue(r.actions, META_LEAD_ACTIONS);
    const purchases = actionValue(r.actions, META_PURCHASE_ACTIONS);
    const purchaseValue = actionValue(r.action_values, META_PURCHASE_ACTIONS);
    const { actions, action_values, ...rest } = r;
    return {
      date: String(r.date_start),
      campaignExternalId: r.campaign_id ? String(r.campaign_id) : null,
      adGroupExternalId: r.adset_id ? String(r.adset_id) : null,
      adExternalId: r.ad_id ? String(r.ad_id) : null,
      spendCents: toCents(r.spend),
      impressions: r.impressions !== undefined ? Number(r.impressions) : null,
      reach: r.reach !== undefined ? Number(r.reach) : null,
      frequency: r.frequency !== undefined ? Number(r.frequency) : null,
      clicks: r.clicks !== undefined ? Number(r.clicks) : null,
      linkClicks: r.inline_link_clicks !== undefined ? Number(r.inline_link_clicks) : null,
      platformConversations: conversations,
      platformLeads: leads,
      platformConversions: purchases ?? leads,
      platformConversionValueCents: purchaseValue !== null ? Math.round(purchaseValue * 100) : null,
      raw: { ...rest, actions: Array.isArray(actions) ? actions.slice(0, 40) : undefined, action_values: Array.isArray(action_values) ? action_values.slice(0, 40) : undefined },
    };
  });
}

// ============================================================================
// GOOGLE ADS API (leitura, GAQL via searchStream)
// ============================================================================

const GOOGLE_ADS = () => `https://googleads.googleapis.com/${googleAdsApiVersion()}`;

export interface GoogleTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export async function googleExchangeCode(fetchImpl: FetchLike, clientId: string, clientSecret: string, redirectUri: string, code: string, codeVerifier: string | null): Promise<GoogleTokenResult> {
  const p = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code });
  if (codeVerifier) p.set("code_verifier", codeVerifier);
  const body = await request(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  const expiresIn = Number(body.expires_in ?? 0);
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null };
}

export async function googleRefreshToken(fetchImpl: FetchLike, clientId: string, clientSecret: string, refreshToken: string): Promise<GoogleTokenResult> {
  const p = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
  const body = await request(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  const expiresIn = Number(body.expires_in ?? 0);
  return { accessToken: body.access_token, refreshToken: null, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null };
}

function googleHeaders(token: string, loginCustomerId: string | null): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // Opcional e ignorado pela API desde 09/09/2026; mantido só por compatibilidade quando configurado.
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) h["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (loginCustomerId) h["login-customer-id"] = loginCustomerId.replace(/-/g, "");
  return h;
}

export async function googleListAccessibleCustomers(fetchImpl: FetchLike, token: string): Promise<string[]> {
  const body = await request(fetchImpl, `${GOOGLE_ADS()}/customers:listAccessibleCustomers`, { method: "GET", headers: googleHeaders(token, null) });
  const names: string[] = body.resourceNames ?? [];
  return names.map((n) => n.replace(/^customers\//, ""));
}

/** GAQL só de LEITURA (searchStream). Nunca usado para mutate. */
export async function googleSearch(fetchImpl: FetchLike, token: string, customerId: string, loginCustomerId: string | null, query: string): Promise<any[]> {
  const body = await request(fetchImpl, `${GOOGLE_ADS()}/customers/${customerId.replace(/-/g, "")}/googleAds:searchStream`, {
    method: "POST",
    headers: googleHeaders(token, loginCustomerId),
    body: JSON.stringify({ query }),
  });
  const chunks: any[] = Array.isArray(body) ? body : [body];
  return chunks.flatMap((c) => c?.results ?? []);
}

export async function googleGetCustomer(fetchImpl: FetchLike, token: string, customerId: string, loginCustomerId: string | null): Promise<ProviderAccount | null> {
  const rows = await googleSearch(
    fetchImpl,
    token,
    customerId,
    loginCustomerId,
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer LIMIT 1"
  );
  const c = rows[0]?.customer;
  if (!c) return null;
  return {
    externalAccountId: String(c.id),
    name: c.descriptiveName ?? null,
    currency: c.currencyCode ?? null,
    timezone: c.timeZone ?? null,
    accountStatus: c.status ?? null,
    isManager: !!c.manager,
    loginCustomerId: loginCustomerId,
  };
}

/** Contas-cliente diretas de uma conta gerenciadora (MCC) — só 1 nível, o suficiente para vincular por empresa. */
export async function googleListCustomerClients(fetchImpl: FetchLike, token: string, managerId: string): Promise<ProviderAccount[]> {
  const rows = await googleSearch(
    fetchImpl,
    token,
    managerId,
    managerId,
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1"
  );
  return rows
    .map((r) => r.customerClient)
    .filter((c) => c && Number(c.level ?? 0) >= 1)
    .map((c) => ({
      externalAccountId: String(c.id),
      name: c.descriptiveName ?? null,
      currency: c.currencyCode ?? null,
      timezone: c.timeZone ?? null,
      accountStatus: c.status ?? null,
      isManager: !!c.manager,
      loginCustomerId: managerId,
    }));
}

function microsToCents(micros: unknown): number | null {
  if (micros === undefined || micros === null) return null;
  const n = Number(micros);
  return Number.isFinite(n) ? Math.round(n / 10000) : null;
}

export async function googleListCampaigns(fetchImpl: FetchLike, token: string, customerId: string, loginCustomerId: string | null): Promise<ProviderCampaign[]> {
  const rows = await googleSearch(
    fetchImpl,
    token,
    customerId,
    loginCustomerId,
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'"
  );
  return rows.map((r) => ({
    externalId: String(r.campaign.id),
    name: String(r.campaign.name ?? r.campaign.id),
    status: r.campaign.status ?? null,
    objective: null,
    campaignType: r.campaign.advertisingChannelType ?? null,
    dailyBudgetCents: microsToCents(r.campaignBudget?.amountMicros),
    lifetimeBudgetCents: null,
    startDate: r.campaign.startDate ?? null,
    endDate: r.campaign.endDate ?? null,
  }));
}

export async function googleListAdGroups(fetchImpl: FetchLike, token: string, customerId: string, loginCustomerId: string | null): Promise<ProviderAdGroup[]> {
  const rows = await googleSearch(
    fetchImpl,
    token,
    customerId,
    loginCustomerId,
    "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'"
  );
  return rows.map((r) => ({ externalId: String(r.adGroup.id), campaignExternalId: String(r.campaign.id), name: String(r.adGroup.name ?? r.adGroup.id), status: r.adGroup.status ?? null }));
}

/** Métricas diárias por campanha (segments.date). Consulta pequena e separada, testável isoladamente. */
export async function googleDailyCampaignMetrics(fetchImpl: FetchLike, token: string, customerId: string, loginCustomerId: string | null, since: string, until: string): Promise<ProviderDailyMetric[]> {
  const rows = await googleSearch(
    fetchImpl,
    token,
    customerId,
    loginCustomerId,
    `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' AND campaign.status != 'REMOVED'`
  );
  return rows.map((r) => {
    const m = r.metrics ?? {};
    return {
      date: String(r.segments?.date),
      campaignExternalId: String(r.campaign.id),
      adGroupExternalId: null,
      adExternalId: null,
      spendCents: microsToCents(m.costMicros) ?? 0,
      impressions: m.impressions !== undefined ? Number(m.impressions) : null,
      reach: null, // o Google não expõe alcance por dia nesse relatório
      frequency: null,
      clicks: m.clicks !== undefined ? Number(m.clicks) : null,
      linkClicks: null,
      platformConversations: null,
      platformLeads: null,
      platformConversions: m.conversions !== undefined ? Number(m.conversions) : null,
      platformConversionValueCents: m.conversionsValue !== undefined ? Math.round(Number(m.conversionsValue) * 100) : null,
      raw: { ctr: m.ctr, average_cpc_micros: m.averageCpc },
    };
  });
}
