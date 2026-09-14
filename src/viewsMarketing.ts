/**
 * Telas do Command Center para a EMPRESA (administrador da empresa, ou
 * atendente com capability): Marketing (visão geral, campanhas, detalhe,
 * Meta, Google, funil, relatórios), Inteligência (central de performance,
 * metas, projeção, gargalos, leads quentes, paradas, SLA, atendentes) e
 * Alertas. Tudo server-rendered; gráficos SVG de charts.ts; nenhum número
 * é inventado — cada valor vem de bi.ts/insights.ts, e ausência vira "—".
 */
import { CONFIDENCE_LABELS, SOURCE_LABELS, type AttributionConfidence, type LeadSource } from "./attribution";
import type { AlertRow, AlertStatus } from "./alerts";
import type { BiFilters, CampaignRow, CompanyBi, CreativeRow, DailyPoint, PeriodSnapshot, ProviderComparison, ResolvedPeriod } from "./bi";
import { deltaPercent, ratio } from "./bi";
import { barChart, bubbleChart, COLORS, donutChart, emptyChart, funnelChart, gaugeChart, heatmapChart, lineChart, progressBar, radarChart, sparkBars, sparkline, type Series } from "./charts";
import {
  fmtBRL,
  fmtDelta,
  fmtNum,
  fmtPct,
  ATTENTION_CHANNEL_LABELS,
  HEALTH_THRESHOLDS,
  SEVERITY_LABELS,
  TEMPERATURE_LABELS,
  type AttentionChannel,
  type AttentionItem,
  type ChannelCostQuality,
  type ChannelCostQualityRow,
  type Bottleneck,
  type CompanyGoals,
  type CostQualityInsight,
  type FunnelStage,
  type GoalProgress,
  type HealthScore,
  type MonthProjection,
  type ScoredLead,
  type StalledOpportunity,
} from "./insights";
import { PROVIDER_LABELS, type MarketingAccountWithConnection, type MarketingCampaign, type MarketingProvider } from "./marketingModels";
import type { Company, Role, User } from "./models";
import { appShell, emptyState, escapeHtml, formatDuration } from "./views";

// --- Helpers de apresentação -----------------------------------------------------

export function ddmm(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

export function fmtDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function freshnessLabel(lastSuccessAt: string | null, now: Date = new Date()): { text: string; cls: string } {
  if (!lastSuccessAt) return { text: "Sem sincronização ainda", cls: "none" };
  const min = Math.floor((now.getTime() - new Date(lastSuccessAt).getTime()) / 60000);
  const text = min < 1 ? "Dados atualizados agora" : min < 60 ? `Dados atualizados há ${min} min` : min < 60 * 48 ? `Dados atualizados há ${Math.floor(min / 60)} h` : `Dados atualizados há ${Math.floor(min / 1440)} dias`;
  return { text, cls: min > 6 * 60 ? "stale" : "" };
}

export function providerChip(provider: MarketingProvider | LeadSource): string {
  if (provider === "META" || provider === "META_ADS") return '<span class="chip chip-meta">Meta Ads</span>';
  if (provider === "GOOGLE" || provider === "GOOGLE_ADS") return '<span class="chip chip-google">Google Ads</span>';
  return `<span class="chip chip-muted">${escapeHtml(SOURCE_LABELS[provider as LeadSource] ?? String(provider))}</span>`;
}

export function confidenceChip(c: AttributionConfidence): string {
  const cls = c === "CONFIRMADA" ? "chip-ok" : c === "PROVAVEL" ? "chip-warn" : "chip-muted";
  return `<span class="chip ${cls}" title="Confiança da atribuição">${escapeHtml(CONFIDENCE_LABELS[c])}</span>`;
}

function tip(label: string, text: string): string {
  return `<span class="tip" data-tip="${escapeHtml(text)}" tabindex="0">${escapeHtml(label)}</span>`;
}

/**
 * Card executivo: valor, comparação com período anterior, seta e sparkline.
 * `lowerIsBetter` inverte a cor (CPL/CAC caindo é bom).
 */
export function kpiCard(opts: {
  label: string;
  tooltip: string;
  value: string;
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
  spark?: (number | null)[];
  sparkColor?: string;
  secondary?: boolean;
  previousLabel: string;
  /** Mistura investimento real com CRM em modo de demonstração — marcado na tela, nunca escondido. */
  hybrid?: boolean;
  /** Sparkline em mini-barras (referência visual) em vez de linha. */
  bars?: boolean;
  /** Card de destaque (filete gradiente no topo, valor maior). */
  hero?: boolean;
}): string {
  const d = deltaPercent(opts.current, opts.previous);
  let deltaHtml = `<div class="kpi-delta muted">${opts.previous === null || opts.previous === undefined ? "sem base de comparação" : "—"}</div>`;
  if (d !== null) {
    const up = d > 0.05;
    const down = d < -0.05;
    const good = opts.lowerIsBetter ? down : up;
    const bad = opts.lowerIsBetter ? up : down;
    const cls = `kpi-delta ${up ? "up" : down ? "down" : ""} ${good ? "good" : ""} ${bad ? "bad" : ""}`;
    const arrow = up ? "↑" : down ? "↓" : "→";
    deltaHtml = `<div class="${cls}"><span class="arrow" aria-hidden="true">${arrow}</span><span>${fmtDelta(d)}</span> <span class="vs">vs ${escapeHtml(opts.previousLabel)}</span></div>`;
  }
  return `<div class="kpi ${opts.secondary ? "kpi-secondary" : ""}${opts.hero ? " hero" : ""}">
    <div class="kpi-label">${tip(opts.label, opts.tooltip)}${opts.hybrid ? '<span class="chip chip-warn chip-xs" title="Híbrido: investimento real com CRM em modo de demonstração — não use para decisão">híbrido</span>' : ""}</div>
    <div class="kpi-value">${escapeHtml(opts.value)}</div>
    ${deltaHtml}
    ${opts.spark && !opts.secondary ? (opts.bars ? sparkBars(opts.spark, opts.sparkColor ?? COLORS.accent) : sparkline(opts.spark, opts.sparkColor ?? COLORS.accent)) : ""}
  </div>`;
}

const PRESETS: { key: string; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "14d", label: "14 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes_atual", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
];

export function queryString(period: ResolvedPeriod, f: BiFilters, override: Record<string, string | null> = {}): string {
  const p = new URLSearchParams();
  p.set("periodo", period.preset);
  if (period.preset === "personalizado") {
    p.set("de", period.current.from);
    p.set("ate", period.current.to);
  }
  if (f.channel !== "ALL") p.set("canal", f.channel);
  if (f.campaignId !== null) p.set("campanha", String(f.campaignId));
  if (f.attendantUserId !== null) p.set("atendente", String(f.attendantUserId));
  if (f.stageId !== null) p.set("etapa", String(f.stageId));
  if (f.objective !== null) p.set("objetivo", f.objective);
  if (f.accountId !== null) p.set("conta", String(f.accountId));
  for (const [k, v] of Object.entries(override)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface FilterOptions {
  campaigns: MarketingCampaign[];
  members: { user_id: number; name: string }[];
  stages: { id: number; name: string }[];
  /** Contas de anúncios vinculadas à empresa (filtro "conta conectada"). */
  accounts?: MarketingAccountWithConnection[];
  /** Objetivos distintos das campanhas sincronizadas (filtro "objetivo"). */
  objectives?: string[];
}

/** Barra de filtros globais (GET) — reflete em todos os componentes da página. */
export function filterBar(basePath: string, period: ResolvedPeriod, f: BiFilters, opts: FilterOptions, freshness: { text: string; cls: string }): string {
  const presets = PRESETS.map((p) => `<a href="${basePath}${queryString(period, f, { periodo: p.key, de: null, ate: null })}" class="${period.preset === p.key ? "active" : ""}">${p.label}</a>`).join("");
  const sourceOptions =
    `<option value="">Todos os canais</option>` +
    (Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => `<option value="${s}" ${f.channel === s ? "selected" : ""}>${escapeHtml(SOURCE_LABELS[s])}</option>`).join("");
  const campaignOptions = `<option value="">Todas as campanhas</option>` + opts.campaigns.map((c) => `<option value="${c.id}" ${f.campaignId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  const memberOptions = `<option value="">Todos os atendentes</option>` + opts.members.map((m) => `<option value="${m.user_id}" ${f.attendantUserId === m.user_id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("");
  const stageOptions = `<option value="">Todas as etapas</option>` + opts.stages.map((s) => `<option value="${s.id}" ${f.stageId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  const objectiveOptions = `<option value="">Todos os objetivos</option>` + (opts.objectives ?? []).map((o) => `<option value="${escapeHtml(o)}" ${f.objective === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
  const accountOptions = `<option value="">Todas as contas</option>` + (opts.accounts ?? []).map((a) => `<option value="${a.id}" ${f.accountId === a.id ? "selected" : ""}>${escapeHtml(`${PROVIDER_LABELS[a.provider]} · ${a.name ?? a.external_account_id}`)}</option>`).join("");
  const extraFilters = (opts.objectives && opts.objectives.length ? `<div class="field"><label>Objetivo<select name="objetivo">${objectiveOptions}</select></label></div>` : "") + (opts.accounts && opts.accounts.length ? `<div class="field"><label>Conta conectada<select name="conta">${accountOptions}</select></label></div>` : "");
  return `<form method="get" action="${basePath}" class="filter-bar">
    <div class="field" style="min-width:100%"><div class="preset-links">${presets}<a href="#" class="${period.preset === "personalizado" ? "active" : ""}" onclick="return false">Personalizado ↓</a></div></div>
    <input type="hidden" name="periodo" value="personalizado" />
    <div class="field"><label>De<input type="date" name="de" value="${period.current.from}" /></label></div>
    <div class="field"><label>Até<input type="date" name="ate" value="${period.current.to}" /></label></div>
    <div class="field"><label>Canal<select name="canal">${sourceOptions}</select></label></div>
    <div class="field"><label>Campanha<select name="campanha">${campaignOptions}</select></label></div>
    <div class="field"><label>Atendente<select name="atendente">${memberOptions}</select></label></div>
    <div class="field"><label>Etapa CRM<select name="etapa">${stageOptions}</select></label></div>
    ${extraFilters}
    <button type="submit" class="btn btn-small btn-primary">Aplicar</button>
    <span class="freshness ${freshness.cls}" style="margin-left:auto"><span class="dot"></span>${escapeHtml(freshness.text)}</span>
  </form>`;
}

const TABS: { key: string; label: string; path: string }[] = [
  { key: "visao", label: "Visão Geral", path: "" },
  { key: "campanhas", label: "Campanhas", path: "/campanhas" },
  { key: "meta", label: "Meta Ads", path: "/meta" },
  { key: "google", label: "Google Ads", path: "/google" },
  { key: "funil", label: "Funil", path: "/funil" },
  { key: "relatorios", label: "Resultados", path: "/relatorios" },
];

function tabs(companyId: number, active: string, qs: string): string {
  return `<div class="tabs">${TABS.map((t) => `<a href="/empresa/${companyId}/marketing${t.path}${qs}" class="${t.key === active ? "active" : ""}">${t.label}</a>`).join("")}</div>`;
}

/** Cabeçalho de um gráfico dentro de um card: título, subtítulo e ações à direita (só apresentação). */
function chartHead(title: string, sub: string, right = "", compact = false): string {
  return `<div class="chart-head${compact ? " compact" : ""}"><div><h3>${escapeHtml(title)}</h3>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}</div>${right}</div>`;
}

function pageHead(title: string, sub: string, right = ""): string {
  return `<div class="page-head"><div><div class="eyebrow">HUB ACTION · Command Center</div><h2>${escapeHtml(title)}</h2><div class="sub">${escapeHtml(sub)}</div></div>${right}</div>`;
}

// --- Blocos reutilizáveis -----------------------------------------------------------

export function executiveCards(bi: CompanyBi): string {
  const c = bi.current;
  const p = bi.previous;
  const prevLabel = bi.period.previousLabel;
  const spend = c.platform.hasSpendData ? c.platform.spendCents : null;
  const prevSpend = p.platform.hasSpendData ? p.platform.spendCents : null;
  const spark = (pick: (d: DailyPoint) => number | null) => bi.daily.map(pick);
  const noSpend = "Sem conta de anúncios sincronizada no período";
  return `<div class="kpi-grid">
    ${kpiCard({ label: "Investimento", tooltip: "Soma do gasto reportado pelas plataformas de anúncio (Meta/Google) no período, em moeda da conta.", value: spend === null ? "—" : fmtBRL(spend), current: spend, previous: prevSpend, lowerIsBetter: true, spark: spark((d) => d.spendCents), previousLabel: prevLabel })}
    ${kpiCard({ label: "Leads", tooltip: "Contatos novos criados no CRM no período (qualquer origem).", value: String(c.crm.leads), current: c.crm.leads, previous: p.crm.leads, spark: spark((d) => d.leads), previousLabel: prevLabel })}
    ${kpiCard({ label: "Qualificados", tooltip: "Oportunidades que entraram numa etapa marcada como 'qualificado' no período.", value: String(c.crm.qualified), current: c.crm.qualified, previous: p.crm.qualified, spark: spark((d) => d.qualified), previousLabel: prevLabel })}
    ${kpiCard({ label: "Agendamentos", tooltip: "Oportunidades com data de agendamento dentro do período.", value: String(c.crm.appointments), current: c.crm.appointments, previous: p.crm.appointments, previousLabel: prevLabel })}
    ${kpiCard({ label: "Comparecimentos", tooltip: "Oportunidades marcadas como 'compareceu' no período.", value: String(c.crm.attendances), current: c.crm.attendances, previous: p.crm.attendances, previousLabel: prevLabel })}
    ${kpiCard({ label: "Clientes novos", tooltip: "Contatos distintos com venda concluída no período.", value: String(c.crm.newCustomers), current: c.crm.newCustomers, previous: p.crm.newCustomers, spark: spark((d) => d.sales), sparkColor: COLORS.positive, previousLabel: prevLabel })}
    ${kpiCard({ label: "Receita", tooltip: "Soma do valor das oportunidades com venda concluída no período.", value: fmtBRL(c.crm.revenueCents), current: c.crm.revenueCents, previous: p.crm.revenueCents, spark: spark((d) => d.revenueCents), sparkColor: COLORS.positive, previousLabel: prevLabel })}
    ${kpiCard({ label: "ROAS", tooltip: spend === null ? noSpend : "Receita atribuída a anúncios ÷ investimento. Só conta vendas de contatos com atribuição confirmada ou provável a Meta/Google.", value: c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, current: c.kpis.roasCrm, previous: p.kpis.roasCrm, spark: spark((d) => d.roas), previousLabel: prevLabel })}
  </div>`;
}

export function secondaryKpis(bi: CompanyBi, hybrid = false): string {
  const c = bi.current.kpis;
  const p = bi.previous.kpis;
  const prevLabel = bi.period.previousLabel;
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const pct = (v: number | null) => fmtPct(v);
  const card = (label: string, tooltip: string, value: string, cur: number | null, prev: number | null, lowerIsBetter = false, mixed = false) =>
    kpiCard({ label, tooltip, value, current: cur, previous: prev, lowerIsBetter, secondary: true, previousLabel: prevLabel, hybrid: mixed && hybrid });
  return `<div class="kpi-grid">
    ${card("Custo por conversa", "investimento ÷ conversas", money(c.costPerConversation), c.costPerConversation, p.costPerConversation, true, true)}
    ${card("CPL", "investimento ÷ leads", money(c.cpl), c.cpl, p.cpl, true, true)}
    ${card("Custo por qualificado", "investimento ÷ leads qualificados", money(c.cplQualified), c.cplQualified, p.cplQualified, true, true)}
    ${card("Custo por agendamento", "investimento ÷ agendamentos", money(c.costPerAppointment), c.costPerAppointment, p.costPerAppointment, true, true)}
    ${card("Custo por comparecimento", "investimento ÷ comparecimentos", money(c.costPerAttendance), c.costPerAttendance, p.costPerAttendance, true, true)}
    ${card("CAC", "investimento ÷ clientes novos", money(c.cac), c.cac, p.cac, true, true)}
    ${card("Taxa de qualificação", "leads qualificados ÷ leads", pct(c.qualificationRate), c.qualificationRate, p.qualificationRate)}
    ${card("Taxa de agendamento", "agendamentos ÷ leads qualificados", pct(c.appointmentRate), c.appointmentRate, p.appointmentRate)}
    ${card("Taxa de comparecimento", "comparecimentos ÷ agendamentos", pct(c.attendanceRate), c.attendanceRate, p.attendanceRate)}
    ${card("Taxa de fechamento", "vendas ÷ leads qualificados", pct(c.closeRate), c.closeRate, p.closeRate)}
    ${card("Ticket médio", "receita ÷ vendas", money(c.ticketCents), c.ticketCents, p.ticketCents)}
    ${card("ROAS CRM", "receita atribuída ÷ investimento atribuído", c.roasCrm === null ? "—" : `${fmtNum(c.roasCrm)}x`, c.roasCrm, p.roasCrm, false, true)}
  </div>`;
}

export const METRIC_OPTIONS: { key: string; label: string; pick: (d: DailyPoint) => number | null; money: boolean; color: string }[] = [
  { key: "investimento", label: "Investimento", pick: (d) => d.spendCents, money: true, color: COLORS.accent },
  { key: "leads", label: "Leads", pick: (d) => d.leads, money: false, color: COLORS.warning },
  { key: "qualificados", label: "Leads qualificados", pick: (d) => d.qualified, money: false, color: COLORS.meta },
  { key: "vendas", label: "Vendas", pick: (d) => d.sales, money: false, color: COLORS.positive },
  { key: "receita", label: "Receita", pick: (d) => d.revenueCents, money: true, color: COLORS.positive },
  { key: "cac", label: "CAC", pick: (d) => d.cac, money: true, color: COLORS.danger },
  { key: "cpl", label: "CPL", pick: (d) => d.cpl, money: true, color: COLORS.google },
  { key: "roas", label: "ROAS", pick: (d) => d.roas, money: false, color: COLORS.positive },
  { key: "mensagens", label: "Conversas", pick: (d) => d.conversations, money: false, color: COLORS.neutral },
  { key: "ctr", label: "CTR", pick: (d) => (d.ctr === null ? null : d.ctr * 100), money: false, color: COLORS.neutral },
  { key: "cpc", label: "CPC", pick: (d) => d.cpc, money: true, color: COLORS.neutral },
  { key: "cpm", label: "CPM", pick: (d) => d.cpm, money: true, color: COLORS.neutral },
];

function seriesFor(daily: DailyPoint[], key: string, secondary: boolean): Series | null {
  const m = METRIC_OPTIONS.find((o) => o.key === key);
  if (!m) return null;
  return {
    name: m.label,
    color: m.color,
    secondary,
    points: daily.map((d) => ({ label: ddmm(d.date), value: m.pick(d) })),
    format: m.money ? (v) => fmtBRL(Math.round(v)) : key === "ctr" ? (v) => `${v.toFixed(2).replace(".", ",")}%` : key === "roas" ? (v) => `${v.toFixed(2).replace(".", ",")}x` : (v) => fmtNum(v),
  };
}

/** Gráfico principal com duas métricas selecionáveis (GET m1/m2). Eixo secundário só quando a segunda métrica tem escala diferente. */
export function performanceChart(bi: CompanyBi, basePath: string, qs: string, m1: string, m2: string | null): string {
  const s1 = seriesFor(bi.daily, m1, false);
  const s2 = m2 ? seriesFor(bi.daily, m2, true) : null;
  const options = (selected: string | null, allowNone: boolean) =>
    (allowNone ? `<option value="" ${!selected ? "selected" : ""}>Nenhuma</option>` : "") + METRIC_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === selected ? "selected" : ""}>${o.label}</option>`).join("");
  const hidden = qs
    .replace(/^\?/, "")
    .split("&")
    .filter((kv) => kv && !kv.startsWith("m1=") && !kv.startsWith("m2="))
    .map((kv) => {
      const [k, v] = kv.split("=");
      return `<input type="hidden" name="${escapeHtml(decodeURIComponent(k))}" value="${escapeHtml(decodeURIComponent(v ?? ""))}" />`;
    })
    .join("");
  const series = [s1, s2].filter((s): s is Series => !!s);
  // Cabeçalho próprio do gráfico principal: título, subtítulo (período/comparação) e o mesmo formulário de métricas de sempre.
  const sub = `${bi.period.label} · diário${s2 ? ` · ${escapeHtml(s1?.name ?? "")} x ${escapeHtml(s2.name)}` : ""}`;
  return `<div class="card-block">
    <div class="chart-head">
      <div><h3>Performance no período</h3><div class="sub">${sub}</div></div>
      <form method="get" action="${basePath}" class="actions">${hidden}
        <select name="m1" style="width:auto" aria-label="Métrica principal">${options(m1, false)}</select>
        <select name="m2" style="width:auto" aria-label="Métrica de comparação">${options(m2, true)}</select>
        <button type="submit" class="btn btn-small">Comparar</button>
      </form>
    </div>
    ${lineChart({ series, height: 300, ariaLabel: `Evolução diária de ${series.map((s) => s.name).join(" e ")}` })}
  </div>`;
}

export function funnelBlock(stages: FunnelStage[], companyId: number, qs: string, withLinks = true): string {
  const steps = stages.map((s) => ({
    label: s.label,
    value: s.value,
    costLabel: s.costPerUnitCents !== null ? `${fmtBRL(s.costPerUnitCents)} cada` : null,
    href: withLinks ? funnelHref(companyId, s.key, qs) : null,
  }));
  return funnelChart(steps);
}

function funnelHref(companyId: number, key: string, qs: string): string | null {
  switch (key) {
    case "conversas":
      return `/empresa/${companyId}/conversas`;
    case "leads":
    case "qualificados":
    case "agendamentos":
    case "comparecimentos":
    case "vendas":
      return `/empresa/${companyId}/crm`;
    case "cliques":
    case "impressoes":
      return `/empresa/${companyId}/marketing/campanhas${qs}`;
    default:
      return null;
  }
}

export function channelChart(bi: CompanyBi, metric: "leads" | "vendas" | "receita" | "cac" | "investimento" | "qualificados" | "roas"): string {
  const items = bi.channels.map((r) => {
    const value =
      metric === "leads" ? r.crm.leads : metric === "vendas" ? r.crm.sales : metric === "receita" ? r.crm.revenueCents : metric === "qualificados" ? r.crm.qualified : metric === "cac" ? r.kpis.cac : metric === "roas" ? r.kpis.roasCrm : r.spendCents;
    const color = r.source === "META_ADS" ? COLORS.meta : r.source === "GOOGLE_ADS" ? COLORS.google : COLORS.neutral;
    return { label: SOURCE_LABELS[r.source], value, color, tooltip: `${SOURCE_LABELS[r.source]} — leads ${r.crm.leads}, qualificados ${r.crm.qualified}, vendas ${r.crm.sales}, receita ${fmtBRL(r.crm.revenueCents)}${r.hasSpend ? `, investimento ${fmtBRL(r.spendCents)}, CAC ${fmtBRL(r.kpis.cac)}` : ""}` };
  });
  const money = metric === "receita" || metric === "cac" || metric === "investimento";
  const valueLabel = { leads: "Leads", vendas: "Clientes", receita: "Receita", cac: "CAC", investimento: "Investimento", qualificados: "Qualificados", roas: "ROAS" }[metric];
  return barChart({ items, format: money ? (v) => fmtBRL(Math.round(v)) : metric === "roas" ? (v) => `${fmtNum(v)}x` : (v) => fmtNum(v), ariaLabel: `Comparação de canais por ${metric}`, valueLabel });
}

export function providerComparisonBlock(bi: CompanyBi): string {
  const meta = bi.providers.find((p) => p.provider === "META");
  const g = bi.providers.find((p) => p.provider === "GOOGLE");
  if (!meta || !g) return '<p class="muted small">Sem dados de provedores.</p>';
  const na = '<span class="na">—</span>';
  const money = (v: number | null) => (v === null ? na : fmtBRL(v));
  const num = (v: number | null) => (v === null ? na : fmtNum(v));
  const pct = (v: number | null, d = 1) => (v === null ? na : fmtPct(v, d));
  const spend = (p: ProviderComparison) => (p.connected && p.platform.hasSpendData ? p.platform.spendCents : null);
  const plat = (p: ProviderComparison, v: number | null) => (p.connected ? v : null);
  const roas = (p: ProviderComparison) => (p.kpis.roasCrm === null ? na : `${fmtNum(p.kpis.roasCrm)}x`);
  const row = (label: string, a: string, b: string, help?: string) => `<tr><td>${label}${help ? ` <span class="tip small muted" data-tip="${escapeHtml(help)}" tabindex="0">?</span>` : ""}</td><td>${a}</td><td>${b}</td></tr>`;
  const th = (p: ProviderComparison) => `${providerChip(p.provider)}${p.connected ? "" : ' <span class="chip chip-muted chip-xs">não conectado</span>'}`;
  const warn = (p: ProviderComparison) => (p.probableShare !== null && p.probableShare > 0.3 ? `<p class="small muted">⚠ ${fmtPct(p.probableShare)} dos leads de ${PROVIDER_LABELS[p.provider]} têm atribuição apenas provável (UTM), não confirmada.</p>` : "");
  return `<div class="data-table-wrap"><table class="compare-table"><thead><tr><th>Métrica</th><th>${th(meta)}</th><th>${th(g)}</th></tr></thead><tbody>
    ${row("Investimento", money(spend(meta)), money(spend(g)), "Gasto reportado pela plataforma, só das contas vinculadas a esta empresa.")}
    ${row("Impressões", num(plat(meta, meta.platform.impressions)), num(plat(g, g.platform.impressions)))}
    ${row("Alcance", num(plat(meta, meta.platform.reach)), num(plat(g, g.platform.reach)), "Meta reporta alcance; Google Ads não fornece — fica em branco.")}
    ${row("Frequência", num(plat(meta, meta.platform.frequency)), num(plat(g, g.platform.frequency)))}
    ${row("Cliques", num(plat(meta, meta.platform.clicks)), num(plat(g, g.platform.clicks)))}
    ${row("CTR", pct(plat(meta, meta.platform.ctr), 2), pct(plat(g, g.platform.ctr), 2))}
    ${row("CPC", money(plat(meta, meta.platform.cpc)), money(plat(g, g.platform.cpc)))}
    ${row("CPM", money(plat(meta, meta.platform.cpm)), money(plat(g, g.platform.cpm)))}
    ${row("Conversas (plataforma)", num(plat(meta, meta.platform.platformConversations)), num(plat(g, g.platform.platformConversations)), "Conversas iniciadas reportadas pela Meta (ação do anúncio).")}
    ${row("Conversões (plataforma)", num(plat(meta, meta.platform.platformConversions)), num(plat(g, g.platform.platformConversions)), "Conversões reportadas pelo provedor (definição dele, não do CRM).")}
    ${row("Taxa de conversão", pct(plat(meta, meta.kpis.platformConversionRate), 2), pct(plat(g, g.kpis.platformConversionRate), 2), "Conversões da plataforma ÷ cliques.")}
    ${row("Custo por conversão", money(plat(meta, meta.kpis.costPerPlatformConversion)), money(plat(g, g.kpis.costPerPlatformConversion)))}
    ${row("Conversas no CRM", String(meta.crm.conversations), String(g.crm.conversations), "Conversas do WhatsApp/CRM de contatos atribuídos ao canal.")}
    ${row("Leads (CRM)", String(meta.crm.leads), String(g.crm.leads))}
    ${row("Qualificados", String(meta.crm.qualified), String(g.crm.qualified))}
    ${row("Clientes novos", String(meta.crm.newCustomers), String(g.crm.newCustomers))}
    ${row("CPL", money(meta.kpis.cpl), money(g.kpis.cpl), "Investimento ÷ leads do CRM.")}
    ${row("CAC", money(meta.kpis.cac), money(g.kpis.cac), "Investimento ÷ clientes novos.")}
    ${row("Receita atribuída", fmtBRL(meta.crm.attributedRevenueCents), fmtBRL(g.crm.attributedRevenueCents))}
    ${row("ROAS", roas(meta), roas(g), "Receita atribuída ÷ investimento.")}
  </tbody></table></div>${warn(meta)}${warn(g)}`;
}

export function attentionBlock(items: AttentionItem[], emptyText = "Nada precisa de atenção com os dados atuais."): string {
  if (items.length === 0) return `<p class="muted small">${escapeHtml(emptyText)}</p>`;
  // Fatos separados por canal (Meta, Google, mídia em geral, CRM/atendimento, integração); recomendação sempre em linha própria.
  const order: AttentionChannel[] = ["META", "GOOGLE", "MIDIA", "CRM", "INTEGRACAO"];
  const li = (it: AttentionItem) => `<li>
      <div><span class="sev sev-${it.severity}">${SEVERITY_LABELS[it.severity]}</span><div class="small muted" style="margin-top:0.3rem">${escapeHtml(it.category)}</div></div>
      <div><div class="fact">${escapeHtml(it.fact)}</div>${it.recommendation ? `<div class="hyp">Recomendação: ${escapeHtml(it.recommendation)}</div>` : ""}</div>
    </li>`;
  return order
    .map((ch) => ({ ch, items: items.filter((i) => (i.channel ?? "MIDIA") === ch) }))
    .filter((g) => g.items.length > 0)
    .map((g) => `<div class="eyebrow" style="margin:10px 0 6px">${ATTENTION_CHANNEL_LABELS[g.ch]}</div><ul class="attention-list">${g.items.map(li).join("")}</ul>`)
    .join("");
}

export function campaignsTable(rows: CampaignRow[], companyId: number, qs: string, timeZone: string, sort: string | null): string {
  if (rows.length === 0) return emptyChart("Nenhuma campanha com dados neste período. Conecte uma conta de anúncios ou altere o período.");
  const num = (v: number | null | undefined, money = false) => (v === null || v === undefined ? "—" : money ? fmtBRL(Math.round(v)) : fmtNum(v));
  const sortKey = sort ?? "investimento";
  const val = (r: CampaignRow): number => {
    switch (sortKey) {
      case "leads": return r.crm.leads;
      case "vendas": return r.crm.sales;
      case "clientes": return r.crm.newCustomers;
      case "receita": return r.crm.revenueCents;
      case "alcance": return r.platform.reach ?? -1;
      case "cpl": return r.kpis.cpl ?? Infinity;
      case "cac": return r.kpis.cac ?? Infinity;
      case "roas": return r.kpis.roasCrm ?? -1;
      case "nome": return 0;
      default: return r.platform.spendCents;
    }
  };
  const sorted = [...rows].sort((a, b) => (sortKey === "nome" ? a.campaign.name.localeCompare(b.campaign.name) : sortKey === "cpl" || sortKey === "cac" ? val(a) - val(b) : val(b) - val(a)));
  const th = (key: string, label: string, tooltip?: string, left = false) =>
    `<th class="${left ? "left" : ""}"><a href="?${qs.replace(/^\?/, "")}${qs ? "&" : ""}ordenar=${key}" title="${escapeHtml(tooltip ?? `Ordenar por ${label}`)}">${label}${sortKey === key ? " ↓" : ""}</a></th>`;
  const statusChip = (s: string | null) => {
    const v = (s ?? "").toUpperCase();
    const cls = v === "ACTIVE" || v === "ENABLED" ? "chip-ok" : v === "PAUSED" ? "chip-warn" : "chip-muted";
    const label = v === "ACTIVE" || v === "ENABLED" ? "Ativa" : v === "PAUSED" ? "Pausada" : v ? v.toLowerCase() : "—";
    return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
  };
  // "Conversas/Conversões": Meta reporta conversas iniciadas; Google reporta conversões. Cada linha mostra o que o SEU provedor fornece.
  const platformConv = (r: CampaignRow) => (r.campaign.provider === "META" ? num(r.platform.platformConversations) : num(r.platform.platformConversions));
  const body = sorted
    .map(
      (r) => `<tr>
      <td class="left">${providerChip(r.campaign.provider)}</td>
      <td class="left">${statusChip(r.campaign.status)}</td>
      <td class="left"><a href="/empresa/${companyId}/marketing/campanhas/${r.campaign.id}${qs}">${escapeHtml(r.campaign.name)}</a></td>
      <td class="left muted">${escapeHtml(r.accountName ?? "—")}</td>
      <td>${r.platform.hasSpendData ? fmtBRL(r.platform.spendCents) : "—"}</td>
      <td>${num(r.platform.impressions)}</td>
      <td>${num(r.platform.reach)}</td>
      <td>${num(r.platform.clicks)}</td>
      <td>${fmtPct(r.platform.ctr, 2)}</td>
      <td>${num(r.platform.cpc, true)}</td>
      <td>${num(r.platform.cpm, true)}</td>
      <td>${platformConv(r)}</td>
      <td>${r.crm.conversations}</td>
      <td>${r.crm.leads}</td>
      <td>${r.crm.qualified}</td>
      <td>${r.crm.appointments}</td>
      <td>${r.crm.attendances}</td>
      <td>${r.crm.newCustomers}</td>
      <td>${num(r.kpis.cpl, true)}</td>
      <td>${num(r.kpis.cac, true)}</td>
      <td>${fmtBRL(r.crm.revenueCents)}</td>
      <td>${r.kpis.roasCrm === null ? "—" : `${fmtNum(r.kpis.roasCrm)}x`}</td>
      <td class="muted">${fmtDateTime(r.updatedAt, timeZone)}</td>
    </tr>`
    )
    .join("");
  return `<div class="data-table-wrap"><table class="data-table" style="min-width:1500px">
    <thead><tr>
      <th class="left">Provider</th><th class="left">Status</th>${th("nome", "Campanha", undefined, true)}<th class="left">Conta</th>
      ${th("investimento", "Investimento")}<th>Impressões</th>${th("alcance", "Alcance", "Só quando o provedor fornece (Meta)")}<th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th>
      <th title="Meta: conversas iniciadas; Google: conversões — sempre o que o próprio provedor reporta">Conv. plataforma</th>
      <th title="Conversas iniciadas no CRM por contatos atribuídos à campanha">Conversas CRM</th>${th("leads", "Leads CRM")}<th>Qualif.</th><th>Agend.</th><th>Compar.</th>${th("clientes", "Clientes")}
      ${th("cpl", "CPL")}${th("cac", "CAC")}${th("receita", "Receita")}${th("roas", "ROAS")}<th>Atualizado em</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <p class="small muted" style="margin-top:0.5rem">Impressões/alcance/cliques/CTR/CPC/CPM/conversões vêm da plataforma. Conversas/leads/qualificados/agendamentos/comparecimentos/clientes/receita vêm do CRM, só de contatos atribuídos à campanha (confirmada ou provável). Os dois lados nunca são somados.</p>`;
}

export function qualityBubble(rows: CampaignRow[]): string {
  const points = rows
    .filter((r) => r.kpis.cpl !== null && r.crm.leads >= 3 && r.platform.spendCents > 0)
    .map((r) => ({
      label: r.campaign.name,
      x: (r.kpis.cpl as number) / 100,
      y: r.kpis.closeRate ?? 0,
      size: r.platform.spendCents,
      color: r.campaign.provider === "META" ? COLORS.meta : COLORS.google,
      tooltip: `${r.campaign.name} — leads ${r.crm.leads}, qualificados ${r.crm.qualified}, vendas ${r.crm.sales}, CPL ${fmtBRL(r.kpis.cpl)}, CAC ${fmtBRL(r.kpis.cac)}, receita ${fmtBRL(r.crm.revenueCents)}, investimento ${fmtBRL(r.platform.spendCents)}`,
    }));
  return bubbleChart(points, (v) => fmtBRL(Math.round(v * 100)));
}

function noIntegrationNotice(bi: CompanyBi, role: Role): string {
  if (bi.hasAnyIntegration) return "";
  return `<div class="notice-box">Meta Ads e Google Ads ainda não conectados para esta empresa. ${
    role === "COMPANY_ADMIN" ? "Entre em contato com a Hub Action para conectar sua conta." : ""
  } Os indicadores do CRM (leads, qualificados, vendas) continuam sendo calculados; custos e ROAS ficam indisponíveis até a conexão.</div>`;
}

// --- Páginas: Marketing ---------------------------------------------------------------

export interface MarketingPageBase {
  company: Company;
  user: User;
  role: Role;
  /** Administrador geral da Hub Action (vê Marketing de qualquer empresa; CTA "Configurar integração"). */
  isPlatformAdmin: boolean;
  canViewMarketing: boolean;
  /** Contas de mídia vinculadas a ESTA empresa (marketing_accounts.company_id). */
  accounts: MarketingAccountWithConnection[];
  provenance: DataProvenance;
  /** Métrica do gráfico mestre Meta x Google (GET m). */
  masterMetric: string;
  /** Métrica do gráfico por canal (GET canalMetrica). */
  channelMetric: string;
  bi: CompanyBi;
  filterOptions: FilterOptions;
  m1: string;
  m2: string | null;
  sort: string | null;
  attention: AttentionItem[];
  funnel: FunnelStage[];
}

function shellFor(base: MarketingPageBase, active: string, body: string): string {
  return appShell({ company: base.company, user: base.user, role: base.role, active, body, canViewMarketing: base.canViewMarketing });
}

export function marketingOverviewPage(base: MarketingPageBase, costQuality: ChannelCostQuality, projection: MonthProjection | null = null): string {
  const { company, bi } = base;
  const basePath = `/empresa/${company.id}/marketing`;
  const qs = queryString(bi.period, bi.filters);
  const fresh = freshnessLabel(bi.freshness.lastSuccessAt);
  const hybrid = isHybrid(base.provenance);
  const c = bi.current;
  const p = bi.previous;
  const prev = bi.period.previousLabel;
  const num = (v: number | null) => (v === null ? "—" : fmtNum(v));
  const platformRow = `<div class="kpi-grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${kpiCard({ label: "Impressões", tooltip: "Exibições reportadas pelas plataformas.", value: num(c.platform.impressions), current: c.platform.impressions, previous: p.platform.impressions, previousLabel: prev, secondary: true })}
    ${kpiCard({ label: "Alcance", tooltip: "Pessoas alcançadas (só Meta fornece).", value: num(c.platform.reach), current: c.platform.reach, previous: p.platform.reach, previousLabel: prev, secondary: true })}
    ${kpiCard({ label: "Cliques", tooltip: "Cliques reportados pelas plataformas.", value: num(c.platform.clicks), current: c.platform.clicks, previous: p.platform.clicks, previousLabel: prev, secondary: true })}
    ${kpiCard({ label: "CTR", tooltip: "Cliques ÷ impressões.", value: fmtPct(c.platform.ctr, 2), current: c.platform.ctr, previous: p.platform.ctr, previousLabel: prev, secondary: true })}
    ${kpiCard({ label: "CPC", tooltip: "Investimento ÷ cliques.", value: c.platform.cpc === null ? "—" : fmtBRL(c.platform.cpc), current: c.platform.cpc, previous: p.platform.cpc, previousLabel: prev, secondary: true, lowerIsBetter: true })}
  </div>`;
  const leadsDaily = lineChart({
    series: [
      { name: "Leads", color: COLORS.accent, points: bi.daily.map((d) => ({ label: ddmm(d.date), value: d.leads })), format: (v) => fmtNum(v) },
      { name: "Clientes (vendas)", color: COLORS.positive, points: bi.daily.map((d) => ({ label: ddmm(d.date), value: d.sales })), format: (v) => fmtNum(v) },
    ],
    height: 240,
    ariaLabel: "Leads e clientes por dia",
  });
  const bestWorst = bestWorstCampaigns(bi.campaigns, company.id, qs);
  const topCreatives = bi.creatives.filter((cr) => cr.leads > 0).slice(0, 4);
  const creativesBlock = topCreatives.length
    ? `<div class="creative-grid">${topCreatives.map((cr) => creativeCard(cr, company.id, qs)).join("")}</div>`
    : bi.creatives.length
      ? '<p class="muted small">Anúncios sincronizados, mas nenhum lead atribuído a anúncio no período.</p>'
      : prepNote("Criativos aparecem quando a conta Meta Ads sincroniza anúncios (campanha → conjunto → anúncio).");
  const body = `${pageHead(`Marketing — ${company.name}`, `Meta Ads + Google Ads + CRM + vendas · ${bi.period.label} · comparado com ${prev}`)}
    ${tabs(company.id, "visao", qs)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, fresh)}
    ${provenanceStrip(base.provenance, bi.providers)}
    ${noIntegrationNotice(bi, base.role)}
    ${primaryKpis(bi, hybrid)}
    ${platformRow}
    <div class="grid-12">
      <div class="col-8">${investmentChart(bi)}</div>
      <div class="col-4"><div class="card-block">${chartHead("Leads e clientes por dia", bi.period.label)}${leadsDaily}</div></div>
    </div>
    ${masterProviderChart(bi, basePath, qs, base.masterMetric)}
    <div class="card-block">${chartHead("Meta Ads x Google Ads", `${bi.period.label} · plataforma e CRM lado a lado · "—" = não fornecido pelo provedor (nunca zero inventado)`)}<div class="grid-12"><div class="col-7">${providerComparisonBlock(bi)}</div><div class="col-5"><div class="eyebrow" style="margin-bottom:8px">Radar de performance</div>${providerRadar(bi)}</div></div></div>
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Funil — do anúncio à venda", `${bi.period.label} · conversão etapa a etapa`, channelQuickLinks(basePath, bi))}${funnelBlock(base.funnel, company.id, qs)}</div></div>
      <div class="col-6">${channelPerformanceBlock(bi, basePath, qs, base.channelMetric)}</div>
    </div>
    <div class="grid-12">
      <div class="col-4"><div class="card-block">${chartHead("Campanhas com melhor desempenho", "clientes gerados; desempate por ROAS")}${bestWorst.best}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Campanhas com pior desempenho", "investimento sem lead ou CPL 30% acima da média")}${bestWorst.worst}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Horário de ouro", "conversas por dia da semana × hora")}${heatmapBlock(bi)}</div></div>
    </div>
    ${costQualityByChannelBlock(costQuality)}
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Criativos em destaque", "anúncios com mais leads atribuídos no período", `<a class="small" href="${basePath}/criativos${qs}">Ver todos →</a>`)}${creativesBlock}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Público destaque", "idade, gênero, cidade e posicionamento")}${prepNote("A sincronização atual não busca os detalhamentos demográficos e de posicionamento da Meta (breakdowns). Estrutura pronta para recebê-los; nada é estimado até lá.")}</div></div>
    </div>
    ${projection ? `<div class="card-block">${chartHead("Metas do mês", `dia ${projection.daysElapsed} de ${projection.daysInMonth}`, `<a class="btn btn-small" href="${basePath}/metas">Gerenciar metas →</a>`)}${goalsMini(projection, company.id)}</div>` : ""}
    <div class="card-block">${chartHead("Custo de aquisição", hybrid ? "Métricas híbridas: investimento real com CRM em modo de demonstração" : `${bi.period.label} · custo por etapa do funil e taxas`)}${secondaryKpis(bi, hybrid)}</div>
    <div class="card-block">${chartHead("Campanhas — Meta Ads e Google Ads", `${bi.period.label} · as 8 maiores por ${base.sort ?? "investimento"}`, `<a class="btn btn-small" href="${basePath}/campanhas${qs}">Ver tabela completa</a>`)}${campaignsTable(bi.campaigns.slice(0, 8), company.id, qs, company.timezone, base.sort)}</div>
    <div class="card-block">${chartHead("Precisa de atenção", "Fatos por canal; recomendações separadas dos fatos")}${attentionBlock(base.attention)}</div>
    <div class="card-block">${chartHead("Integrações", "Conta, status e última sincronização por provedor — tokens nunca aparecem")}${integrationsBlock(base.accounts, company.name, base.role, base.isPlatformAdmin)}
      <p class="small muted" style="margin:12px 0 0">Última sincronização concluída — Meta Ads: ${fmtDateTime(bi.freshness.byProvider.META, company.timezone)} · Google Ads: ${fmtDateTime(bi.freshness.byProvider.GOOGLE, company.timezone)}</p>
      ${base.role === "COMPANY_ADMIN" && bi.hasAnyIntegration ? `<div style="margin-top:8px"><form method="post" action="${basePath}/atualizar" style="display:inline"><button type="submit" class="btn btn-small">Atualizar agora</button></form> <span class="small muted">(no máximo uma vez a cada 15 minutos por empresa)</span></div>` : ""}
    </div>`;
  return shellFor(base, "marketing", body);
}

export function marketingCampaignsPage(base: MarketingPageBase): string {
  const { company, bi } = base;
  const qs = queryString(bi.period, bi.filters);
  const body = `${pageHead("Campanhas", bi.period.label)}
    ${tabs(company.id, "campanhas", qs)}
    ${filterBar(`/empresa/${company.id}/marketing/campanhas`, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}
    ${noIntegrationNotice(bi, base.role)}
    <div class="card-block">${chartHead("Tabela master — Meta Ads e Google Ads", `${bi.period.label} · plataforma e CRM lado a lado · clique na campanha para o detalhe`)}${campaignsTable(bi.campaigns, company.id, qs, company.timezone, base.sort)}</div>
    <div class="card-block">${chartHead("Qualidade do lead: custo x fechamento", "CPL (eixo X) por taxa de fechamento (eixo Y); tamanho da bolha = investimento")}${qualityBubble(bi.campaigns)}</div>`;
  return shellFor(base, "marketing/campanhas", body);
}

export function marketingCampaignDetailPage(
  base: MarketingPageBase,
  campaign: MarketingCampaign,
  row: CampaignRow | null,
  adGroups: { name: string; status: string | null }[],
  ads: { name: string; status: string | null; ad_group_id: number | null }[],
  account: MarketingAccountWithConnection | null
): string {
  const { company, bi } = base;
  const basePath = `/empresa/${company.id}/marketing/campanhas/${campaign.id}`;
  const qs = queryString(bi.period, bi.filters);
  const hierarchyTitle = campaign.provider === "META" ? "Conjuntos de anúncios e anúncios" : "Grupos de anúncios";
  const groups = adGroups.length ? `<ul class="list">${adGroups.map((g) => `<li><span>${escapeHtml(g.name)}</span><span class="chip chip-muted">${escapeHtml(g.status ?? "—")}</span></li>`).join("")}</ul>` : '<p class="muted small">Nenhum grupo sincronizado.</p>';
  const adsList = campaign.provider === "META" ? (ads.length ? `<ul class="list">${ads.map((a) => `<li><span>${escapeHtml(a.name)}</span><span class="chip chip-muted">${escapeHtml(a.status ?? "—")}</span></li>`).join("")}</ul>` : '<p class="muted small">Nenhum anúncio sincronizado.</p>') : "";
  const budget = campaign.daily_budget_cents !== null ? `${fmtBRL(campaign.daily_budget_cents)}/dia` : campaign.lifetime_budget_cents !== null ? `${fmtBRL(campaign.lifetime_budget_cents)} total` : "não informado pela API";
  const body = `${pageHead(campaign.name, `${campaign.provider === "META" ? "Meta Ads" : "Google Ads"} · ${account?.name ?? "—"} · ${bi.period.label}`, `<a href="/empresa/${company.id}/marketing/campanhas${qs}" class="btn btn-small">&larr; Campanhas</a>`)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}
    <div class="grid-12">
      <div class="col-4"><div class="card-block"><h3>Dados da campanha</h3>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:0.3rem 1rem;font-size:0.85rem;margin:0">
          <dt class="muted">Plataforma</dt><dd>${providerChip(campaign.provider)}</dd>
          <dt class="muted">Status</dt><dd>${escapeHtml(campaign.status ?? "—")}</dd>
          <dt class="muted">Objetivo / tipo</dt><dd>${escapeHtml(campaign.objective ?? campaign.campaign_type ?? "—")}</dd>
          <dt class="muted">Orçamento</dt><dd>${escapeHtml(budget)}</dd>
          <dt class="muted">Período da campanha</dt><dd>${escapeHtml(campaign.start_date ?? "—")} → ${escapeHtml(campaign.end_date ?? "em andamento")}</dd>
          <dt class="muted">Moeda</dt><dd>${escapeHtml(campaign.currency ?? account?.currency ?? "—")}</dd>
        </dl></div></div>
      <div class="col-8">${executiveCards(bi)}</div>
    </div>
    ${performanceChart(bi, basePath, qs, base.m1, base.m2)}
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Funil da campanha", `${bi.period.label} · só contatos atribuídos a esta campanha`)}${funnelBlock(base.funnel, company.id, qs, false)}</div></div>
      <div class="col-6"><div class="card-block"><h3>Métricas da plataforma x resultados do CRM</h3>
        ${row ? `<dl style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 1rem;font-size:0.85rem;margin:0">
          <dt class="muted">Conversas reportadas pela plataforma</dt><dd>${row.platform.platformConversations ?? "—"}</dd>
          <dt class="muted">Leads reportados pela plataforma</dt><dd>${row.platform.platformLeads ?? "—"}</dd>
          <dt class="muted">Conversões reportadas pela plataforma</dt><dd>${row.platform.platformConversions ?? "—"}</dd>
          <dt class="muted">Conversas no CRM (atribuídas)</dt><dd>${row.crm.conversations}</dd>
          <dt class="muted">Leads no CRM (atribuídos)</dt><dd>${row.crm.leads} <span class="small muted">(${row.crm.confirmedLeads} confirmados, ${row.crm.probableLeads} prováveis)</span></dd>
          <dt class="muted">Vendas no CRM (atribuídas)</dt><dd>${row.crm.sales}</dd>
          <dt class="muted">Receita atribuída</dt><dd>${fmtBRL(row.crm.attributedRevenueCents)}</dd>
        </dl><p class="small muted" style="margin-top:0.6rem">Os dois lados são fontes diferentes e não são somados.</p>` : '<p class="muted small">Sem dados no período.</p>'}
      </div></div>
    </div>
    <div class="card-block"><h3>${hierarchyTitle}</h3><div class="grid-12"><div class="col-6">${groups}</div><div class="col-6">${adsList}</div></div></div>
    <div class="card-block"><h3>Custo de aquisição</h3>${secondaryKpis(bi, isHybrid(base.provenance))}</div>`;
  return shellFor(base, "marketing/campanhas", body);
}

export function marketingProviderPage(base: MarketingPageBase, provider: MarketingProvider, accounts: MarketingAccountWithConnection[]): string {
  const { company, bi } = base;
  const key = provider === "META" ? "meta" : "google";
  const label = PROVIDER_LABELS[provider];
  const qs = queryString(bi.period, bi.filters);
  const basePath = `/empresa/${company.id}/marketing/${key}`;
  const hybrid = isHybrid(base.provenance) && accounts.length > 0;
  const head = `${pageHead(`${label} — ${company.name}`, `${bi.period.label} · comparado com ${bi.period.previousLabel} · só dados ${label} desta empresa`)}
    ${tabs(company.id, key, qs)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.byProvider[provider]))}`;
  const health = providerHealthGrid(base.accounts, provider, bi.freshness.byProvider[provider], base.attention, bi.period.label);
  const alerts = base.attention.filter((a) => a.channel === provider || a.channel === "MIDIA" || (a.channel === "INTEGRACAO" && a.fact.startsWith(label)));
  const alertsBlock = alerts.length ? attentionBlock(alerts) : '<p class="muted small">Nenhum alerta automático para este canal com os dados atuais (CPL/CAC subindo, CTR em queda, gasto sem lead, conta sem sincronização).</p>';
  // Provedor sem conta vinculada: a área existe (nunca 404), com estado vazio profissional e CTA por papel.
  if (accounts.length === 0) {
    const c = bi.current;
    const crmNote =
      c.crm.leads > 0
        ? `<div class="card-block">${chartHead(`Resultados no CRM atribuídos a ${label}`, "Contatos com origem declarada ou UTM deste canal — sem conta vinculada não há investimento, CPL, CAC nem ROAS")}<div class="kpi-grid">
            ${kpiCard({ label: "Leads", tooltip: "Contatos no CRM atribuídos a este canal.", value: String(c.crm.leads), current: c.crm.leads, previous: bi.previous.crm.leads, previousLabel: bi.period.previousLabel })}
            ${kpiCard({ label: "Qualificados", tooltip: "Leads qualificados no CRM (atribuídos).", value: String(c.crm.qualified), current: c.crm.qualified, previous: bi.previous.crm.qualified, previousLabel: bi.period.previousLabel })}
            ${kpiCard({ label: "Clientes novos", tooltip: "Contatos com venda concluída (atribuídos).", value: String(c.crm.newCustomers), current: c.crm.newCustomers, previous: bi.previous.crm.newCustomers, previousLabel: bi.period.previousLabel })}
            ${kpiCard({ label: "Receita atribuída", tooltip: "Receita das vendas atribuídas a este canal.", value: fmtBRL(c.crm.attributedRevenueCents), current: c.crm.attributedRevenueCents, previous: bi.previous.crm.attributedRevenueCents, previousLabel: bi.period.previousLabel })}
          </div></div>`
        : "";
    return shellFor(base, `marketing/${key}`, `${head}<div class="card-block">${chartHead("Saúde da conta", "conta, status, sincronização e período")}${health}</div>${providerEmptyState(provider, company.name, base.role, base.isPlatformAdmin)}${crmNote}`);
  }
  const provCampaigns = bi.campaigns.filter((r) => r.campaign.provider === provider);
  const color = provider === "META" ? COLORS.meta : COLORS.google;
  const campaignBars = barChart({
    items: provCampaigns
      .filter((r) => r.platform.hasSpendData)
      .map((r) => ({ label: r.campaign.name, value: r.platform.spendCents, color, tooltip: `${r.campaign.name} — investimento ${fmtBRL(r.platform.spendCents)}, leads ${r.crm.leads}, clientes ${r.crm.newCustomers}, CPL ${fmtBRL(r.kpis.cpl)}, CAC ${fmtBRL(r.kpis.cac)}` })),
    format: (v) => fmtBRL(Math.round(v)),
    ariaLabel: `Investimento por campanha — ${label}`,
    valueLabel: "Investimento",
  });
  const bestWorst = bestWorstCampaigns(provCampaigns, company.id, qs);
  const creatives = bi.creatives.filter((cr) => cr.ad.provider === provider);
  const adRanking = provider === "META"
    ? `<div class="card-block">${chartHead("Ranking de anúncios", "por leads atribuídos ao anúncio (real, via ad id)", `<a class="small" href="/empresa/${company.id}/marketing/criativos${qs}">Ver criativos →</a>`)}${creatives.length ? rankList(creatives.slice(0, 8).map((cr) => ({ name: cr.ad.name, value: cr.leads, label: `${cr.leads} leads`, sub: cr.customers ? `${cr.customers} cliente(s)` : undefined })), COLORS.meta, "Nenhum lead atribuído a anúncio no período.") : prepNote("Nenhum anúncio sincronizado ainda para esta conta.")}</div>`
    : `<div class="card-block">${chartHead("Palavras-chave e termos de pesquisa", "estrutura pronta")}${prepNote("A sincronização atual do Google Ads traz campanhas, grupos e métricas diárias — não busca palavras-chave, termos de pesquisa, dispositivos nem horários. Quando a consulta GAQL for ampliada, estes blocos passam a mostrar dados reais; nada é estimado até lá.")}</div>`;
  const extras = provider === "META"
    ? `<div class="grid-12">
        <div class="col-6"><div class="card-block">${chartHead("Melhor horário", "conversas de contatos deste canal por dia × hora")}${heatmapBlock(bi)}</div></div>
        <div class="col-6"><div class="card-block">${chartHead("Público e posicionamento", "idade, gênero, cidade, feed / stories / reels")}${prepNote("Os detalhamentos (breakdowns) demográficos e de posicionamento da Meta ainda não são sincronizados. Estrutura pronta para recebê-los.")}</div></div>
      </div>`
    : `<div class="grid-12">
        <div class="col-6"><div class="card-block">${chartHead("Horários", "conversas de contatos deste canal por dia × hora")}${heatmapBlock(bi)}</div></div>
        <div class="col-6"><div class="card-block">${chartHead("Dispositivos", "estrutura pronta")}${prepNote("Desempenho por dispositivo (celular, computador, tablet) depende de segmentação na consulta GAQL, ainda não sincronizada.")}</div></div>
      </div>`;
  const body = `${head}
    ${provenanceStrip(base.provenance, bi.providers.filter((p) => p.provider === provider))}
    <div class="card-block">${chartHead("Saúde da conta", "conta, status, sincronização e período analisado")}${health}</div>
    ${providerKpis(bi, provider, hybrid)}
    ${performanceChart(bi, basePath, qs, base.m1, base.m2)}
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Investimento por campanha", `${bi.period.label} · ${provCampaigns.length} campanha(s) · ${provider === "META" ? "campanha → conjunto → anúncio" : "campanha → grupo de anúncios"} no detalhe`)}${campaignBars}</div></div>
      <div class="col-6"><div class="card-block">${chartHead(`Funil ${label}`, `${bi.period.label} · do anúncio à venda, só contatos atribuídos a ${label}`)}${funnelBlock(base.funnel, company.id, qs)}</div></div>
    </div>
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Campanhas top", "clientes gerados; desempate por ROAS")}${bestWorst.best}</div></div>
      <div class="col-6"><div class="card-block">${chartHead("Campanhas fracas", "investimento sem lead ou CPL 30% acima da média")}${bestWorst.worst}</div></div>
    </div>
    ${adRanking}
    ${extras}
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Comparação por período", `${bi.period.label} x ${bi.period.previousLabel}`)}${periodComparisonTable(bi)}</div></div>
      <div class="col-6"><div class="card-block">${chartHead("Alertas automáticos", "regras objetivas: CPL/CAC subindo, CTR em queda, gasto sem lead, conta sem sincronização")}${alertsBlock}</div></div>
    </div>
    <div class="card-block">${chartHead("Custo x qualidade por campanha", "CPL (eixo X) por taxa de fechamento (eixo Y); tamanho da bolha = investimento")}${qualityBubble(provCampaigns)}</div>
    <div class="card-block">${chartHead(`Campanhas ${label}`, `${bi.period.label} · plataforma e CRM lado a lado`)}${campaignsTable(provCampaigns, company.id, qs, company.timezone, base.sort)}</div>
    <div class="card-block">${chartHead("Contas vinculadas", "Nome, status e última sincronização — credenciais nunca aparecem")}${integrationsBlock(accounts, company.name, base.role, base.isPlatformAdmin)}</div>`;
  return shellFor(base, `marketing/${key}`, body);
}

export function marketingFunnelPage(base: MarketingPageBase, bottlenecks: Bottleneck[]): string {
  const { company, bi } = base;
  const qs = queryString(bi.period, bi.filters);
  const body = `${pageHead("Funil", `${bi.period.label} — do anúncio à receita`)}
    ${tabs(company.id, "funil", qs)}
    ${filterBar(`/empresa/${company.id}/marketing/funil`, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Funil executivo", `${bi.period.label} · do anúncio à receita`, channelQuickLinks(`/empresa/${company.id}/marketing/funil`, bi))}${funnelBlock(base.funnel, company.id, qs)}
        <p class="small muted" style="margin-top:0.75rem">Receita no período: <strong>${fmtBRL(bi.current.crm.revenueCents)}</strong> · Investimento: <strong>${bi.current.platform.hasSpendData ? fmtBRL(bi.current.platform.spendCents) : "—"}</strong></p></div></div>
      <div class="col-4"><div class="card-block"><h3>Possíveis gargalos</h3>${
        bottlenecks.length
          ? `<ul class="attention-list">${bottlenecks.map((b) => `<li style="grid-template-columns:1fr"><div class="fact">${escapeHtml(b.fact)}</div><div class="hyp">${escapeHtml(b.hypothesis)}</div></li>`).join("")}</ul>`
          : '<p class="muted small">Nenhuma passagem do funil abaixo do esperado com amostra suficiente (mínimo de 10 na etapa de origem).</p>'
      }</div></div>
    </div>
    <div class="card-block">${chartHead("Canais", `${bi.period.label} · comparação por origem do contato`)}<div class="grid-12">
      <div class="col-6">${chartHead("Leads por canal", "contatos novos no período", "", true)}${channelChart(bi, "leads")}</div>
      <div class="col-6">${chartHead("Clientes por canal", "vendas concluídas no período", "", true)}${channelChart(bi, "vendas")}</div>
      <div class="col-6">${chartHead("Receita por canal", "soma das vendas concluídas", "", true)}${channelChart(bi, "receita")}</div>
      <div class="col-6">${chartHead("CAC por canal", "só mídia paga · investimento ÷ clientes", "", true)}${channelChart(bi, "cac")}</div>
    </div></div>`;
  return shellFor(base, "marketing/funil", body);
}

export function marketingReportPage(base: MarketingPageBase, summary: string, costQuality: CostQualityInsight): string {
  const { company, bi } = base;
  const qs = queryString(bi.period, bi.filters);
  const c = bi.current;
  const p = bi.previous;
  const rowsChange = [
    ["Investimento", c.platform.hasSpendData ? fmtBRL(c.platform.spendCents) : "—", p.platform.hasSpendData ? fmtBRL(p.platform.spendCents) : "—", deltaPercent(c.platform.hasSpendData ? c.platform.spendCents : null, p.platform.hasSpendData ? p.platform.spendCents : null)],
    ["Leads", String(c.crm.leads), String(p.crm.leads), deltaPercent(c.crm.leads, p.crm.leads)],
    ["Qualificados", String(c.crm.qualified), String(p.crm.qualified), deltaPercent(c.crm.qualified, p.crm.qualified)],
    ["Agendamentos", String(c.crm.appointments), String(p.crm.appointments), deltaPercent(c.crm.appointments, p.crm.appointments)],
    ["Clientes", String(c.crm.newCustomers), String(p.crm.newCustomers), deltaPercent(c.crm.newCustomers, p.crm.newCustomers)],
    ["Receita", fmtBRL(c.crm.revenueCents), fmtBRL(p.crm.revenueCents), deltaPercent(c.crm.revenueCents, p.crm.revenueCents)],
    ["CPL", c.kpis.cpl === null ? "—" : fmtBRL(c.kpis.cpl), p.kpis.cpl === null ? "—" : fmtBRL(p.kpis.cpl), deltaPercent(c.kpis.cpl, p.kpis.cpl)],
    ["CAC", c.kpis.cac === null ? "—" : fmtBRL(c.kpis.cac), p.kpis.cac === null ? "—" : fmtBRL(p.kpis.cac), deltaPercent(c.kpis.cac, p.kpis.cac)],
    ["ROAS", c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, p.kpis.roasCrm === null ? "—" : `${fmtNum(p.kpis.roasCrm)}x`, deltaPercent(c.kpis.roasCrm, p.kpis.roasCrm)],
    ["Taxa de fechamento", fmtPct(c.kpis.closeRate), fmtPct(p.kpis.closeRate), deltaPercent(c.kpis.closeRate, p.kpis.closeRate)],
  ] as [string, string, string, number | null][];
  const best = bi.campaigns.filter((r) => r.crm.newCustomers >= 1).sort((a, b) => b.crm.newCustomers - a.crm.newCustomers)[0];
  const biggest = bi.campaigns[0];
  const bestChannel = bi.channels.filter((r) => r.crm.sales > 0).sort((a, b) => b.crm.sales - a.crm.sales)[0];
  const body = `${pageHead("Resultados", `Relatório executivo · ${bi.period.label} vs ${bi.period.previousLabel}`)}
    ${tabs(company.id, "relatorios", qs)}
    ${filterBar(`/empresa/${company.id}/marketing/relatorios`, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}
    <div class="card-block"><h3>Resumo executivo (gerado por regras, só com números do banco)</h3><p style="font-size:0.95rem;line-height:1.5">${escapeHtml(summary)}</p></div>
    <div class="grid-12">
      <div class="col-7 col-6"><div class="card-block"><h3>Principais mudanças vs período anterior</h3>
        <div class="data-table-wrap"><table class="data-table" style="min-width:0"><thead><tr><th class="left">Métrica</th><th>Atual</th><th>Anterior</th><th>Variação</th></tr></thead>
        <tbody>${rowsChange.map(([l, a, b, d]) => `<tr><td class="left">${l}</td><td>${a}</td><td>${b}</td><td>${fmtDelta(d)}</td></tr>`).join("")}</tbody></table></div></div></div>
      <div class="col-6"><div class="card-block"><h3>Destaques</h3><dl style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 1rem;font-size:0.85rem;margin:0">
        <dt class="muted">Melhor campanha (clientes)</dt><dd>${best ? `${escapeHtml(best.campaign.name)} (${best.crm.newCustomers})` : "—"}</dd>
        <dt class="muted">Maior investimento</dt><dd>${biggest && biggest.platform.hasSpendData ? `${escapeHtml(biggest.campaign.name)} (${fmtBRL(biggest.platform.spendCents)})` : "—"}</dd>
        <dt class="muted">Melhor CAC</dt><dd>${costQuality.bestCac ? `${escapeHtml(costQuality.bestCac.campaign.name)} (${fmtBRL(costQuality.bestCac.kpis.cac)})` : "—"}</dd>
        <dt class="muted">Canal com mais clientes</dt><dd>${bestChannel ? `${escapeHtml(SOURCE_LABELS[bestChannel.source])} (${bestChannel.crm.sales})` : "—"}</dd>
      </dl>${costQuality.text ? `<p class="small" style="margin-top:0.75rem;color:#fde68a">Custo x qualidade: ${escapeHtml(costQuality.text)}</p>` : ""}</div></div>
    </div>
    <div class="card-block"><h3>Meta Ads x Google Ads</h3>${providerComparisonBlock(bi)}</div>`;
  return shellFor(base, "marketing", body);
}

// --- Inteligência ------------------------------------------------------------------------

export interface IntelligencePageOpts {
  company: Company;
  user: User;
  role: Role;
  canViewMarketing: boolean;
  bi: CompanyBi; // mês atual
  bi7: CompanyBi; // últimos 7 dias (para variações rápidas)
  goals: CompanyGoals | null;
  projection: MonthProjection;
  attention: AttentionItem[];
  bottlenecks: Bottleneck[];
  hot: ScoredLead[];
  stalled: StalledOpportunity[];
  health: HealthScore;
  summary: string;
  costQuality: CostQualityInsight;
  funnel: FunnelStage[];
  notice?: string;
  error?: string;
}

function goalsForm(companyId: number, g: CompanyGoals | null, canEdit: boolean): string {
  const v = (n: number | null | undefined, cents = false) => (n === null || n === undefined ? "" : cents ? (n / 100).toFixed(2) : String(n));
  const dis = canEdit ? "" : "disabled";
  return `<form method="post" action="/empresa/${companyId}/inteligencia/metas" class="form-grid">
    <label>Meta de faturamento (R$)<input type="number" step="0.01" min="0" name="revenue" value="${v(g?.revenue_cents, true)}" ${dis} /></label>
    <label>Meta de clientes novos<input type="number" min="0" name="new_customers" value="${v(g?.new_customers)}" ${dis} /></label>
    <label>Meta de leads<input type="number" min="0" name="leads" value="${v(g?.leads)}" ${dis} /></label>
    <label>Meta de leads qualificados<input type="number" min="0" name="qualified_leads" value="${v(g?.qualified_leads)}" ${dis} /></label>
    <label>Meta de agendamentos<input type="number" min="0" name="appointments" value="${v(g?.appointments)}" ${dis} /></label>
    <label>Meta de comparecimentos<input type="number" min="0" name="attendances" value="${v(g?.attendances)}" ${dis} /></label>
    <label>CAC máximo (R$)<input type="number" step="0.01" min="0" name="max_cac" value="${v(g?.max_cac_cents, true)}" ${dis} /></label>
    <label>CPL máximo (R$)<input type="number" step="0.01" min="0" name="max_cpl" value="${v(g?.max_cpl_cents, true)}" ${dis} /></label>
    <label>ROAS mínimo<input type="number" step="0.1" min="0" name="min_roas" value="${v(g?.min_roas)}" ${dis} /></label>
    <label>Investimento mensal planejado (R$)<input type="number" step="0.01" min="0" name="planned_spend" value="${v(g?.planned_monthly_spend_cents, true)}" ${dis} /></label>
    ${canEdit ? '<div style="align-self:end"><button type="submit" class="btn btn-small btn-primary">Salvar metas</button></div>' : ""}
  </form>`;
}

function goalsProgress(p: MonthProjection): string {
  const rows = p.items
    .filter((i) => i.goal !== null || i.actual > 0)
    .map((i) => {
      const f = (n: number | null) => (n === null ? "—" : i.isCurrency ? fmtBRL(Math.round(n)) : fmtNum(Math.round(n)));
      const pct = i.attainment === null ? 0 : Math.min(100, i.attainment * 100);
      return `<div class="goal-row">
        <div>${escapeHtml(i.label)}<div class="bar" style="margin-top:0.3rem"><span style="width:${pct.toFixed(0)}%"></span></div></div>
        <div><div class="eyebrow">Meta</div>${f(i.goal)}</div>
        <div><div class="eyebrow">Realizado</div>${f(i.actual)}</div>
        <div><div class="eyebrow">Atingido</div>${i.attainment === null ? "—" : fmtPct(i.attainment, 1)}</div>
        <div><div class="eyebrow">Faltam / dia</div>${i.remaining === null ? "—" : `${f(i.remaining)}${i.neededPerDay !== null ? ` · ${f(i.neededPerDay)}/dia` : ""}`}</div>
        <div><div class="eyebrow">Projeção</div>${f(i.projected)}${i.projectedGap !== null ? ` <span class="small ${i.projectedGap >= 0 ? "muted" : ""}" style="${i.projectedGap < 0 ? "color:#fbbf24" : ""}">(${i.projectedGap >= 0 ? "+" : ""}${f(i.projectedGap)})</span>` : ""}</div>
      </div>`;
    })
    .join("");
  return `<p class="small muted">Dia ${p.daysElapsed} de ${p.daysInMonth} · ${p.daysRemaining} dia(s) restantes. Projeção linear: ritmo diário atual × dias do mês (cálculo transparente, sem IA).</p>${rows || '<p class="muted small">Defina metas abaixo para acompanhar o atingimento.</p>'}${p.headline ? `<p style="margin-top:0.75rem;font-weight:600">${escapeHtml(p.headline)}</p>` : ""}`;
}

function leadsTable(companyId: number, leads: ScoredLead[], timeZone: string, extra?: (l: ScoredLead) => string): string {
  if (leads.length === 0) return '<p class="muted small">Nenhum lead nessa condição agora.</p>';
  return `<div class="data-table-wrap"><table class="data-table" style="min-width:820px"><thead><tr>
    <th class="left">Lead</th><th class="left">Origem</th><th class="left">Campanha</th><th>Score</th><th class="left">Etapa</th><th class="left">Atendente</th><th>Última interação</th><th class="left">Ação recomendada</th>${extra ? '<th class="left">Motivo</th>' : ""}
  </tr></thead><tbody>${leads
    .map(
      (l) => `<tr>
      <td class="left">${l.conversationId ? `<a href="/empresa/${companyId}/conversas/${l.conversationId}">${escapeHtml(l.name)}</a>` : escapeHtml(l.name)}<br /><span class="muted small">${escapeHtml(l.phoneMasked)}</span></td>
      <td class="left">${providerChip(l.source)} ${confidenceChip(l.confidence)}</td>
      <td class="left">${escapeHtml(l.campaignName ?? "—")}</td>
      <td><strong>${l.score}</strong> <span class="chip ${l.temperature === "ALTA_INTENCAO" ? "chip-ok" : l.temperature === "QUENTE" ? "chip-warn" : "chip-muted"}">${TEMPERATURE_LABELS[l.temperature]}</span></td>
      <td class="left">${escapeHtml(l.stageName ?? "—")}</td>
      <td class="left">${escapeHtml(l.attendantName ?? "—")}</td>
      <td>${fmtDateTime(l.lastInteractionAt, timeZone)}${l.waitingHumanSinceMs !== null ? `<br /><span class="chip chip-bad">aguardando há ${formatDuration(l.waitingHumanSinceMs)}</span>` : ""}</td>
      <td class="left">${escapeHtml(l.recommendedAction)}</td>
      ${extra ? `<td class="left">${extra(l)}</td>` : ""}
    </tr>`
    )
    .join("")}</tbody></table></div>`;
}

export function intelligencePage(o: IntelligencePageOpts): string {
  const { company, bi } = o;
  const c = bi.current;
  const mesLabel = "Este mês";
  const s7 = o.bi7.current.kpis;
  const p7 = o.bi7.previous.kpis;
  const health = o.health;
  const slaHtml = (() => {
    const s = bi.sla;
    const total = s.count || 0;
    const pct = (n: number) => (total ? fmtPct(n / total) : "—");
    return `<dl style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 1rem;font-size:0.85rem;margin:0">
      <dt class="muted">Tempo médio de 1ª resposta</dt><dd>${s.avgMinutes === null ? "—" : formatDuration(s.avgMinutes * 60000)}</dd>
      <dt class="muted">Mediana</dt><dd>${s.medianMinutes === null ? "—" : formatDuration(s.medianMinutes * 60000)}</dd>
      <dt class="muted">P90</dt><dd>${s.p90Minutes === null ? "—" : formatDuration(s.p90Minutes * 60000)}</dd>
      <dt class="muted">Maior espera atual</dt><dd>${s.longestOpenWaitMs === null ? "—" : formatDuration(s.longestOpenWaitMs)}</dd>
      <dt class="muted">Respondidos em até 5 min</dt><dd>${pct(s.buckets.upTo5)}</dd>
      <dt class="muted">5 a 15 min</dt><dd>${pct(s.buckets.upTo15)}</dd>
      <dt class="muted">15 a 30 min</dt><dd>${pct(s.buckets.upTo30)}</dd>
      <dt class="muted">Mais de 30 min</dt><dd>${pct(s.buckets.over30)}</dd>
    </dl>${
      s.conversionFastVsSlow
        ? `<p class="small" style="margin-top:0.6rem">Conversão em venda: respondidos em até 15 min ${fmtPct(s.conversionFastVsSlow.fastRate)} (n=${s.conversionFastVsSlow.fastN}) vs depois de 15 min ${fmtPct(s.conversionFastVsSlow.slowRate)} (n=${s.conversionFastVsSlow.slowN}). <span class="muted">Relação observada, não prova de causa.</span></p>`
        : '<p class="small muted" style="margin-top:0.6rem">Relação tempo de resposta × conversão só é mostrada com pelo menos 10 atendimentos em cada grupo.</p>'
    }`;
  })();
  const attendantsHtml = bi.attendants.length
    ? `<div class="data-table-wrap"><table class="data-table" style="min-width:760px"><thead><tr><th class="left">Atendente</th><th>Atendimentos</th><th>Leads</th><th>Qualif.</th><th>Agend.</th><th>Compar.</th><th>Vendas</th><th>Receita</th><th>Fechamento</th><th>1ª resposta (média)</th><th>Ticket</th></tr></thead><tbody>${bi.attendants
        .map(
          (a) => `<tr><td class="left">${escapeHtml(a.name)}</td><td>${a.conversationsAssigned}</td><td>${a.leads}</td><td>${a.qualified}</td><td>${a.appointments}</td><td>${a.attendances}</td><td>${a.sales}</td><td>${fmtBRL(a.revenueCents)}</td><td>${fmtPct(a.closeRate)}</td><td>${a.avgFirstResponseMinutes === null ? "—" : formatDuration(a.avgFirstResponseMinutes * 60000)}</td><td>${a.ticketCents === null ? "—" : fmtBRL(a.ticketCents)}</td></tr>`
        )
        .join("")}</tbody></table></div>`
    : '<p class="muted small">Sem atendentes cadastrados.</p>';
  const sources: LeadSource[] = ["META_ADS", "GOOGLE_ADS", "ORGANICO", "INDICACAO", "OUTROS", "DESCONHECIDA"];
  const matrixHtml = bi.attendantMatrix.length
    ? `<div class="data-table-wrap"><table class="data-table" style="min-width:700px"><thead><tr><th class="left">Atendente</th>${sources.map((s) => `<th>${escapeHtml(SOURCE_LABELS[s])}</th>`).join("")}</tr></thead><tbody>${bi.attendantMatrix
        .map((m) => `<tr><td class="left">${escapeHtml(m.name)}</td>${sources.map((s) => `<td title="leads / vendas">${m.bySource[s].leads}/${m.bySource[s].sales} <span class="muted small">${fmtPct(m.bySource[s].closeRate)}</span></td>`).join("")}</tr>`)
        .join("")}</tbody></table></div><p class="small muted">Formato: leads/vendas e taxa de fechamento, por origem do contato. Compara só atendentes desta empresa.</p>`
    : "";
  const semColor = health.semaphore === "VERDE" ? COLORS.positive : health.semaphore === "AMARELO" ? COLORS.warning : health.semaphore === "VERMELHO" ? COLORS.danger : COLORS.neutral;
  const semText = health.semaphore === "CINZA" ? "dados insuficientes" : health.semaphore.toLowerCase();
  const semChip = health.semaphore === "VERDE" ? "chip-ok" : health.semaphore === "AMARELO" ? "chip-warn" : health.semaphore === "VERMELHO" ? "chip-bad" : "chip-muted";
  // Faixas do gauge = os mesmos limiares usados no cálculo (insights.ts), nunca números soltos.
  const bands = [
    { upTo: HEALTH_THRESHOLDS.AMARELO, color: COLORS.danger, label: `0–${HEALTH_THRESHOLDS.AMARELO - 1} vermelho` },
    { upTo: HEALTH_THRESHOLDS.VERDE, color: COLORS.warning, label: `${HEALTH_THRESHOLDS.AMARELO}–${HEALTH_THRESHOLDS.VERDE - 1} amarelo` },
    { upTo: 100, color: COLORS.positive, label: `${HEALTH_THRESHOLDS.VERDE}–100 verde` },
  ];
  const healthHtml = `${gaugeChart({ value: health.score, color: semColor, statusLabel: semText, bands, ariaLabel: `Saúde do marketing: ${health.score === null ? "sem dado suficiente" : `${health.score} de 100`} (${semText})` })}
    <div class="gauge-status"><span class="chip ${semChip}"><span class="semaforo semaforo-${health.semaphore}"></span>${escapeHtml(semText)}</span></div>
    <div class="gauge-legend">${bands.map((b) => `<span><i style="background:${b.color}"></i>${escapeHtml(b.label)}</span>`).join("")}</div>
    <details><summary class="small" style="cursor:pointer;color:#38bdf8">Como é calculado</summary><ul class="small" style="margin:0.5rem 0 0;padding-left:1.1rem">${health.components.map((cmp) => `<li>${escapeHtml(cmp.label)} (peso ${(cmp.weight * 100).toFixed(0)}%): ${cmp.score === null ? "sem dado suficiente" : `${cmp.score.toFixed(0)}`} — <span class="muted">${escapeHtml(cmp.explanation)}</span></li>`).join("")}</ul></details>
    ${health.reasons.length ? `<ul class="small" style="margin:0.5rem 0 0;padding-left:1.1rem;color:#fde68a">${health.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}`;
  const bi7 = o.bi7;
  const c7 = bi7.current;
  const p7s = bi7.previous;
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const good: string[] = [];
  const bad: string[] = [];
  const judge = (label: string, cur: number | null, prev: number | null, fmt: (v: number) => string, lowerIsBetter = false) => {
    const d = deltaPercent(cur, prev);
    if (d === null || cur === null || prev === null || Math.abs(d) < 5) return;
    const improved = lowerIsBetter ? d < 0 : d > 0;
    (improved ? good : bad).push(`${label}: ${fmt(prev)} → ${fmt(cur)} (${fmtDelta(d)}) nos últimos 7 dias vs 7 anteriores`);
  };
  judge("Leads", c7.crm.leads, p7s.crm.leads, (v) => fmtNum(v));
  judge("Leads qualificados", c7.crm.qualified, p7s.crm.qualified, (v) => fmtNum(v));
  judge("Clientes novos", c7.crm.newCustomers, p7s.crm.newCustomers, (v) => fmtNum(v));
  judge("Receita atribuída", c7.crm.attributedRevenueCents, p7s.crm.attributedRevenueCents, (v) => fmtBRL(v));
  judge("CPL", s7.cpl, p7.cpl, (v) => fmtBRL(v), true);
  judge("CAC", s7.cac, p7.cac, (v) => fmtBRL(v), true);
  judge("Taxa de fechamento", s7.closeRate, p7.closeRate, (v) => fmtPct(v), false);
  judge("CTR", c7.platform.ctr, p7s.platform.ctr, (v) => fmtPct(v, 2));
  for (const it of o.attention) {
    if (it.severity === "OPORTUNIDADE") good.push(it.fact);
    if (it.severity === "CRITICO" || it.severity === "ATENCAO") bad.push(it.fact);
  }
  const list = (items: string[], empty: string) => (items.length ? `<ul>${items.slice(0, 6).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : `<p class="empty">${escapeHtml(empty)}</p>`);
  const recs = o.attention.filter((a) => a.recommendation).map((a) => `${a.recommendation} (${a.fact})`);
  const chans = bi.channels;
  const topLeads = [...chans].sort((a, b) => b.crm.leads - a.crm.leads)[0];
  const topCustomers = [...chans].filter((r) => r.crm.newCustomers > 0).sort((a, b) => b.crm.newCustomers - a.crm.newCustomers)[0];
  const bestCost = [...chans].filter((r) => r.kpis.cac !== null).sort((a, b) => (a.kpis.cac as number) - (b.kpis.cac as number))[0];
  const bestCpl = [...chans].filter((r) => r.kpis.cpl !== null).sort((a, b) => (a.kpis.cpl as number) - (b.kpis.cpl as number))[0];
  const sourceFacts: string[] = [];
  if (topLeads && topLeads.crm.leads > 0) sourceFacts.push(`Maior fonte de leads: ${SOURCE_LABELS[topLeads.source]} (${topLeads.crm.leads} leads no mês)`);
  if (topCustomers) sourceFacts.push(`Maior fonte de clientes: ${SOURCE_LABELS[topCustomers.source]} (${topCustomers.crm.newCustomers} clientes)`);
  if (bestCost) sourceFacts.push(`Melhor custo por cliente: ${SOURCE_LABELS[bestCost.source]} (CAC ${fmtBRL(bestCost.kpis.cac)})`);
  if (bestCpl) sourceFacts.push(`Melhor custo por lead: ${SOURCE_LABELS[bestCpl.source]} (CPL ${fmtBRL(bestCpl.kpis.cpl)})`);
  const cacAvg = c.kpis.cac;
  const waste = bi.campaigns
    .filter((r) => r.platform.hasSpendData && r.platform.spendCents > 0 && (r.crm.leads === 0 || (cacAvg !== null && r.kpis.cac !== null && r.kpis.cac > cacAvg * 1.5)))
    .map((r) => (r.crm.leads === 0 ? `"${r.campaign.name}" investiu ${fmtBRL(r.platform.spendCents)} sem gerar lead` : `"${r.campaign.name}" tem CAC ${fmtBRL(r.kpis.cac)} — ${fmtDelta(deltaPercent(r.kpis.cac, cacAvg))} acima da média (${fmtBRL(cacAvg)})`));
  const body = `${pageHead(`Inteligência — ${company.name}`, `Leitura gerencial · ${mesLabel} · ${o.projection.today} · comparações de 7 dias · gerada por regras, só com números do banco`)}
    ${o.notice ? `<p class="success">${escapeHtml(o.notice)}</p>` : ""}${o.error ? `<p class="error">${escapeHtml(o.error)}</p>` : ""}
    ${noIntegrationNotice(bi, o.role)}
    <div class="exec-summary" style="margin-bottom:16px"><div class="eyebrow" style="margin-bottom:6px">Resumo executivo</div>${escapeHtml(o.summary)}<div class="small muted" style="margin-top:8px">Últimos 7 dias vs 7 anteriores — CPL ${money(s7.cpl)} (${fmtDelta(deltaPercent(s7.cpl, p7.cpl))}) · CAC ${money(s7.cac)} (${fmtDelta(deltaPercent(s7.cac, p7.cac))}) · fechamento ${fmtPct(s7.closeRate)} (${fmtDelta(deltaPercent(s7.closeRate, p7.closeRate))})</div></div>
    <div class="kpi-grid">
      ${kpiCard({ label: "Investimento do mês", tooltip: "Gasto sincronizado das plataformas no mês corrente.", value: c.platform.hasSpendData ? fmtBRL(c.platform.spendCents) : "—", current: c.platform.hasSpendData ? c.platform.spendCents : null, previous: bi.previous.platform.hasSpendData ? bi.previous.platform.spendCents : null, lowerIsBetter: true, previousLabel: bi.period.previousLabel, hero: true })}
      ${kpiCard({ label: "Receita atribuída", tooltip: "Receita de vendas de contatos atribuídos a anúncios.", value: fmtBRL(c.crm.attributedRevenueCents), current: c.crm.attributedRevenueCents, previous: bi.previous.crm.attributedRevenueCents, previousLabel: bi.period.previousLabel, hero: true })}
      ${kpiCard({ label: "ROAS", tooltip: "Receita atribuída ÷ investimento.", value: c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, current: c.kpis.roasCrm, previous: bi.previous.kpis.roasCrm, previousLabel: bi.period.previousLabel, hero: true })}
      ${kpiCard({ label: "CAC", tooltip: "Investimento ÷ clientes novos (mês).", value: money(c.kpis.cac), current: c.kpis.cac, previous: bi.previous.kpis.cac, lowerIsBetter: true, previousLabel: bi.period.previousLabel, hero: true })}
      ${kpiCard({ label: "Leads", tooltip: "Contatos novos no mês.", value: String(c.crm.leads), current: c.crm.leads, previous: bi.previous.crm.leads, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Qualificados", tooltip: "Oportunidades qualificadas no mês.", value: String(c.crm.qualified), current: c.crm.qualified, previous: bi.previous.crm.qualified, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Clientes novos", tooltip: "Contatos com venda concluída no mês.", value: String(c.crm.newCustomers), current: c.crm.newCustomers, previous: bi.previous.crm.newCustomers, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Ticket médio", tooltip: "Receita ÷ vendas.", value: money(c.kpis.ticketCents), current: c.kpis.ticketCents, previous: bi.previous.kpis.ticketCents, previousLabel: bi.period.previousLabel })}
    </div>
    <div class="insight-grid" style="margin-bottom:16px">
      <div class="insight-card good"><h4>O que está funcionando</h4>${list(good, "Nenhuma melhora relevante (≥ 5%) nos últimos 7 dias, nem oportunidade detectada.")}</div>
      <div class="insight-card bad"><h4>O que piorou</h4>${list(bad, "Nenhuma piora relevante (≥ 5%) nem alerta crítico nos últimos 7 dias.")}</div>
      <div class="insight-card warn"><h4>Gargalos do funil</h4>${list(o.bottlenecks.map((b) => `${b.fact} — ${b.hypothesis}`), "Nenhum gargalo com amostra suficiente (mínimo de 10 na etapa de origem).")}</div>
      <div class="insight-card info"><h4>Recomendações automáticas</h4>${list(recs, "Sem recomendação: nenhuma regra disparou com os dados atuais.")}</div>
      <div class="insight-card"><h4>Fontes e custo por resultado</h4>${list(sourceFacts, "Sem leads no mês para apontar fontes.")}</div>
      <div class="insight-card bad"><h4>Onde está desperdiçando dinheiro</h4>${list(waste, cacAvg === null && !bi.campaigns.some((r) => r.platform.spendCents > 0) ? "Sem investimento no mês." : "Nenhuma campanha gastando sem lead nem com CAC 50% acima da média.")}</div>
    </div>
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Comparativo Meta x Google", "mês atual · plataforma e CRM lado a lado")}${providerComparisonBlock(bi)}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Radar de performance", "Meta x Google em taxas comparáveis")}${providerRadar(bi)}</div></div>
    </div>
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Comparação entre períodos", `${bi7.period.label} x ${bi7.period.previousLabel}`)}${periodComparisonTable(bi7)}</div></div>
      <div class="col-6"><div class="card-block">${chartHead("Custo x qualidade por campanha", "regra: a campanha de menor CPL não é automaticamente a melhor")}<p style="font-size:13.5px;line-height:1.55;margin:0">${o.costQuality.text ? escapeHtml(o.costQuality.text) : '<span class="muted">Sem campanhas suficientes para comparar custo e qualidade.</span>'}</p>${o.costQuality.bestCac ? `<p class="small muted" style="margin-top:8px">Melhor CAC: ${escapeHtml(o.costQuality.bestCac.campaign.name)} (${fmtBRL(o.costQuality.bestCac.kpis.cac)})</p>` : ""}</div></div>
    </div>
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Meta do mês e projeção", `dia ${o.projection.daysElapsed} de ${o.projection.daysInMonth}`, `<a class="btn btn-small" href="/empresa/${company.id}/marketing/metas">Metas →</a>`)}${goalsProgress(o.projection)}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Saúde do marketing", `Índice de 0 a 100 · ${health.components.length} componentes ponderados`)}${healthHtml}</div></div>
    </div>
    <div class="card-block">${chartHead("Insights acionáveis", "todos os fatos por canal com a recomendação separada")}${attentionBlock(o.attention)}</div>
    <div class="grid-12">
      <div class="col-7 col-6"><div class="card-block">${chartHead("Funil executivo do mês", "Este mês · conversão etapa a etapa")}${funnelBlock(o.funnel, company.id, "")}</div></div>
      <div class="col-6"><div class="card-block">${chartHead("Horário de ouro", "conversas do mês por dia × hora")}${heatmapBlock(bi)}</div></div>
    </div>
    <div class="card-block">${chartHead("Leads quentes agora", "score determinístico por regras")}${leadsTable(company.id, o.hot, company.timezone)}</div>
    <div class="card-block">${chartHead("Oportunidades paradas", "sem movimento no funil")}${leadsTable(company.id, o.stalled.map((s) => s.lead), company.timezone, (l) => {
      const st = o.stalled.find((s) => s.lead.contactId === l.contactId)!;
      return `${escapeHtml(st.reason)} <span class="muted">(${formatDuration(st.stalledForMs)}${l.opportunityValueCents ? ` · ${fmtBRL(l.opportunityValueCents)} em aberto` : ""})</span>`;
    })}</div>
    <div class="grid-12">
      <div class="col-4"><div class="card-block">${chartHead("SLA de atendimento", "mês atual")}${slaHtml}</div></div>
      <div class="col-8"><div class="card-block">${chartHead("Performance dos atendentes", "mês atual")}${attendantsHtml}</div></div>
    </div>
    ${matrixHtml ? `<div class="card-block">${chartHead("Atendente x origem", "leads/vendas e fechamento por origem")}${matrixHtml}</div>` : ""}`;
  return appShell({ company, user: o.user, role: o.role, active: "inteligencia", body, canViewMarketing: o.canViewMarketing });
}

// --- Alertas ---------------------------------------------------------------------------

export function alertsPage(o: {
  company: Company;
  user: User;
  role: Role;
  canViewMarketing: boolean;
  alerts: AlertRow[];
  status: AlertStatus | "TODOS";
  members: { user_id: number; name: string }[];
  notice?: string;
}): string {
  const { company } = o;
  const statuses: (AlertStatus | "TODOS")[] = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO", "TODOS"];
  const labels: Record<string, string> = { ABERTO: "Abertos", EM_ANALISE: "Em análise", RESOLVIDO: "Resolvidos", IGNORADO: "Ignorados", TODOS: "Todos" };
  const nav = `<div class="tabs">${statuses.map((s) => `<a href="/empresa/${company.id}/alertas?status=${s}" class="${s === o.status ? "active" : ""}">${labels[s]}</a>`).join("")}</div>`;
  const memberOptions = (sel: number | null) => `<option value="">Sem responsável</option>` + o.members.map((m) => `<option value="${m.user_id}" ${m.user_id === sel ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("");
  const rows = o.alerts.length
    ? o.alerts
        .map(
          (a) => `<tr>
        <td class="left muted">${fmtDateTime(a.created_at, company.timezone)}</td>
        <td class="left">${escapeHtml(a.category)}</td>
        <td class="left"><span class="sev sev-${a.severity}">${SEVERITY_LABELS[a.severity]}</span></td>
        <td class="left" style="white-space:normal;max-width:420px">${escapeHtml(a.description)}</td>
        <td class="left">${escapeHtml(a.metric ?? "—")}</td>
        <td>${escapeHtml(a.current_value ?? "—")}</td><td>${escapeHtml(a.reference_value ?? "—")}</td>
        <td class="left"><form method="post" action="/empresa/${company.id}/alertas/${a.id}/status" class="inline-form" style="gap:0.3rem">
          <select name="status" style="width:auto">${(["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO"] as AlertStatus[]).map((s) => `<option value="${s}" ${s === a.status ? "selected" : ""}>${labels[s].replace(/s$/, "")}</option>`).join("")}</select>
          <select name="assignee" style="width:auto">${memberOptions(a.assignee_user_id)}</select>
          <button type="submit" class="btn btn-small">Salvar</button></form></td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="8" class="left muted">Nenhum alerta ${labels[o.status].toLowerCase()}.</td></tr>`;
  const body = `${pageHead("Alertas", "Ocorrências geradas por regras objetivas — nunca por suposição")}
    ${o.notice ? `<p class="success">${escapeHtml(o.notice)}</p>` : ""}
    ${nav}
    <div class="data-table-wrap"><table class="data-table" style="min-width:1000px"><thead><tr><th class="left">Data</th><th class="left">Categoria</th><th class="left">Severidade</th><th class="left">Descrição</th><th class="left">Métrica</th><th>Valor</th><th>Referência</th><th class="left">Status / responsável</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small muted" style="margin-top:0.75rem">Os alertas são reavaliados sempre que a Central de Performance é aberta. Limiares configuráveis pela Hub Action.</p>`;
  return appShell({ company, user: o.user, role: o.role, active: "alertas", body, canViewMarketing: o.canViewMarketing });
}

// --- Central de Marketing da empresa: blocos novos ---------------------------------------

/**
 * Procedência dos números: mídia (Meta/Google) e CRM podem vir de fontes
 * incompatíveis (investimento real x CRM em demonstração). Nunca é escondido.
 */
export interface DataProvenance {
  media: "real" | "demo" | "none";
  crm: "real" | "demo";
}

/** Investimento real misturado com CRM de demonstração: CAC/CPL/ROAS/receita atribuída viram "híbridos". */
export function isHybrid(p: DataProvenance): boolean {
  return p.media === "real" && p.crm === "demo";
}

/** Faixa de procedência: de onde vem cada família de números. */
export function provenanceStrip(p: DataProvenance, providers: ProviderComparison[]): string {
  const media = providers
    .map((pr) => {
      const label = PROVIDER_LABELS[pr.provider];
      if (!pr.connected) return `<span class="chip chip-muted"><span class="semaforo semaforo-CINZA"></span>${label} — não conectado</span>`;
      return p.media === "demo"
        ? `<span class="chip chip-warn"><span class="semaforo semaforo-AMARELO"></span>${label} — dados de demonstração</span>`
        : `<span class="chip chip-ok"><span class="semaforo semaforo-VERDE"></span>${label} — dados reais</span>`;
    })
    .join("");
  const crm =
    p.crm === "demo"
      ? `<span class="chip chip-warn"><span class="semaforo semaforo-AMARELO"></span>CRM — dados de demonstração</span>`
      : `<span class="chip chip-ok"><span class="semaforo semaforo-VERDE"></span>CRM — dados reais</span>`;
  const hybrid = isHybrid(p) ? `<span class="small muted">Investimento real com CRM em modo de demonstração: CPL, CAC, ROAS e receita atribuída estão marcados como <strong>híbrido</strong> — não use para decisão até desligar o modo de demonstração.</span>` : "";
  return `<div class="provenance">${media}${crm}${hybrid}</div>`;
}

/** Integrações da empresa: conta, status e última sincronização por provedor — tokens nunca aparecem. */
export function integrationsBlock(accounts: MarketingAccountWithConnection[], companyName: string, role: Role, isPlatformAdmin: boolean): string {
  const cards = (["META", "GOOGLE"] as MarketingProvider[])
    .map((p) => {
      const mine = accounts.filter((a) => a.provider === p);
      const label = PROVIDER_LABELS[p];
      if (mine.length === 0) {
        const cta = isPlatformAdmin
          ? `<a class="btn btn-small btn-primary" href="/admin/integracoes">Configurar integração</a>`
          : role === "COMPANY_ADMIN"
            ? `<span class="small muted">Entre em contato com a Hub Action.</span>`
            : "";
        return `<div class="integration-card"><h4>${providerChip(p)}</h4>
          <dl><dt>Conta</dt><dd>—</dd><dt>Status</dt><dd><span class="chip chip-muted">Não conectado</span></dd><dt>Última sincronização</dt><dd>—</dd></dl>
          <p class="small muted" style="margin:4px 0 0">Nenhuma conta ${escapeHtml(label)} está vinculada à ${escapeHtml(companyName)}.</p>${cta ? `<div>${cta}</div>` : ""}</div>`;
      }
      const rows = mine
        .map((a) => {
          const fresh = freshnessLabel(a.last_success_at);
          const status = a.connection_status === "CONECTADA" ? '<span class="chip chip-ok">Conectado</span>' : '<span class="chip chip-bad">Reconexão necessária</span>';
          return `<dl><dt>Conta</dt><dd>${escapeHtml(a.name ?? a.external_account_id)}${a.currency ? ` <span class="muted small">${escapeHtml(a.currency)}</span>` : ""}</dd>
            <dt>Status</dt><dd>${status}${a.sync_enabled ? "" : ' <span class="chip chip-muted chip-xs">sincronização desligada</span>'}</dd>
            <dt>Última sincronização</dt><dd><span class="freshness ${fresh.cls}"><span class="dot"></span>${escapeHtml(fresh.text)}</span>${a.last_error_sanitized ? `<div class="small" style="color:var(--danger)">${escapeHtml(a.last_error_sanitized)}</div>` : ""}</dd></dl>`;
        })
        .join("");
      return `<div class="integration-card"><h4>${providerChip(p)}</h4>${rows}</div>`;
    })
    .join("");
  return `<div class="integration-cards">${cards}</div>`;
}

/** Primeira linha de KPIs da central: investimento total e por provedor, funil do CRM, receita atribuída, CAC e ROAS. */
export function primaryKpis(bi: CompanyBi, hybrid: boolean): string {
  const c = bi.current;
  const p = bi.previous;
  const prevLabel = bi.period.previousLabel;
  const spendOf = (s: PeriodSnapshot) => (s.platform.hasSpendData ? s.platform.spendCents : null);
  const prov = (k: MarketingProvider) => bi.providers.find((x) => x.provider === k);
  const provSpend = (k: MarketingProvider) => {
    const x = prov(k);
    return x && x.connected && x.platform.hasSpendData ? x.platform.spendCents : null;
  };
  const spark = (pick: (d: DailyPoint) => number | null) => bi.daily.map(pick);
  const sparkProv = (k: MarketingProvider) => bi.dailyByProvider[k].map((d) => d.spendCents);
  const provTip = (k: MarketingProvider) => (prov(k)?.connected ? `Gasto reportado por ${PROVIDER_LABELS[k]} no período, só das contas vinculadas a esta empresa.` : `${PROVIDER_LABELS[k]} não conectado — sem investimento a mostrar (nunca estimado).`);
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  return `<div class="kpi-grid">
    ${kpiCard({ label: "Investimento total", tooltip: "Soma do gasto reportado por Meta Ads e Google Ads no período.", value: money(spendOf(c)), current: spendOf(c), previous: spendOf(p), lowerIsBetter: true, spark: spark((d) => d.spendCents), previousLabel: prevLabel })}
    ${kpiCard({ label: "Investimento Meta Ads", tooltip: provTip("META"), value: money(provSpend("META")), current: provSpend("META"), previous: null, lowerIsBetter: true, spark: sparkProv("META"), sparkColor: COLORS.meta, previousLabel: prevLabel })}
    ${kpiCard({ label: "Investimento Google Ads", tooltip: provTip("GOOGLE"), value: money(provSpend("GOOGLE")), current: provSpend("GOOGLE"), previous: null, lowerIsBetter: true, spark: sparkProv("GOOGLE"), sparkColor: COLORS.google, previousLabel: prevLabel })}
    ${kpiCard({ label: "Leads", tooltip: "Contatos novos criados no CRM no período (respeita canal, campanha e atendente filtrados).", value: String(c.crm.leads), current: c.crm.leads, previous: p.crm.leads, spark: spark((d) => d.leads), previousLabel: prevLabel })}
    ${kpiCard({ label: "Leads qualificados", tooltip: "Oportunidades que entraram numa etapa marcada como 'qualificado' no período.", value: String(c.crm.qualified), current: c.crm.qualified, previous: p.crm.qualified, spark: spark((d) => d.qualified), previousLabel: prevLabel })}
    ${kpiCard({ label: "Agendamentos", tooltip: "Oportunidades com data de agendamento dentro do período.", value: String(c.crm.appointments), current: c.crm.appointments, previous: p.crm.appointments, previousLabel: prevLabel })}
    ${kpiCard({ label: "Comparecimentos", tooltip: "Oportunidades marcadas como 'compareceu' no período.", value: String(c.crm.attendances), current: c.crm.attendances, previous: p.crm.attendances, previousLabel: prevLabel })}
    ${kpiCard({ label: "Clientes novos", tooltip: "Contatos distintos com venda concluída no período.", value: String(c.crm.newCustomers), current: c.crm.newCustomers, previous: p.crm.newCustomers, spark: spark((d) => d.sales), sparkColor: COLORS.positive, previousLabel: prevLabel })}
    ${kpiCard({ label: "Receita atribuída", tooltip: "Receita das vendas de contatos atribuídos a Meta/Google (atribuição confirmada ou provável).", value: fmtBRL(c.crm.attributedRevenueCents), current: c.crm.attributedRevenueCents, previous: p.crm.attributedRevenueCents, spark: spark((d) => d.revenueCents), sparkColor: COLORS.positive, previousLabel: prevLabel, hybrid })}
    ${kpiCard({ label: "CAC", tooltip: "Investimento ÷ clientes novos no período.", value: money(c.kpis.cac), current: c.kpis.cac, previous: p.kpis.cac, lowerIsBetter: true, spark: spark((d) => d.cac), previousLabel: prevLabel, hybrid })}
    ${kpiCard({ label: "ROAS", tooltip: "Receita atribuída ÷ investimento.", value: c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, current: c.kpis.roasCrm, previous: p.kpis.roasCrm, spark: spark((d) => d.roas), previousLabel: prevLabel, hybrid })}
  </div>`;
}

const MASTER_METRICS: { key: string; label: string; pick: (d: DailyPoint) => number | null; money: boolean }[] = [
  { key: "investimento", label: "Investimento", pick: (d) => d.spendCents, money: true },
  { key: "leads", label: "Leads", pick: (d) => d.leads, money: false },
  { key: "qualificados", label: "Qualificados", pick: (d) => d.qualified, money: false },
  { key: "clientes", label: "Clientes (vendas)", pick: (d) => d.sales, money: false },
  { key: "receita", label: "Receita", pick: (d) => d.revenueCents, money: true },
  { key: "cpl", label: "CPL", pick: (d) => d.cpl, money: true },
  { key: "cac", label: "CAC", pick: (d) => d.cac, money: true },
  { key: "roas", label: "ROAS", pick: (d) => d.roas, money: false },
];

/** Campos ocultos para manter os filtros globais num formulário GET que só troca um parâmetro. */
function hiddenInputs(qs: string, except: string[]): string {
  return qs
    .replace(/^\?/, "")
    .split("&")
    .filter((kv) => kv && !except.some((k) => kv.startsWith(`${k}=`)))
    .map((kv) => {
      const [k, v] = kv.split("=");
      return `<input type="hidden" name="${escapeHtml(decodeURIComponent(k))}" value="${escapeHtml(decodeURIComponent(v ?? ""))}" />`;
    })
    .join("");
}

/** Gráfico mestre: a mesma métrica, dia a dia, Meta Ads x Google Ads (série diária por provedor do BI). */
export function masterProviderChart(bi: CompanyBi, basePath: string, qs: string, metric: string): string {
  const m = MASTER_METRICS.find((x) => x.key === metric) ?? MASTER_METRICS[0];
  const fmt = m.money ? (v: number) => fmtBRL(Math.round(v)) : m.key === "roas" ? (v: number) => `${v.toFixed(2).replace(".", ",")}x` : (v: number) => fmtNum(v);
  const ch = bi.filters.channel;
  const series: Series[] = [];
  const add = (k: MarketingProvider, color: string) => {
    if (ch === "ALL" || ch === (k === "META" ? "META_ADS" : "GOOGLE_ADS")) {
      series.push({ name: PROVIDER_LABELS[k], color, points: bi.dailyByProvider[k].map((d) => ({ label: ddmm(d.date), value: m.pick(d) })), format: fmt });
    }
  };
  add("META", COLORS.meta);
  add("GOOGLE", COLORS.google);
  const options = MASTER_METRICS.map((o) => `<option value="${o.key}" ${o.key === m.key ? "selected" : ""}>${o.label}</option>`).join("");
  const connected = bi.providers.filter((p) => p.connected).map((p) => PROVIDER_LABELS[p.provider]);
  const sub = `${bi.period.label} · diário · ${m.label}${connected.length ? ` · conectados: ${connected.join(", ")}` : " · nenhum provedor conectado"}`;
  const hasAny = series.some((s) => s.points.some((pt) => pt.value !== null));
  const chart = hasAny
    ? lineChart({ series, height: 300, ariaLabel: `Meta Ads x Google Ads — ${m.label} por dia` })
    : emptyChart("Sem dados diários de Meta Ads e Google Ads neste período. Conecte uma conta ou amplie o período.");
  const form = `<form method="get" action="${basePath}" class="actions">${hiddenInputs(qs, ["m"])}<select name="m" style="width:auto" aria-label="Métrica do gráfico">${options}</select><button type="submit" class="btn btn-small">Aplicar</button></form>`;
  return `<div class="card-block">${chartHead("Meta Ads x Google Ads", sub, form)}${chart}</div>`;
}

/** Investimento por dia: Meta Ads, Google Ads e total. */
export function investmentChart(bi: CompanyBi): string {
  const fmt = (v: number) => fmtBRL(Math.round(v));
  const pts = (arr: DailyPoint[]) => arr.map((d) => ({ label: ddmm(d.date), value: d.spendCents }));
  const series: Series[] = [
    { name: "Total", color: COLORS.accent, points: pts(bi.daily), format: fmt },
    { name: "Meta Ads", color: COLORS.meta, points: pts(bi.dailyByProvider.META), format: fmt },
    { name: "Google Ads", color: COLORS.google, points: pts(bi.dailyByProvider.GOOGLE), format: fmt },
  ];
  const any = series.some((s) => s.points.some((p) => p.value !== null));
  const total = bi.current.platform.hasSpendData ? fmtBRL(bi.current.platform.spendCents) : "—";
  return `<div class="card-block">${chartHead("Investimento por dia", `${bi.period.label} · Meta Ads, Google Ads e total · ${total} no período`)}${any ? lineChart({ series, height: 260, ariaLabel: "Investimento diário por provedor" }) : emptyChart("Sem investimento sincronizado no período.")}</div>`;
}

const CHANNEL_METRICS: { key: string; label: string; metric: "leads" | "vendas" | "receita" | "cac" | "investimento" | "qualificados" | "roas" }[] = [
  { key: "investimento", label: "Investimento", metric: "investimento" },
  { key: "leads", label: "Leads", metric: "leads" },
  { key: "qualificados", label: "Qualificados", metric: "qualificados" },
  { key: "clientes", label: "Clientes", metric: "vendas" },
  { key: "receita", label: "Receita", metric: "receita" },
  { key: "cac", label: "CAC", metric: "cac" },
  { key: "roas", label: "ROAS", metric: "roas" },
];

/** Performance por canal (Meta, Google, orgânico, indicação, outros) com métrica selecionável. */
export function channelPerformanceBlock(bi: CompanyBi, basePath: string, qs: string, metric: string): string {
  const m = CHANNEL_METRICS.find((x) => x.key === metric) ?? CHANNEL_METRICS[1];
  const options = CHANNEL_METRICS.map((o) => `<option value="${o.key}" ${o.key === m.key ? "selected" : ""}>${o.label}</option>`).join("");
  const form = `<form method="get" action="${basePath}" class="actions">${hiddenInputs(qs, ["canalMetrica"])}<select name="canalMetrica" style="width:auto" aria-label="Métrica por canal">${options}</select><button type="submit" class="btn btn-small">Aplicar</button></form>`;
  return `<div class="card-block">${chartHead("Performance por canal", `${bi.period.label} · ${m.label} por origem do contato`, form)}${channelChart(bi, m.metric)}</div>`;
}

/** Custo x qualidade por canal: CPL e CAC lado a lado, com leitura por regras. */
export function costQualityByChannelBlock(cq: ChannelCostQuality): string {
  const money = (v: number | null) => (v === null ? '<span class="na">—</span>' : fmtBRL(v));
  const pct = (v: number | null) => (v === null ? '<span class="na">—</span>' : fmtPct(v));
  const meta = cq.rows.find((r) => r.provider === "META");
  const g = cq.rows.find((r) => r.provider === "GOOGLE");
  if (!meta || !g) return '<p class="muted small">Sem dados de provedores.</p>';
  const best = (p: MarketingProvider, winner: MarketingProvider | null) => (winner === p ? ' class="best"' : "");
  const row = (label: string, fm: string, fg: string, winner: MarketingProvider | null = null) => `<tr><td>${label}</td><td${best("META", winner)}>${fm}</td><td${best("GOOGLE", winner)}>${fg}</td></tr>`;
  const th = (r: ChannelCostQualityRow) => `${escapeHtml(r.label)}${r.connected ? "" : ' <span class="chip chip-muted chip-xs">não conectado</span>'}`;
  const table = `<div class="data-table-wrap"><table class="compare-table"><thead><tr><th>Métrica</th><th>${th(meta)}</th><th>${th(g)}</th></tr></thead><tbody>
    ${row("Investimento", money(meta.spendCents), money(g.spendCents))}
    ${row("Leads", String(meta.leads), String(g.leads))}
    ${row("CPL (custo por lead)", money(meta.cpl), money(g.cpl), cq.cheapestLead)}
    ${row("Taxa de qualificação", pct(meta.qualificationRate), pct(g.qualificationRate))}
    ${row("Clientes novos", String(meta.customers), String(g.customers))}
    ${row("CAC (custo por cliente)", money(meta.cac), money(g.cac), cq.cheapestCustomer)}
    ${row("Taxa de fechamento", pct(meta.closeRate), pct(g.closeRate), cq.bestQuality)}
  </tbody></table></div>`;
  const facts = cq.facts.length ? `<ul class="fact-list">${cq.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : '<p class="small muted">Sem investimento suficiente nos dois canais para comparar custo e qualidade.</p>';
  return `<div class="card-block">${chartHead("Custo x qualidade por canal", "Qual canal traz lead mais barato, cliente mais barato e leads de mais qualidade? Leia CPL e CAC juntos — um canal pode ter CPL maior e ainda assim ser mais lucrativo.")}<div class="grid-12"><div class="col-7">${table}</div><div class="col-5"><div class="eyebrow" style="margin-bottom:8px">Leitura por regras (só números do período)</div>${facts}</div></div></div>`;
}

/** Estado vazio de um provedor não conectado — a área existe sempre; a chamada para ação depende do papel. */
export function providerEmptyState(provider: MarketingProvider, companyName: string, role: Role, isPlatformAdmin: boolean): string {
  const label = PROVIDER_LABELS[provider];
  const cta = isPlatformAdmin
    ? `<a class="btn btn-primary" href="/admin/integracoes">Configurar integração</a>`
    : role === "COMPANY_ADMIN"
      ? `<span class="muted">Entre em contato com a Hub Action.</span>`
      : `<span class="muted">Peça ao administrador da empresa.</span>`;
  return `<div class="empty-state">
    <span class="es-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg></span>
    <h2>${escapeHtml(label)} ainda não conectado</h2>
    <p>A integração com ${escapeHtml(label)} ainda não foi configurada para esta empresa. Nenhuma conta ${escapeHtml(label)} está vinculada à ${escapeHtml(companyName)}. Assim que a conta for vinculada, investimento, campanhas, CPL, CAC e ROAS deste canal passam a aparecer aqui automaticamente — nada é estimado até lá.</p>
    <div class="actions">${cta}</div>
  </div>`;
}

/** KPIs específicos de cada provedor (só o que ele reporta; "—" quando não fornecido). */
export function providerKpis(bi: CompanyBi, provider: MarketingProvider, hybrid: boolean): string {
  const c = bi.current;
  const p = bi.previous;
  const prevLabel = bi.period.previousLabel;
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const num = (v: number | null) => (v === null ? "—" : fmtNum(v));
  const spend = c.platform.hasSpendData ? c.platform.spendCents : null;
  const prevSpend = p.platform.hasSpendData ? p.platform.spendCents : null;
  const card = (label: string, tooltip: string, value: string, current: number | null, previous: number | null, extra: { lowerIsBetter?: boolean; hybrid?: boolean } = {}) =>
    kpiCard({ label, tooltip, value, current, previous, previousLabel: prevLabel, ...extra });
  const common = [
    card("Investimento", "Gasto reportado pela plataforma no período.", money(spend), spend, prevSpend, { lowerIsBetter: true }),
    card("Impressões", "Vezes que o anúncio foi exibido (plataforma).", num(c.platform.impressions), c.platform.impressions, p.platform.impressions),
  ];
  const meta = [
    card("Alcance", "Pessoas distintas alcançadas (Meta). Soma dos dias — pode contar a mesma pessoa mais de uma vez.", num(c.platform.reach), c.platform.reach, p.platform.reach),
    card("Frequência", "Impressões ÷ alcance (Meta).", num(c.platform.frequency), c.platform.frequency, p.platform.frequency, { lowerIsBetter: true }),
    card("Cliques", "Cliques reportados pela plataforma.", num(c.platform.clicks), c.platform.clicks, p.platform.clicks),
    card("CTR", "Cliques ÷ impressões.", fmtPct(c.platform.ctr, 2), c.platform.ctr, p.platform.ctr),
    card("CPC", "Investimento ÷ cliques.", money(c.platform.cpc), c.platform.cpc, p.platform.cpc, { lowerIsBetter: true }),
    card("CPM", "Investimento por mil impressões.", money(c.platform.cpm), c.platform.cpm, p.platform.cpm, { lowerIsBetter: true }),
    card("Conversas", "Conversas iniciadas reportadas pela Meta (ação do anúncio).", num(c.platform.platformConversations), c.platform.platformConversations, p.platform.platformConversations),
    card("Leads", "Contatos no CRM atribuídos a Meta Ads.", String(c.crm.leads), c.crm.leads, p.crm.leads),
    card("CPL", "Investimento ÷ leads do CRM.", money(c.kpis.cpl), c.kpis.cpl, p.kpis.cpl, { lowerIsBetter: true, hybrid }),
    card("Qualificados", "Leads qualificados no CRM (atribuídos).", String(c.crm.qualified), c.crm.qualified, p.crm.qualified),
    card("CAC", "Investimento ÷ clientes novos.", money(c.kpis.cac), c.kpis.cac, p.kpis.cac, { lowerIsBetter: true, hybrid }),
    card("Clientes novos", "Contatos com venda concluída (atribuídos).", String(c.crm.newCustomers), c.crm.newCustomers, p.crm.newCustomers),
    card("Receita atribuída", "Receita das vendas atribuídas a Meta Ads.", fmtBRL(c.crm.attributedRevenueCents), c.crm.attributedRevenueCents, p.crm.attributedRevenueCents, { hybrid }),
    card("ROAS", "Receita atribuída ÷ investimento.", c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, c.kpis.roasCrm, p.kpis.roasCrm, { hybrid }),
  ];
  const google = [
    card("Cliques", "Cliques reportados pela plataforma.", num(c.platform.clicks), c.platform.clicks, p.platform.clicks),
    card("CTR", "Cliques ÷ impressões.", fmtPct(c.platform.ctr, 2), c.platform.ctr, p.platform.ctr),
    card("CPC médio", "Investimento ÷ cliques.", money(c.platform.cpc), c.platform.cpc, p.platform.cpc, { lowerIsBetter: true }),
    card("Conversões", "Conversões reportadas pelo Google Ads (definição da plataforma, não do CRM).", num(c.platform.platformConversions), c.platform.platformConversions, p.platform.platformConversions),
    card("Taxa de conversão", "Conversões da plataforma ÷ cliques.", fmtPct(c.kpis.platformConversionRate, 2), c.kpis.platformConversionRate, p.kpis.platformConversionRate),
    card("Custo por conversão", "Investimento ÷ conversões da plataforma.", money(c.kpis.costPerPlatformConversion), c.kpis.costPerPlatformConversion, p.kpis.costPerPlatformConversion, { lowerIsBetter: true }),
    card("Leads CRM", "Contatos no CRM atribuídos a Google Ads.", String(c.crm.leads), c.crm.leads, p.crm.leads),
    card("Qualificados", "Leads qualificados no CRM (atribuídos).", String(c.crm.qualified), c.crm.qualified, p.crm.qualified),
    card("CAC", "Investimento ÷ clientes novos.", money(c.kpis.cac), c.kpis.cac, p.kpis.cac, { lowerIsBetter: true, hybrid }),
    card("Clientes novos", "Contatos com venda concluída (atribuídos).", String(c.crm.newCustomers), c.crm.newCustomers, p.crm.newCustomers),
    card("Receita atribuída", "Receita das vendas atribuídas a Google Ads.", fmtBRL(c.crm.attributedRevenueCents), c.crm.attributedRevenueCents, p.crm.attributedRevenueCents, { hybrid }),
    card("ROAS", "Receita atribuída ÷ investimento.", c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, c.kpis.roasCrm, p.kpis.roasCrm, { hybrid }),
  ];
  return `<div class="kpi-grid">${[...common, ...(provider === "META" ? meta : google)].join("")}</div>`;
}

/** Atalhos do funil: Todos os canais | Meta Ads | Google Ads (mesmo filtro global de canal). */
export function channelQuickLinks(basePath: string, bi: CompanyBi): string {
  const link = (value: string | null, label: string) => {
    const active = value === null ? bi.filters.channel === "ALL" : bi.filters.channel === value;
    return `<a href="${basePath}${queryString(bi.period, bi.filters, { canal: value })}" class="${active ? "active" : ""}">${label}</a>`;
  };
  return `<div class="seg-links">${link(null, "Todos os canais")}${link("META_ADS", "Meta Ads")}${link("GOOGLE_ADS", "Google Ads")}</div>`;
}

// --- v3: blocos premium (ranking, radar, heatmap, criativos, metas, saúde, comparação de períodos) --------

/** Nota de "estrutura pronta, dado ainda não sincronizado" — nunca um número inventado. */
export function prepNote(text: string): string {
  return `<div class="prep-note">${escapeHtml(text)}</div>`;
}

/** Lista ranqueada com barra proporcional — usada para atendentes, campanhas, anúncios. */
export function rankList(items: { name: string; value: number; label: string; sub?: string; href?: string }[], color = COLORS.accent, emptyText = "Sem dados neste período."): string {
  const rows = items.filter((i) => i.value > 0);
  if (rows.length === 0) return `<p class="muted small">${escapeHtml(emptyText)}</p>`;
  const max = Math.max(...rows.map((i) => i.value));
  return `<ol class="rank-list">${rows
    .map((it, i) => `<li><span class="pos">${i + 1}</span><span class="name" title="${escapeHtml(it.name)}">${it.href ? `<a href="${escapeHtml(it.href)}">${escapeHtml(it.name)}</a>` : escapeHtml(it.name)}</span><span class="bar"><span style="width:${((it.value / max) * 100).toFixed(1)}%;background:${color}"></span></span><span class="val">${escapeHtml(it.label)}</span>${it.sub ? `<span class="sub">${escapeHtml(it.sub)}</span>` : ""}</li>`)
    .join("")}</ol>`;
}

/** Campanhas com melhor e pior desempenho (regras explícitas: clientes/ROAS para melhor; investimento sem lead ou CPL acima da média para pior). */
export function bestWorstCampaigns(rows: CampaignRow[], companyId: number, qs: string): { best: string; worst: string } {
  const href = (r: CampaignRow) => `/empresa/${companyId}/marketing/campanhas/${r.campaign.id}${qs}`;
  const best = [...rows]
    .filter((r) => r.crm.newCustomers > 0 || r.crm.leads > 0)
    .sort((a, b) => b.crm.newCustomers - a.crm.newCustomers || (b.kpis.roasCrm ?? 0) - (a.kpis.roasCrm ?? 0) || b.crm.leads - a.crm.leads)
    .slice(0, 5)
    .map((r) => ({ name: r.campaign.name, value: r.crm.newCustomers > 0 ? r.crm.newCustomers : r.crm.leads, label: r.crm.newCustomers > 0 ? `${r.crm.newCustomers} cliente(s)` : `${r.crm.leads} lead(s)`, sub: r.kpis.cac !== null ? `CAC ${fmtBRL(r.kpis.cac)}` : r.kpis.cpl !== null ? `CPL ${fmtBRL(r.kpis.cpl)}` : undefined, href: href(r) }));
  const avgCpl = (() => {
    const c = rows.filter((r) => r.kpis.cpl !== null);
    return c.length ? c.reduce((s, r) => s + (r.kpis.cpl as number), 0) / c.length : null;
  })();
  const worst = [...rows]
    .filter((r) => r.platform.hasSpendData && r.platform.spendCents > 0 && (r.crm.leads === 0 || (avgCpl !== null && (r.kpis.cpl ?? 0) > avgCpl * 1.3)))
    .sort((a, b) => (b.crm.leads === 0 ? b.platform.spendCents : b.kpis.cpl ?? 0) - (a.crm.leads === 0 ? a.platform.spendCents : a.kpis.cpl ?? 0))
    .slice(0, 5)
    .map((r) => ({ name: r.campaign.name, value: r.crm.leads === 0 ? r.platform.spendCents : (r.kpis.cpl as number), label: r.crm.leads === 0 ? `${fmtBRL(r.platform.spendCents)} sem lead` : `CPL ${fmtBRL(r.kpis.cpl)}`, sub: r.crm.leads === 0 ? "0 leads" : `${r.crm.leads} lead(s)`, href: href(r) }));
  return {
    best: rankList(best, COLORS.positive, "Nenhuma campanha com lead ou cliente no período."),
    worst: rankList(worst, COLORS.danger, avgCpl === null ? "Sem investimento no período para apontar desperdício." : "Nenhuma campanha gastando sem lead nem com CPL 30% acima da média — bom sinal."),
  };
}

/** Radar Meta x Google sobre taxas comparáveis (cada eixo normalizado pelo maior valor entre os dois provedores). */
export function providerRadar(bi: CompanyBi): string {
  const meta = bi.providers.find((p) => p.provider === "META");
  const g = bi.providers.find((p) => p.provider === "GOOGLE");
  if (!meta || !g) return "";
  const totalLeads = meta.crm.leads + g.crm.leads;
  const axes = ["CTR", "Qualificação", "Agendamento", "Fechamento", "Participação nos leads"];
  const raw = (p: ProviderComparison) => [p.connected ? p.platform.ctr : null, p.kpis.qualificationRate, p.kpis.appointmentRate, p.kpis.closeRate, totalLeads > 0 ? p.crm.leads / totalLeads : null];
  const rm = raw(meta);
  const rg = raw(g);
  const norm = (i: number, v: number | null) => {
    if (v === null) return null;
    const m = Math.max(rm[i] ?? 0, rg[i] ?? 0);
    return m > 0 ? v / m : 0;
  };
  return radarChart({
    axes,
    series: [
      { name: "Meta Ads", color: COLORS.meta, values: rm.map((v, i) => norm(i, v)) },
      { name: "Google Ads", color: COLORS.google, values: rg.map((v, i) => norm(i, v)) },
    ],
    ariaLabel: "Radar de performance Meta Ads x Google Ads",
    note: "cada eixo = valor ÷ maior valor entre os dois provedores (100% = o melhor dos dois)",
  });
}

/** Horário de ouro — conversas reais por dia da semana × hora. */
export function heatmapBlock(bi: CompanyBi): string {
  const h = bi.heatmap;
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const cols = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const chart = heatmapChart({ rows: days, cols, values: h.cells, format: (v) => `${fmtNum(v)} conversa(s)`, ariaLabel: "Conversas por dia da semana e hora", emptyMessage: "Sem conversas no período para desenhar o horário de ouro." });
  const best = h.bestHour === null ? "" : `<div class="status-item" style="margin-top:10px"><div class="k">Seu melhor horário</div><div class="v">${h.bestHour}h – ${(h.bestHour + 1) % 24}h <span class="muted small">· ${fmtPct(h.bestShare)} das conversas</span></div></div>`;
  return `${chart}${best}`;
}

/** Cartão de criativo (anúncio): prévia por iniciais (imagem não sincronizada), provedor, campanha, resultados reais do CRM. */
export function creativeCard(c: CreativeRow, companyId: number, qs: string): string {
  const initials = c.ad.name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const status = (c.ad.status ?? "").toUpperCase();
  const chip = status === "ACTIVE" || status === "ENABLED" ? '<span class="chip chip-ok chip-xs">Ativo</span>' : status === "PAUSED" ? '<span class="chip chip-warn chip-xs">Pausado</span>' : status ? `<span class="chip chip-muted chip-xs">${escapeHtml(status.toLowerCase())}</span>` : "";
  return `<div class="creative-card">
    <div class="creative-preview">${chip}<span class="initials">${escapeHtml(initials || "AD")}</span><span>prévia não sincronizada</span></div>
    <div class="creative-body">
      <h4 title="${escapeHtml(c.ad.name)}">${escapeHtml(c.ad.name)}</h4>
      <div class="small muted" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${providerChip(c.ad.provider)}<a href="/empresa/${companyId}/marketing/campanhas/${c.ad.campaign_id}${qs}" class="muted">${escapeHtml(c.campaignName)}</a></div>
      <div class="creative-stats">
        <div>Leads<b>${c.leads}</b></div>
        <div>Clientes<b>${c.customers}</b></div>
        <div>Receita<b>${fmtBRL(c.revenueCents)}</b></div>
        <div>Investimento<b>${c.hasMediaData ? fmtBRL(c.platform.spendCents) : "—"}</b></div>
        <div>CTR<b>${c.hasMediaData ? fmtPct(c.platform.ctr, 2) : "—"}</b></div>
        <div>CPL<b>${c.hasMediaData ? money(c.cpl) : "—"}</b></div>
      </div>
    </div>
  </div>`;
}

/** Cartão de meta: valor, alvo, progresso, faltante, ritmo necessário e projeção. */
export function goalCard(item: GoalProgress, daysRemaining: number): string {
  const f = (n: number | null) => (n === null ? "—" : item.isCurrency ? fmtBRL(Math.round(n)) : fmtNum(Math.round(n)));
  const pct = item.attainment;
  const gapCls = item.projectedGap === null ? "" : item.projectedGap >= 0 ? "chip-ok" : "chip-warn";
  return `<div class="goal-card">
    <div class="goal-head"><span class="eyebrow">${escapeHtml(item.label)}</span>${pct !== null ? `<span class="chip ${pct >= 1 ? "chip-ok" : pct >= 0.6 ? "chip-warn" : "chip-bad"} chip-xs">${fmtPct(pct, 0)} atingido</span>` : '<span class="chip chip-muted chip-xs">sem meta</span>'}</div>
    <div class="goal-value">${f(item.actual)}</div>
    <div class="goal-target">${item.goal === null ? "Defina a meta abaixo para acompanhar." : `meta ${f(item.goal)}`}</div>
    ${progressBar(pct)}
    <div class="goal-meta">
      <span>Faltam <b>${f(item.remaining)}</b></span>
      <span>Ritmo necessário <b>${item.neededPerDay === null ? "—" : `${f(item.neededPerDay)}/dia`}</b></span>
      <span>Projeção do mês <b>${f(item.projected)}</b></span>
      <span>Vs meta ${item.projectedGap === null ? "<b>—</b>" : `<span class="chip ${gapCls} chip-xs">${item.projectedGap >= 0 ? "+" : ""}${f(item.projectedGap)}</span>`}</span>
    </div>
    ${daysRemaining >= 0 ? "" : ""}
  </div>`;
}

/** Comparação de períodos (atual x anterior) — mesmas fórmulas do relatório. */
export function periodComparisonTable(bi: CompanyBi): string {
  const c = bi.current;
  const p = bi.previous;
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const rows: [string, string, string, number | null][] = [
    ["Investimento", c.platform.hasSpendData ? fmtBRL(c.platform.spendCents) : "—", p.platform.hasSpendData ? fmtBRL(p.platform.spendCents) : "—", deltaPercent(c.platform.hasSpendData ? c.platform.spendCents : null, p.platform.hasSpendData ? p.platform.spendCents : null)],
    ["Impressões", c.platform.impressions === null ? "—" : fmtNum(c.platform.impressions), p.platform.impressions === null ? "—" : fmtNum(p.platform.impressions), deltaPercent(c.platform.impressions, p.platform.impressions)],
    ["Cliques", c.platform.clicks === null ? "—" : fmtNum(c.platform.clicks), p.platform.clicks === null ? "—" : fmtNum(p.platform.clicks), deltaPercent(c.platform.clicks, p.platform.clicks)],
    ["CTR", fmtPct(c.platform.ctr, 2), fmtPct(p.platform.ctr, 2), deltaPercent(c.platform.ctr, p.platform.ctr)],
    ["Leads", String(c.crm.leads), String(p.crm.leads), deltaPercent(c.crm.leads, p.crm.leads)],
    ["Qualificados", String(c.crm.qualified), String(p.crm.qualified), deltaPercent(c.crm.qualified, p.crm.qualified)],
    ["Clientes novos", String(c.crm.newCustomers), String(p.crm.newCustomers), deltaPercent(c.crm.newCustomers, p.crm.newCustomers)],
    ["Receita atribuída", fmtBRL(c.crm.attributedRevenueCents), fmtBRL(p.crm.attributedRevenueCents), deltaPercent(c.crm.attributedRevenueCents, p.crm.attributedRevenueCents)],
    ["CPL", money(c.kpis.cpl), money(p.kpis.cpl), deltaPercent(c.kpis.cpl, p.kpis.cpl)],
    ["CAC", money(c.kpis.cac), money(p.kpis.cac), deltaPercent(c.kpis.cac, p.kpis.cac)],
    ["ROAS", c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, p.kpis.roasCrm === null ? "—" : `${fmtNum(p.kpis.roasCrm)}x`, deltaPercent(c.kpis.roasCrm, p.kpis.roasCrm)],
  ];
  return `<div class="data-table-wrap"><table class="compare-table"><thead><tr><th>Métrica</th><th>${escapeHtml(bi.period.label)}</th><th>${escapeHtml(bi.period.previousLabel)}</th><th>Variação</th></tr></thead><tbody>${rows
    .map(([l, a, b, d]) => `<tr><td>${l}</td><td>${a}</td><td>${b}</td><td class="${d === null ? "na" : ""}">${fmtDelta(d)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

/** Saúde da conta de um provedor: conta, status da conexão, sincronização, alertas — só fatos. */
export function providerHealthGrid(accounts: MarketingAccountWithConnection[], provider: MarketingProvider, freshnessAt: string | null, attention: AttentionItem[], period: string): string {
  const mine = accounts.filter((a) => a.provider === provider);
  const fresh = freshnessLabel(freshnessAt);
  const alerts = attention.filter((a) => a.channel === provider || (a.channel === "INTEGRACAO" && a.fact.startsWith(PROVIDER_LABELS[provider])));
  const critical = alerts.filter((a) => a.severity === "CRITICO").length;
  const status = mine.length === 0 ? '<span class="chip chip-muted">Não conectado</span>' : mine.every((a) => a.connection_status === "CONECTADA") ? '<span class="chip chip-ok">Conectado</span>' : '<span class="chip chip-bad">Reconexão necessária</span>';
  const sync = mine.length === 0 ? "—" : mine.every((a) => a.sync_enabled) ? '<span class="chip chip-ok chip-xs">ativa</span>' : '<span class="chip chip-warn chip-xs">desligada em alguma conta</span>';
  return `<div class="status-grid">
    <div class="status-item"><div class="k">Conta conectada</div><div class="v">${mine.length ? mine.map((a) => escapeHtml(a.name ?? a.external_account_id)).join(", ") : "—"}</div></div>
    <div class="status-item"><div class="k">Status da conta</div><div class="v">${status}</div></div>
    <div class="status-item"><div class="k">Sincronização</div><div class="v">${sync} <span class="freshness ${fresh.cls}"><span class="dot"></span>${escapeHtml(fresh.text)}</span></div></div>
    <div class="status-item"><div class="k">Período analisado</div><div class="v">${escapeHtml(period)}${alerts.length ? ` <span class="chip ${critical ? "chip-bad" : "chip-warn"} chip-xs">${alerts.length} alerta(s)</span>` : ' <span class="chip chip-ok chip-xs">sem alertas</span>'}</div></div>
  </div>`;
}

/** Metas do mês em versão compacta (para visão geral e dashboard). */
export function goalsMini(projection: MonthProjection | null, companyId: number): string {
  if (!projection) return "";
  const items = projection.items.filter((i) => i.goal !== null).slice(0, 4);
  if (items.length === 0) return `<p class="muted small">Nenhuma meta definida. <a href="/empresa/${companyId}/marketing/metas">Definir metas do mês →</a></p>`;
  return `<div class="goal-cards" style="grid-template-columns:repeat(${Math.min(4, items.length)},minmax(0,1fr))">${items.map((i) => goalCard(i, projection.daysRemaining)).join("")}</div>`;
}

/**
 * Blocos consolidados de mídia para o Dashboard geral da empresa (Meta + Google + CRM). Renderizado pelo
 * servidor só para quem pode ver marketing; os blocos operacionais do dashboard continuam abaixo.
 */
export function dashboardMarketingBlocks(bi: CompanyBi, funnel: FunnelStage[], accounts: MarketingAccountWithConnection[], projection: MonthProjection | null, role: Role, isPlatformAdmin: boolean, provenance: DataProvenance, companyId: number, ops: { waitingNow: number; avgFirstResponseMinutes: number | null; withinSlaPercent: number | null; slaTargetMinutes: number; opportunitiesCreated: number }): string {
  const c = bi.current;
  const p = bi.previous;
  const prev = bi.period.previousLabel;
  const hybrid = isHybrid(provenance);
  const qs = queryString(bi.period, bi.filters);
  const spark = (pick: (d: DailyPoint) => number | null) => bi.daily.map(pick);
  const spendOf = (s: PeriodSnapshot) => (s.platform.hasSpendData ? s.platform.spendCents : null);
  const prov = (k: MarketingProvider) => bi.providers.find((x) => x.provider === k);
  const provSpend = (k: MarketingProvider) => {
    const x = prov(k);
    return x && x.connected && x.platform.hasSpendData ? x.platform.spendCents : null;
  };
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const card = (label: string, tooltip: string, value: string, cur: number | null, prevV: number | null, extra: Partial<Parameters<typeof kpiCard>[0]> = {}) =>
    kpiCard({ label, tooltip, value, current: cur, previous: prevV, previousLabel: prev, ...extra });
  const funnelConv = ratio(c.crm.newCustomers, c.crm.leads);
  const prevFunnelConv = ratio(p.crm.newCustomers, p.crm.leads);
  const kpis = `<div class="kpi-grid">
    ${card("Investimento total", "Meta Ads + Google Ads no período.", money(spendOf(c)), spendOf(c), spendOf(p), { lowerIsBetter: true, spark: spark((d) => d.spendCents), bars: true, hero: true })}
    ${card("Investimento Meta", prov("META")?.connected ? "Gasto reportado pela Meta." : "Meta Ads não conectado.", money(provSpend("META")), provSpend("META"), null, { lowerIsBetter: true, spark: bi.dailyByProvider.META.map((d) => d.spendCents), sparkColor: COLORS.meta, bars: true })}
    ${card("Investimento Google", prov("GOOGLE")?.connected ? "Gasto reportado pelo Google." : "Google Ads não conectado.", money(provSpend("GOOGLE")), provSpend("GOOGLE"), null, { lowerIsBetter: true, spark: bi.dailyByProvider.GOOGLE.map((d) => d.spendCents), sparkColor: COLORS.google, bars: true })}
    ${card("Leads gerados", "Contatos novos no CRM.", String(c.crm.leads), c.crm.leads, p.crm.leads, { spark: spark((d) => d.leads), sparkColor: COLORS.purple, bars: true })}
    ${card("Leads qualificados", "Oportunidades que chegaram a uma etapa 'qualificado'.", String(c.crm.qualified), c.crm.qualified, p.crm.qualified, { spark: spark((d) => d.qualified), sparkColor: COLORS.purple, bars: true })}
    ${card("Agendamentos", "Oportunidades com agendamento no período.", String(c.crm.appointments), c.crm.appointments, p.crm.appointments)}
    ${card("Comparecimentos", "Oportunidades marcadas como 'compareceu'.", String(c.crm.attendances), c.crm.attendances, p.crm.attendances)}
    ${card("Clientes gerados", "Contatos distintos com venda concluída.", String(c.crm.newCustomers), c.crm.newCustomers, p.crm.newCustomers, { spark: spark((d) => d.sales), sparkColor: COLORS.positive, bars: true })}
    ${card("Receita atribuída", "Receita das vendas de contatos atribuídos a anúncios.", fmtBRL(c.crm.attributedRevenueCents), c.crm.attributedRevenueCents, p.crm.attributedRevenueCents, { spark: spark((d) => d.revenueCents), sparkColor: COLORS.positive, bars: true, hybrid })}
    ${card("CAC", "Investimento ÷ clientes novos.", money(c.kpis.cac), c.kpis.cac, p.kpis.cac, { lowerIsBetter: true, hybrid })}
    ${card("CPL", "Investimento ÷ leads.", money(c.kpis.cpl), c.kpis.cpl, p.kpis.cpl, { lowerIsBetter: true, hybrid })}
    ${card("ROAS", "Receita atribuída ÷ investimento.", c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, c.kpis.roasCrm, p.kpis.roasCrm, { spark: spark((d) => d.roas), bars: true, hybrid })}
    ${card("Conversão do funil", "Clientes novos ÷ leads no período.", fmtPct(funnelConv, 1), funnelConv, prevFunnelConv, { secondary: true })}
    ${card("Tempo médio de resposta", "Média da 1ª resposta humana (atendimentos concluídos no período).", ops.avgFirstResponseMinutes === null ? "—" : formatDuration(ops.avgFirstResponseMinutes * 60000), null, null, { secondary: true })}
    ${card("Aguardando humano", "Conversas com espera aberta agora (não filtra por período).", String(ops.waitingNow), null, null, { secondary: true })}
    ${card("Oportunidades criadas", "Oportunidades abertas no CRM no período.", String(ops.opportunitiesCreated), null, null, { secondary: true })}
  </div>`;
  const attendants = rankList(
    bi.attendants.map((a) => ({ name: a.name, value: a.leads, label: `${a.leads} leads`, sub: a.sales ? `${a.sales} venda(s)` : undefined })).sort((a, b) => b.value - a.value).slice(0, 6),
    COLORS.accent,
    "Sem leads por atendente no período."
  );
  const withinSla = ops.withinSlaPercent;
  const donut = withinSla === null
    ? emptyChart("Sem atendimentos concluídos no período.")
    : donutChart({ items: [{ label: "No prazo", value: Math.round(withinSla), color: COLORS.positive }, { label: "Fora do prazo", value: Math.round(100 - withinSla), color: COLORS.grid === "#232330" ? "#3a3a4a" : COLORS.muted }], format: (v) => `${fmtNum(v)}%`, centerLabel: "no prazo", ariaLabel: "1ª resposta dentro do prazo" });
  const bestWorst = bestWorstCampaigns(bi.campaigns, companyId, qs);
  return `${provenanceStrip(provenance, bi.providers)}
    ${kpis}
    <div class="grid-12">
      <div class="col-7">${masterProviderChart(bi, `/empresa/${companyId}/dashboard`, qs, "investimento")}</div>
      <div class="col-5"><div class="card-block">${chartHead("Funil de aquisição", "do anúncio à venda", `<a class="small" href="/empresa/${companyId}/marketing/funil${qs}">Ver detalhes →</a>`)}${funnelBlock(funnel, companyId, qs)}</div></div>
    </div>
    <div class="grid-12">
      <div class="col-4"><div class="card-block">${chartHead("Leads por atendente", bi.period.label, `<a class="small" href="/empresa/${companyId}/inteligencia">Ver todos →</a>`)}${attendants}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Horário de ouro", "conversas por dia da semana × hora")}${heatmapBlock(bi)}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Conversas e atendimento", `meta de 1ª resposta: ${ops.slaTargetMinutes} min`, `<a class="small" href="/empresa/${companyId}/conversas">Ver conversas →</a>`)}${donut}
        <div class="status-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:12px"><div class="status-item"><div class="k">Conversas</div><div class="v">${c.crm.conversations}</div></div><div class="status-item"><div class="k">Aguardando humano</div><div class="v" style="color:${ops.waitingNow ? "var(--accent)" : "inherit"}">${ops.waitingNow}</div></div><div class="status-item"><div class="k">1ª resposta (média)</div><div class="v">${ops.avgFirstResponseMinutes === null ? "—" : formatDuration(ops.avgFirstResponseMinutes * 60000)}</div></div></div></div></div>
    </div>
    <div class="grid-12">
      <div class="col-4"><div class="card-block">${chartHead("Contas conectadas", "status por provedor", isPlatformAdmin ? `<a class="small" href="/admin/integracoes">Gerenciar →</a>` : "")}${integrationsBlock(accounts, "", role, isPlatformAdmin).replace('class="integration-cards"', 'class="integration-cards" style="grid-template-columns:1fr"')}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Por origem", "leads por canal de origem")}${channelChart(bi, "leads")}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Campanhas com melhor desempenho", "clientes gerados; desempate por ROAS")}${bestWorst.best}</div></div>
    </div>
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Campanhas que pedem atenção", "investimento sem lead ou CPL 30% acima da média")}${bestWorst.worst}</div></div>
      <div class="col-6"><div class="card-block">${chartHead("Metas do mês", projection ? `dia ${projection.daysElapsed} de ${projection.daysInMonth}` : "", `<a class="small" href="/empresa/${companyId}/marketing/metas">Gerenciar →</a>`)}${goalsMini(projection, companyId).replace("grid-template-columns:repeat(4,minmax(0,1fr))", "grid-template-columns:repeat(2,minmax(0,1fr))")}</div></div>
    </div>
    <div class="card-block">${chartHead("Campanhas em destaque", `${bi.period.label} · maiores por investimento`, `<a class="btn btn-small" href="/empresa/${companyId}/marketing/campanhas${qs}">Ver todas →</a>`)}${campaignsTable(bi.campaigns.slice(0, 6), companyId, qs, "America/Sao_Paulo", null)}</div>`;
}

// --- Página: Metas ----------------------------------------------------------------------

export function goalsPage(base: MarketingPageBase, goals: CompanyGoals | null, projection: MonthProjection, notice?: string, error?: string): string {
  const { company } = base;
  const canEdit = base.role === "COMPANY_ADMIN";
  const gauge = (item: GoalProgress) => {
    const pct = item.attainment === null ? null : Math.min(100, item.attainment * 100);
    const color = pct === null ? COLORS.neutral : pct >= 100 ? COLORS.positive : pct >= 60 ? COLORS.accent : COLORS.warning;
    return `<div class="card-block" style="text-align:center">${chartHead(item.label, item.goal === null ? "sem meta definida" : `meta ${item.isCurrency ? fmtBRL(item.goal) : fmtNum(item.goal)}`)}${gaugeChart({ value: pct, max: 100, color, statusLabel: pct === null ? "sem meta" : `${pct.toFixed(0)}% atingido`, ariaLabel: `${item.label}: ${pct === null ? "sem meta" : `${pct.toFixed(0)}% da meta`}` })}<div class="small muted">realizado ${item.isCurrency ? fmtBRL(Math.round(item.actual)) : fmtNum(item.actual)}${item.projected !== null ? ` · projeção ${item.isCurrency ? fmtBRL(Math.round(item.projected)) : fmtNum(Math.round(item.projected))}` : ""}</div></div>`;
  };
  const gauges = projection.items.slice(0, 3).map(gauge).join("");
  const cards = projection.items.map((i) => goalCard(i, projection.daysRemaining)).join("");
  const c = base.bi.current;
  const cplGoal = goals?.max_cpl_cents ?? null;
  const cacGoal = goals?.max_cac_cents ?? null;
  const roasGoal = goals?.min_roas ?? null;
  const limitRow = (label: string, actual: number | null, goal: number | null, fmt: (v: number) => string, lowerIsBetter: boolean) => {
    const ok = actual === null || goal === null ? null : lowerIsBetter ? actual <= goal : actual >= goal;
    return `<div class="status-item"><div class="k">${escapeHtml(label)}</div><div class="v">${actual === null ? "—" : fmt(actual)} <span class="muted small">/ ${goal === null ? "sem limite" : `${lowerIsBetter ? "máx." : "mín."} ${fmt(goal)}`}</span>${ok === null ? "" : `<span class="chip ${ok ? "chip-ok" : "chip-bad"} chip-xs">${ok ? "dentro" : "fora"}</span>`}</div></div>`;
  };
  const body = `${pageHead(`Metas — ${company.name}`, `Mês atual · dia ${projection.daysElapsed} de ${projection.daysInMonth} · ${projection.daysRemaining} dia(s) restantes · projeção linear (ritmo diário atual × dias do mês)`)}
    ${notice ? `<p class="success">${escapeHtml(notice)}</p>` : ""}${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    ${projection.headline ? `<div class="exec-summary" style="margin-bottom:16px">${escapeHtml(projection.headline)}</div>` : ""}
    <div class="grid-12"><div class="col-4">${gauges.split("</div><div class=\"card-block\"").join("</div></div><div class=\"col-4\"><div class=\"card-block\"")}</div></div>
    <div class="card-block">${chartHead("Meta x realizado", "progresso, faltante, ritmo necessário e projeção até o fim do mês")}<div class="goal-cards">${cards}</div></div>
    <div class="card-block">${chartHead("Limites de eficiência", "CPL, CAC e ROAS do mês contra os limites definidos")}<div class="status-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${limitRow("CPL", c.kpis.cpl, cplGoal, (v) => fmtBRL(v), true)}${limitRow("CAC", c.kpis.cac, cacGoal, (v) => fmtBRL(v), true)}${limitRow("ROAS", c.kpis.roasCrm, roasGoal, (v) => `${fmtNum(v)}x`, false)}
    </div></div>
    <div class="card-block">${chartHead("Definir metas do mês", canEdit ? "salvas por empresa; valem para o mês corrente" : "somente o administrador da empresa edita")}${goalsForm(company.id, goals, canEdit)}</div>`;
  return shellFor(base, "marketing/metas", body);
}

// --- Página: Conteúdo / Criativos ---------------------------------------------------------

export function creativesPage(base: MarketingPageBase): string {
  const { company, bi } = base;
  const qs = queryString(bi.period, bi.filters);
  const basePath = `/empresa/${company.id}/marketing/criativos`;
  const creatives = bi.creatives;
  const withMedia = creatives.filter((c) => c.hasMediaData);
  const head = `${pageHead(`Conteúdo / Criativos — ${company.name}`, `${bi.period.label} · anúncios sincronizados com resultados reais do CRM por anúncio`)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}`;
  if (creatives.length === 0) {
    return shellFor(base, "marketing/criativos", `${head}<div class="empty-state"><span class="es-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg></span><h2>Nenhum anúncio sincronizado ainda</h2><p>Os criativos aparecem aqui assim que uma conta Meta Ads for vinculada e sincronizada (a Meta envia campanha → conjunto → anúncio). Google Ads não expõe anúncios pela sincronização atual.</p></div>`);
  }
  const ranking = rankList(
    creatives.slice(0, 8).map((c) => ({ name: c.ad.name, value: c.leads, label: `${c.leads} leads`, sub: c.customers ? `${c.customers} cliente(s)` : undefined, href: `/empresa/${company.id}/marketing/campanhas/${c.ad.campaign_id}${qs}` })),
    COLORS.accent,
    "Nenhum lead atribuído a anúncio no período."
  );
  const byCtr = withMedia.filter((c) => c.platform.ctr !== null).sort((a, b) => (b.platform.ctr ?? 0) - (a.platform.ctr ?? 0));
  const best = byCtr[0];
  const worst = byCtr.length > 1 ? byCtr[byCtr.length - 1] : null;
  const mediaNote = withMedia.length === 0
    ? prepNote("Métricas de mídia por anúncio (alcance, cliques, CTR, CPL, engajamento) e o formato (imagem, vídeo, reels, stories, feed) ainda não são sincronizados — a coleta atual grava métricas no nível da campanha. A estrutura já lê o nível 'anúncio' quando a sincronização passar a gravá-lo; até lá estes campos ficam em '—'. Leads, clientes e receita por anúncio já são reais (atribuição por ad id).")
    : "";
  const compare = withMedia.length
    ? `<div class="data-table-wrap"><table class="compare-table"><thead><tr><th>Anúncio</th><th>Investimento</th><th>Alcance</th><th>Cliques</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead><tbody>${withMedia
        .map((c) => `<tr><td>${escapeHtml(c.ad.name)}</td><td>${fmtBRL(c.platform.spendCents)}</td><td>${c.platform.reach === null ? "—" : fmtNum(c.platform.reach)}</td><td>${c.platform.clicks === null ? "—" : fmtNum(c.platform.clicks)}</td><td>${fmtPct(c.platform.ctr, 2)}</td><td>${c.leads}</td><td>${c.cpl === null ? "—" : fmtBRL(c.cpl)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : "";
  const body = `${head}
    ${mediaNote}
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Ranking dos melhores", "por leads atribuídos ao anúncio (dado real do CRM)")}${ranking}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Melhor e pior criativo", withMedia.length ? "por CTR (mídia sincronizada)" : "aguardando métricas de mídia por anúncio")}${best ? `<div class="status-item"><div class="k">Melhor CTR</div><div class="v">${escapeHtml(best.ad.name)} · ${fmtPct(best.platform.ctr, 2)}</div></div>` : ""}${worst ? `<div class="status-item" style="margin-top:8px"><div class="k">Pior CTR</div><div class="v">${escapeHtml(worst.ad.name)} · ${fmtPct(worst.platform.ctr, 2)}</div></div>` : ""}${!best ? '<p class="muted small">Sem métricas de mídia por anúncio no período.</p>' : ""}</div></div>
    </div>
    <div class="card-block">${chartHead("Grid de criativos", `${creatives.length} anúncio(s) · prévia visual ainda não sincronizada (iniciais no lugar da imagem)`)}<div class="creative-grid">${creatives.map((c) => creativeCard(c, company.id, qs)).join("")}</div></div>
    ${compare ? `<div class="card-block">${chartHead("Comparação entre criativos", "só anúncios com métricas de mídia")}${compare}</div>` : ""}`;
  return shellFor(base, "marketing/criativos", body);
}

export type { PeriodSnapshot };
