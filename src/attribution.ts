/**
 * Atribuição de origem do lead — SÓ com evidência. Regras determinísticas,
 * sem IA, sem adivinhar: quando não há sinal, a origem é DESCONHECIDA e a
 * confiança é NAO_ATRIBUIDA.
 *
 * Confiança:
 * - CONFIRMADA: identificador oficial da plataforma (ctwa_clid/fbclid/ids de
 *   campanha/anúncio vindos do referral do WhatsApp ou de UTM com id; gclid/
 *   gbraid/wbraid do Google).
 * - PROVAVEL: só UTM/regra consistente (ex.: utm_source=facebook&utm_medium=cpc)
 *   ou origem declarada manualmente pelo atendente.
 * - NAO_ATRIBUIDA: nenhum sinal.
 *
 * Nunca apresentar PROVAVEL como fato — as telas mostram a confiança ao lado.
 */
import { db } from "./db";

export type LeadSource = "META_ADS" | "GOOGLE_ADS" | "ORGANICO" | "INSTAGRAM" | "SITE" | "INDICACAO" | "OUTROS" | "DESCONHECIDA";
export type AttributionConfidence = "CONFIRMADA" | "PROVAVEL" | "NAO_ATRIBUIDA";
export type AttributionProvider = "META" | "GOOGLE" | null;

export const LEAD_SOURCES: LeadSource[] = ["META_ADS", "GOOGLE_ADS", "ORGANICO", "INSTAGRAM", "SITE", "INDICACAO", "OUTROS", "DESCONHECIDA"];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  META_ADS: "Meta Ads",
  GOOGLE_ADS: "Google Ads",
  ORGANICO: "Orgânico",
  INSTAGRAM: "Instagram",
  SITE: "Site",
  INDICACAO: "Indicação",
  OUTROS: "Outros",
  DESCONHECIDA: "Origem desconhecida",
};

export const CONFIDENCE_LABELS: Record<AttributionConfidence, string> = {
  CONFIRMADA: "Confirmada",
  PROVAVEL: "Provável",
  NAO_ATRIBUIDA: "Não atribuída",
};

export interface AttributionSignals {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ctwaClid?: string | null;
  externalCampaignId?: string | null;
  externalAdsetId?: string | null;
  externalAdId?: string | null;
  referralHeadline?: string | null;
  referralSourceUrl?: string | null;
  /** Origem escolhida à mão pelo atendente (sempre PROVAVEL, nunca CONFIRMADA). */
  declaredSource?: LeadSource | null;
}

export interface AttributionResult {
  source: LeadSource;
  confidence: AttributionConfidence;
  provider: AttributionProvider;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function hasValue(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

const PAID_MEDIUMS = ["cpc", "ppc", "paid", "paidsocial", "paid_social", "paid-social", "ads", "cpm", "display", "paidsearch", "paid_search"];

export function classifyAttribution(s: AttributionSignals): AttributionResult {
  // 1. Identificadores oficiais — confirmada.
  if (hasValue(s.ctwaClid) || hasValue(s.fbclid) || (hasValue(s.externalAdId) && !hasValue(s.gclid))) {
    return { source: "META_ADS", confidence: "CONFIRMADA", provider: "META" };
  }
  if (hasValue(s.gclid) || hasValue(s.gbraid) || hasValue(s.wbraid)) {
    return { source: "GOOGLE_ADS", confidence: "CONFIRMADA", provider: "GOOGLE" };
  }
  if (hasValue(s.externalCampaignId) && !hasValue(s.utmSource)) {
    // id de campanha sem indicar plataforma: só sabemos que é mídia paga com id — trata como Meta
    // apenas se veio do referral do WhatsApp (o chamador preenche externalAdId nesse caso).
    return { source: "OUTROS", confidence: "PROVAVEL", provider: null };
  }

  // 2. UTM — provável.
  const src = clean(s.utmSource);
  const medium = clean(s.utmMedium);
  const paid = PAID_MEDIUMS.some((m) => medium.includes(m));
  if (src) {
    const isMeta = /facebook|fb|meta|instagram|ig/.test(src);
    const isGoogle = /google|adwords|gads/.test(src);
    if (isMeta && paid) return { source: "META_ADS", confidence: "PROVAVEL", provider: "META" };
    if (isGoogle && paid) return { source: "GOOGLE_ADS", confidence: "PROVAVEL", provider: "GOOGLE" };
    if (/instagram|ig/.test(src)) return { source: "INSTAGRAM", confidence: "PROVAVEL", provider: null };
    if (isGoogle || medium.includes("organic")) return { source: "ORGANICO", confidence: "PROVAVEL", provider: null };
    if (/referral|indica|recommend/.test(medium) || /indica/.test(src)) return { source: "INDICACAO", confidence: "PROVAVEL", provider: null };
    if (/site|website|landing|lp/.test(src) || /site|web/.test(medium)) return { source: "SITE", confidence: "PROVAVEL", provider: null };
    return { source: "OUTROS", confidence: "PROVAVEL", provider: null };
  }

  // 3. Declarada manualmente — provável.
  if (s.declaredSource && s.declaredSource !== "DESCONHECIDA") {
    const provider: AttributionProvider = s.declaredSource === "META_ADS" ? "META" : s.declaredSource === "GOOGLE_ADS" ? "GOOGLE" : null;
    return { source: s.declaredSource, confidence: "PROVAVEL", provider };
  }

  return { source: "DESCONHECIDA", confidence: "NAO_ATRIBUIDA", provider: null };
}

/**
 * Referral do WhatsApp Cloud API (mensagem iniciada por anúncio "Clique para
 * o WhatsApp"): message.referral = { source_url, source_id, source_type
 * ("ad" | "post"), headline, body, media_type, ctwa_clid }. Só lê o formato
 * documentado; qualquer campo ausente vira null.
 */
export function parseWhatsAppReferral(referral: unknown): AttributionSignals | null {
  if (!referral || typeof referral !== "object") return null;
  const r = referral as Record<string, unknown>;
  const str = (k: string): string | null => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, 500) : null);
  const sourceType = str("source_type");
  const sourceId = str("source_id");
  const signals: AttributionSignals = {
    ctwaClid: str("ctwa_clid"),
    referralHeadline: str("headline"),
    referralSourceUrl: str("source_url"),
    externalAdId: sourceType === "ad" ? sourceId : null,
  };
  const fromUrl = signals.referralSourceUrl ? parseUtmFromUrl(signals.referralSourceUrl) : null;
  if (fromUrl) Object.assign(signals, { ...fromUrl, ...stripNulls(signals) });
  if (!signals.ctwaClid && !signals.externalAdId && !signals.referralSourceUrl) return null;
  return signals;
}

function stripNulls<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) (out as any)[k] = v;
  return out;
}

/** Extrai utm_* e ids de clique de uma URL (ex.: link de anúncio, site). Não lança. */
export function parseUtmFromUrl(url: string): AttributionSignals | null {
  try {
    const u = new URL(url);
    const p = u.searchParams;
    const get = (k: string) => (p.get(k) ? p.get(k)!.slice(0, 300) : null);
    const out: AttributionSignals = {
      utmSource: get("utm_source"),
      utmMedium: get("utm_medium"),
      utmCampaign: get("utm_campaign"),
      utmContent: get("utm_content"),
      utmTerm: get("utm_term"),
      fbclid: get("fbclid"),
      gclid: get("gclid"),
      gbraid: get("gbraid"),
      wbraid: get("wbraid"),
    };
    return Object.values(out).some((v) => v) ? out : null;
  } catch {
    return null;
  }
}

export interface ContactAttribution {
  source: LeadSource;
  attribution_confidence: AttributionConfidence;
  attribution_provider: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ctwa_clid: string | null;
  external_campaign_id: string | null;
  external_adset_id: string | null;
  external_ad_id: string | null;
  referral_headline: string | null;
  referral_source_url: string | null;
  attributed_at: string | null;
}

/**
 * Grava a atribuição no contato — primeiro toque vence: uma atribuição
 * CONFIRMADA nunca é substituída por uma PROVAVEL, e uma já gravada só é
 * trocada se a nova tiver confiança maior. Sempre escopada por company_id.
 */
export async function applyContactAttribution(companyId: number, contactId: number, signals: AttributionSignals): Promise<AttributionResult> {
  const result = classifyAttribution(signals);
  const current = await db.get<{ attribution_confidence: AttributionConfidence }>(
    "SELECT attribution_confidence FROM contacts WHERE id = ? AND company_id = ?",
    contactId,
    companyId
  );
  if (!current) return result;
  const rank: Record<AttributionConfidence, number> = { NAO_ATRIBUIDA: 0, PROVAVEL: 1, CONFIRMADA: 2 };
  if (rank[result.confidence] <= rank[current.attribution_confidence] && current.attribution_confidence !== "NAO_ATRIBUIDA") {
    return result;
  }
  if (result.confidence === "NAO_ATRIBUIDA") return result;
  await db.run(
    `UPDATE contacts SET source = ?, attribution_confidence = ?, attribution_provider = ?,
       utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
       fbclid = ?, gclid = ?, gbraid = ?, wbraid = ?, ctwa_clid = ?,
       external_campaign_id = ?, external_adset_id = ?, external_ad_id = ?,
       referral_headline = ?, referral_source_url = ?, attributed_at = ?
     WHERE id = ? AND company_id = ?`,
    result.source,
    result.confidence,
    result.provider,
    signals.utmSource ?? null,
    signals.utmMedium ?? null,
    signals.utmCampaign ?? null,
    signals.utmContent ?? null,
    signals.utmTerm ?? null,
    signals.fbclid ?? null,
    signals.gclid ?? null,
    signals.gbraid ?? null,
    signals.wbraid ?? null,
    signals.ctwaClid ?? null,
    signals.externalCampaignId ?? null,
    signals.externalAdsetId ?? null,
    signals.externalAdId ?? null,
    signals.referralHeadline ?? null,
    signals.referralSourceUrl ?? null,
    new Date().toISOString(),
    contactId,
    companyId
  );
  return result;
}

/** Origem declarada pelo atendente na tela — nunca sobrescreve uma CONFIRMADA. */
export async function declareContactSource(companyId: number, contactId: number, source: LeadSource): Promise<void> {
  await applyContactAttribution(companyId, contactId, { declaredSource: source });
}
