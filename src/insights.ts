/**
 * Growth Intelligence — regras determinísticas sobre os números do bi.ts.
 * Nada aqui inventa causa: cada item separa FATO (número vindo do banco) de
 * HIPÓTESE/RECOMENDAÇÃO (texto marcado como tal). Sem IA.
 *
 * Contém: metas do mês + projeção, funil executivo com perdas, detector de
 * gargalos ("possível gargalo"), central "precisa de atenção", análise
 * custo x qualidade, score de lead, leads quentes, oportunidades paradas,
 * semáforo/score de saúde (fórmula transparente) e resumo executivo.
 */
import { CONFIDENCE_LABELS, SOURCE_LABELS, type AttributionConfidence, type LeadSource } from "./attribution";
import { db } from "./db";
import { deltaPercent, monthBoundsIso, ratio, type CampaignRow, type CompanyBi, type PeriodSnapshot } from "./bi";
import { PROVIDER_LABELS, listAccountsForCompany, type MarketingProvider } from "./marketingModels";

// --- Formatação (pt-BR, usada nos textos dos insights) ------------------------

export function fmtBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function fmtDelta(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}%`;
}

// --- Metas do mês --------------------------------------------------------------

export interface CompanyGoals {
  revenue_cents: number | null;
  new_customers: number | null;
  leads: number | null;
  qualified_leads: number | null;
  appointments: number | null;
  attendances: number | null;
  max_cac_cents: number | null;
  max_cpl_cents: number | null;
  min_roas: number | null;
  planned_monthly_spend_cents: number | null;
}

export async function getGoals(companyId: number): Promise<CompanyGoals | null> {
  const row = await db.get<CompanyGoals>("SELECT * FROM company_goals WHERE company_id = ?", companyId);
  return row ?? null;
}

export async function saveGoals(companyId: number, g: CompanyGoals): Promise<void> {
  const at = new Date().toISOString();
  const existing = await db.get<{ company_id: number }>("SELECT company_id FROM company_goals WHERE company_id = ?", companyId);
  const values = [g.revenue_cents, g.new_customers, g.leads, g.qualified_leads, g.appointments, g.attendances, g.max_cac_cents, g.max_cpl_cents, g.min_roas, g.planned_monthly_spend_cents, at];
  if (existing) {
    await db.run(
      "UPDATE company_goals SET revenue_cents = ?, new_customers = ?, leads = ?, qualified_leads = ?, appointments = ?, attendances = ?, max_cac_cents = ?, max_cpl_cents = ?, min_roas = ?, planned_monthly_spend_cents = ?, updated_at = ? WHERE company_id = ?",
      ...values,
      companyId
    );
  } else {
    await db.run(
      "INSERT INTO company_goals (revenue_cents, new_customers, leads, qualified_leads, appointments, attendances, max_cac_cents, max_cpl_cents, min_roas, planned_monthly_spend_cents, updated_at, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ...values,
      companyId
    );
  }
}

export interface GoalProgress {
  label: string;
  goal: number | null;
  actual: number;
  attainment: number | null; // 0..1
  remaining: number | null;
  neededPerDay: number | null;
  projected: number | null;
  projectedGap: number | null;
  isCurrency: boolean;
}

export interface MonthProjection {
  monthStart: string;
  today: string;
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  items: GoalProgress[];
  /** Frase-fato sobre faturamento, se houver meta. */
  headline: string | null;
}

/** Projeção linear transparente: ritmo diário (realizado / dias transcorridos) x dias do mês. */
export function projectMonth(monthSnapshot: PeriodSnapshot, goals: CompanyGoals | null, timeZone: string, now: Date = new Date()): MonthProjection {
  const b = monthBoundsIso(timeZone, now);
  const daysRemaining = b.daysInMonth - b.daysElapsed;
  const item = (label: string, goal: number | null, actual: number, isCurrency: boolean): GoalProgress => {
    const projected = b.daysElapsed > 0 ? (actual / b.daysElapsed) * b.daysInMonth : null;
    const remaining = goal !== null ? Math.max(0, goal - actual) : null;
    return {
      label,
      goal,
      actual,
      attainment: goal ? actual / goal : null,
      remaining,
      neededPerDay: remaining !== null && daysRemaining > 0 ? remaining / daysRemaining : null,
      projected,
      projectedGap: projected !== null && goal !== null ? projected - goal : null,
      isCurrency,
    };
  };
  const c = monthSnapshot.crm;
  const items = [
    item("Faturamento", goals?.revenue_cents ?? null, c.revenueCents, true),
    item("Clientes novos", goals?.new_customers ?? null, c.newCustomers, false),
    item("Leads", goals?.leads ?? null, c.leads, false),
    item("Leads qualificados", goals?.qualified_leads ?? null, c.qualified, false),
    item("Agendamentos", goals?.appointments ?? null, c.appointments, false),
    item("Comparecimentos", goals?.attendances ?? null, c.attendances, false),
    item("Investimento", goals?.planned_monthly_spend_cents ?? null, monthSnapshot.platform.hasSpendData ? monthSnapshot.platform.spendCents : 0, true),
  ];
  const rev = items[0];
  let headline: string | null = null;
  if (rev.goal !== null && rev.projected !== null && b.daysElapsed >= 3) {
    const gap = rev.projected - rev.goal;
    headline =
      gap >= 0
        ? `Se o ritmo atual continuar, a empresa terminará o mês aproximadamente ${fmtBRL(Math.round(gap))} acima da meta de faturamento.`
        : `Se o ritmo atual continuar, a empresa terminará o mês aproximadamente ${fmtBRL(Math.round(-gap))} abaixo da meta de faturamento.`;
  }
  return { monthStart: b.monthStart, today: b.today, daysElapsed: b.daysElapsed, daysRemaining, daysInMonth: b.daysInMonth, items, headline };
}

// --- Funil executivo e gargalos -----------------------------------------------

export interface FunnelStage {
  key: string;
  label: string;
  value: number | null;
  costPerUnitCents: number | null;
}

export function executiveFunnel(s: PeriodSnapshot): FunnelStage[] {
  const spend = s.platform.hasSpendData ? s.platform.spendCents : null;
  const cost = (n: number | null) => (spend !== null && n ? Math.round(spend / n) : null);
  return [
    { key: "impressoes", label: "Impressões", value: s.platform.impressions, costPerUnitCents: null },
    { key: "cliques", label: "Cliques", value: s.platform.clicks, costPerUnitCents: cost(s.platform.clicks) },
    { key: "conversas", label: "Conversas", value: s.crm.conversations, costPerUnitCents: cost(s.crm.conversations) },
    { key: "leads", label: "Leads", value: s.crm.leads, costPerUnitCents: cost(s.crm.leads) },
    { key: "qualificados", label: "Qualificados", value: s.crm.qualified, costPerUnitCents: cost(s.crm.qualified) },
    { key: "agendamentos", label: "Agendamentos", value: s.crm.appointments, costPerUnitCents: cost(s.crm.appointments) },
    { key: "comparecimentos", label: "Comparecimentos", value: s.crm.attendances, costPerUnitCents: cost(s.crm.attendances) },
    { key: "vendas", label: "Vendas", value: s.crm.sales, costPerUnitCents: cost(s.crm.newCustomers) },
  ];
}

export interface Bottleneck {
  fromLabel: string;
  toLabel: string;
  conversion: number; // 0..1
  fact: string;
  hypothesis: string;
}

/** Detector por regras: passagens do funil com conversão baixa e amostra mínima. Sempre "possível gargalo". */
export function detectBottlenecks(s: PeriodSnapshot): Bottleneck[] {
  const out: Bottleneck[] = [];
  const check = (from: number | null, to: number | null, fromLabel: string, toLabel: string, threshold: number, hypothesis: string) => {
    if (from === null || to === null || from < 10) return;
    const conv = to / from;
    if (conv < threshold) {
      out.push({ fromLabel, toLabel, conversion: conv, fact: `De ${from.toLocaleString("pt-BR")} ${fromLabel.toLowerCase()}, só ${to.toLocaleString("pt-BR")} viraram ${toLabel.toLowerCase()} (${fmtPct(conv)}).`, hypothesis });
    }
  };
  check(s.platform.clicks, s.crm.conversations, "Cliques", "Conversas", 0.2, "Possível gargalo: página, oferta ou chamada para ação do anúncio.");
  check(s.crm.conversations, s.crm.qualified, "Conversas", "Qualificados", 0.25, "Possível gargalo: segmentação do público ou promessa do anúncio.");
  check(s.crm.qualified, s.crm.appointments, "Qualificados", "Agendamentos", 0.4, "Possível gargalo: abordagem comercial no atendimento.");
  check(s.crm.appointments, s.crm.attendances, "Agendamentos", "Comparecimentos", 0.6, "Possível gargalo: confirmação e follow-up antes do horário.");
  check(s.crm.attendances, s.crm.sales, "Comparecimentos", "Vendas", 0.3, "Possível gargalo: fechamento comercial.");
  return out;
}

// --- Precisa de atenção ---------------------------------------------------------

export type Severity = "CRITICO" | "ATENCAO" | "OPORTUNIDADE" | "INFORMACAO";

/** Onde o fato acontece: por provedor, mídia paga em geral, CRM/atendimento ou integração. */
export type AttentionChannel = "META" | "GOOGLE" | "MIDIA" | "CRM" | "INTEGRACAO";
export const ATTENTION_CHANNEL_LABELS: Record<AttentionChannel, string> = { META: "Meta Ads", GOOGLE: "Google Ads", MIDIA: "Mídia paga (geral)", CRM: "CRM e atendimento", INTEGRACAO: "Integração" };

export interface AttentionItem {
  severity: Severity;
  category: string;
  channel?: AttentionChannel;
  fact: string;
  recommendation?: string;
  metric?: string;
  currentValue?: string;
  referenceValue?: string;
  /** Chave estável para não repetir alerta no mesmo dia. */
  dedupeKey: string;
}

export interface AttentionThresholds {
  spendWithoutLeadCents: number; // ex.: 15000 = R$ 150
  cplIncreasePct: number; // ex.: 30
  cacIncreasePct: number; // ex.: 30
  hoursWithoutSync: number; // ex.: 6
  cacAboveAvgPct: number; // ex.: 50
  attendanceDropPct: number; // pontos percentuais, ex.: 15
}

export const DEFAULT_THRESHOLDS: AttentionThresholds = { spendWithoutLeadCents: 15000, cplIncreasePct: 30, cacIncreasePct: 30, hoursWithoutSync: 6, cacAboveAvgPct: 50, attendanceDropPct: 15 };

export async function buildAttention(companyId: number, bi: CompanyBi, thresholds: AttentionThresholds = DEFAULT_THRESHOLDS, now: Date = new Date()): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const cur = bi.current;
  const prev = bi.previous;
  const day = now.toISOString().slice(0, 10);

  // Integrações
  const accounts = await listAccountsForCompany(companyId);
  for (const a of accounts) {
    if (a.connection_status === "RECONEXAO_NECESSARIA" || a.connection_status === "EXPIRADA" || a.connection_status === "REVOGADA") {
      items.push({ severity: "CRITICO", category: "Integração", channel: "INTEGRACAO", fact: `${a.provider === "META" ? "Meta Ads" : "Google Ads"} (${a.name ?? a.external_account_id}) precisa ser reconectado.`, recommendation: "Peça à Hub Action para reconectar a conta.", dedupeKey: `reconexao:${a.id}:${day}` });
      continue;
    }
    if (a.sync_enabled && a.last_success_at) {
      const hours = (now.getTime() - new Date(a.last_success_at).getTime()) / 3600000;
      if (hours >= thresholds.hoursWithoutSync) {
        items.push({ severity: hours >= 24 ? "CRITICO" : "ATENCAO", category: "Integração", channel: "INTEGRACAO", fact: `${a.provider === "META" ? "Meta Ads" : "Google Ads"} (${a.name ?? a.external_account_id}) não sincroniza há ${Math.floor(hours)} horas.`, recommendation: "Use \"Atualizar agora\" ou verifique a conexão.", metric: "horas_sem_sync", currentValue: `${Math.floor(hours)}h`, referenceValue: `${thresholds.hoursWithoutSync}h`, dedupeKey: `sync:${a.id}:${day}` });
      }
    } else if (a.sync_enabled && !a.last_success_at) {
      items.push({ severity: "INFORMACAO", category: "Integração", channel: "INTEGRACAO", fact: `${a.provider === "META" ? "Meta Ads" : "Google Ads"} (${a.name ?? a.external_account_id}) ainda não teve nenhuma sincronização concluída.`, dedupeKey: `nosync:${a.id}:${day}` });
    }
  }

  for (const p of ["META", "GOOGLE"] as const) {
    if (!accounts.some((a) => a.provider === p)) {
      items.push({ severity: "INFORMACAO", category: "Integração", channel: "INTEGRACAO", fact: `${PROVIDER_LABELS[p]} não conectado para esta empresa.`, recommendation: "Sem conta vinculada, investimento, CPL, CAC e ROAS deste canal ficam indisponíveis (nunca são estimados).", dedupeKey: `naoconectado:${p}:${day}` });
    }
  }

  // Campanhas gastando sem lead atribuído (no período)
  for (const row of bi.campaigns) {
    if (row.platform.spendCents >= thresholds.spendWithoutLeadCents && row.crm.leads === 0) {
      items.push({ severity: "CRITICO", category: "Campanha", channel: row.campaign.provider, fact: `Campanha "${row.campaign.name}" investiu ${fmtBRL(row.platform.spendCents)} no período sem gerar lead atribuído.`, recommendation: "Confira se a atribuição está chegando (UTM/anúncio de WhatsApp) e revise a campanha.", metric: "investimento_sem_lead", currentValue: fmtBRL(row.platform.spendCents), referenceValue: fmtBRL(thresholds.spendWithoutLeadCents), dedupeKey: `semlead:${row.campaign.id}:${day}` });
    }
  }

  // CPL / CAC vs período anterior
  const cplDelta = deltaPercent(cur.kpis.cpl, prev.kpis.cpl);
  if (cplDelta !== null && cplDelta >= thresholds.cplIncreasePct) {
    items.push({ severity: "ATENCAO", category: "Custo", channel: "MIDIA", fact: `CPL aumentou ${fmtDelta(cplDelta)} em relação ao período anterior (${fmtBRL(prev.kpis.cpl)} → ${fmtBRL(cur.kpis.cpl)}).`, recommendation: "Analise as campanhas que mais aumentaram de custo.", metric: "cpl", currentValue: fmtBRL(cur.kpis.cpl), referenceValue: fmtBRL(prev.kpis.cpl), dedupeKey: `cpl_up:${day}` });
  }
  const cacDelta = deltaPercent(cur.kpis.cac, prev.kpis.cac);
  if (cacDelta !== null && cacDelta >= thresholds.cacIncreasePct) {
    items.push({ severity: "ATENCAO", category: "Custo", channel: "MIDIA", fact: `CAC aumentou ${fmtDelta(cacDelta)} em relação ao período anterior (${fmtBRL(prev.kpis.cac)} → ${fmtBRL(cur.kpis.cac)}).`, metric: "cac", currentValue: fmtBRL(cur.kpis.cac), referenceValue: fmtBRL(prev.kpis.cac), dedupeKey: `cac_up:${day}` });
  }
  if (cplDelta !== null && cacDelta !== null && cplDelta < 0 && cacDelta > 0) {
    items.push({ severity: "ATENCAO", category: "Qualidade", channel: "MIDIA", fact: `CPL caiu ${fmtDelta(cplDelta)} mas o CAC subiu ${fmtDelta(cacDelta)}: os leads ficaram mais baratos e converteram menos.`, recommendation: "Compare qualificação por campanha antes de aumentar investimento nas mais baratas.", dedupeKey: `cpl_down_cac_up:${day}` });
  }

  // CAC por campanha vs média da empresa
  const cacAvg = cur.kpis.cac;
  if (cacAvg !== null) {
    for (const row of bi.campaigns) {
      if (row.kpis.cac === null || row.crm.newCustomers < 2) continue;
      const diff = ((row.kpis.cac - cacAvg) / cacAvg) * 100;
      if (diff >= thresholds.cacAboveAvgPct) {
        items.push({ severity: "ATENCAO", category: "Campanha", channel: row.campaign.provider, fact: `CAC da campanha "${row.campaign.name}" está ${fmtDelta(diff)} acima da média da empresa (${fmtBRL(row.kpis.cac)} vs ${fmtBRL(cacAvg)}).`, metric: "cac_campanha", currentValue: fmtBRL(row.kpis.cac), referenceValue: fmtBRL(cacAvg), dedupeKey: `cac_alto:${row.campaign.id}:${day}` });
      } else if (diff <= -thresholds.cacAboveAvgPct * 0.8) {
        items.push({ severity: "OPORTUNIDADE", category: "Campanha", channel: row.campaign.provider, fact: `Campanha "${row.campaign.name}" tem CAC ${fmtDelta(Math.abs(diff))} menor que a média da empresa (${fmtBRL(row.kpis.cac)} vs ${fmtBRL(cacAvg)}).`, recommendation: "Candidata a receber mais investimento — confira se a qualidade se mantém com escala.", dedupeKey: `cac_baixo:${row.campaign.id}:${day}` });
      }
    }
  }

  // CTR e frequência
  const ctrDelta = deltaPercent(cur.platform.ctr, prev.platform.ctr);
  if (ctrDelta !== null && ctrDelta <= -25) {
    const freq = cur.platform.frequency;
    const prevFreq = prev.platform.frequency;
    const freqText = freq !== null && prevFreq !== null ? ` A frequência foi de ${fmtNum(prevFreq)} para ${fmtNum(freq)} no mesmo período.` : "";
    items.push({ severity: "ATENCAO", category: "Anúncios", channel: "MIDIA", fact: `CTR caiu ${fmtDelta(ctrDelta)} em comparação ao período anterior.${freqText}`, recommendation: freq !== null && prevFreq !== null && freq > prevFreq * 1.5 ? "Vale revisar o criativo — a mesma audiência está vendo o anúncio mais vezes." : undefined, dedupeKey: `ctr_down:${day}` });
  }

  // Taxa de comparecimento
  if (cur.kpis.attendanceRate !== null && prev.kpis.attendanceRate !== null && cur.crm.appointments >= 5) {
    const drop = (prev.kpis.attendanceRate - cur.kpis.attendanceRate) * 100;
    if (drop >= thresholds.attendanceDropPct) {
      items.push({ severity: "ATENCAO", category: "Atendimento", channel: "CRM", fact: `Taxa de comparecimento caiu de ${fmtPct(prev.kpis.attendanceRate)} para ${fmtPct(cur.kpis.attendanceRate)}.`, recommendation: "Revise confirmação e lembretes antes dos horários.", dedupeKey: `comparecimento_down:${day}` });
    }
  }

  // Oportunidade: melhor qualificação
  const best = bi.campaigns.filter((r) => r.crm.leads >= 10 && r.kpis.qualificationRate !== null).sort((a, b) => (b.kpis.qualificationRate ?? 0) - (a.kpis.qualificationRate ?? 0))[0];
  if (best && (best.kpis.qualificationRate ?? 0) > 0) {
    items.push({ severity: "OPORTUNIDADE", category: "Campanha", channel: best.campaign.provider, fact: `"${best.campaign.name}" tem a maior taxa de qualificação do período (${fmtPct(best.kpis.qualificationRate)}).`, dedupeKey: `melhor_qualif:${best.campaign.id}:${day}` });
  }

  // Aguardando humano
  if (bi.sla.longestOpenWaitMs !== null && bi.sla.longestOpenWaitMs > 60 * 60 * 1000) {
    items.push({ severity: "CRITICO", category: "Atendimento", channel: "CRM", fact: `Há cliente aguardando atendente humano há ${Math.floor(bi.sla.longestOpenWaitMs / 3600000)}h sem resposta.`, recommendation: "Abra a Caixa de Entrada e responda.", dedupeKey: `espera_longa:${day}` });
  }

  const order: Record<Severity, number> = { CRITICO: 0, ATENCAO: 1, OPORTUNIDADE: 2, INFORMACAO: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

// --- Custo x qualidade por canal (Meta x Google) ---------------------------------

export interface ChannelCostQualityRow {
  provider: MarketingProvider;
  label: string;
  connected: boolean;
  spendCents: number | null;
  leads: number;
  customers: number;
  cpl: number | null;
  cac: number | null;
  qualificationRate: number | null;
  closeRate: number | null;
}

export interface ChannelCostQuality {
  rows: ChannelCostQualityRow[];
  cheapestLead: MarketingProvider | null;
  cheapestCustomer: MarketingProvider | null;
  bestQuality: MarketingProvider | null;
  /** Frases por regra, só com números presentes — separam fato de leitura. */
  facts: string[];
}

/**
 * Responde "qual canal traz lead/cliente mais barato e leads de mais qualidade?"
 * comparando só provedores com investimento no período. Se um canal tem CPL
 * maior mas CAC menor, diz isso explicitamente — CPL sozinho não classifica.
 */
export function channelCostQuality(providers: CompanyBi["providers"]): ChannelCostQuality {
  const rows: ChannelCostQualityRow[] = providers.map((p) => ({
    provider: p.provider,
    label: PROVIDER_LABELS[p.provider],
    connected: p.connected,
    spendCents: p.platform.hasSpendData ? p.platform.spendCents : null,
    leads: p.crm.leads,
    customers: p.crm.newCustomers,
    cpl: p.kpis.cpl,
    cac: p.kpis.cac,
    qualificationRate: p.kpis.qualificationRate,
    closeRate: p.kpis.closeRate,
  }));
  const withSpend = rows.filter((r) => r.spendCents !== null && r.spendCents > 0);
  const pick = (key: "cpl" | "cac" | "closeRate", dir: "asc" | "desc", minLeads: number): MarketingProvider | null => {
    const c = withSpend.filter((r) => r[key] !== null && r.leads >= minLeads);
    if (c.length < 2) return null;
    c.sort((a, b) => (dir === "asc" ? (a[key] as number) - (b[key] as number) : (b[key] as number) - (a[key] as number)));
    return c[0].provider;
  };
  const cheapestLead = pick("cpl", "asc", 1);
  const cheapestCustomer = pick("cac", "asc", 1);
  const bestQuality = pick("closeRate", "desc", 5);
  const by = (p: MarketingProvider) => rows.find((r) => r.provider === p)!;
  const facts: string[] = [];
  if (withSpend.length === 1) {
    facts.push(`Só ${withSpend[0].label} tem investimento no período — a comparação de custo entre canais depende de o outro provedor estar conectado e investindo.`);
  }
  if (cheapestLead) facts.push(`Lead mais barato: ${by(cheapestLead).label} (CPL ${fmtBRL(by(cheapestLead).cpl)}).`);
  if (cheapestCustomer) facts.push(`Cliente mais barato: ${by(cheapestCustomer).label} (CAC ${fmtBRL(by(cheapestCustomer).cac)}).`);
  if (bestQuality) facts.push(`Maior taxa de fechamento: ${by(bestQuality).label} (${fmtPct(by(bestQuality).closeRate)}).`);
  if (cheapestLead && cheapestCustomer && cheapestLead !== cheapestCustomer) {
    const a = by(cheapestCustomer);
    const b = by(cheapestLead);
    facts.push(`${a.label} tem CPL maior que ${b.label} (${fmtBRL(a.cpl)} vs ${fmtBRL(b.cpl)}), mas CAC menor (${fmtBRL(a.cac)} vs ${fmtBRL(b.cac)}): traz o cliente mais barato. Não classifique canais só pelo CPL.`);
  }
  return { rows, cheapestLead, cheapestCustomer, bestQuality, facts };
}

// --- Custo x qualidade ---------------------------------------------------------

export interface CostQualityInsight {
  cheapest: CampaignRow | null;
  bestCac: CampaignRow | null;
  text: string | null;
}

/** Destaca quando a campanha de menor CPL não é a de menor CAC — nunca classificar só pelo CPL. */
export function costVsQuality(rows: CampaignRow[]): CostQualityInsight {
  const withCpl = rows.filter((r) => r.kpis.cpl !== null && r.crm.leads >= 5);
  const withCac = rows.filter((r) => r.kpis.cac !== null && r.crm.newCustomers >= 2);
  const cheapest = withCpl.sort((a, b) => (a.kpis.cpl ?? 0) - (b.kpis.cpl ?? 0))[0] ?? null;
  const bestCac = withCac.sort((a, b) => (a.kpis.cac ?? 0) - (b.kpis.cac ?? 0))[0] ?? null;
  let text: string | null = null;
  if (cheapest && bestCac && cheapest.campaign.id !== bestCac.campaign.id) {
    text = `"${cheapest.campaign.name}" tem o menor CPL (${fmtBRL(cheapest.kpis.cpl)}), mas "${bestCac.campaign.name}" tem o menor CAC (${fmtBRL(bestCac.kpis.cac)}) — CPL maior (${fmtBRL(bestCac.kpis.cpl)}) com clientes mais baratos no final. Não classifique campanhas só pelo CPL.`;
  } else if (cheapest && bestCac) {
    text = `"${bestCac.campaign.name}" tem ao mesmo tempo o menor CPL e o menor CAC do período.`;
  }
  return { cheapest, bestCac, text };
}

// --- Score de lead ---------------------------------------------------------------

export const LEAD_SCORE_RULES = {
  created: 5,
  replied: 10,
  interest: 10, // tem oportunidade
  qualified: 25,
  scheduled: 25,
  attended: 40,
  bought: 100,
  noReply48h: -10,
  lost: -30,
} as const;

export type LeadTemperature = "FRIO" | "MORNO" | "QUENTE" | "ALTA_INTENCAO";

export function temperatureFor(score: number): LeadTemperature {
  if (score >= 80) return "ALTA_INTENCAO";
  if (score >= 50) return "QUENTE";
  if (score >= 20) return "MORNO";
  return "FRIO";
}

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { FRIO: "Frio", MORNO: "Morno", QUENTE: "Quente", ALTA_INTENCAO: "Alta intenção" };

export interface ScoredLead {
  contactId: number;
  name: string;
  phoneMasked: string;
  source: LeadSource;
  confidence: AttributionConfidence;
  campaignName: string | null;
  score: number;
  temperature: LeadTemperature;
  stageName: string | null;
  attendantName: string | null;
  lastInteractionAt: string | null;
  waitingHumanSinceMs: number | null;
  conversationId: number | null;
  recommendedAction: string;
  opportunityValueCents: number;
  isWon: boolean;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${phone.slice(0, Math.max(0, phone.length - 8)).replace(/\d/g, "•")}${phone.slice(-8).replace(/\d(?=\d{4})/g, "•")}`;
}

/** Score determinístico a partir do que aconteceu com o contato (isolado por empresa). */
export async function scoreLeads(companyId: number, now: Date = new Date()): Promise<ScoredLead[]> {
  const contacts = await db.all<{
    id: number;
    name: string;
    phone: string;
    source: LeadSource;
    attribution_confidence: AttributionConfidence;
    utm_campaign: string | null;
    external_campaign_id: string | null;
  }>("SELECT id, name, phone, source, attribution_confidence, utm_campaign, external_campaign_id FROM contacts WHERE company_id = ?", companyId);
  if (contacts.length === 0) return [];
  const campaigns = await db.all<{ external_id: string; name: string }>("SELECT external_id, name FROM marketing_campaigns WHERE company_id = ?", companyId);
  const campaignName = new Map(campaigns.map((c) => [c.external_id, c.name]));
  const opps = await db.all<{ contact_id: number; qualified_at: string | null; scheduled_at: string | null; attended_at: string | null; is_won: number; is_lost: number; value_cents: number; responsible_user_id: number | null; stage_name: string; responsible_name: string | null }>(
    `SELECT o.contact_id, o.qualified_at, o.scheduled_at, o.attended_at, ps.is_won, ps.is_lost, o.value_cents, o.responsible_user_id, ps.name AS stage_name, u.name AS responsible_name
     FROM opportunities o JOIN pipeline_stages ps ON ps.id = o.stage_id LEFT JOIN users u ON u.id = o.responsible_user_id WHERE o.company_id = ?`,
    companyId
  );
  const convs = await db.all<{ id: number; contact_id: number; assigned_user_id: number | null; assigned_name: string | null; updated_at: string; last_author: string | null; last_at: string | null; open_wait_started_at: string | null }>(
    `SELECT co.id, co.contact_id, co.assigned_user_id, u.name AS assigned_name, co.updated_at,
            (SELECT author_type FROM messages m WHERE m.conversation_id = co.id ORDER BY m.id DESC LIMIT 1) AS last_author,
            (SELECT created_at FROM messages m WHERE m.conversation_id = co.id ORDER BY m.id DESC LIMIT 1) AS last_at,
            (SELECT started_at FROM wait_episodes we WHERE we.conversation_id = co.id AND we.ended_at IS NULL ORDER BY we.id DESC LIMIT 1) AS open_wait_started_at
     FROM conversations co LEFT JOIN users u ON u.id = co.assigned_user_id WHERE co.company_id = ?`,
    companyId
  );
  const repliedContacts = new Set(
    (
      await db.all<{ contact_id: number }>(
        `SELECT DISTINCT co.contact_id FROM messages m JOIN conversations co ON co.id = m.conversation_id
         WHERE co.company_id = ? AND m.author_type = 'CLIENTE' AND EXISTS (
           SELECT 1 FROM messages m2 WHERE m2.conversation_id = co.id AND m2.author_type IN ('HUMANO','ROBO','AUTOMACAO') AND m2.id < m.id)`,
        companyId
      )
    ).map((r) => r.contact_id)
  );
  const oppsByContact = new Map<number, typeof opps>();
  for (const o of opps) {
    if (!oppsByContact.has(o.contact_id)) oppsByContact.set(o.contact_id, []);
    oppsByContact.get(o.contact_id)!.push(o);
  }
  const convByContact = new Map<number, (typeof convs)[number]>();
  for (const c of convs) {
    const cur = convByContact.get(c.contact_id);
    if (!cur || c.updated_at > cur.updated_at) convByContact.set(c.contact_id, c);
  }
  const nowMs = now.getTime();
  return contacts.map((c) => {
    const os = oppsByContact.get(c.id) ?? [];
    const conv = convByContact.get(c.id);
    let score = LEAD_SCORE_RULES.created;
    if (repliedContacts.has(c.id)) score += LEAD_SCORE_RULES.replied;
    if (os.length > 0) score += LEAD_SCORE_RULES.interest;
    if (os.some((o) => o.qualified_at)) score += LEAD_SCORE_RULES.qualified;
    if (os.some((o) => o.scheduled_at)) score += LEAD_SCORE_RULES.scheduled;
    if (os.some((o) => o.attended_at)) score += LEAD_SCORE_RULES.attended;
    const isWon = os.some((o) => o.is_won === 1);
    if (isWon) score += LEAD_SCORE_RULES.bought;
    if (os.length > 0 && os.every((o) => o.is_lost === 1)) score += LEAD_SCORE_RULES.lost;
    const noReply = conv && conv.last_author === "HUMANO" && conv.last_at && nowMs - new Date(conv.last_at).getTime() > 48 * 3600000;
    if (noReply) score += LEAD_SCORE_RULES.noReply48h;
    const active = os.filter((o) => o.is_won === 0 && o.is_lost === 0);
    const primary = active[0] ?? os[0] ?? null;
    const waitingMs = conv?.open_wait_started_at ? nowMs - new Date(conv.open_wait_started_at).getTime() : null;
    let action = "Acompanhar";
    if (waitingMs !== null) action = "Responder agora — cliente aguardando atendente";
    else if (primary?.scheduled_at && !primary.attended_at && new Date(primary.scheduled_at).getTime() < nowMs) action = "Confirmar se compareceu ao agendamento";
    else if (primary?.scheduled_at && !primary.attended_at) action = "Confirmar o agendamento";
    else if (primary?.qualified_at && !primary.scheduled_at) action = "Propor um horário";
    else if (noReply) action = "Retomar contato — sem resposta há mais de 48h";
    else if (isWon) action = "Cliente — pós-venda/indicação";
    return {
      contactId: c.id,
      name: c.name,
      phoneMasked: maskPhone(c.phone),
      source: c.source,
      confidence: c.attribution_confidence,
      campaignName: (c.external_campaign_id && campaignName.get(c.external_campaign_id)) || c.utm_campaign || null,
      score,
      temperature: temperatureFor(score),
      stageName: primary?.stage_name ?? null,
      attendantName: primary?.responsible_name ?? conv?.assigned_name ?? null,
      lastInteractionAt: conv?.last_at ?? null,
      waitingHumanSinceMs: waitingMs,
      conversationId: conv?.id ?? null,
      recommendedAction: action,
      opportunityValueCents: active.reduce((s, o) => s + o.value_cents, 0),
      isWon,
    };
  });
}

export function hotLeads(scored: ScoredLead[], limit = 10): ScoredLead[] {
  return scored.filter((l) => !l.isWon && l.score >= 50).sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface StalledOpportunity {
  lead: ScoredLead;
  reason: string;
  stalledForMs: number;
}

/** Oportunidades paradas: regras objetivas com horas configuráveis. */
export function stalledOpportunities(scored: ScoredLead[], hours = { qualifiedNoInteraction: 24, waitingHuman: 1, scheduledPast: 2 }, now: Date = new Date()): StalledOpportunity[] {
  const nowMs = now.getTime();
  const out: StalledOpportunity[] = [];
  for (const l of scored) {
    if (l.isWon) continue;
    if (l.waitingHumanSinceMs !== null && l.waitingHumanSinceMs > hours.waitingHuman * 3600000) {
      out.push({ lead: l, reason: "Pediu atendimento humano e continua sem resposta", stalledForMs: l.waitingHumanSinceMs });
      continue;
    }
    const sinceInteraction = l.lastInteractionAt ? nowMs - new Date(l.lastInteractionAt).getTime() : null;
    if (l.stageName && /qualific/i.test(l.stageName) && sinceInteraction !== null && sinceInteraction > hours.qualifiedNoInteraction * 3600000) {
      out.push({ lead: l, reason: `Lead qualificado sem interação há mais de ${hours.qualifiedNoInteraction}h`, stalledForMs: sinceInteraction });
    }
  }
  return out.sort((a, b) => b.lead.opportunityValueCents - a.lead.opportunityValueCents || b.stalledForMs - a.stalledForMs);
}

// --- Semáforo e saúde ------------------------------------------------------------

export type Semaphore = "VERDE" | "AMARELO" | "VERMELHO" | "CINZA";

/** Limites do semáforo da saúde (0–100): abaixo de AMARELO é vermelho; a partir de VERDE é verde. Usados no cálculo e nas faixas do gauge. */
export const HEALTH_THRESHOLDS = { AMARELO: 40, VERDE: 70 } as const;

export interface HealthScore {
  score: number | null;
  semaphore: Semaphore;
  components: { label: string; score: number | null; weight: number; explanation: string }[];
  reasons: string[];
}

/**
 * Fórmula transparente (0–100), média ponderada dos componentes com dado
 * suficiente. Sem dado suficiente em nenhum componente → CINZA, sem número.
 * - Eficiência de aquisição (30%): CAC vs meta de CAC máximo (ou vs período anterior se não há meta).
 * - Qualidade dos leads (20%): taxa de qualificação (0% → 0, 50%+ → 100).
 * - Conversão CRM (25%): taxa de fechamento (0 → 0, 40%+ → 100).
 * - Saúde técnica (15%): contas sincronizando sem erro nas últimas 24h.
 * - Tendência (10%): receita vs período anterior (−50% → 0, +50% → 100).
 */
export async function healthScore(companyId: number, bi: CompanyBi, goals: CompanyGoals | null, now: Date = new Date()): Promise<HealthScore> {
  const cur = bi.current;
  const prev = bi.previous;
  const reasons: string[] = [];
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const components: HealthScore["components"] = [];

  let acquisition: number | null = null;
  if (cur.kpis.cac !== null) {
    if (goals?.max_cac_cents) {
      acquisition = clamp(100 - ((cur.kpis.cac - goals.max_cac_cents) / goals.max_cac_cents) * 100);
      if (cur.kpis.cac > goals.max_cac_cents) reasons.push(`CAC ${fmtBRL(cur.kpis.cac)} acima do máximo desejado ${fmtBRL(goals.max_cac_cents)}.`);
    } else if (prev.kpis.cac !== null) {
      acquisition = clamp(50 - (deltaPercent(cur.kpis.cac, prev.kpis.cac) ?? 0));
    }
  }
  components.push({ label: "Eficiência de aquisição", score: acquisition, weight: 0.3, explanation: goals?.max_cac_cents ? "CAC atual comparado ao CAC máximo definido na meta." : "CAC atual comparado ao período anterior (sem meta definida)." });

  const quality = cur.crm.leads >= 5 && cur.kpis.qualificationRate !== null ? clamp(cur.kpis.qualificationRate * 200) : null;
  components.push({ label: "Qualidade dos leads", score: quality, weight: 0.2, explanation: "Taxa de qualificação: 50% ou mais vale 100." });

  const conversion = cur.crm.qualified >= 5 && cur.kpis.closeRate !== null ? clamp(cur.kpis.closeRate * 250) : null;
  components.push({ label: "Conversão CRM", score: conversion, weight: 0.25, explanation: "Taxa de fechamento sobre qualificados: 40% ou mais vale 100." });

  const accounts = await listAccountsForCompany(companyId);
  let technical: number | null = null;
  if (accounts.length > 0) {
    const healthy = accounts.filter((a) => a.connection_status === "CONECTADA" && a.last_success_at && now.getTime() - new Date(a.last_success_at).getTime() < 24 * 3600000).length;
    technical = clamp((healthy / accounts.length) * 100);
    if (healthy < accounts.length) reasons.push(`${accounts.length - healthy} conta(s) de anúncio sem sincronização saudável nas últimas 24h.`);
  }
  components.push({ label: "Saúde técnica das integrações", score: technical, weight: 0.15, explanation: "Contas conectadas e sincronizadas com sucesso nas últimas 24h." });

  const trendDelta = deltaPercent(cur.crm.revenueCents, prev.crm.revenueCents);
  const trend = trendDelta !== null ? clamp(50 + trendDelta) : null;
  components.push({ label: "Tendência", score: trend, weight: 0.1, explanation: "Receita vs período anterior: −50% vale 0, +50% vale 100." });

  const valid = components.filter((c) => c.score !== null);
  if (valid.length === 0) return { score: null, semaphore: "CINZA", components, reasons: ["Dados insuficientes para calcular a saúde."] };
  const totalWeight = valid.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(valid.reduce((s, c) => s + (c.score as number) * c.weight, 0) / totalWeight);
  const broken = accounts.some((a) => a.connection_status === "RECONEXAO_NECESSARIA" || a.connection_status === "ERRO" || a.connection_status === "EXPIRADA");
  if (broken) reasons.push("Há integração com erro ou precisando de reconexão.");
  const semaphore: Semaphore = broken || score < HEALTH_THRESHOLDS.AMARELO ? "VERMELHO" : score < HEALTH_THRESHOLDS.VERDE ? "AMARELO" : "VERDE";
  return { score, semaphore, components, reasons };
}

// --- Resumo executivo automático ----------------------------------------------

export function executiveSummary(bi: CompanyBi): string {
  const cur = bi.current;
  const prev = bi.previous;
  const parts: string[] = [];
  const periodLabel = bi.period.label.toLowerCase();
  if (cur.platform.hasSpendData) {
    parts.push(`Em ${periodLabel}, a empresa investiu ${fmtBRL(cur.platform.spendCents)} em mídia paga e registrou ${cur.crm.newCustomers} cliente(s) novo(s)${cur.crm.attributedSales ? `, ${cur.crm.attributedSales} deles atribuído(s) a anúncios` : ""}.`);
    if (cur.kpis.cac !== null) {
      const d = deltaPercent(cur.kpis.cac, prev.kpis.cac);
      parts.push(`O CAC foi de ${fmtBRL(cur.kpis.cac)}${d !== null ? `, ${d < 0 ? "queda" : "alta"} de ${Math.abs(d).toFixed(0)}% em relação a ${bi.period.previousLabel}` : ""}.`);
    }
    const meta = bi.providers.find((p) => p.provider === "META");
    if (meta && cur.crm.attributedSales > 0 && meta.crm.attributedSales > 0) {
      parts.push(`Meta Ads respondeu por ${fmtPct(meta.crm.attributedSales / cur.crm.attributedSales)} dos clientes atribuídos.`);
    }
    const bestCac = bi.campaigns.filter((r) => r.kpis.cac !== null && r.crm.newCustomers >= 1).sort((a, b) => (a.kpis.cac ?? 0) - (b.kpis.cac ?? 0))[0];
    if (bestCac) parts.push(`A campanha "${bestCac.campaign.name}" apresentou o menor CAC do período (${fmtBRL(bestCac.kpis.cac)}).`);
  } else {
    parts.push(`Em ${periodLabel}, a empresa registrou ${cur.crm.leads} lead(s), ${cur.crm.qualified} qualificado(s) e ${cur.crm.sales} venda(s) (${fmtBRL(cur.crm.revenueCents)}).`);
    parts.push("Nenhuma conta de anúncios sincronizada no período — custos e ROAS não podem ser calculados.");
  }
  if (cur.crm.unattributedLeads > 0 && cur.crm.leads > 0) {
    parts.push(`${fmtPct(cur.crm.unattributedLeads / cur.crm.leads)} dos leads estão sem origem atribuída.`);
  }
  return parts.join(" ");
}

export const SEVERITY_LABELS: Record<Severity, string> = { CRITICO: "Crítico", ATENCAO: "Atenção", OPORTUNIDADE: "Oportunidade", INFORMACAO: "Informação" };
export { SOURCE_LABELS, CONFIDENCE_LABELS };
export type { MarketingProvider };
