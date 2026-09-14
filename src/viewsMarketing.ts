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
import type { BiFilters, CampaignRow, CompanyBi, DailyPoint, PeriodSnapshot, ResolvedPeriod } from "./bi";
import { deltaPercent } from "./bi";
import { barChart, bubbleChart, COLORS, emptyChart, funnelChart, gaugeChart, lineChart, sparkline, type Series } from "./charts";
import {
  fmtBRL,
  fmtDelta,
  fmtNum,
  fmtPct,
  HEALTH_THRESHOLDS,
  SEVERITY_LABELS,
  TEMPERATURE_LABELS,
  type AttentionItem,
  type Bottleneck,
  type CompanyGoals,
  type CostQualityInsight,
  type FunnelStage,
  type HealthScore,
  type MonthProjection,
  type ScoredLead,
  type StalledOpportunity,
} from "./insights";
import type { MarketingAccountWithConnection, MarketingCampaign, MarketingProvider } from "./marketingModels";
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
  return `<div class="kpi ${opts.secondary ? "kpi-secondary" : ""}">
    <div class="kpi-label">${tip(opts.label, opts.tooltip)}</div>
    <div class="kpi-value">${escapeHtml(opts.value)}</div>
    ${deltaHtml}
    ${opts.spark && !opts.secondary ? sparkline(opts.spark, opts.sparkColor ?? COLORS.accent) : ""}
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
  return `<form method="get" action="${basePath}" class="filter-bar">
    <div class="field" style="min-width:100%"><div class="preset-links">${presets}<a href="#" class="${period.preset === "personalizado" ? "active" : ""}" onclick="return false">Personalizado ↓</a></div></div>
    <input type="hidden" name="periodo" value="personalizado" />
    <div class="field"><label>De<input type="date" name="de" value="${period.current.from}" /></label></div>
    <div class="field"><label>Até<input type="date" name="ate" value="${period.current.to}" /></label></div>
    <div class="field"><label>Canal<select name="canal">${sourceOptions}</select></label></div>
    <div class="field"><label>Campanha<select name="campanha">${campaignOptions}</select></label></div>
    <div class="field"><label>Atendente<select name="atendente">${memberOptions}</select></label></div>
    <div class="field"><label>Etapa CRM<select name="etapa">${stageOptions}</select></label></div>
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

export function secondaryKpis(bi: CompanyBi): string {
  const c = bi.current.kpis;
  const p = bi.previous.kpis;
  const prevLabel = bi.period.previousLabel;
  const money = (v: number | null) => (v === null ? "—" : fmtBRL(v));
  const pct = (v: number | null) => fmtPct(v);
  const card = (label: string, tooltip: string, value: string, cur: number | null, prev: number | null, lowerIsBetter = false) =>
    kpiCard({ label, tooltip, value, current: cur, previous: prev, lowerIsBetter, secondary: true, previousLabel: prevLabel });
  return `<div class="kpi-grid">
    ${card("Custo por conversa", "investimento ÷ conversas", money(c.costPerConversation), c.costPerConversation, p.costPerConversation, true)}
    ${card("CPL", "investimento ÷ leads", money(c.cpl), c.cpl, p.cpl, true)}
    ${card("Custo por qualificado", "investimento ÷ leads qualificados", money(c.cplQualified), c.cplQualified, p.cplQualified, true)}
    ${card("Custo por agendamento", "investimento ÷ agendamentos", money(c.costPerAppointment), c.costPerAppointment, p.costPerAppointment, true)}
    ${card("Custo por comparecimento", "investimento ÷ comparecimentos", money(c.costPerAttendance), c.costPerAttendance, p.costPerAttendance, true)}
    ${card("CAC", "investimento ÷ clientes novos", money(c.cac), c.cac, p.cac, true)}
    ${card("Taxa de qualificação", "leads qualificados ÷ leads", pct(c.qualificationRate), c.qualificationRate, p.qualificationRate)}
    ${card("Taxa de agendamento", "agendamentos ÷ leads qualificados", pct(c.appointmentRate), c.appointmentRate, p.appointmentRate)}
    ${card("Taxa de comparecimento", "comparecimentos ÷ agendamentos", pct(c.attendanceRate), c.attendanceRate, p.attendanceRate)}
    ${card("Taxa de fechamento", "vendas ÷ leads qualificados", pct(c.closeRate), c.closeRate, p.closeRate)}
    ${card("Ticket médio", "receita ÷ vendas", money(c.ticketCents), c.ticketCents, p.ticketCents)}
    ${card("ROAS CRM", "receita atribuída ÷ investimento atribuído", c.roasCrm === null ? "—" : `${fmtNum(c.roasCrm)}x`, c.roasCrm, p.roasCrm)}
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
  const cards = bi.providers
    .map((p) => {
      const c = p.crm;
      const k = p.kpis;
      const spend = p.platform.hasSpendData ? fmtBRL(p.platform.spendCents) : "—";
      const warn = p.probableShare !== null && p.probableShare > 0.3 ? `<p class="small muted">⚠ ${fmtPct(p.probableShare)} dos leads deste canal têm atribuição apenas provável (UTM), não confirmada.</p>` : "";
      const noData = !p.connected ? `<p class="small muted">${p.provider === "META" ? "Meta Ads" : "Google Ads"} ainda não conectado.</p>` : !p.platform.hasSpendData ? `<p class="small muted">Sem investimento sincronizado no período.</p>` : "";
      return `<div class="provider-card">
        <h4>${providerChip(p.provider)}</h4>
        ${noData}
        <dl>
          <dt>Investimento</dt><dd>${spend}</dd>
          <dt>Leads</dt><dd>${c.leads}</dd>
          <dt>Qualificados</dt><dd>${c.qualified}</dd>
          <dt>Clientes</dt><dd>${c.newCustomers}</dd>
          <dt>CPL</dt><dd>${k.cpl === null ? "—" : fmtBRL(k.cpl)}</dd>
          <dt>CAC</dt><dd>${k.cac === null ? "—" : fmtBRL(k.cac)}</dd>
          <dt>Receita atribuída</dt><dd>${fmtBRL(c.attributedRevenueCents)}</dd>
          <dt>ROAS</dt><dd>${k.roasCrm === null ? "—" : `${fmtNum(k.roasCrm)}x`}</dd>
        </dl>
        ${warn}
      </div>`;
    })
    .join("");
  return `<div class="provider-compare">${cards}</div>`;
}

export function attentionBlock(items: AttentionItem[], emptyText = "Nada precisa de atenção com os dados atuais."): string {
  if (items.length === 0) return `<p class="muted small">${escapeHtml(emptyText)}</p>`;
  return `<ul class="attention-list">${items
    .map(
      (it) => `<li>
      <div><span class="sev sev-${it.severity}">${SEVERITY_LABELS[it.severity]}</span><div class="small muted" style="margin-top:0.3rem">${escapeHtml(it.category)}</div></div>
      <div><div class="fact">${escapeHtml(it.fact)}</div>${it.recommendation ? `<div class="hyp">Recomendação: ${escapeHtml(it.recommendation)}</div>` : ""}</div>
    </li>`
    )
    .join("")}</ul>`;
}

export function campaignsTable(rows: CampaignRow[], companyId: number, qs: string, timeZone: string, sort: string | null): string {
  if (rows.length === 0) return emptyChart("Nenhuma campanha com dados neste período. Conecte uma conta de anúncios ou altere o período.");
  const num = (v: number | null | undefined, money = false) => (v === null || v === undefined ? "—" : money ? fmtBRL(Math.round(v)) : fmtNum(v));
  const sortKey = sort ?? "investimento";
  const val = (r: CampaignRow): number => {
    switch (sortKey) {
      case "leads": return r.crm.leads;
      case "vendas": return r.crm.sales;
      case "receita": return r.crm.revenueCents;
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
  const body = sorted
    .map(
      (r) => `<tr>
      <td class="left">${statusChip(r.campaign.status)}</td>
      <td class="left">${providerChip(r.campaign.provider)}</td>
      <td class="left"><a href="/empresa/${companyId}/marketing/campanhas/${r.campaign.id}${qs}">${escapeHtml(r.campaign.name)}</a></td>
      <td class="left muted">${escapeHtml(r.accountName ?? "—")}</td>
      <td>${r.platform.hasSpendData ? fmtBRL(r.platform.spendCents) : "—"}</td>
      <td>${num(r.platform.impressions)}</td>
      <td>${num(r.platform.clicks)}</td>
      <td>${fmtPct(r.platform.ctr, 2)}</td>
      <td>${num(r.platform.cpc, true)}</td>
      <td>${num(r.platform.cpm, true)}</td>
      <td>${r.crm.conversations}</td>
      <td>${r.crm.leads}</td>
      <td>${r.crm.qualified}</td>
      <td>${r.crm.appointments}</td>
      <td>${r.crm.attendances}</td>
      <td>${r.crm.sales}</td>
      <td>${fmtBRL(r.crm.revenueCents)}</td>
      <td>${num(r.kpis.cpl, true)}</td>
      <td>${num(r.kpis.cplQualified, true)}</td>
      <td>${num(r.kpis.cac, true)}</td>
      <td>${r.kpis.roasCrm === null ? "—" : `${fmtNum(r.kpis.roasCrm)}x`}</td>
      <td class="muted">${fmtDateTime(r.updatedAt, timeZone)}</td>
    </tr>`
    )
    .join("");
  return `<div class="data-table-wrap"><table class="data-table">
    <thead><tr>
      <th class="left">Status</th><th class="left">Canal</th>${th("nome", "Campanha", undefined, true)}<th class="left">Conta</th>
      ${th("investimento", "Investimento")}<th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th>
      <th title="Conversas iniciadas no CRM por contatos atribuídos à campanha">Conversas</th>${th("leads", "Leads")}<th>Qualif.</th><th>Agend.</th><th>Compar.</th>${th("vendas", "Vendas")}${th("receita", "Receita")}
      ${th("cpl", "CPL")}<th>CPL qualif.</th>${th("cac", "CAC")}${th("roas", "ROAS")}<th>Atualizado</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>
  <p class="small muted" style="margin-top:0.5rem">Impressões/cliques/CTR/CPC/CPM vêm da plataforma. Conversas/leads/qualificados/vendas/receita vêm do CRM, só de contatos atribuídos à campanha (confirmada ou provável). Conversões da plataforma não são somadas aos resultados do CRM.</p>`;
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
  canViewMarketing: boolean;
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

export function marketingOverviewPage(base: MarketingPageBase): string {
  const { company, bi } = base;
  const basePath = `/empresa/${company.id}/marketing`;
  const qs = queryString(bi.period, bi.filters);
  const fresh = freshnessLabel(bi.freshness.lastSuccessAt);
  const body = `${pageHead(company.name, `${bi.period.label} · comparado com ${bi.period.previousLabel}`)}
    ${tabs(company.id, "visao", qs)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, fresh)}
    ${noIntegrationNotice(bi, base.role)}
    ${executiveCards(bi)}
    ${performanceChart(bi, basePath, qs, base.m1, base.m2)}
    <div class="grid-12">
      <div class="col-6"><div class="card-block">${chartHead("Funil — do anúncio à venda", `${bi.period.label} · conversão etapa a etapa`)}${funnelBlock(base.funnel, company.id, qs)}</div></div>
      <div class="col-6"><div class="card-block"><h3>Meta Ads x Google Ads</h3>${providerComparisonBlock(bi)}</div></div>
    </div>
    <div class="card-block"><h3>Custo de aquisição</h3>${secondaryKpis(bi)}</div>
    <div class="card-block"><h3>Campanhas <span class="actions"><a class="btn btn-small" href="${basePath}/campanhas${qs}">Ver tabela completa</a></span></h3>${campaignsTable(bi.campaigns.slice(0, 8), company.id, qs, company.timezone, base.sort)}</div>
    <div class="card-block"><h3>Precisa de atenção</h3>${attentionBlock(base.attention)}</div>
    <div class="card-block"><h3>Última sincronização</h3>
      <p class="small">Meta Ads: ${fmtDateTime(bi.freshness.byProvider.META, company.timezone)} · Google Ads: ${fmtDateTime(bi.freshness.byProvider.GOOGLE, company.timezone)}</p>
      ${base.role === "COMPANY_ADMIN" && bi.hasAnyIntegration ? `<form method="post" action="${basePath}/atualizar" style="display:inline"><button type="submit" class="btn btn-small">Atualizar agora</button></form> <span class="small muted">(no máximo uma vez a cada 15 minutos por empresa)</span>` : ""}
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
    <div class="card-block"><h3>Tabela master</h3>${campaignsTable(bi.campaigns, company.id, qs, company.timezone, base.sort)}</div>
    <div class="card-block"><h3>Qualidade do lead: custo x fechamento</h3>${qualityBubble(bi.campaigns)}</div>`;
  return shellFor(base, "marketing", body);
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
    <div class="card-block"><h3>Custo de aquisição</h3>${secondaryKpis(bi)}</div>`;
  return shellFor(base, "marketing", body);
}

export function marketingProviderPage(base: MarketingPageBase, provider: MarketingProvider, accounts: MarketingAccountWithConnection[]): string {
  const { company, bi } = base;
  const key = provider === "META" ? "meta" : "google";
  const qs = queryString(bi.period, bi.filters);
  const basePath = `/empresa/${company.id}/marketing/${key}`;
  const p = bi.providers.find((x) => x.provider === provider)!;
  const accountsHtml = accounts.length
    ? `<ul class="list">${accounts.map((a) => `<li><span>${escapeHtml(a.name ?? a.external_account_id)} <span class="muted small">${escapeHtml(a.currency ?? "")}</span></span><span class="chip ${a.connection_status === "CONECTADA" ? "chip-ok" : "chip-bad"}">${escapeHtml(a.connection_status === "CONECTADA" ? "Conectada" : "Reconexão necessária")}</span></li>`).join("")}</ul>`
    : `<div class="notice-box">${provider === "META" ? "Meta Ads" : "Google Ads"} ainda não conectado. ${base.role === "COMPANY_ADMIN" ? "Entre em contato com a Hub Action para conectar sua conta." : ""}</div>`;
  const body = `${pageHead(provider === "META" ? "Meta Ads" : "Google Ads", bi.period.label)}
    ${tabs(company.id, key, qs)}
    ${filterBar(basePath, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.byProvider[provider]))}
    <div class="card-block"><h3>Contas vinculadas</h3>${accountsHtml}</div>
    ${executiveCards(bi)}
    ${performanceChart(bi, basePath, qs, base.m1, base.m2)}
    <div class="grid-12">
      <div class="col-6"><div class="card-block"><h3>Plataforma</h3><dl style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 1rem;font-size:0.85rem;margin:0">
        <dt class="muted">Impressões</dt><dd>${p.platform.impressions ?? "—"}</dd>
        <dt class="muted">Alcance</dt><dd>${p.platform.reach ?? "—"}</dd>
        <dt class="muted">Frequência</dt><dd>${fmtNum(p.platform.frequency)}</dd>
        <dt class="muted">Cliques</dt><dd>${p.platform.clicks ?? "—"}</dd>
        <dt class="muted">CTR</dt><dd>${fmtPct(p.platform.ctr, 2)}</dd>
        <dt class="muted">CPC</dt><dd>${p.platform.cpc === null ? "—" : fmtBRL(p.platform.cpc)}</dd>
        <dt class="muted">CPM</dt><dd>${p.platform.cpm === null ? "—" : fmtBRL(p.platform.cpm)}</dd>
        <dt class="muted">Conversas (plataforma)</dt><dd>${p.platform.platformConversations ?? "—"}</dd>
        <dt class="muted">Conversões (plataforma)</dt><dd>${p.platform.platformConversions ?? "—"}</dd>
      </dl></div></div>
      <div class="col-6"><div class="card-block"><h3>Resultados no CRM (atribuídos)</h3>${providerComparisonBlock({ ...bi, providers: [p] })}</div></div>
    </div>
    <div class="card-block"><h3>Campanhas</h3>${campaignsTable(bi.campaigns.filter((r) => r.campaign.provider === provider), company.id, qs, company.timezone, base.sort)}</div>`;
  return shellFor(base, "marketing", body);
}

export function marketingFunnelPage(base: MarketingPageBase, bottlenecks: Bottleneck[]): string {
  const { company, bi } = base;
  const qs = queryString(bi.period, bi.filters);
  const body = `${pageHead("Funil", `${bi.period.label} — do anúncio à receita`)}
    ${tabs(company.id, "funil", qs)}
    ${filterBar(`/empresa/${company.id}/marketing/funil`, bi.period, bi.filters, base.filterOptions, freshnessLabel(bi.freshness.lastSuccessAt))}
    <div class="grid-12">
      <div class="col-8"><div class="card-block">${chartHead("Funil executivo", `${bi.period.label} · do anúncio à receita`)}${funnelBlock(base.funnel, company.id, qs)}
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
  return shellFor(base, "marketing", body);
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
  const body = `${pageHead("Central de Performance", `${mesLabel} · ${o.projection.today} · comparações de 7 dias`)}
    ${o.notice ? `<p class="success">${escapeHtml(o.notice)}</p>` : ""}${o.error ? `<p class="error">${escapeHtml(o.error)}</p>` : ""}
    ${noIntegrationNotice(bi, o.role)}
    <div class="kpi-grid">
      ${kpiCard({ label: "Investimento do mês", tooltip: "Gasto sincronizado das plataformas no mês corrente.", value: c.platform.hasSpendData ? fmtBRL(c.platform.spendCents) : "—", current: c.platform.hasSpendData ? c.platform.spendCents : null, previous: bi.previous.platform.hasSpendData ? bi.previous.platform.spendCents : null, lowerIsBetter: true, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Receita atribuída", tooltip: "Receita de vendas de contatos atribuídos a anúncios.", value: fmtBRL(c.crm.attributedRevenueCents), current: c.crm.attributedRevenueCents, previous: bi.previous.crm.attributedRevenueCents, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "ROAS", tooltip: "Receita atribuída ÷ investimento.", value: c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`, current: c.kpis.roasCrm, previous: bi.previous.kpis.roasCrm, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Leads", tooltip: "Contatos novos no mês.", value: String(c.crm.leads), current: c.crm.leads, previous: bi.previous.crm.leads, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Qualificados", tooltip: "Oportunidades qualificadas no mês.", value: String(c.crm.qualified), current: c.crm.qualified, previous: bi.previous.crm.qualified, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Agendamentos", tooltip: "Agendamentos no mês.", value: String(c.crm.appointments), current: c.crm.appointments, previous: bi.previous.crm.appointments, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Comparecimentos", tooltip: "Comparecimentos no mês.", value: String(c.crm.attendances), current: c.crm.attendances, previous: bi.previous.crm.attendances, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Clientes novos", tooltip: "Contatos com venda concluída no mês.", value: String(c.crm.newCustomers), current: c.crm.newCustomers, previous: bi.previous.crm.newCustomers, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "CAC", tooltip: "Investimento ÷ clientes novos (mês).", value: c.kpis.cac === null ? "—" : fmtBRL(c.kpis.cac), current: c.kpis.cac, previous: bi.previous.kpis.cac, lowerIsBetter: true, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Ticket médio", tooltip: "Receita ÷ vendas.", value: c.kpis.ticketCents === null ? "—" : fmtBRL(c.kpis.ticketCents), current: c.kpis.ticketCents, previous: bi.previous.kpis.ticketCents, previousLabel: bi.period.previousLabel })}
      ${kpiCard({ label: "Meta atingida", tooltip: "Faturamento realizado ÷ meta de faturamento do mês.", value: o.projection.items[0].attainment === null ? "—" : fmtPct(o.projection.items[0].attainment, 1), current: null, previous: null, previousLabel: "" })}
      ${kpiCard({ label: "Projeção do mês", tooltip: "Faturamento projetado mantendo o ritmo diário atual.", value: o.projection.items[0].projected === null ? "—" : fmtBRL(Math.round(o.projection.items[0].projected)), current: null, previous: null, previousLabel: "" })}
    </div>
    <div class="grid-12">
      <div class="col-8"><div class="card-block"><h3>Meta do mês e projeção</h3>${goalsProgress(o.projection)}</div></div>
      <div class="col-4"><div class="card-block">${chartHead("Saúde do marketing", `Índice de 0 a 100 · ${health.components.length} componentes ponderados`)}${healthHtml}</div></div>
    </div>
    <div class="card-block"><h3>Resumo executivo</h3><p style="font-size:0.95rem;line-height:1.5">${escapeHtml(o.summary)}</p>
      <p class="small muted">Últimos 7 dias vs 7 anteriores — CPL ${s7.cpl === null ? "—" : fmtBRL(s7.cpl)} (${fmtDelta(deltaPercent(s7.cpl, p7.cpl))}) · CAC ${s7.cac === null ? "—" : fmtBRL(s7.cac)} (${fmtDelta(deltaPercent(s7.cac, p7.cac))}) · fechamento ${fmtPct(s7.closeRate)} (${fmtDelta(deltaPercent(s7.closeRate, p7.closeRate))})</p></div>
    <div class="card-block"><h3>Precisa de atenção</h3>${attentionBlock(o.attention)}</div>
    <div class="grid-12">
      <div class="col-7 col-6"><div class="card-block">${chartHead("Funil executivo do mês", "Este mês · conversão etapa a etapa")}${funnelBlock(o.funnel, company.id, "")}</div></div>
      <div class="col-6"><div class="card-block"><h3>Detector de gargalos</h3>${
        o.bottlenecks.length
          ? `<ul class="attention-list">${o.bottlenecks.map((b) => `<li style="grid-template-columns:1fr"><div class="fact">${escapeHtml(b.fact)}</div><div class="hyp">${escapeHtml(b.hypothesis)}</div></li>`).join("")}</ul>`
          : '<p class="muted small">Nenhum gargalo detectado com amostra suficiente.</p>'
      }${o.costQuality.text ? `<p class="small" style="margin-top:0.75rem;color:#fde68a"><strong>Custo x qualidade:</strong> ${escapeHtml(o.costQuality.text)}</p>` : ""}</div></div>
    </div>
    <div class="card-block"><h3>Leads quentes agora</h3>${leadsTable(company.id, o.hot, company.timezone)}</div>
    <div class="card-block"><h3>Oportunidades paradas</h3>${leadsTable(company.id, o.stalled.map((s) => s.lead), company.timezone, (l) => {
      const st = o.stalled.find((s) => s.lead.contactId === l.contactId)!;
      return `${escapeHtml(st.reason)} <span class="muted">(${formatDuration(st.stalledForMs)}${l.opportunityValueCents ? ` · ${fmtBRL(l.opportunityValueCents)} em aberto` : ""})</span>`;
    })}</div>
    <div class="grid-12">
      <div class="col-4"><div class="card-block"><h3>SLA de atendimento (mês)</h3>${slaHtml}</div></div>
      <div class="col-8"><div class="card-block"><h3>Performance dos atendentes (mês)</h3>${attendantsHtml}</div></div>
    </div>
    ${matrixHtml ? `<div class="card-block"><h3>Atendente x origem (mês)</h3>${matrixHtml}</div>` : ""}
    <div class="card-block"><h3>Metas da empresa</h3>${goalsForm(company.id, o.goals, o.role === "COMPANY_ADMIN")}</div>`;
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

export type { PeriodSnapshot };
