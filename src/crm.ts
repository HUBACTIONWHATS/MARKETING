import { db } from "./db";

export interface PipelineStage {
  id: number;
  company_id: number;
  name: string;
  position: number;
  is_won: number; // 0 | 1
  is_lost: number; // 0 | 1
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
}

export interface OpportunityWithDetails extends Opportunity {
  contact_name: string;
  contact_phone: string;
  responsible_name: string | null;
}

const DEFAULT_STAGES: { name: string; isWon: boolean; isLost: boolean }[] = [
  { name: "Novo contato", isWon: false, isLost: false },
  { name: "Em atendimento", isWon: false, isLost: false },
  { name: "Qualificado", isWon: false, isLost: false },
  { name: "Agendado", isWon: false, isLost: false },
  { name: "Venda concluída", isWon: true, isLost: false },
  { name: "Perdido", isWon: false, isLost: true },
];

function nowIso(): string {
  return new Date().toISOString();
}

/** Provisiona o funil padrão para uma empresa que ainda não tem etapas. Idempotente. */
export function ensureDefaultPipelineStages(companyId: number): void {
  const count = db.prepare("SELECT COUNT(*) c FROM pipeline_stages WHERE company_id = ?").get(companyId) as {
    c: number;
  };
  if (count.c > 0) return;
  const insert = db.prepare(
    "INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const at = nowIso();
  DEFAULT_STAGES.forEach((stage, idx) => {
    insert.run(companyId, stage.name, idx + 1, stage.isWon ? 1 : 0, stage.isLost ? 1 : 0, at);
  });
}

// --- Etapas do funil (configurável) -----------------------------------------

export function listStages(companyId: number): PipelineStage[] {
  return db.prepare("SELECT * FROM pipeline_stages WHERE company_id = ? ORDER BY position").all(companyId) as PipelineStage[];
}

export function getStage(companyId: number, stageId: number): PipelineStage | undefined {
  return db.prepare("SELECT * FROM pipeline_stages WHERE id = ? AND company_id = ?").get(stageId, companyId) as
    | PipelineStage
    | undefined;
}

function firstStage(companyId: number): PipelineStage {
  ensureDefaultPipelineStages(companyId);
  return listStages(companyId)[0];
}

export function addStage(companyId: number, name: string): void {
  const stages = listStages(companyId);
  const position = stages.length > 0 ? Math.max(...stages.map((s) => s.position)) + 1 : 1;
  db.prepare("INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at) VALUES (?, ?, ?, 0, 0, ?)").run(
    companyId,
    name,
    position,
    nowIso()
  );
}

export function renameStage(companyId: number, stageId: number, name: string): void {
  db.prepare("UPDATE pipeline_stages SET name = ? WHERE id = ? AND company_id = ?").run(name, stageId, companyId);
}

export function reorderStage(companyId: number, stageId: number, direction: "up" | "down"): void {
  const stages = listStages(companyId);
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= stages.length) return;
  const a = stages[idx];
  const b = stages[swapIdx];
  const update = db.prepare("UPDATE pipeline_stages SET position = ? WHERE id = ?");
  const tx = db.transaction(() => {
    update.run(b.position, a.id);
    update.run(a.position, b.id);
  });
  tx();
}

export interface StageActionResult {
  ok: boolean;
  error?: string;
}

/** Etapas marcadas como "venda concluída" ou "perdido" são o fim do funil e não podem ser excluídas ou perder o marcador — protege as métricas do dashboard. */
export function deleteStage(companyId: number, stageId: number): StageActionResult {
  const stage = getStage(companyId, stageId);
  if (!stage) return { ok: false, error: "Etapa não encontrada." };
  if (stage.is_won || stage.is_lost) {
    return { ok: false, error: "Etapas de encerramento do funil (venda concluída / perdido) não podem ser excluídas." };
  }
  const inUse = db.prepare("SELECT COUNT(*) c FROM opportunities WHERE stage_id = ?").get(stageId) as { c: number };
  if (inUse.c > 0) return { ok: false, error: "Existem oportunidades nesta etapa. Mova-as antes de excluir." };
  db.prepare("DELETE FROM pipeline_stages WHERE id = ? AND company_id = ?").run(stageId, companyId);
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

export function createOpportunity(input: CreateOpportunityInput): Opportunity {
  const stage = firstStage(input.companyId);
  const at = nowIso();
  const info = db
    .prepare(
      `INSERT INTO opportunities (company_id, contact_id, stage_id, title, value_cents, responsible_user_id, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
  return getOpportunity(input.companyId, Number(info.lastInsertRowid))!;
}

export function getOpportunity(companyId: number, id: number): Opportunity | undefined {
  return db.prepare("SELECT * FROM opportunities WHERE id = ? AND company_id = ?").get(id, companyId) as Opportunity | undefined;
}

export function listOpportunitiesByStage(companyId: number): Map<number, OpportunityWithDetails[]> {
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS contact_name, c.phone AS contact_phone, u.name AS responsible_name
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id
       LEFT JOIN users u ON u.id = o.responsible_user_id
       WHERE o.company_id = ?
       ORDER BY o.updated_at DESC`
    )
    .all(companyId) as OpportunityWithDetails[];
  const map = new Map<number, OpportunityWithDetails[]>();
  for (const row of rows) {
    if (!map.has(row.stage_id)) map.set(row.stage_id, []);
    map.get(row.stage_id)!.push(row);
  }
  return map;
}

/** Move a oportunidade de etapa. Etapa "perdido" exige motivo. Fecha (closed_at) ao entrar em venda/perda, reabre se sair delas. */
export function moveOpportunity(
  companyId: number,
  opportunityId: number,
  newStageId: number,
  lostReason?: string
): StageActionResult {
  const opp = getOpportunity(companyId, opportunityId);
  const stage = getStage(companyId, newStageId);
  if (!opp || !stage) return { ok: false, error: "Oportunidade ou etapa não encontrada." };
  if (stage.is_lost && (!lostReason || !lostReason.trim())) {
    return { ok: false, error: "Informe o motivo da perda para mover para esta etapa." };
  }
  const at = nowIso();
  const closedAt = stage.is_won || stage.is_lost ? at : null;
  db.prepare("UPDATE opportunities SET stage_id = ?, lost_reason = ?, closed_at = ?, updated_at = ? WHERE id = ?").run(
    newStageId,
    stage.is_lost ? lostReason!.trim() : null,
    closedAt,
    at,
    opportunityId
  );
  return { ok: true };
}

export interface UpdateOpportunityFields {
  responsibleUserId?: number | null;
  valueCents?: number;
  scheduledAt?: string | null;
}

export function updateOpportunityDetails(companyId: number, opportunityId: number, fields: UpdateOpportunityFields): void {
  const opp = getOpportunity(companyId, opportunityId);
  if (!opp) return;
  db.prepare("UPDATE opportunities SET responsible_user_id = ?, value_cents = ?, scheduled_at = ?, updated_at = ? WHERE id = ?").run(
    fields.responsibleUserId !== undefined ? fields.responsibleUserId : opp.responsible_user_id,
    fields.valueCents !== undefined ? fields.valueCents : opp.value_cents,
    fields.scheduledAt !== undefined ? fields.scheduledAt : opp.scheduled_at,
    nowIso(),
    opportunityId
  );
}
