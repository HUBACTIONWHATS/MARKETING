import { localDayRangeToUtc } from "./businessHours";
import { db } from "./db";

export interface DashboardFilters {
  /** "YYYY-MM-DD", inclusive */
  from: string;
  /** "YYYY-MM-DD", inclusive */
  to: string;
  attendantUserId: number | null;
}

export interface FirstResponseStats {
  count: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  withinSlaPercent: number | null;
}

export interface DashboardData {
  newContacts: number;
  opportunitiesCreated: number;
  scheduledCount: number;
  wonCount: number;
  wonRevenueCents: number;
  waitingNow: number;
  longestWaitMs: number | null;
  firstResponse: FirstResponseStats;
  closedWithoutReply: number;
  slaTargetMinutes: number;
  hasAnyData: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const row = await db.get<{ c: number }>(sql, ...params);
  return row ? Number(row.c) : 0;
}

export async function computeDashboard(
  companyId: number,
  timeZone: string,
  slaTargetMinutes: number,
  filters: DashboardFilters
): Promise<DashboardData> {
  const { startUtc, endUtc } = localDayRangeToUtc(filters.from, filters.to, timeZone);
  const fromIso = startUtc.toISOString();
  const toIso = endUtc.toISOString();
  const attendant = filters.attendantUserId;

  // CAST(? AS INTEGER) IS NULL: o Postgres não infere o tipo de um parâmetro nulo em `? IS NULL`.
  const newContacts = await count(
    "SELECT COUNT(*) c FROM contacts WHERE company_id = ? AND created_at >= ? AND created_at < ?",
    companyId,
    fromIso,
    toIso
  );

  const opportunitiesCreated = await count(
    `SELECT COUNT(*) c FROM opportunities
     WHERE company_id = ? AND created_at >= ? AND created_at < ?
       AND (CAST(? AS INTEGER) IS NULL OR responsible_user_id = ?)`,
    companyId,
    fromIso,
    toIso,
    attendant,
    attendant
  );

  const scheduledCount = await count(
    `SELECT COUNT(*) c FROM opportunities
     WHERE company_id = ? AND scheduled_at >= ? AND scheduled_at < ?
       AND (CAST(? AS INTEGER) IS NULL OR responsible_user_id = ?)`,
    companyId,
    fromIso,
    toIso,
    attendant,
    attendant
  );

  const wonRow = (await db.get<{ c: number; s: number }>(
    `SELECT COUNT(*) c, COALESCE(SUM(o.value_cents), 0) s
     FROM opportunities o
     JOIN pipeline_stages ps ON ps.id = o.stage_id
     WHERE o.company_id = ? AND ps.is_won = 1 AND o.closed_at >= ? AND o.closed_at < ?
       AND (CAST(? AS INTEGER) IS NULL OR o.responsible_user_id = ?)`,
    companyId,
    fromIso,
    toIso,
    attendant,
    attendant
  )) ?? { c: 0, s: 0 };

  // Pendências: estado atual, não filtrado por período (é "agora").
  const waitingRows = await db.all<{ started_at: string }>(
    `SELECT we.started_at FROM conversations co
     JOIN wait_episodes we ON we.conversation_id = co.id AND we.ended_at IS NULL
     WHERE co.company_id = ? AND (CAST(? AS INTEGER) IS NULL OR co.assigned_user_id = ?)`,
    companyId,
    attendant,
    attendant
  );
  const now = Date.now();
  const waitingNow = waitingRows.length;
  const longestWaitMs =
    waitingRows.length > 0 ? Math.max(...waitingRows.map((r) => now - new Date(r.started_at).getTime())) : null;

  // Esperas concluídas no período: primeiro episódio de cada conversa, encerrado por resposta humana.
  const episodes = await db.all<{ started_at: string; ended_at: string }>(
    `SELECT we.started_at, we.ended_at FROM wait_episodes we
     WHERE we.company_id = ? AND we.ended_reason = 'RESPOSTA_HUMANA'
       AND we.started_at >= ? AND we.started_at < ?
       AND we.id = (SELECT MIN(id) FROM wait_episodes we2 WHERE we2.conversation_id = we.conversation_id)
       AND (CAST(? AS INTEGER) IS NULL OR we.ended_by_user_id = ?)`,
    companyId,
    fromIso,
    toIso,
    attendant,
    attendant
  );

  const durationsMin = episodes.map((e) => (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 60000);
  const avgMinutes = durationsMin.length > 0 ? durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length : null;
  const medianMinutes = durationsMin.length > 0 ? median(durationsMin) : null;
  const withinSlaPercent =
    durationsMin.length > 0
      ? Math.round((durationsMin.filter((m) => m <= slaTargetMinutes).length / durationsMin.length) * 100)
      : null;

  // Encerrados sem nenhuma resposta humana enviada — não filtra por atendente (não houve autor).
  const closedWithoutReply = await count(
    `SELECT COUNT(*) c FROM conversations co
     WHERE co.company_id = ? AND co.status = 'ENCERRADO' AND co.updated_at >= ? AND co.updated_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM messages m WHERE m.conversation_id = co.id AND m.author_type = 'HUMANO' AND m.send_status = 'ENVIADA'
       )`,
    companyId,
    fromIso,
    toIso
  );

  const totalContacts = await count("SELECT COUNT(*) c FROM contacts WHERE company_id = ?", companyId);
  const totalConversations = await count("SELECT COUNT(*) c FROM conversations WHERE company_id = ?", companyId);
  const totalOpportunities = await count("SELECT COUNT(*) c FROM opportunities WHERE company_id = ?", companyId);

  return {
    newContacts,
    opportunitiesCreated,
    scheduledCount,
    wonCount: Number(wonRow.c),
    wonRevenueCents: Number(wonRow.s),
    waitingNow,
    longestWaitMs,
    firstResponse: { count: durationsMin.length, avgMinutes, medianMinutes, withinSlaPercent },
    closedWithoutReply,
    slaTargetMinutes,
    hasAnyData: totalContacts > 0 || totalConversations > 0 || totalOpportunities > 0,
  };
}
