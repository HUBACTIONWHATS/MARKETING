/**
 * Feedback de conversão para as plataformas (Meta Conversions API / conversões
 * importadas do Google Ads) — SÓ A ARQUITETURA. Nada é enviado: o envio fica
 * desativado até existir credencial e ativação explícita do administrador
 * geral por empresa e provedor (conversion_feedback_settings.enabled).
 *
 * O que já funciona: geração idempotente dos eventos reais do CRM
 * (external_event_id determinístico), fila com status/tentativas, auditoria.
 * O que falta (pendência declarada): o "sender" oficial de cada plataforma,
 * a ser implementado consultando a documentação atual quando houver
 * credencial — nunca com base em tutorial antigo.
 */
import { audit } from "./access";
import { db } from "./db";
import type { MarketingProvider } from "./marketingModels";

export type FeedbackEventType = "Lead" | "QualifiedLead" | "AppointmentScheduled" | "AppointmentAttended" | "Purchase";

export interface FeedbackEvent {
  id: number;
  company_id: number;
  provider: MarketingProvider;
  contact_id: number | null;
  opportunity_id: number | null;
  event_type: FeedbackEventType;
  event_time: string;
  value_cents: number | null;
  currency: string | null;
  source: string | null;
  attribution_confidence: string | null;
  external_event_id: string;
  status: "PENDENTE" | "VALIDADO" | "ENVIADO" | "ACEITO" | "REJEITADO" | "DESATIVADO";
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export async function isFeedbackEnabled(companyId: number, provider: MarketingProvider): Promise<boolean> {
  const row = await db.get<{ enabled: number }>("SELECT enabled FROM conversion_feedback_settings WHERE company_id = ? AND provider = ?", companyId, provider);
  return !!row && row.enabled === 1;
}

export async function setFeedbackEnabled(companyId: number, provider: MarketingProvider, enabled: boolean, userId: number): Promise<void> {
  const at = new Date().toISOString();
  const existing = await db.get<{ id: number }>("SELECT id FROM conversion_feedback_settings WHERE company_id = ? AND provider = ?", companyId, provider);
  if (existing) await db.run("UPDATE conversion_feedback_settings SET enabled = ?, updated_at = ? WHERE id = ?", enabled ? 1 : 0, at, existing.id);
  else await db.run("INSERT INTO conversion_feedback_settings (company_id, provider, enabled, updated_at) VALUES (?, ?, ?, ?)", companyId, provider, enabled ? 1 : 0, at);
  await audit(enabled ? "feedback_conversao_ativado" : "feedback_conversao_desativado", { companyId, userId, detail: provider });
}

/**
 * Registra um evento real do CRM para envio futuro. Idempotente: o mesmo
 * (empresa, provedor, tipo, oportunidade/contato) nunca gera duas linhas.
 * Só cria quando o contato tem atribuição para aquele provedor — sem
 * evidência, não há o que devolver à plataforma.
 */
export async function recordConversionEvent(input: {
  companyId: number;
  contactId: number | null;
  opportunityId: number | null;
  eventType: FeedbackEventType;
  eventTime: string;
  valueCents: number | null;
  currency: string | null;
}): Promise<{ created: boolean; reason?: string }> {
  if (!input.contactId) return { created: false, reason: "sem contato" };
  const contact = await db.get<{ attribution_provider: string | null; source: string; attribution_confidence: string }>(
    "SELECT attribution_provider, source, attribution_confidence FROM contacts WHERE id = ? AND company_id = ?",
    input.contactId,
    input.companyId
  );
  if (!contact || !contact.attribution_provider) return { created: false, reason: "contato sem atribuição a uma plataforma" };
  const provider = contact.attribution_provider as MarketingProvider;
  const externalEventId = `${provider}:${input.eventType}:${input.opportunityId ?? `c${input.contactId}`}`;
  const existing = await db.get<{ id: number }>(
    "SELECT id FROM conversion_feedback_events WHERE company_id = ? AND provider = ? AND external_event_id = ?",
    input.companyId,
    provider,
    externalEventId
  );
  if (existing) return { created: false, reason: "evento já registrado" };
  const enabled = await isFeedbackEnabled(input.companyId, provider);
  await db.run(
    `INSERT INTO conversion_feedback_events
      (company_id, provider, contact_id, opportunity_id, event_type, event_time, value_cents, currency, source, attribution_confidence, external_event_id, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    input.companyId,
    provider,
    input.contactId,
    input.opportunityId,
    input.eventType,
    input.eventTime,
    input.valueCents,
    input.currency,
    contact.source,
    contact.attribution_confidence,
    externalEventId,
    enabled ? "PENDENTE" : "DESATIVADO",
    new Date().toISOString()
  );
  await audit("feedback_conversao_evento_criado", { companyId: input.companyId, detail: `${provider} ${input.eventType} (${enabled ? "pendente" : "desativado"})` });
  return { created: true };
}

export function listFeedbackEvents(companyId: number, limit = 50): Promise<FeedbackEvent[]> {
  return db.all<FeedbackEvent>("SELECT * FROM conversion_feedback_events WHERE company_id = ? ORDER BY id DESC LIMIT ?", companyId, limit);
}

/**
 * Processador da fila — INTENCIONALMENTE sem envio. Devolve o motivo para o
 * painel. Quando a integração oficial for implementada, é aqui que entra o
 * envio com event_id/idempotência da plataforma e auditoria de aceito/rejeitado.
 */
export async function processPendingFeedback(): Promise<{ sent: number; skipped: number; reason: string }> {
  const pending = await db.get<{ c: number }>("SELECT COUNT(*) c FROM conversion_feedback_events WHERE status = 'PENDENTE'");
  return { sent: 0, skipped: Number(pending?.c ?? 0), reason: "Envio desativado: integração oficial de conversões ainda não implementada (aguardando credenciais e ativação explícita)." };
}
