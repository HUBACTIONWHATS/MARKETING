import { db } from "./db";

export interface PipelineStage {
  id: number;
  company_id: number;
  name: string;
  position: number;
  is_won: number; // 0 | 1
  is_lost: number; // 0 | 1
  /** Entrar nesta etapa marca o lead como qualificado (qualified_at) — base do CPL qualificado. */
  is_qualified: number; // 0 | 1
  /** Entrar nesta etapa marca comparecimento (attended_at) — base do custo por comparecimento. */
  is_attended: number; // 0 | 1
  created_at: string;
}

export interface Opportunity {
  id: number;
  company_id: number;
  contact_id: number;
  stage_id: number;
  title: string;
  value_cents: number;
  responsible_user_id: number | null;
  scheduled_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  qualified_at: string | null;
  attended_at: string | null;
}

export interface OpportunityWithDetails extends Opportunity {
  contact_name: string;
  contact_phone: string;
  responsible_name: string | null;
  contact_source: string;
  contact_confidence: string;
}

const DEFAULT_STAGES: { name: string; isWon: boolean; isLost: boolean; isQualified?: boolean; isAttended?: boolean }[] = [
  { name: "Novo contato", isWon: false, isLost: false },
  { name: "Em atendimento", isWon: false, isLost: false },
  { name: "Qualificado", isWon: false, isLost: false, isQualified: true },
  { name: "Agendado", isWon: false, isLost: false },
  { name: "Compareceu", isWon: false, isLost: false, isAttended: true },
  { name: "Venda concluída", isWon: true, isLost: false },
  { name: "Perdido", isWon: false, isLost: true },
];

function nowIso(): string {
  return new Date().toISOString();
}

/** Provisiona o funil padrão para uma empresa que ainda não tem etapas. Idempotente. */
export async function ensureDefaultPipelineStages(companyId: number): Promise<void> {
  const count = await db.get<{ c: number }>("SELECT COUNT(*) c FROM pipeline_stages WHERE company_id = ?", companyId);
  if (count && count.c > 0) return;
  const at = nowIso();
  for (const [idx, stage] of DEFAULT_STAGES.entries()) {
    await db.run(
      "INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, is_qualified, is_attended, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      companyId,
      stage.name,
      idx + 1,
      stage.isWon ? 1 : 0,
      stage.isLost ? 1 : 0,
      stage.isQualified ? 1 : 0,
      stage.isAttended ? 1 : 0,
      at
    );
  }
}

/** Marca o significado de uma etapa para o funil de marketing (qualificado / compareceu). Só da própria empresa. */
export async function setStageFlags(companyId: number, stageId: number, flags: { isQualified: boolean; isAttended: boolean }): Promise<void> {
  await db.run("UPDATE pipeline_stages SET is_qualified = ?, is_attended = ? WHERE id = ? AND company_id = ?", flags.isQualified ? 1 : 0, flags.isAttended ? 1 : 0, stageId, companyId);
}

// --- Etapas do funil (configurável) -----------------------------------------

export function listStages(companyId: number): Promise<PipelineStage[]> {
  return db.all<PipelineStage>("SELECT * FROM pipeline_stages WHERE company_id = ? ORDER BY position", companyId);
}

export function getStage(companyId: number, stageId: number): Promise<PipelineStage | undefined> {
  return db.get<PipelineStage>("SELECT * FROM pipeline_stages WHERE id = ? AND company_id = ?", stageId, companyId);
}

async function firstStage(companyId: number): Promise<PipelineStage> {
  await ensureDefaultPipelineStages(companyId);
  return (await listStages(companyId))[0];
}

export async function addStage(companyId: number, name: string): Promise<void> {
  const stages = await listStages(companyId);
  const position = stages.length > 0 ? Math.max(...stages.map((s) => s.position)) + 1 : 1;
  await db.run(
    "INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at) VALUES (?, ?, ?, 0, 0, ?)",
    companyId,
    name,
    position,
    nowIso()
  );
}

export async function renameStage(companyId: number, stageId: number, name: string): Promise<void> {
  await db.run("UPDATE pipeline_stages SET name = ? WHERE id = ? AND company_id = ?", name, stageId, companyId);
}

export async function reorderStage(companyId: number, stageId: number, direction: "up" | "down"): Promise<void> {
  const stages = await listStages(companyId);
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= stages.length) return;
  const a = stages[idx];
  const b = stages[swapIdx];
  await db.transaction(async (tx) => {
    await tx.run("UPDATE pipeline_stages SET position = ? WHERE id = ?", b.position, a.id);
    await tx.run("UPDATE pipeline_stages SET position = ? WHERE id = ?", a.position, b.id);
  });
}

export interface StageActionResult {
  ok: boolean;
  error?: string;
}

/** Etapas marcadas como "venda concluída" ou "perdido" são o fim do funil e não podem ser excluídas ou perder o marcador — protege as métricas do dashboard. */
export async function deleteStage(companyId: number, stageId: number): Promise<StageActionResult> {
  const stage = await getStage(companyId, stageId);
  if (!stage) return { ok: false, error: "Etapa não encontrada." };
  if (stage.is_won || stage.is_lost) {
    return { ok: false, error: "Etapas de encerramento do funil (venda concluída / perdido) não podem ser excluídas." };
  }
  const inUse = await db.get<{ c: number }>("SELECT COUNT(*) c FROM opportunities WHERE stage_id = ?", stageId);
  if (inUse && inUse.c > 0) return { ok: false, error: "Existem oportunidades nesta etapa. Mova-as antes de excluir." };
  await db.run("DELETE FROM pipeline_stages WHERE id = ? AND company_id = ?", stageId, companyId);
  return { ok: true };
}

// --- Oportunidades (separadas de contato) -----------------------------------

export interface CreateOpportunityInput {
  companyId: number;
  contactId: number;
  title: string;
  valueCents: number;
  responsibleUserId?: number | null;
  scheduledAt?: string | null;
}

export async function createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
  const stage = await firstStage(input.companyId);
  const at = nowIso();
  const row = await db.get<{ id: number }>(
    `INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, responsible_user_id, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.companyId,
    input.contactId,
    stage.id,
    input.title,
    input.valueCents,
    input.responsibleUserId ?? null,
    input.scheduledAt ?? null,
    at,
    at
  );
  return (await getOpportunity(input.companyId, row!.id))!;
}

export function getOpportunity(companyId: number, id: number): Promise<Opportunity | undefined> {
  return db.get<Opportunity>("SELECT * FROM opportunities WHERE id = ? AND company_id = ?", id, companyId);
}

export async function listOpportunitiesByStage(companyId: number): Promise<Map<number, OpportunityWithDetails[]>> {
  const rows = await db.all<OpportunityWithDetails>(
    `SELECT o.*, c.name AS contact_name, c.phone AS contact_phone, u.name AS responsible_name,
            c.source AS contact_source, c.attribution_confidence AS contact_confidence
     FROM opportunities o
     JOIN contacts c ON c.id = o.contact_id
     LEFT JOIN users u ON u.id = o.responsible_user_id
     WHERE o.company_id = ?
     ORDER BY o.updated_at DESC`,
    companyId
  );
  const map = new Map<number, OpportunityWithDetails[]>();
  for (const row of rows) {
    if (!map.has(row.stage_id)) map.set(row.stage_id, []);
    map.get(row.stage_id)!.push(row);
  }
  return map;
}

export interface MoveResult extends StageActionResult {
  /** Marcos alcançados AGORA (primeira vez) — usados pelo feedback de conversão e pela auditoria. */
  reached?: { qualified: boolean; attended: boolean; won: boolean };
  opportunity?: Opportunity;
}

/**
 * Move a oportunidade de etapa. Etapa "perdido" exige motivo. Fecha (closed_at)
 * ao entrar em venda/perda, reabre se sair delas. Marcos do funil de marketing:
 * entrar numa etapa qualificada/compareceu/ganha grava qualified_at (uma vez);
 * entrar numa etapa "compareceu" grava attended_at (uma vez). Datas nunca são
 * apagadas ao voltar de etapa — o fato aconteceu.
 */
export async function moveOpportunity(
  companyId: number,
  opportunityId: number,
  newStageId: number,
  lostReason?: string
): Promise<MoveResult> {
  const opp = await getOpportunity(companyId, opportunityId);
  const stage = await getStage(companyId, newStageId);
  if (!opp || !stage) return { ok: false, error: "Oportunidade ou etapa não encontrada." };
  if (stage.is_lost && (!lostReason || !lostReason.trim())) {
    return { ok: false, error: "Informe o motivo da perda para mover para esta etapa." };
  }
  const at = nowIso();
  const closedAt = stage.is_won || stage.is_lost ? at : null;
  const reachesQualified = !opp.qualified_at && (stage.is_qualified === 1 || stage.is_attended === 1 || stage.is_won === 1);
  const reachesAttended = !opp.attended_at && stage.is_attended === 1;
  const reachesWon = stage.is_won === 1 && !(opp.closed_at && (await getStage(companyId, opp.stage_id))?.is_won === 1);
  await db.run(
    "UPDATE opportunities SET stage_id = ?, lost_reason = ?, closed_at = ?, updated_at = ?, qualified_at = COALESCE(qualified_at, ?), attended_at = COALESCE(attended_at, ?) WHERE id = ? AND company_id = ?",
    newStageId,
    stage.is_lost ? lostReason!.trim() : null,
    closedAt,
    at,
    reachesQualified ? at : null,
    reachesAttended ? at : null,
    opportunityId,
    companyId
  );
  return { ok: true, reached: { qualified: reachesQualified, attended: reachesAttended, won: reachesWon }, opportunity: await getOpportunity(companyId, opportunityId) };
}

export interface UpdateOpportunityFields {
  responsibleUserId?: number | null;
  valueCents?: number;
  scheduledAt?: string | null;
  /** Comparecimento registrado à mão (sem mover de etapa). */
  attendedAt?: string | null;
}

export async function updateOpportunityDetails(
  companyId: number,
  opportunityId: number,
  fields: UpdateOpportunityFields
): Promise<void> {
  const opp = await getOpportunity(companyId, opportunityId);
  if (!opp) return;
  await db.run(
    "UPDATE opportunities SET responsible_user_id = ?, value_cents = ?, scheduled_at = ?, attended_at = ?, updated_at = ? WHERE id = ? AND company_id = ?",
    fields.responsibleUserId !== undefined ? fields.responsibleUserId : opp.responsible_user_id,
    fields.valueCents !== undefined ? fields.valueCents : opp.value_cents,
    fields.scheduledAt !== undefined ? fields.scheduledAt : opp.scheduled_at,
    fields.attendedAt !== undefined ? fields.attendedAt : opp.attended_at,
    nowIso(),
    opportunityId,
    companyId
  );
}
