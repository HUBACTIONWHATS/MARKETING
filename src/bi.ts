/**
 * Motor de BI do Command Center — todos os números das telas de marketing/
 * inteligência nascem aqui, sempre a partir do banco local (nunca de API
 * externa na hora de renderizar) e sempre escopados por company_id.
 *
 * Princípios:
 * - Nunca dividir por zero: ratio() devolve null e a tela mostra "—".
 * - Nunca transformar ausência em zero quando zero tem outro significado:
 *   métricas de plataforma (impressões, cliques, conversas da Meta) ficam
 *   null se a plataforma não reportou.
 * - Resultados do CRM (leads, qualificados, vendas) e conversões reportadas
 *   pela plataforma são séries SEPARADAS — nunca somadas entre si.
 * - Atribuição a campanha/canal só com evidência (contacts.source +
 *   attribution_confidence); o resto é "origem desconhecida".
 */
import { CONFIDENCE_LABELS, LEAD_SOURCES, type AttributionConfidence, type LeadSource } from "./attribution";
import { localDayRangeToUtc, zonedTimeToUtc } from "./businessHours";
import { db } from "./db";
import { companyDataFreshness, listAccountsForCompany, listCampaignsForCompany, type MarketingCampaign, type MarketingProvider } from "./marketingModels";

// --- Utilidades numéricas -------------------------------------------------------

/** Divisão segura: null quando o denominador é 0/ausente ou o numerador é null. */
export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator === null || numerator === undefined || !denominator) return null;
  return numerator / denominator;
}

/** Variação percentual entre dois valores; null quando não dá para comparar. */
export function deltaPercent(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function sumNullable(values: (number | null | undefined)[]): number | null {
  let any = false;
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    any = true;
    total += v;
  }
  return any ? total : null;
}

// --- Períodos -------------------------------------------------------------------

export type PeriodPreset = "hoje" | "7d" | "14d" | "30d" | "mes_atual" | "mes_passado" | "personalizado";

export interface Period {
  from: string; // YYYY-MM-DD (fuso da empresa), inclusive
  to: string; // inclusive
}

export interface ResolvedPeriod {
  preset: PeriodPreset;
  label: string;
  current: Period;
  previous: Period;
  previousLabel: string;
}

function ymdInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

export function resolvePeriod(preset: string | undefined, custom: { from?: string; to?: string }, timeZone: string, now: Date = new Date()): ResolvedPeriod {
  const today = ymdInZone(now, timeZone);
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = prevMonthEnd.slice(0, 8) + "01";
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  let p: PeriodPreset = (["hoje", "7d", "14d", "30d", "mes_atual", "mes_passado", "personalizado"] as PeriodPreset[]).includes(preset as PeriodPreset)
    ? (preset as PeriodPreset)
    : "30d";
  if (p === "personalizado" && !(valid(custom.from) && valid(custom.to))) p = "30d";

  let current: Period;
  let label: string;
  switch (p) {
    case "hoje":
      current = { from: today, to: today };
      label = "Hoje";
      break;
    case "7d":
      current = { from: addDays(today, -6), to: today };
      label = "Últimos 7 dias";
      break;
    case "14d":
      current = { from: addDays(today, -13), to: today };
      label = "Últimos 14 dias";
      break;
    case "mes_atual":
      current = { from: monthStart, to: today };
      label = "Este mês";
      break;
    case "mes_passado":
      current = { from: prevMonthStart, to: prevMonthEnd };
      label = "Mês passado";
      break;
    case "personalizado":
      current = custom.from! <= custom.to! ? { from: custom.from!, to: custom.to! } : { from: custom.to!, to: custom.from! };
      label = `${current.from} a ${current.to}`;
      break;
    default:
      current = { from: addDays(today, -29), to: today };
      label = "Últimos 30 dias";
  }

  let previous: Period;
  let previousLabel: string;
  if (p === "mes_atual") {
    // Este mês x mesmo trecho do mês anterior (dias 1..N) — comparação justa.
    const n = daysBetween(current.from, current.to);
    previous = { from: prevMonthStart, to: addDays(prevMonthStart, Math.min(n, daysBetween(prevMonthStart, prevMonthEnd)) - 1) };
    previousLabel = "mesmo trecho do mês anterior";
  } else if (p === "mes_passado") {
    const pmEnd = addDays(prevMonthStart, -1);
    previous = { from: pmEnd.slice(0, 8) + "01", to: pmEnd };
    previousLabel = "mês anterior";
  } else {
    const n = daysBetween(current.from, current.to);
    previous = { from: addDays(current.from, -n), to: addDays(current.from, -1) };
    previousLabel = p === "hoje" ? "ontem" : `${n} dias anteriores`;
  }
  return { preset: p, label, current, previous, previousLabel };
}

// --- Filtros --------------------------------------------------------------------

export interface BiFilters {
  /** "ALL" ou uma origem (META_ADS, GOOGLE_ADS, ORGANICO, ...). */
  channel: LeadSource | "ALL";
  campaignId: number | null;
  attendantUserId: number | null;
  stageId: number | null;
}

export const EMPTY_FILTERS: BiFilters = { channel: "ALL", campaignId: null, attendantUserId: null, stageId: null };

export function parseFilters(q: Record<string, string | undefined>): BiFilters {
  const channel = q.canal && (LEAD_SOURCES as string[]).includes(q.canal) ? (q.canal as LeadSource) : "ALL";
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : null);
  return { channel, campaignId: num(q.campanha), attendantUserId: num(q.atendente), stageId: num(q.etapa) };
}

// --- Fatos brutos (uma carga por requisição, agregação em memória) ---------

interface ContactFact {
  id: number;
  created_at: string;
  source: LeadSource;
  attribution_confidence: AttributionConfidence;
  external_campaign_id: string | null;
  external_adset_id: string | null;
  external_ad_id: string | null;
  utm_campaign: string | null;
  campaignId: number | null; // resolvido
}

interface OpportunityFact {
  id: number;
  contact_id: number;
  created_at: string;
  qualified_at: string | null;
  scheduled_at: string | null;
  attended_at: string | null;
  closed_at: string | null;
  is_won: number;
  is_lost: number;
  value_cents: number;
  responsible_user_id: number | null;
  stage_id: number;
}

interface ConversationFact {
  id: number;
  contact_id: number;
  created_at: string;
  assigned_user_id: number | null;
}

interface WaitFact {
  conversation_id: number;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ended_by_user_id: number | null;
}

interface MetricFact {
  provider: MarketingProvider;
  account_id: number;
  campaign_id: number | null;
  level: string;
  metric_date: string;
  currency: string | null;
  spend_cents: number;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  link_clicks: number | null;
  platform_conversations: number | null;
  platform_leads: number | null;
  platform_conversions: number | null;
  platform_conversion_value_cents: number | null;
}

export interface CrmFacts {
  contacts: ContactFact[];
  opportunities: OpportunityFact[];
  conversations: ConversationFact[];
  waits: WaitFact[];
  metrics: MetricFact[];
  campaigns: MarketingCampaign[];
  contactById: Map<number, ContactFact>;
  rangeUtc: { fromIso: string; toIso: string };
}

/** Campanha do contato: id oficial > anúncio > conjunto > nome de campanha da UTM (provável). */
function resolveContactCampaign(
  c: { external_campaign_id: string | null; external_adset_id: string | null; external_ad_id: string | null; utm_campaign: string | null },
  byExternal: Map<string, number>,
  adToCampaign: Map<string, number>,
  adGroupToCampaign: Map<string, number>,
  byName: Map<string, number>
): number | null {
  if (c.external_campaign_id && byExternal.has(c.external_campaign_id)) return byExternal.get(c.external_campaign_id)!;
  if (c.external_ad_id && adToCampaign.has(c.external_ad_id)) return adToCampaign.get(c.external_ad_id)!;
  if (c.external_adset_id && adGroupToCampaign.has(c.external_adset_id)) return adGroupToCampaign.get(c.external_adset_id)!;
  if (c.utm_campaign && byName.has(c.utm_campaign.trim().toLowerCase())) return byName.get(c.utm_campaign.trim().toLowerCase())!;
  return null;
}

/** Carrega os fatos de um período amplo (o maior entre atual e anterior) para agregar em memória. */
export async function loadFacts(companyId: number, timeZone: string, from: string, to: string): Promise<CrmFacts> {
  const { startUtc, endUtc } = localDayRangeToUtc(from, to, timeZone);
  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();

  const campaigns = await listCampaignsForCompany(companyId);
  const byExternal = new Map(campaigns.map((c) => [c.external_id, c.id]));
  const byName = new Map(campaigns.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const ads = await db.all<{ external_id: string; campaign_id: number }>("SELECT external_id, campaign_id FROM marketing_ads WHERE company_id = ?", companyId);
  const adGroups = await db.all<{ external_id: string; campaign_id: number }>("SELECT external_id, campaign_id FROM marketing_ad_groups WHERE company_id = ?", companyId);
  const adToCampaign = new Map(ads.map((a) => [a.external_id, a.campaign_id]));
  const adGroupToCampaign = new Map(adGroups.map((g) => [g.external_id, g.campaign_id]));

  // Contatos: todos da empresa (um contato antigo pode gerar venda no período) — volume pequeno por empresa.
  const contactsRaw = await db.all<Omit<ContactFact, "campaignId">>(
    "SELECT id, created_at, source, attribution_confidence, external_campaign_id, external_adset_id, external_ad_id, utm_campaign FROM contacts WHERE company_id = ?",
    companyId
  );
  const contacts: ContactFact[] = contactsRaw.map((c) => ({ ...c, campaignId: resolveContactCampaign(c, byExternal, adToCampaign, adGroupToCampaign, byName) }));

  const opportunities = await db.all<OpportunityFact>(
    `SELECT o.id, o.contact_id, o.created_at, o.qualified_at, o.scheduled_at, o.attended_at, o.closed_at, ps.is_won, ps.is_lost, o.value_cents, o.responsible_user_id, o.stage_id
     FROM opportunities o JOIN pipeline_stages ps ON ps.id = o.stage_id WHERE o.company_id = ?`,
    companyId
  );
  const conversations = await db.all<ConversationFact>(
    "SELECT id, contact_id, created_at, assigned_user_id FROM conversations WHERE company_id = ? AND created_at >= ? AND created_at < ?",
    companyId,
    fromIso,
    toIso
  );
  const waits = await db.all<WaitFact>(
    `SELECT we.conversation_id, we.started_at, we.ended_at, we.ended_reason, we.ended_by_user_id FROM wait_episodes we
     WHERE we.company_id = ? AND we.started_at >= ? AND we.started_at < ?
       AND we.id = (SELECT MIN(id) FROM wait_episodes we2 WHERE we2.conversation_id = we.conversation_id)`,
    companyId,
    fromIso,
    toIso
  );
  const metrics = await db.all<MetricFact>(
    `SELECT provider, account_id, campaign_id, level, metric_date, currency, spend_cents, impressions, reach, frequency, clicks, link_clicks,
            platform_conversations, platform_leads, platform_conversions, platform_conversion_value_cents
     FROM marketing_metrics_daily WHERE company_id = ? AND level = 'CAMPAIGN' AND metric_date >= ? AND metric_date <= ?`,
    companyId,
    from,
    to
  );
  return { contacts, opportunities, conversations, waits, metrics, campaigns, contactById: new Map(contacts.map((c) => [c.id, c])), rangeUtc: { fromIso, toIso } };
}

// --- Agregação de um período ----------------------------------------------------

export interface PlatformMetrics {
  spendCents: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  platformConversations: number | null;
  platformLeads: number | null;
  platformConversions: number | null;
  platformConversionValueCents: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  currencies: string[];
  mixedCurrency: boolean;
  hasSpendData: boolean;
}

export interface CrmMetrics {
  conversations: number;
  leads: number;
  qualified: number;
  appointments: number;
  attendances: number;
  sales: number;
  newCustomers: number;
  revenueCents: number;
  /** Só contatos com atribuição CONFIRMADA ou PROVAVEL a Meta/Google. */
  attributedLeads: number;
  attributedSales: number;
  attributedRevenueCents: number;
  confirmedLeads: number;
  probableLeads: number;
  unattributedLeads: number;
}

export interface DerivedKpis {
  costPerConversation: number | null;
  cpl: number | null;
  cplQualified: number | null;
  costPerAppointment: number | null;
  costPerAttendance: number | null;
  cac: number | null;
  qualificationRate: number | null;
  appointmentRate: number | null;
  attendanceRate: number | null;
  closeRate: number | null;
  ticketCents: number | null;
  /** receita atribuída / investimento (só faz sentido com investimento > 0). */
  roasCrm: number | null;
  /** receita total do CRM / investimento — referência, não atribuída. */
  roasTotal: number | null;
  conversationsPerSale: number | null;
  /** Conversões reportadas pela plataforma ÷ cliques (definição do provedor, ex.: Google Ads; não é do CRM). */
  platformConversionRate: number | null;
  /** Investimento ÷ conversões reportadas pela plataforma. */
  costPerPlatformConversion: number | null;
}

export interface PeriodSnapshot {
  period: Period;
  platform: PlatformMetrics;
  crm: CrmMetrics;
  kpis: DerivedKpis;
}

function inRange(iso: string | null, fromIso: string, toIso: string): boolean {
  return !!iso && iso >= fromIso && iso < toIso;
}

function isPaid(source: LeadSource): boolean {
  return source === "META_ADS" || source === "GOOGLE_ADS";
}

function contactMatches(c: ContactFact, f: BiFilters): boolean {
  if (f.channel !== "ALL" && c.source !== f.channel) return false;
  if (f.campaignId !== null && c.campaignId !== f.campaignId) return false;
  return true;
}

function metricMatches(m: MetricFact, f: BiFilters): boolean {
  if (f.channel === "META_ADS" && m.provider !== "META") return false;
  if (f.channel === "GOOGLE_ADS" && m.provider !== "GOOGLE") return false;
  if (f.channel !== "ALL" && !isPaid(f.channel)) return false; // investimento só existe em mídia paga
  if (f.campaignId !== null && m.campaign_id !== f.campaignId) return false;
  return true;
}

export function aggregatePlatform(metrics: MetricFact[]): PlatformMetrics {
  const spend = metrics.reduce((s, m) => s + (m.spend_cents || 0), 0);
  const impressions = sumNullable(metrics.map((m) => m.impressions));
  const clicks = sumNullable(metrics.map((m) => m.clicks));
  const reach = sumNullable(metrics.map((m) => m.reach));
  const currencies = [...new Set(metrics.map((m) => m.currency).filter((c): c is string => !!c))];
  return {
    spendCents: spend,
    impressions,
    reach,
    clicks,
    linkClicks: sumNullable(metrics.map((m) => m.link_clicks)),
    platformConversations: sumNullable(metrics.map((m) => m.platform_conversations)),
    platformLeads: sumNullable(metrics.map((m) => m.platform_leads)),
    platformConversions: sumNullable(metrics.map((m) => m.platform_conversions)),
    platformConversionValueCents: sumNullable(metrics.map((m) => m.platform_conversion_value_cents)),
    ctr: ratio(clicks, impressions),
    cpc: ratio(spend, clicks),
    cpm: impressions ? (spend / impressions) * 1000 : null,
    frequency: ratio(impressions, reach),
    currencies,
    mixedCurrency: currencies.length > 1,
    hasSpendData: metrics.length > 0,
  };
}

export function aggregateCrm(facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): CrmMetrics {
  const { startUtc, endUtc } = localDayRangeToUtc(period.from, period.to, timeZone);
  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();
  const contactOk = (id: number) => {
    const c = facts.contactById.get(id);
    return !!c && contactMatches(c, f);
  };
  const oppOk = (o: OpportunityFact) => contactOk(o.contact_id) && (f.attendantUserId === null || o.responsible_user_id === f.attendantUserId) && (f.stageId === null || o.stage_id === f.stageId);

  const leadsList = facts.contacts.filter((c) => inRange(c.created_at, fromIso, toIso) && contactMatches(c, f));
  const conversations = facts.conversations.filter((c) => inRange(c.created_at, fromIso, toIso) && contactOk(c.contact_id) && (f.attendantUserId === null || c.assigned_user_id === f.attendantUserId)).length;
  const qualified = facts.opportunities.filter((o) => inRange(o.qualified_at, fromIso, toIso) && oppOk(o)).length;
  const appointments = facts.opportunities.filter((o) => inRange(o.scheduled_at, fromIso, toIso) && oppOk(o)).length;
  const attendances = facts.opportunities.filter((o) => inRange(o.attended_at, fromIso, toIso) && oppOk(o)).length;
  const won = facts.opportunities.filter((o) => o.is_won === 1 && inRange(o.closed_at, fromIso, toIso) && oppOk(o));
  const attributed = (id: number) => {
    const c = facts.contactById.get(id);
    return !!c && isPaid(c.source) && c.attribution_confidence !== "NAO_ATRIBUIDA";
  };
  return {
    conversations,
    leads: leadsList.length,
    qualified,
    appointments,
    attendances,
    sales: won.length,
    newCustomers: new Set(won.map((o) => o.contact_id)).size,
    revenueCents: won.reduce((s, o) => s + o.value_cents, 0),
    attributedLeads: leadsList.filter((c) => isPaid(c.source) && c.attribution_confidence !== "NAO_ATRIBUIDA").length,
    attributedSales: won.filter((o) => attributed(o.contact_id)).length,
    attributedRevenueCents: won.filter((o) => attributed(o.contact_id)).reduce((s, o) => s + o.value_cents, 0),
    confirmedLeads: leadsList.filter((c) => c.attribution_confidence === "CONFIRMADA").length,
    probableLeads: leadsList.filter((c) => c.attribution_confidence === "PROVAVEL").length,
    unattributedLeads: leadsList.filter((c) => c.attribution_confidence === "NAO_ATRIBUIDA").length,
  };
}

export function deriveKpis(platform: PlatformMetrics, crm: CrmMetrics): DerivedKpis {
  const spend = platform.hasSpendData ? platform.spendCents : null;
  return {
    costPerConversation: ratio(spend, crm.conversations),
    cpl: ratio(spend, crm.leads),
    cplQualified: ratio(spend, crm.qualified),
    costPerAppointment: ratio(spend, crm.appointments),
    costPerAttendance: ratio(spend, crm.attendances),
    cac: ratio(spend, crm.newCustomers),
    qualificationRate: ratio(crm.qualified, crm.leads),
    appointmentRate: ratio(crm.appointments, crm.qualified),
    attendanceRate: ratio(crm.attendances, crm.appointments),
    closeRate: ratio(crm.sales, crm.qualified),
    ticketCents: ratio(crm.revenueCents, crm.sales),
    roasCrm: spend ? ratio(crm.attributedRevenueCents, spend) : null,
    roasTotal: spend ? ratio(crm.revenueCents, spend) : null,
    conversationsPerSale: ratio(crm.conversations, crm.sales),
    platformConversionRate: ratio(platform.platformConversions, platform.clicks),
    costPerPlatformConversion: ratio(spend, platform.platformConversions),
  };
}

export function snapshot(facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): PeriodSnapshot {
  const platform = aggregatePlatform(facts.metrics.filter((m) => m.metric_date >= period.from && m.metric_date <= period.to && metricMatches(m, f)));
  const crm = aggregateCrm(facts, period, timeZone, f);
  return { period, platform, crm, kpis: deriveKpis(platform, crm) };
}

// --- Séries diárias -------------------------------------------------------------

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  spendCents: number | null;
  impressions: number | null;
  clicks: number | null;
  platformConversations: number | null;
  conversations: number;
  leads: number;
  qualified: number;
  sales: number;
  revenueCents: number;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
}

export function dailySeries(facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): DailyPoint[] {
  const days: string[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) days.push(d);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const contactOk = (id: number) => {
    const c = facts.contactById.get(id);
    return !!c && contactMatches(c, f);
  };
  return days.map((date) => {
    const m = facts.metrics.filter((x) => x.metric_date === date && metricMatches(x, f));
    const p = aggregatePlatform(m);
    const leads = facts.contacts.filter((c) => contactMatches(c, f) && dayOf(c.created_at) === date).length;
    const conversations = facts.conversations.filter((c) => contactOk(c.contact_id) && dayOf(c.created_at) === date).length;
    const qualified = facts.opportunities.filter((o) => o.qualified_at && contactOk(o.contact_id) && dayOf(o.qualified_at) === date).length;
    const won = facts.opportunities.filter((o) => o.is_won === 1 && o.closed_at && contactOk(o.contact_id) && dayOf(o.closed_at) === date);
    const revenue = won.reduce((s, o) => s + o.value_cents, 0);
    const spend = p.hasSpendData ? p.spendCents : null;
    return {
      date,
      spendCents: spend,
      impressions: p.impressions,
      clicks: p.clicks,
      platformConversations: p.platformConversations,
      conversations,
      leads,
      qualified,
      sales: won.length,
      revenueCents: revenue,
      cpl: ratio(spend, leads),
      cac: ratio(spend, new Set(won.map((o) => o.contact_id)).size),
      roas: spend ? ratio(revenue, spend) : null,
      ctr: p.ctr,
      cpc: p.cpc,
      cpm: p.cpm,
    };
  });
}

// --- Por campanha -------------------------------------------------------------

export interface CampaignRow {
  campaign: MarketingCampaign;
  accountName: string | null;
  platform: PlatformMetrics;
  crm: CrmMetrics;
  kpis: DerivedKpis;
  updatedAt: string | null;
}

export async function campaignRows(companyId: number, facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): Promise<CampaignRow[]> {
  const accounts = await listAccountsForCompany(companyId);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const rows: CampaignRow[] = [];
  for (const campaign of facts.campaigns) {
    if (f.channel === "META_ADS" && campaign.provider !== "META") continue;
    if (f.channel === "GOOGLE_ADS" && campaign.provider !== "GOOGLE") continue;
    if (f.campaignId !== null && campaign.id !== f.campaignId) continue;
    const cf: BiFilters = { ...f, channel: "ALL", campaignId: campaign.id };
    const platform = aggregatePlatform(facts.metrics.filter((m) => m.campaign_id === campaign.id && m.metric_date >= period.from && m.metric_date <= period.to));
    const crm = aggregateCrm(facts, period, timeZone, cf);
    if (!platform.hasSpendData && crm.leads === 0 && crm.sales === 0) continue;
    rows.push({ campaign, accountName: accountName.get(campaign.account_id) ?? null, platform, crm, kpis: deriveKpis(platform, crm), updatedAt: campaign.updated_at });
  }
  return rows.sort((a, b) => b.platform.spendCents - a.platform.spendCents);
}

// --- Por canal / por provedor ----------------------------------------------------

export interface ChannelRow {
  source: LeadSource;
  spendCents: number | null;
  crm: CrmMetrics;
  kpis: DerivedKpis;
  hasSpend: boolean;
}

export function channelRows(facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): ChannelRow[] {
  const out: ChannelRow[] = [];
  for (const source of LEAD_SOURCES) {
    if (f.channel !== "ALL" && f.channel !== source) continue;
    const cf: BiFilters = { ...f, channel: source };
    const metrics = isPaid(source) ? facts.metrics.filter((m) => m.metric_date >= period.from && m.metric_date <= period.to && metricMatches(m, cf)) : [];
    const platform = aggregatePlatform(metrics);
    const crm = aggregateCrm(facts, period, timeZone, cf);
    if (!platform.hasSpendData && crm.leads === 0 && crm.sales === 0 && crm.conversations === 0) continue;
    out.push({ source, spendCents: platform.hasSpendData ? platform.spendCents : null, crm, kpis: deriveKpis(platform, crm), hasSpend: platform.hasSpendData });
  }
  return out;
}

export interface ProviderComparison {
  provider: MarketingProvider;
  connected: boolean;
  platform: PlatformMetrics;
  crm: CrmMetrics;
  kpis: DerivedKpis;
  /** Leads/vendas do canal com confiança PROVAVEL (não confirmada) — para avisar na tela. */
  probableShare: number | null;
}

export async function providerComparison(companyId: number, facts: CrmFacts, period: Period, timeZone: string, f: BiFilters): Promise<ProviderComparison[]> {
  const accounts = await listAccountsForCompany(companyId);
  return (["META", "GOOGLE"] as MarketingProvider[]).map((provider) => {
    const source: LeadSource = provider === "META" ? "META_ADS" : "GOOGLE_ADS";
    const cf: BiFilters = { ...f, channel: source };
    const platform = aggregatePlatform(facts.metrics.filter((m) => m.metric_date >= period.from && m.metric_date <= period.to && metricMatches(m, cf)));
    const crm = aggregateCrm(facts, period, timeZone, cf);
    return {
      provider,
      connected: accounts.some((a) => a.provider === provider),
      platform,
      crm,
      kpis: deriveKpis(platform, crm),
      probableShare: ratio(crm.probableLeads, crm.leads),
    };
  });
}

// --- Por atendente e matriz atendente x origem ---------------------------------

export interface AttendantRow {
  userId: number;
  name: string;
  conversationsAssigned: number;
  leads: number;
  qualified: number;
  appointments: number;
  attendances: number;
  sales: number;
  revenueCents: number;
  closeRate: number | null;
  ticketCents: number | null;
  avgFirstResponseMinutes: number | null;
  firstResponses: number;
}

export async function attendantRows(companyId: number, facts: CrmFacts, period: Period, timeZone: string): Promise<AttendantRow[]> {
  const members = await db.all<{ user_id: number; name: string }>(
    "SELECT u.id AS user_id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY u.name",
    companyId
  );
  const { startUtc, endUtc } = localDayRangeToUtc(period.from, period.to, timeZone);
  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();
  return members.map((m) => {
    const opps = facts.opportunities.filter((o) => o.responsible_user_id === m.user_id);
    const won = opps.filter((o) => o.is_won === 1 && inRange(o.closed_at, fromIso, toIso));
    const qualified = opps.filter((o) => inRange(o.qualified_at, fromIso, toIso)).length;
    const waits = facts.waits.filter((w) => w.ended_by_user_id === m.user_id && w.ended_reason === "RESPOSTA_HUMANA" && w.ended_at);
    const durations = waits.map((w) => (new Date(w.ended_at!).getTime() - new Date(w.started_at).getTime()) / 60000);
    const revenue = won.reduce((s, o) => s + o.value_cents, 0);
    return {
      userId: m.user_id,
      name: m.name,
      conversationsAssigned: facts.conversations.filter((c) => c.assigned_user_id === m.user_id).length,
      leads: opps.filter((o) => inRange(o.created_at, fromIso, toIso)).length,
      qualified,
      appointments: opps.filter((o) => inRange(o.scheduled_at, fromIso, toIso)).length,
      attendances: opps.filter((o) => inRange(o.attended_at, fromIso, toIso)).length,
      sales: won.length,
      revenueCents: revenue,
      closeRate: ratio(won.length, qualified),
      ticketCents: ratio(revenue, won.length),
      avgFirstResponseMinutes: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      firstResponses: durations.length,
    };
  });
}

export interface AttendantSourceCell {
  userId: number;
  name: string;
  bySource: Record<LeadSource, { leads: number; sales: number; closeRate: number | null }>;
}

export async function attendantSourceMatrix(companyId: number, facts: CrmFacts, period: Period, timeZone: string): Promise<AttendantSourceCell[]> {
  const members = await db.all<{ user_id: number; name: string }>(
    "SELECT u.id AS user_id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY u.name",
    companyId
  );
  const { startUtc, endUtc } = localDayRangeToUtc(period.from, period.to, timeZone);
  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();
  return members.map((m) => {
    const bySource = {} as AttendantSourceCell["bySource"];
    for (const source of LEAD_SOURCES) {
      const opps = facts.opportunities.filter((o) => o.responsible_user_id === m.user_id && facts.contactById.get(o.contact_id)?.source === source && inRange(o.created_at, fromIso, toIso));
      const sales = facts.opportunities.filter(
        (o) => o.responsible_user_id === m.user_id && o.is_won === 1 && facts.contactById.get(o.contact_id)?.source === source && inRange(o.closed_at, fromIso, toIso)
      ).length;
      bySource[source] = { leads: opps.length, sales, closeRate: ratio(sales, opps.length) };
    }
    return { userId: m.user_id, name: m.name, bySource };
  });
}

// --- SLA de atendimento ----------------------------------------------------------

export interface SlaStats {
  count: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  p90Minutes: number | null;
  buckets: { upTo5: number; upTo15: number; upTo30: number; over30: number };
  longestOpenWaitMs: number | null;
  /** Só com amostra suficiente (>= 10 em cada grupo); senão null. */
  conversionFastVsSlow: { fastRate: number; slowRate: number; fastN: number; slowN: number } | null;
}

export function slaStats(facts: CrmFacts): SlaStats {
  const ended = facts.waits.filter((w) => w.ended_reason === "RESPOSTA_HUMANA" && w.ended_at);
  const durations = ended.map((w) => (new Date(w.ended_at!).getTime() - new Date(w.started_at).getTime()) / 60000).sort((a, b) => a - b);
  const pct = (p: number) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(p * durations.length))] : null);
  const open = facts.waits.filter((w) => !w.ended_at);
  const now = Date.now();
  const conversationContact = new Map(facts.conversations.map((c) => [c.id, c.contact_id]));
  const wonContacts = new Set(facts.opportunities.filter((o) => o.is_won === 1).map((o) => o.contact_id));
  const fast = ended.filter((w) => (new Date(w.ended_at!).getTime() - new Date(w.started_at).getTime()) / 60000 <= 15);
  const slow = ended.filter((w) => (new Date(w.ended_at!).getTime() - new Date(w.started_at).getTime()) / 60000 > 15);
  const convRate = (group: WaitFact[]) => group.filter((w) => wonContacts.has(conversationContact.get(w.conversation_id) ?? -1)).length / group.length;
  return {
    count: durations.length,
    avgMinutes: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    medianMinutes: pct(0.5),
    p90Minutes: pct(0.9),
    buckets: {
      upTo5: durations.filter((d) => d <= 5).length,
      upTo15: durations.filter((d) => d > 5 && d <= 15).length,
      upTo30: durations.filter((d) => d > 15 && d <= 30).length,
      over30: durations.filter((d) => d > 30).length,
    },
    longestOpenWaitMs: open.length ? Math.max(...open.map((w) => now - new Date(w.started_at).getTime())) : null,
    conversionFastVsSlow: fast.length >= 10 && slow.length >= 10 ? { fastRate: convRate(fast), slowRate: convRate(slow), fastN: fast.length, slowN: slow.length } : null,
  };
}

// --- Visão completa (uma chamada por página) --------------------------------------

export interface CompanyBi {
  period: ResolvedPeriod;
  filters: BiFilters;
  current: PeriodSnapshot;
  previous: PeriodSnapshot;
  daily: DailyPoint[];
  previousDaily: DailyPoint[];
  /** Série diária só de cada provedor (mesmos filtros, canal forçado) — para comparar Meta x Google no tempo. */
  dailyByProvider: Record<MarketingProvider, DailyPoint[]>;
  campaigns: CampaignRow[];
  channels: ChannelRow[];
  providers: ProviderComparison[];
  attendants: AttendantRow[];
  attendantMatrix: AttendantSourceCell[];
  sla: SlaStats;
  freshness: { lastSuccessAt: string | null; byProvider: Record<MarketingProvider, string | null> };
  hasAnyIntegration: boolean;
  hasAnyCrmData: boolean;
  confidenceLabels: typeof CONFIDENCE_LABELS;
}

export async function computeCompanyBi(companyId: number, timeZone: string, period: ResolvedPeriod, filters: BiFilters): Promise<CompanyBi> {
  const from = period.previous.from < period.current.from ? period.previous.from : period.current.from;
  const to = period.current.to > period.previous.to ? period.current.to : period.previous.to;
  const facts = await loadFacts(companyId, timeZone, from, to);
  const accounts = await listAccountsForCompany(companyId);
  const current = snapshot(facts, period.current, timeZone, filters);
  const previous = snapshot(facts, period.previous, timeZone, filters);
  return {
    period,
    filters,
    current,
    previous,
    daily: dailySeries(facts, period.current, timeZone, filters),
    previousDaily: dailySeries(facts, period.previous, timeZone, filters),
    dailyByProvider: {
      META: dailySeries(facts, period.current, timeZone, { ...filters, channel: "META_ADS" }),
      GOOGLE: dailySeries(facts, period.current, timeZone, { ...filters, channel: "GOOGLE_ADS" }),
    },
    campaigns: await campaignRows(companyId, facts, period.current, timeZone, filters),
    channels: channelRows(facts, period.current, timeZone, filters),
    providers: await providerComparison(companyId, facts, period.current, timeZone, filters),
    attendants: await attendantRows(companyId, facts, period.current, timeZone),
    attendantMatrix: await attendantSourceMatrix(companyId, facts, period.current, timeZone),
    sla: slaStats(facts),
    freshness: await companyDataFreshness(companyId),
    hasAnyIntegration: accounts.length > 0,
    hasAnyCrmData: facts.contacts.length > 0 || facts.opportunities.length > 0,
    confidenceLabels: CONFIDENCE_LABELS,
  };
}

/** Início do dia local em ISO UTC — usado pelas projeções (mês corrente). */
export function monthBoundsIso(timeZone: string, now: Date = new Date()): { monthStart: string; today: string; daysElapsed: number; daysInMonth: number; startIso: string; nowIso: string } {
  const today = ymdInZone(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { monthStart, today, daysElapsed: d, daysInMonth, startIso: zonedTimeToUtc(y, m, 1, 0, 0, timeZone).toISOString(), nowIso: now.toISOString() };
}
