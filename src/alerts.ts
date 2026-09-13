/**
 * Central de alertas: regras configuráveis (alert_rules, por empresa ou
 * padrão global) + ocorrências (alerts) geradas a partir dos itens de
 * "precisa de atenção" (insights.ts). Idempotente por dedupe_key (um alerta
 * por fato por dia). Sempre escopado por company_id.
 */
import { db } from "./db";
import { buildAttention, DEFAULT_THRESHOLDS, type AttentionItem, type AttentionThresholds, type Severity } from "./insights";
import type { CompanyBi } from "./bi";

export type AlertStatus = "ABERTO" | "EM_ANALISE" | "RESOLVIDO" | "IGNORADO";

export interface AlertRow {
  id: number;
  company_id: number;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  metric: string | null;
  current_value: string | null;
  reference_value: string | null;
  status: AlertStatus;
  assignee_user_id: number | null;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  company_name?: string;
  assignee_name?: string | null;
}

export const RULE_KINDS: { kind: keyof AttentionThresholds; label: string; unit: string }[] = [
  { kind: "spendWithoutLeadCents", label: "Investimento sem lead qualificado (R$)", unit: "centavos" },
  { kind: "cplIncreasePct", label: "Aumento de CPL vs período anterior (%)", unit: "%" },
  { kind: "cacIncreasePct", label: "Aumento de CAC vs período anterior (%)", unit: "%" },
  { kind: "hoursWithoutSync", label: "Horas sem sincronização", unit: "h" },
  { kind: "cacAboveAvgPct", label: "CAC da campanha acima da média (%)", unit: "%" },
  { kind: "attendanceDropPct", label: "Queda da taxa de comparecimento (pontos)", unit: "pp" },
];

/** Limiares da empresa (linha própria) com fallback no padrão global (company_id NULL) e depois no código. */
export async function thresholdsFor(companyId: number): Promise<AttentionThresholds> {
  const rows = await db.all<{ company_id: number | null; kind: string; threshold: number; enabled: number }>(
    "SELECT company_id, kind, threshold, enabled FROM alert_rules WHERE company_id = ? OR company_id IS NULL",
    companyId
  );
  const out: AttentionThresholds = { ...DEFAULT_THRESHOLDS };
  for (const r of rows.filter((x) => x.company_id === null)) if (r.enabled) (out as any)[r.kind] = Number(r.threshold);
  for (const r of rows.filter((x) => x.company_id === companyId)) if (r.enabled) (out as any)[r.kind] = Number(r.threshold);
  return out;
}

export async function saveThreshold(companyId: number | null, kind: keyof AttentionThresholds, threshold: number): Promise<void> {
  const at = new Date().toISOString();
  const existing = await db.get<{ id: number }>(
    companyId === null ? "SELECT id FROM alert_rules WHERE company_id IS NULL AND kind = ?" : "SELECT id FROM alert_rules WHERE company_id = ? AND kind = ?",
    ...(companyId === null ? [kind] : [companyId, kind])
  );
  if (existing) await db.run("UPDATE alert_rules SET threshold = ?, enabled = 1, updated_at = ? WHERE id = ?", threshold, at, existing.id);
  else await db.run("INSERT INTO alert_rules (company_id, kind, threshold, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", companyId, kind, threshold, at, at);
}

export function listGlobalRules(): Promise<{ kind: string; threshold: number }[]> {
  return db.all("SELECT kind, threshold FROM alert_rules WHERE company_id IS NULL");
}

/** Avalia as regras para a empresa e persiste ocorrências novas (dedupe por dia). Devolve os itens avaliados. */
export async function evaluateAlerts(companyId: number, bi: CompanyBi, now: Date = new Date()): Promise<AttentionItem[]> {
  const items = await buildAttention(companyId, bi, await thresholdsFor(companyId), now);
  const at = now.toISOString();
  for (const it of items) {
    if (it.severity === "INFORMACAO") continue;
    const existing = await db.get<{ id: number }>("SELECT id FROM alerts WHERE company_id = ? AND dedupe_key = ?", companyId, it.dedupeKey);
    if (existing) continue;
    await db.run(
      `INSERT INTO alerts (company_id, category, severity, title, description, metric, current_value, reference_value, status, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?, ?)`,
      companyId,
      it.category,
      it.severity,
      it.fact.slice(0, 200),
      it.recommendation ? `${it.fact} Recomendação: ${it.recommendation}` : it.fact,
      it.metric ?? null,
      it.currentValue ?? null,
      it.referenceValue ?? null,
      it.dedupeKey,
      at,
      at
    );
  }
  return items;
}

export function listAlerts(companyId: number, status: AlertStatus | "TODOS", limit = 100): Promise<AlertRow[]> {
  const base = `SELECT a.*, u.name AS assignee_name FROM alerts a LEFT JOIN users u ON u.id = a.assignee_user_id WHERE a.company_id = ?`;
  if (status === "TODOS") return db.all<AlertRow>(`${base} ORDER BY a.id DESC LIMIT ?`, companyId, limit);
  return db.all<AlertRow>(`${base} AND a.status = ? ORDER BY a.id DESC LIMIT ?`, companyId, status, limit);
}

export function listAlertsAllCompanies(limit = 200): Promise<AlertRow[]> {
  return db.all<AlertRow>(
    `SELECT a.*, c.name AS company_name, u.name AS assignee_name FROM alerts a JOIN companies c ON c.id = a.company_id LEFT JOIN users u ON u.id = a.assignee_user_id
     WHERE a.status IN ('ABERTO','EM_ANALISE') ORDER BY CASE a.severity WHEN 'CRITICO' THEN 0 WHEN 'ATENCAO' THEN 1 ELSE 2 END, a.id DESC LIMIT ?`,
    limit
  );
}

export async function updateAlertStatus(companyId: number, alertId: number, status: AlertStatus, assigneeUserId: number | null): Promise<boolean> {
  const at = new Date().toISOString();
  const res = await db.run(
    "UPDATE alerts SET status = ?, assignee_user_id = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND company_id = ?",
    status,
    assigneeUserId,
    at,
    status === "RESOLVIDO" || status === "IGNORADO" ? at : null,
    alertId,
    companyId
  );
  return res.changes > 0;
}
