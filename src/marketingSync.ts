/**
 * Sincronização incremental e idempotente das plataformas de anúncio para o
 * espelho local (marketing_*). Nunca consulta a API durante a renderização de
 * uma tela — as telas leem só o banco (ver bi.ts).
 *
 * Estratégia:
 * - primeira sincronização de uma conta: últimos MARKETING_INITIAL_LOOKBACK_DAYS
 *   (padrão 90) dias;
 * - seguintes: só os últimos MARKETING_RECENT_WINDOW_DAYS (padrão 7) — dias
 *   que a plataforma ainda pode revisar (atribuição tardia);
 * - upsert por (dimension_key, metric_date): rodar duas vezes não duplica.
 *
 * Hospedagem gratuita (Render): não há worker/cron confiável e a instância
 * dorme sem tráfego. O agendador abaixo é em processo (setInterval) e só roda
 * enquanto a instância estiver acordada — limitação documentada em
 * PUBLICACAO.md e mostrada no painel. O botão "Atualizar agora" é o caminho
 * garantido.
 */
import { audit } from "./access";
import { db } from "./db";
import {
  decryptConnectionTokens,
  finishSyncRun,
  getAccount,
  getConnection,
  hasRunningSyncRun,
  markAccountSync,
  markConnectionSync,
  setConnectionStatus,
  startSyncRun,
  updateConnectionTokens,
  upsertAd,
  upsertAdGroup,
  upsertCampaign,
  upsertDailyMetric,
  type MarketingAccount,
  type MarketingConnection,
} from "./marketingModels";
import { googleOAuthConfig } from "./marketingOAuth";
import {
  googleDailyCampaignMetrics,
  googleListAdGroups,
  googleListCampaigns,
  googleRefreshToken,
  metaDailyInsights,
  metaListAdSets,
  metaListAds,
  metaListCampaigns,
  ProviderError,
  sanitizeText,
  type FetchLike,
} from "./marketingProviders";

export interface SyncDeps {
  fetchImpl: FetchLike;
  now: () => Date;
}

const defaultDeps: SyncDeps = { fetchImpl: (url, init) => fetch(url, init as any) as any, now: () => new Date() };

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBefore(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

export function initialLookbackDays(): number {
  const n = Number(process.env.MARKETING_INITIAL_LOOKBACK_DAYS || 90);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 90;
}

export function recentWindowDays(): number {
  const n = Number(process.env.MARKETING_RECENT_WINDOW_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 7;
}

export interface SyncResult {
  ok: boolean;
  processed: number;
  error?: string;
  errorKind?: string;
  windowFrom: string;
  windowTo: string;
}

/** Garante token utilizável (renova o Google com refresh token; Meta expirada → reconexão). Nunca devolve o token para fora deste módulo. */
async function ensureAccessToken(connection: MarketingConnection, deps: SyncDeps, baseUrl: string): Promise<string> {
  const tokens = await decryptConnectionTokens(connection.id);
  if (!tokens.accessToken) throw new ProviderError("AUTH_EXPIRED", "Conexão sem token — reconecte a conta.");
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : null;
  const soon = deps.now().getTime() + 5 * 60 * 1000;
  if (expiresAt !== null && expiresAt < soon) {
    if (connection.provider === "GOOGLE" && tokens.refreshToken) {
      const cfg = googleOAuthConfig(baseUrl);
      if (!cfg.configured) throw new ProviderError("INVALID", `Credenciais do Google ausentes no servidor (${cfg.missing.join(", ")}).`);
      const refreshed = await googleRefreshToken(deps.fetchImpl, cfg.clientId!, process.env.GOOGLE_CLIENT_SECRET!, tokens.refreshToken);
      await updateConnectionTokens(connection.id, { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt });
      return refreshed.accessToken;
    }
    throw new ProviderError("AUTH_EXPIRED", "Token expirado — reconecte a conta.");
  }
  return tokens.accessToken;
}

async function syncMeta(account: MarketingAccount, token: string, since: string, until: string, deps: SyncDeps): Promise<number> {
  const actId = account.external_account_id;
  const campaignIds = new Map<string, number>();
  for (const c of await metaListCampaigns(deps.fetchImpl, token, actId)) {
    const id = await upsertCampaign({ accountId: account.id, companyId: account.company_id, provider: "META", currency: account.currency, ...c });
    campaignIds.set(c.externalId, id);
  }
  const adGroupIds = new Map<string, number>();
  for (const g of await metaListAdSets(deps.fetchImpl, token, actId)) {
    const campaignId = campaignIds.get(g.campaignExternalId);
    if (!campaignId) continue;
    const id = await upsertAdGroup({ accountId: account.id, companyId: account.company_id, campaignId, provider: "META", externalId: g.externalId, name: g.name, status: g.status });
    adGroupIds.set(g.externalId, id);
  }
  const adIds = new Map<string, number>();
  for (const a of await metaListAds(deps.fetchImpl, token, actId)) {
    const campaignId = campaignIds.get(a.campaignExternalId);
    if (!campaignId) continue;
    const id = await upsertAd({
      accountId: account.id,
      companyId: account.company_id,
      campaignId,
      adGroupId: a.adGroupExternalId ? (adGroupIds.get(a.adGroupExternalId) ?? null) : null,
      provider: "META",
      externalId: a.externalId,
      name: a.name,
      status: a.status,
    });
    adIds.set(a.externalId, id);
  }

  let processed = 0;
  for (const level of ["campaign", "ad"] as const) {
    const rows = await metaDailyInsights(deps.fetchImpl, token, actId, level, since, until);
    for (const r of rows) {
      const campaignId = r.campaignExternalId ? (campaignIds.get(r.campaignExternalId) ?? null) : null;
      if (!campaignId) continue;
      const adGroupId = r.adGroupExternalId ? (adGroupIds.get(r.adGroupExternalId) ?? null) : null;
      const adId = r.adExternalId ? (adIds.get(r.adExternalId) ?? null) : null;
      const lvl = level === "campaign" ? "CAMPAIGN" : "AD";
      await upsertDailyMetric({
        companyId: account.company_id,
        provider: "META",
        accountId: account.id,
        campaignId,
        adGroupId: lvl === "AD" ? adGroupId : null,
        adId: lvl === "AD" ? adId : null,
        level: lvl,
        dimensionKey: `META:${lvl}:${actId}:${r.campaignExternalId ?? ""}:${lvl === "AD" ? r.adGroupExternalId ?? "" : ""}:${lvl === "AD" ? r.adExternalId ?? "" : ""}`,
        metricDate: r.date,
        currency: account.currency,
        spendCents: r.spendCents,
        impressions: r.impressions,
        reach: r.reach,
        frequency: r.frequency,
        clicks: r.clicks,
        linkClicks: r.linkClicks,
        platformConversations: r.platformConversations,
        platformLeads: r.platformLeads,
        platformConversions: r.platformConversions,
        platformConversionValueCents: r.platformConversionValueCents,
        rawMetricsJson: JSON.stringify(r.raw).slice(0, 8000),
      });
      processed += 1;
    }
  }
  return processed;
}

async function syncGoogle(account: MarketingAccount, token: string, since: string, until: string, deps: SyncDeps): Promise<number> {
  const customerId = account.external_account_id;
  const login = account.login_customer_id;
  const campaignIds = new Map<string, number>();
  for (const c of await googleListCampaigns(deps.fetchImpl, token, customerId, login)) {
    const id = await upsertCampaign({ accountId: account.id, companyId: account.company_id, provider: "GOOGLE", currency: account.currency, ...c });
    campaignIds.set(c.externalId, id);
  }
  for (const g of await googleListAdGroups(deps.fetchImpl, token, customerId, login)) {
    const campaignId = campaignIds.get(g.campaignExternalId);
    if (!campaignId) continue;
    await upsertAdGroup({ accountId: account.id, companyId: account.company_id, campaignId, provider: "GOOGLE", externalId: g.externalId, name: g.name, status: g.status });
  }
  let processed = 0;
  for (const r of await googleDailyCampaignMetrics(deps.fetchImpl, token, customerId, login, since, until)) {
    const campaignId = r.campaignExternalId ? (campaignIds.get(r.campaignExternalId) ?? null) : null;
    if (!campaignId) continue;
    await upsertDailyMetric({
      companyId: account.company_id,
      provider: "GOOGLE",
      accountId: account.id,
      campaignId,
      adGroupId: null,
      adId: null,
      level: "CAMPAIGN",
      dimensionKey: `GOOGLE:CAMPAIGN:${customerId}:${r.campaignExternalId}::`,
      metricDate: r.date,
      currency: account.currency,
      spendCents: r.spendCents,
      impressions: r.impressions,
      reach: null,
      frequency: null,
      clicks: r.clicks,
      linkClicks: null,
      platformConversations: null,
      platformLeads: null,
      platformConversions: r.platformConversions,
      platformConversionValueCents: r.platformConversionValueCents,
      rawMetricsJson: JSON.stringify(r.raw).slice(0, 4000),
    });
    processed += 1;
  }
  return processed;
}

/**
 * Sincroniza UMA conta. Registra a execução (marketing_sync_runs), atualiza
 * status de conta/conexão e audita. Erros voltam sanitizados; token expirado
 * vira RECONEXAO_NECESSARIA na conexão.
 */
export async function syncAccount(
  accountId: number,
  trigger: "MANUAL" | "AUTO",
  userId: number | null,
  baseUrl: string,
  deps: SyncDeps = defaultDeps
): Promise<SyncResult> {
  const account = await getAccount(accountId);
  const windowTo = ymd(deps.now());
  if (!account) return { ok: false, processed: 0, error: "Conta não encontrada.", windowFrom: windowTo, windowTo };
  if (!account.company_id) return { ok: false, processed: 0, error: "Conta sem empresa vinculada.", windowFrom: windowTo, windowTo };
  if (await hasRunningSyncRun(accountId)) return { ok: false, processed: 0, error: "Já existe uma sincronização em andamento para esta conta.", windowFrom: windowTo, windowTo };
  const connection = await getConnection(account.connection_id);
  if (!connection) return { ok: false, processed: 0, error: "Conexão não encontrada.", windowFrom: windowTo, windowTo };

  const isInitial = !account.last_success_at;
  const windowFrom = ymd(daysBefore(deps.now(), isInitial ? initialLookbackDays() : recentWindowDays()));
  const runId = await startSyncRun({
    companyId: account.company_id,
    provider: account.provider,
    accountId: account.id,
    trigger: isInitial ? "INICIAL" : trigger,
    windowFrom,
    windowTo,
    createdByUserId: userId,
  });

  try {
    if (connection.status === "REVOGADA") throw new ProviderError("AUTH_EXPIRED", "Conexão revogada — reconecte a conta.");
    const token = await ensureAccessToken(connection, deps, baseUrl);
    const processed = account.provider === "META" ? await syncMeta(account, token, windowFrom, windowTo, deps) : await syncGoogle(account, token, windowFrom, windowTo, deps);
    await finishSyncRun(runId, "OK", processed, null);
    await markAccountSync(account.id, true, null);
    await markConnectionSync(connection.id, true, null);
    await audit(trigger === "MANUAL" ? "marketing_sync_manual" : "marketing_sync_auto", {
      companyId: account.company_id,
      userId,
      detail: `${account.provider} ${account.name ?? account.external_account_id}: ${processed} registro(s), ${windowFrom} a ${windowTo}`,
    });
    return { ok: true, processed, windowFrom, windowTo };
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "UNKNOWN";
    const message = err instanceof ProviderError ? err.sanitized : sanitizeText(err instanceof Error ? err.message : String(err));
    await finishSyncRun(runId, "ERRO", 0, message);
    await markAccountSync(account.id, false, message);
    await markConnectionSync(connection.id, false, message);
    if (kind === "AUTH_EXPIRED") await setConnectionStatus(connection.id, "RECONEXAO_NECESSARIA", message);
    else if (kind !== "RATE_LIMIT") await setConnectionStatus(connection.id, "ERRO", message);
    await audit("marketing_sync_falhou", { companyId: account.company_id, userId, detail: `${account.provider} ${account.name ?? account.external_account_id}: ${kind} — ${message}` });
    return { ok: false, processed: 0, error: message, errorKind: kind, windowFrom, windowTo };
  }
}

/** Todas as contas com sincronização ligada (usado pelo agendador e pelo botão do painel global). */
export async function syncAllEnabled(trigger: "MANUAL" | "AUTO", userId: number | null, baseUrl: string, deps: SyncDeps = defaultDeps): Promise<SyncResult[]> {
  const accounts = await db.all<{ id: number }>("SELECT id FROM marketing_accounts WHERE sync_enabled = 1 AND company_id IS NOT NULL ORDER BY id");
  const results: SyncResult[] = [];
  for (const a of accounts) results.push(await syncAccount(a.id, trigger, userId, baseUrl, deps));
  return results;
}

let schedulerHandle: NodeJS.Timeout | null = null;
let schedulerBusy = false;

export function syncIntervalMinutes(): number {
  const n = Number(process.env.MARKETING_SYNC_INTERVAL_MINUTES ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
}

/** Agendador em processo — só enquanto a instância estiver acordada (limitação do plano gratuito, documentada). */
export function startSyncScheduler(baseUrl: string): void {
  const minutes = syncIntervalMinutes();
  if (minutes === 0 || schedulerHandle) return;
  schedulerHandle = setInterval(
    async () => {
      if (schedulerBusy) return;
      schedulerBusy = true;
      try {
        await syncAllEnabled("AUTO", null, baseUrl);
      } catch (err) {
        console.error("[marketing] agendador falhou:", sanitizeText(err instanceof Error ? err.message : String(err)));
      } finally {
        schedulerBusy = false;
      }
    },
    minutes * 60 * 1000
  );
  schedulerHandle.unref();
  console.log(`[marketing] sincronização automática a cada ${minutes} min enquanto a instância estiver ativa (plano gratuito pode suspender).`);
}
