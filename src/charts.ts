/**
 * Gráficos em SVG gerados no servidor — sem biblioteca, sem JavaScript no
 * navegador, coerente com o frontend server-rendered do projeto. Tooltips
 * nativos via <title>. Cada função devolve uma string HTML e trata o caso
 * "sem dados" sem quebrar (nunca desenha eixo vazio).
 *
 * Semântica de cor (ver viewsMarketing.ts): positivo verde, atenção âmbar,
 * erro vermelho, Meta violeta discreto, Google laranja discreto, neutro cinza.
 */
import { escapeHtml } from "./views";

export const COLORS = {
  accent: "#38bdf8",
  positive: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  meta: "#a78bfa",
  google: "#fb923c",
  neutral: "#94a3b8",
  muted: "#475569",
  grid: "#1f2937",
  text: "#cbd5e1",
};

export interface SeriesPoint {
  label: string; // "dd/mm"
  value: number | null;
}

export interface Series {
  name: string;
  color: string;
  points: SeriesPoint[];
  /** Eixo direito (segunda métrica em escala diferente). */
  secondary?: boolean;
  /** Formatador do valor no tooltip/eixo. */
  format: (v: number) => string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function hasData(series: Series[]): boolean {
  return series.some((s) => s.points.some((p) => p.value !== null && p.value !== undefined));
}

export function emptyChart(message = "Ainda não existem dados suficientes neste período."): string {
  return `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

/** Linha/área temporal com até duas séries (eixo secundário opcional, deixado explícito na legenda). */
export function lineChart(opts: { series: Series[]; height?: number; ariaLabel: string }): string {
  const { series } = opts;
  if (series.length === 0 || !hasData(series)) return emptyChart();
  const W = 960;
  const H = opts.height ?? 260;
  const padL = 56;
  const padR = series.some((s) => s.secondary) ? 64 : 16;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(...series.map((s) => s.points.length));
  if (n === 0) return emptyChart();

  const maxPrimary = niceMax(Math.max(0, ...series.filter((s) => !s.secondary).flatMap((s) => s.points.map((p) => p.value ?? 0))));
  const maxSecondary = niceMax(Math.max(0, ...series.filter((s) => s.secondary).flatMap((s) => s.points.map((p) => p.value ?? 0))));

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number, secondary: boolean) => padT + innerH - (v / (secondary ? maxSecondary : maxPrimary)) * innerH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = padT + innerH - f * innerH;
      const primary = series.find((s) => !s.secondary);
      const secondary = series.find((s) => s.secondary);
      const left = primary ? primary.format(f * maxPrimary) : "";
      const right = secondary ? secondary.format(f * maxSecondary) : "";
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" stroke-width="1" />
        <text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="${COLORS.neutral}">${escapeHtml(left)}</text>
        ${secondary ? `<text x="${W - padR + 6}" y="${yy + 4}" text-anchor="start" font-size="10" fill="${secondary.color}">${escapeHtml(right)}</text>` : ""}`;
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const xLabels = series[0].points
    .map((p, i) => (i % labelEvery === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${COLORS.neutral}">${escapeHtml(p.label)}</text>` : ""))
    .join("");

  const paths = series
    .map((s) => {
      const pts = s.points.map((p, i) => (p.value === null || p.value === undefined ? null : `${x(i).toFixed(1)},${y(p.value, !!s.secondary).toFixed(1)}`));
      let d = "";
      let open = false;
      for (const pt of pts) {
        if (pt === null) {
          open = false;
          continue;
        }
        d += `${open ? "L" : "M"}${pt} `;
        open = true;
      }
      const dots = s.points
        .map((p, i) =>
          p.value === null || p.value === undefined
            ? ""
            : `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value, !!s.secondary).toFixed(1)}" r="3" fill="${s.color}"><title>${escapeHtml(`${p.label} — ${s.name}: ${s.format(p.value)}`)}</title></circle>`
        )
        .join("");
      return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.secondary ? 'stroke-dasharray="5 4"' : ""} />${dots}`;
    })
    .join("");

  const legend = series
    .map(
      (s) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}${s.secondary ? ' <span class="meta">(eixo direito, tracejado)</span>' : ""}</span>`
    )
    .join("");

  return `<div class="chart">
    <div class="chart-legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" preserveAspectRatio="none" class="chart-svg">${gridLines}${xLabels}${paths}</svg>
  </div>`;
}

export interface BarItem {
  label: string;
  value: number | null;
  color?: string;
  tooltip?: string;
}

/** Barras horizontais — comparação entre campanhas/canais. Valores null viram "—". */
export function barChart(opts: { items: BarItem[]; format: (v: number) => string; ariaLabel: string }): string {
  const items = opts.items.filter((i) => i.value !== null && i.value !== undefined);
  if (items.length === 0) return emptyChart();
  const max = Math.max(...items.map((i) => i.value as number), 0) || 1;
  const rowH = 28;
  const W = 960;
  const labelW = 220;
  const H = items.length * rowH + 8;
  const rows = items
    .map((it, idx) => {
      const v = it.value as number;
      const w = Math.max(2, (v / max) * (W - labelW - 120));
      const yy = idx * rowH + 4;
      const color = it.color ?? COLORS.accent;
      return `<g>
        <title>${escapeHtml(it.tooltip ?? `${it.label}: ${opts.format(v)}`)}</title>
        <text x="${labelW - 8}" y="${yy + 17}" text-anchor="end" font-size="12" fill="${COLORS.text}">${escapeHtml(it.label.length > 32 ? it.label.slice(0, 31) + "…" : it.label)}</text>
        <rect x="${labelW}" y="${yy + 4}" width="${w.toFixed(1)}" height="${rowH - 10}" rx="3" fill="${color}" opacity="0.85" />
        <text x="${labelW + w + 8}" y="${yy + 17}" font-size="12" fill="${COLORS.text}">${escapeHtml(opts.format(v))}</text>
      </g>`;
    })
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg" style="height:${H}px">${rows}</svg></div>`;
}

export interface FunnelStep {
  label: string;
  value: number | null;
  /** Custo acumulado por unidade nesta etapa (ex.: CPL), já formatado. */
  costLabel?: string | null;
  href?: string | null;
}

/** Funil vertical: volume, conversão para a etapa seguinte, acumulada e perda. */
export function funnelChart(steps: FunnelStep[]): string {
  const valid = steps.filter((s) => s.value !== null && s.value !== undefined);
  if (valid.length === 0 || valid.every((s) => (s.value as number) === 0)) return emptyChart("Sem eventos no funil para este período.");
  const first = (steps.find((s) => s.value !== null && s.value !== undefined)?.value as number) || 0;
  let prev: number | null = null;
  const rows = steps
    .map((s) => {
      const v = s.value;
      const widthPct = v === null || v === undefined || first === 0 ? 0 : Math.max(6, (v / first) * 100);
      const pct = (n: number) => (n < 0.1 ? `${(n * 100).toFixed(1)}%` : `${(n * 100).toFixed(0)}%`).replace(".", ",");
      // Etapas nem sempre são estritamente aninhadas (ex.: lead criado à mão no CRM sem conversa):
      // quando a etapa é MAIOR que a anterior, não existe "conversão" nem "perda" a mostrar.
      const nested = v !== null && v !== undefined && prev !== null && prev > 0 && v <= prev;
      const stepConv = nested ? pct((v as number) / (prev as number)) : "—";
      const cumConv = v !== null && v !== undefined && first > 0 && v <= first ? pct(v / first) : "—";
      const loss = nested && (v as number) < (prev as number) ? `${pct(((prev as number) - (v as number)) / (prev as number))} perdidos` : "";
      if (v !== null && v !== undefined) prev = v;
      const valueLabel = v === null || v === undefined ? "—" : v.toLocaleString("pt-BR");
      const inner = `<div class="funnel-bar" style="width:${widthPct}%"></div>
        <div class="funnel-text"><strong>${escapeHtml(valueLabel)}</strong> ${escapeHtml(s.label)}${s.costLabel ? ` <span class="meta">· ${escapeHtml(s.costLabel)}</span>` : ""}</div>`;
      return `<div class="funnel-row">
        ${s.href ? `<a href="${escapeHtml(s.href)}" class="funnel-link">${inner}</a>` : inner}
        <div class="funnel-conv"><span title="Conversão da etapa anterior para esta">${stepConv}</span> <span class="meta" title="Conversão acumulada desde a primeira etapa">(${cumConv} acum.)</span> ${loss ? `<span class="funnel-loss">${escapeHtml(loss)}</span>` : ""}</div>
      </div>`;
    })
    .join("");
  return `<div class="funnel">${rows}</div>`;
}

/** Mini linha (sparkline) para os cards executivos. Sem eixos. */
export function sparkline(values: (number | null)[], color = COLORS.accent): string {
  const nums = values.filter((v): v is number => v !== null && v !== undefined);
  if (nums.length < 2) return "";
  const W = 120;
  const H = 28;
  const max = Math.max(...nums, 0) || 1;
  const min = Math.min(...nums, 0);
  const range = max - min || 1;
  const n = values.length;
  const pts = values
    .map((v, i) => (v === null || v === undefined ? null : `${((i / (n - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * (H - 4) - 2).toFixed(1)}`))
    .filter(Boolean);
  return `<svg viewBox="0 0 ${W} ${H}" class="sparkline" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" /></svg>`;
}

export interface BubblePoint {
  label: string;
  x: number; // CPL (R$)
  y: number; // taxa de fechamento (0..1)
  size: number; // investimento
  color?: string;
  tooltip: string;
}

/** Eficiência x qualidade: CPL (x) por taxa de fechamento (y), bolha = investimento. */
export function bubbleChart(points: BubblePoint[], formatX: (v: number) => string): string {
  if (points.length === 0) return emptyChart("Sem campanhas com investimento e leads suficientes para comparar.");
  const W = 960;
  const H = 300;
  const padL = 56;
  const padR = 20;
  const padT = 16;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxX = niceMax(Math.max(...points.map((p) => p.x)));
  const maxY = Math.min(1, niceMax(Math.max(...points.map((p) => p.y), 0.05)));
  const maxSize = Math.max(...points.map((p) => p.size), 1);
  const grid = [0, 0.5, 1]
    .map((f) => {
      const yy = padT + innerH - f * innerH;
      const xx = padL + f * innerW;
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" />
        <text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="${COLORS.neutral}">${(f * maxY * 100).toFixed(0)}%</text>
        <text x="${xx}" y="${H - 14}" text-anchor="middle" font-size="10" fill="${COLORS.neutral}">${escapeHtml(formatX(f * maxX))}</text>`;
    })
    .join("");
  const circles = points
    .map((p) => {
      const cx = padL + (p.x / maxX) * innerW;
      const cy = padT + innerH - (Math.min(p.y, maxY) / maxY) * innerH;
      const r = 6 + Math.sqrt(p.size / maxSize) * 22;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${p.color ?? COLORS.accent}" opacity="0.55" stroke="${p.color ?? COLORS.accent}"><title>${escapeHtml(p.tooltip)}</title></circle>
        <text x="${cx.toFixed(1)}" y="${(cy - r - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${COLORS.text}">${escapeHtml(p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label)}</text>`;
    })
    .join("");
  return `<div class="chart">
    <div class="chart-legend"><span class="meta">Eixo X: CPL (menor é melhor) · Eixo Y: taxa de fechamento (maior é melhor) · Tamanho: investimento</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Custo por lead versus taxa de fechamento por campanha" class="chart-svg">${grid}${circles}</svg>
  </div>`;
}
