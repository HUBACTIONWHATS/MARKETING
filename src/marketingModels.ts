/**
 * Camada de dados de mídia paga (Meta Ads / Google Ads) — SOMENTE LEITURA da
 * plataforma; aqui só existe o espelho local sincronizado (ver
 * marketingSync.ts). Regras fixas:
 * - tokens só cifrados (credentialCrypto) e nunca devolvidos a views
 *   (toConnectionView remove os campos);
 * - toda leitura de negócio é escopada por company_id — uma empresa nunca
 *   enxerga conta/campanha/métrica de outra;
 * - company_id fica denormalizado em campanhas/grupos/anúncios/métricas
 *   (propagateCompany) para consultas de BI rápidas e isolamento simples.
 */
import { decryptSecret, encryptSecret } from "./credentialCrypto";
import { db, type DbClient } from "./db";

export type MarketingProvider = "META" | "GOOGLE";
export type ConnectionStatus = "CONECTADA" | "EXPIRADA" | "ERRO" | "REVOGADA" | "RECONEXAO_NECESSARIA";

export const PROVIDER_LABELS: Record<MarketingProvider, string> = { META: "Meta Ads", GOOGLE: "Google Ads" };

export interface MarketingConnection {
  id: number;
  provider: MarketingProvider;
  status: ConnectionStatus;
  external_user_id: string | null;
  display_name: string | null;
  scopes: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error_sanitized: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export type ConnectionView = Omit<MarketingConnection, "encrypted_access_token" | "encrypted_refresh_token"> & {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
};

export function toConnectionView(c: MarketingConnection): ConnectionView {
  const { encrypted_access_token, encrypted_refresh_token, ...rest } = c;
  return { ...rest, hasAccessToken: !!encrypted_access_token, hasRefreshToken: !!encrypted_refresh_token };
}

export interface MarketingAccount {
  id: number;
  connection_id: number;
  company_id: number | null;
  provider: MarketingProvider;
  external_account_id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  account_status: string | null;
  is_manager: number;
  login_customer_id: string | null;
  sync_enabled: number;
  linked_at: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error_sanitized: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingAccountWithConnection extends MarketingAccount {
  connection_status: ConnectionStatus;
  connection_display_name: string | null;
  company_name: string | null;
}

export interface MarketingCampaign {
  id: number;
  company_id: number | null;
  account_id: number;
  provider: MarketingProvider;
  external_id: string;
  name: string;
  status: string | null;
  objective: string | null;
  campaign_type: string | null;
  daily_budget_cents: number | null;
  lifetime_budget_cents: number | null;
  currency: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricsDailyInput {
  companyId: number | null;
  provider: MarketingProvider;
  accountId: number;
  campaignId: number | null;
  adGroupId: number | null;
  adId: number | null;
  level: "ACCOUNT" | "CAMPAIGN" | "ADGROUP" | "AD";
  dimensionKey: string;
  metricDate: string; // YYYY-MM-DD
  currency: string | null;
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
  rawMetricsJson: string | null;
}

export interface SyncRun {
  id: number;
  company_id: number | null;
  provider: MarketingProvider;
  account_id: number | null;
  trigger_kind: "MANUAL" | "AUTO" | "INICIAL";
  status: "RODANDO" | "OK" | "ERRO";
  started_at: string;
  finished_at: string | null;
  window_from: string | null;
  window_to: string | null;
  processed_count: number;
  error_sanitized: string | null;
  created_by_user_id: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Conexões ------------------------------------------------------------------

export async function createConnection(input: {
  provider: MarketingProvider;
  externalUserId: string | null;
  displayName: string | null;
  scopes: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  createdByUserId: number;
}): Promise<number> {
  const at = nowIso();
  const row = await db.get<{ id: number }>(
    `INSERT INTO marketing_connections
      (provider, status, external_user_id, display_name, scopes, encrypted_access_token, encrypted_refresh_token, token_expires_at, created_by_user_id, created_at, updated_at)
     VALUES (?, 'CONECTADA', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.provider,
    input.externalUserId,
    input.displayName,
    input.scopes,
    encryptSecret(input.accessToken),
    input.refreshToken ? encryptSecret(input.refreshToken) : null,
    input.expiresAt,
    input.createdByUserId,
    at,
    at
  );
  return row!.id;
}

export function getConnection(id: number): Promise<MarketingConnection | undefined> {
  return db.get<MarketingConnection>("SELECT * FROM marketing_connections WHERE id = ?", id);
}

export function listConnections(): Promise<MarketingConnection[]> {
  return db.all<MarketingConnection>("SELECT * FROM marketing_connections ORDER BY id DESC");
}

/** Só a sincronização usa isto — nunca uma view. Lança se a chave não decifra. */
export async function decryptConnectionTokens(id: number): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const c = await getConnection(id);
  if (!c) return { accessToken: null, refreshToken: null };
  return {
    accessToken: c.encrypted_access_token ? decryptSecret(c.encrypted_access_token) : null,
    refreshToken: c.encrypted_refresh_token ? decryptSecret(c.encrypted_refresh_token) : null,
  };
}

export async function updateConnectionTokens(id: number, tokens: { accessToken: string; refreshToken?: string | null; expiresAt: string | null }): Promise<void> {
  if (tokens.refreshToken !== undefined) {
    await db.run(
      "UPDATE marketing_connections SET encrypted_access_token = ?, encrypted_refresh_token = ?, token_expires_at = ?, status = 'CONECTADA', last_error_sanitized = NULL, updated_at = ? WHERE id = ?",
      encryptSecret(tokens.accessToken),
      tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokens.expiresAt,
      nowIso(),
      id
    );
    return;
  }
  await db.run(
    "UPDATE marketing_connections SET encrypted_access_token = ?, token_expires_at = ?, status = 'CONECTADA', last_error_sanitized = NULL, updated_at = ? WHERE id = ?",
    encryptSecret(tokens.accessToken),
    tokens.expiresAt,
    nowIso(),
    id
  );
}

export async function setConnectionStatus(id: number, status: ConnectionStatus, errorSanitized: string | null): Promise<void> {
  await db.run("UPDATE marketing_connections SET status = ?, last_error_sanitized = ?, updated_at = ? WHERE id = ?", status, errorSanitized, nowIso(), id);
}

export async function markConnectionSync(id: number, ok: boolean, errorSanitized: string | null): Promise<void> {
  const at = nowIso();
  if (ok) {
    await db.run("UPDATE marketing_connections SET last_sync_at = ?, last_success_at = ?, last_error_sanitized = NULL, updated_at = ? WHERE id = ?", at, at, at, id);
  } else {
    await db.run("UPDATE marketing_connections SET last_sync_at = ?, last_error_sanitized = ?, updated_at = ? WHERE id = ?", at, errorSanitized, at, id);
  }
}

/** Revogação local: apaga os tokens cifrados e desliga a sincronização das contas. Não chama a plataforma. */
export async function revokeConnection(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE marketing_connections SET status = 'REVOGADA', encrypted_access_token = NULL, encrypted_refresh_token = NULL, updated_at = ? WHERE id = ?",
      nowIso(),
      id
    );
    await tx.run("UPDATE marketing_accounts SET sync_enabled = 0, updated_at = ? WHERE connection_id = ?", nowIso(), id);
  });
}

// --- Contas ----------------------------------------------------------------------

export async function upsertAccount(input: {
  connectionId: number;
  provider: MarketingProvider;
  externalAccountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: string | null;
  isManager: boolean;
  loginCustomerId: string | null;
}): Promise<number> {
  const at = nowIso();
  const existing = await db.get<{ id: number }>("SELECT id FROM marketing_accounts WHERE provider = ? AND external_account_id = ?", input.provider, input.externalAccountId);
  if (existing) {
    await db.run(
      "UPDATE marketing_accounts SET connection_id = ?, name = ?, currency = ?, timezone = ?, account_status = ?, is_manager = ?, login_customer_id = COALESCE(?, login_customer_id), updated_at = ? WHERE id = ?",
      input.connectionId,
      input.name,
      input.currency,
      input.timezone,
      input.accountStatus,
      input.isManager ? 1 : 0,
      input.loginCustomerId,
      at,
      existing.id
    );
    return existing.id;
  }
  const row = await db.get<{ id: number }>(
    `INSERT INTO marketing_accounts (connection_id, provider, external_account_id, name, currency, timezone, account_status, is_manager, login_customer_id, sync_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id`,
    input.connectionId,
    input.provider,
    input.externalAccountId,
    input.name,
    input.currency,
    input.timezone,
    input.accountStatus,
    input.isManager ? 1 : 0,
    input.loginCustomerId,
    at,
    at
  );
  return row!.id;
}

export function getAccount(id: number): Promise<MarketingAccount | undefined> {
  return db.get<MarketingAccount>("SELECT * FROM marketing_accounts WHERE id = ?", id);
}

const ACCOUNT_WITH_CONNECTION_SQL = `SELECT a.*, c.status AS connection_status, c.display_name AS connection_display_name, co.name AS company_name
  FROM marketing_accounts a
  JOIN marketing_connections c ON c.id = a.connection_id
  LEFT JOIN companies co ON co.id = a.company_id`;

export function listAllAccounts(): Promise<MarketingAccountWithConnection[]> {
  return db.all<MarketingAccountWithConnection>(`${ACCOUNT_WITH_CONNECTION_SQL} ORDER BY a.provider, a.name`);
}

export function listAccountsForCompany(companyId: number): Promise<MarketingAccountWithConnection[]> {
  return db.all<MarketingAccountWithConnection>(`${ACCOUNT_WITH_CONNECTION_SQL} WHERE a.company_id = ? ORDER BY a.provider, a.name`, companyId);
}

export function listAccountsForConnection(connectionId: number): Promise<MarketingAccount[]> {
  return db.all<MarketingAccount>("SELECT * FROM marketing_accounts WHERE connection_id = ? ORDER BY name", connectionId);
}

/** Mantém company_id denormalizado em campanhas/grupos/anúncios/métricas da conta. */
async function propagateCompany(tx: DbClient, accountId: number, companyId: number | null): Promise<void> {
  const at = nowIso();
  await tx.run("UPDATE marketing_campaigns SET company_id = ?, updated_at = ? WHERE account_id = ?", companyId, at, accountId);
  await tx.run("UPDATE marketing_ad_groups SET company_id = ?, updated_at = ? WHERE account_id = ?", companyId, at, accountId);
  await tx.run("UPDATE marketing_ads SET company_id = ?, updated_at = ? WHERE account_id = ?", companyId, at, accountId);
  await tx.run("UPDATE marketing_metrics_daily SET company_id = ?, updated_at = ? WHERE account_id = ?", companyId, at, accountId);
}

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

/** Vincula uma conta a UMA empresa (a Hub Action decide). Sem empresa, nada dela aparece em lugar nenhum. */
export async function linkAccountToCompany(accountId: number, companyId: number, enableSync: boolean): Promise<AdminActionResult> {
  const account = await getAccount(accountId);
  if (!account) return { ok: false, error: "Conta não encontrada." };
  const company = await db.get<{ id: number }>("SELECT id FROM companies WHERE id = ?", companyId);
  if (!company) return { ok: false, error: "Empresa não encontrada." };
  await db.transaction(async (tx) => {
    await tx.run(
      "UPDATE marketing_accounts SET company_id = ?, sync_enabled = ?, linked_at = ?, updated_at = ? WHERE id = ?",
      companyId,
      enableSync ? 1 : 0,
      nowIso(),
      nowIso(),
      accountId
    );
    await propagateCompany(tx, accountId, companyId);
  });
  return { ok: true };
}

export async function unlinkAccount(accountId: number): Promise<AdminActionResult> {
  const account = await getAccount(accountId);
  if (!account) return { ok: false, error: "Conta não encontrada." };
  await db.transaction(async (tx) => {
    await tx.run("UPDATE marketing_accounts SET company_id = NULL, sync_enabled = 0, linked_at = NULL, updated_at = ? WHERE id = ?", nowIso(), accountId);
    await propagateCompany(tx, accountId, null);
  });
  return { ok: true };
}

export async function setAccountSyncEnabled(accountId: number, enabled: boolean): Promise<AdminActionResult> {
  const account = await getAccount(accountId);
  if (!account) return { ok: false, error: "Conta não encontrada." };
  if (enabled && !account.company_id) return { ok: false, error: "Vincule a conta a uma empresa antes de ativar a sincronização." };
  await db.run("UPDATE marketing_accounts SET sync_enabled = ?, updated_at = ? WHERE id = ?", enabled ? 1 : 0, nowIso(), accountId);
  return { ok: true };
}

export async function markAccountSync(accountId: number, ok: boolean, errorSanitized: string | null): Promise<void> {
  const at = nowIso();
  if (ok) {
    await db.run("UPDATE marketing_accounts SET last_sync_at = ?, last_success_at = ?, last_error_sanitized = NULL, updated_at = ? WHERE id = ?", at, at, at, accountId);
  } else {
    await db.run("UPDATE marketing_accounts SET last_sync_at = ?, last_error_sanitized = ?, updated_at = ? WHERE id = ?", at, errorSanitized, at, accountId);
  }
}

// --- Campanhas / grupos / anúncios ---------------------------------------------

export async function upsertCampaign(input: {
  accountId: number;
  companyId: number | null;
  provider: MarketingProvider;
  externalId: string;
  name: string;
  status: string | null;
  objective: string | null;
  campaignType: string | null;
  dailyBudgetCents: number | null;
  lifetimeBudgetCents: number | null;
  currency: string | null;
  startDate: string | null;
  endDate: string | null;
}): Promise<number> {
  const at = nowIso();
  const existing = await db.get<{ id: number }>("SELECT id FROM marketing_campaigns WHERE account_id = ? AND external_id = ?", input.accountId, input.externalId);
  if (existing) {
    await db.run(
      `UPDATE marketing_campaigns SET company_id = ?, name = ?, status = ?, objective = ?, campaign_type = ?, daily_budget_cents = ?, lifetime_budget_cents = ?, currency = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?`,
      input.companyId,
      input.name,
      input.status,
      input.objective,
      input.campaignType,
      input.dailyBudgetCents,
      input.lifetimeBudgetCents,
      input.currency,
      input.startDate,
      input.endDate,
      at,
      existing.id
    );
    return existing.id;
  }
  const row = await db.get<{ id: number }>(
    `INSERT INTO marketing_campaigns (company_id, account_id, provider, external_id, name, status, objective, campaign_type, daily_budget_cents, lifetime_budget_cents, currency, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.companyId,
    input.accountId,
    input.provider,
    input.externalId,
    input.name,
    input.status,
    input.objective,
    input.campaignType,
    input.dailyBudgetCents,
    input.lifetimeBudgetCents,
    input.currency,
    input.startDate,
    input.endDate,
    at,
    at
  );
  return row!.id;
}

export async function upsertAdGroup(input: {
  accountId: number;
  companyId: number | null;
  campaignId: number;
  provider: MarketingProvider;
  externalId: string;
  name: string;
  status: string | null;
}): Promise<number> {
  const at = nowIso();
  const existing = await db.get<{ id: number }>("SELECT id FROM marketing_ad_groups WHERE account_id = ? AND external_id = ?", input.accountId, input.externalId);
  if (existing) {
    await db.run("UPDATE marketing_ad_groups SET company_id = ?, campaign_id = ?, name = ?, status = ?, updated_at = ? WHERE id = ?", input.companyId, input.campaignId, input.name, input.status, at, existing.id);
    return existing.id;
  }
  const row = await db.get<{ id: number }>(
    "INSERT INTO marketing_ad_groups (company_id, account_id, campaign_id, provider, external_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    input.companyId,
    input.accountId,
    input.campaignId,
    input.provider,
    input.externalId,
    input.name,
    input.status,
    at,
    at
  );
  return row!.id;
}

export async function upsertAd(input: {
  accountId: number;
  companyId: number | null;
  campaignId: number;
  adGroupId: number | null;
  provider: MarketingProvider;
  externalId: string;
  name: string;
  status: string | null;
}): Promise<number> {
  const at = nowIso();
  const existing = await db.get<{ id: number }>("SELECT id FROM marketing_ads WHERE account_id = ? AND external_id = ?", input.accountId, input.externalId);
  if (existing) {
    await db.run(
      "UPDATE marketing_ads SET company_id = ?, campaign_id = ?, ad_group_id = ?, name = ?, status = ?, updated_at = ? WHERE id = ?",
      input.companyId,
      input.campaignId,
      input.adGroupId,
      input.name,
      input.status,
      at,
      existing.id
    );
    return existing.id;
  }
  const row = await db.get<{ id: number }>(
    "INSERT INTO marketing_ads (company_id, account_id, campaign_id, ad_group_id, provider, external_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    input.companyId,
    input.accountId,
    input.campaignId,
    input.adGroupId,
    input.provider,
    input.externalId,
    input.name,
    input.status,
    at,
    at
  );
  return row!.id;
}

export function listCampaignsForCompany(companyId: number): Promise<MarketingCampaign[]> {
  return db.all<MarketingCampaign>("SELECT * FROM marketing_campaigns WHERE company_id = ? ORDER BY name", companyId);
}

export function getCampaignForCompany(companyId: number, campaignId: number): Promise<MarketingCampaign | undefined> {
  return db.get<MarketingCampaign>("SELECT * FROM marketing_campaigns WHERE id = ? AND company_id = ?", campaignId, companyId);
}

export function listCampaignsForAccount(accountId: number): Promise<MarketingCampaign[]> {
  return db.all<MarketingCampaign>("SELECT * FROM marketing_campaigns WHERE account_id = ? ORDER BY name", accountId);
}

export function listAdGroupsForCampaign(companyId: number, campaignId: number): Promise<{ id: number; external_id: string; name: string; status: string | null }[]> {
  return db.all("SELECT id, external_id, name, status FROM marketing_ad_groups WHERE campaign_id = ? AND company_id = ? ORDER BY name", campaignId, companyId);
}

export function listAdsForCampaign(companyId: number, campaignId: number): Promise<{ id: number; external_id: string; name: string; status: string | null; ad_group_id: number | null }[]> {
  return db.all("SELECT id, external_id, name, status, ad_group_id FROM marketing_ads WHERE campaign_id = ? AND company_id = ? ORDER BY name", campaignId, companyId);
}

// --- Métricas diárias (idempotente por dimension_key + data) ----------------

export async function upsertDailyMetric(m: MetricsDailyInput): Promise<void> {
  const at = nowIso();
  await db.run(
    `INSERT INTO marketing_metrics_daily
      (company_id, provider, account_id, campaign_id, ad_group_id, ad_id, level, dimension_key, metric_date, currency,
       spend_cents, impressions, reach, frequency, clicks, link_clicks, platform_conversations, platform_leads,
       platform_conversions, platform_conversion_value_cents, raw_metrics_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dimension_key, metric_date) DO UPDATE SET
       company_id = excluded.company_id, campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id, ad_id = excluded.ad_id,
       currency = excluded.currency, spend_cents = excluded.spend_cents, impressions = excluded.impressions, reach = excluded.reach,
       frequency = excluded.frequency, clicks = excluded.clicks, link_clicks = excluded.link_clicks,
       platform_conversations = excluded.platform_conversations, platform_leads = excluded.platform_leads,
       platform_conversions = excluded.platform_conversions, platform_conversion_value_cents = excluded.platform_conversion_value_cents,
       raw_metrics_json = excluded.raw_metrics_json, updated_at = excluded.updated_at`,
    m.companyId,
    m.provider,
    m.accountId,
    m.campaignId,
    m.adGroupId,
    m.adId,
    m.level,
    m.dimensionKey,
    m.metricDate,
    m.currency,
    m.spendCents,
    m.impressions,
    m.reach,
    m.frequency,
    m.clicks,
    m.linkClicks,
    m.platformConversations,
    m.platformLeads,
    m.platformConversions,
    m.platformConversionValueCents,
    m.rawMetricsJson,
    at,
    at
  );
}

// --- Execuções de sincronização ----------------------------------------------

export async function startSyncRun(input: {
  companyId: number | null;
  provider: MarketingProvider;
  accountId: number | null;
  trigger: "MANUAL" | "AUTO" | "INICIAL";
  windowFrom: string | null;
  windowTo: string | null;
  createdByUserId: number | null;
}): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO marketing_sync_runs (company_id, provider, account_id, trigger_kind, status, started_at, window_from, window_to, created_by_user_id)
     VALUES (?, ?, ?, ?, 'RODANDO', ?, ?, ?, ?) RETURNING id`,
    input.companyId,
    input.provider,
    input.accountId,
    input.trigger,
    nowIso(),
    input.windowFrom,
    input.windowTo,
    input.createdByUserId
  );
  return row!.id;
}

export async function finishSyncRun(id: number, status: "OK" | "ERRO", processedCount: number, errorSanitized: string | null): Promise<void> {
  await db.run("UPDATE marketing_sync_runs SET status = ?, finished_at = ?, processed_count = ?, error_sanitized = ? WHERE id = ?", status, nowIso(), processedCount, errorSanitized, id);
}

export async function hasRunningSyncRun(accountId: number): Promise<boolean> {
  // Execução travada há mais de 30 min é considerada morta (processo pode ter sido reiniciado pela hospedagem).
  const row = await db.get<{ c: number }>(
    "SELECT COUNT(*) c FROM marketing_sync_runs WHERE account_id = ? AND status = 'RODANDO' AND started_at > ?",
    accountId,
    new Date(Date.now() - 30 * 60 * 1000).toISOString()
  );
  return !!row && Number(row.c) > 0;
}

export function listSyncRuns(limit: number, companyId?: number): Promise<(SyncRun & { account_name: string | null; company_name: string | null })[]> {
  const base = `SELECT r.*, a.name AS account_name, co.name AS company_name
    FROM marketing_sync_runs r
    LEFT JOIN marketing_accounts a ON a.id = r.account_id
    LEFT JOIN companies co ON co.id = r.company_id`;
  if (companyId !== undefined) return db.all(`${base} WHERE r.company_id = ? ORDER BY r.id DESC LIMIT ?`, companyId, limit);
  return db.all(`${base} ORDER BY r.id DESC LIMIT ?`, limit);
}

/** Última sincronização bem-sucedida de qualquer conta da empresa — "dados atualizados há X". */
export async function companyDataFreshness(companyId: number): Promise<{ lastSuccessAt: string | null; byProvider: Record<MarketingProvider, string | null> }> {
  const rows = await db.all<{ provider: MarketingProvider; last: string | null }>(
    "SELECT provider, MAX(last_success_at) AS last FROM marketing_accounts WHERE company_id = ? GROUP BY provider",
    companyId
  );
  const byProvider: Record<MarketingProvider, string | null> = { META: null, GOOGLE: null };
  let lastSuccessAt: string | null = null;
  for (const r of rows) {
    byProvider[r.provider] = r.last;
    if (r.last && (!lastSuccessAt || r.last > lastSuccessAt)) lastSuccessAt = r.last;
  }
  return { lastSuccessAt, byProvider };
}
