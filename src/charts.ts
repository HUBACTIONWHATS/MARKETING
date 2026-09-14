/**
 * Gráficos em SVG gerados no servidor — sem biblioteca, sem JavaScript no
 * navegador, coerente com o frontend server-rendered do projeto. Tooltips
 * nativos via <title> continuam existindo (acessibilidade); por cima deles há
 * um tooltip visual em SVG mostrado no :hover só com CSS (`.pt .ttp`, definido
 * em views.ts). Cada função devolve uma string HTML e trata o caso "sem dados"
 * sem quebrar (nunca desenha eixo vazio).
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

/** Ids únicos para gradientes (várias instâncias de gráfico na mesma página). */
let gradientSeq = 0;
const nextGradientId = (prefix: string) => `${prefix}-${++gradientSeq}`;

/**
 * Curva suave (monotone cubic — passa pelos pontos sem ultrapassá-los, então
 * nunca desenha valores "inventados" acima/abaixo dos dados). Só o traçado
 * muda; os pontos são exatamente os mesmos.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  const f = (n: number) => n.toFixed(1);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (pts.length === 2) return `M${f(pts[0].x)},${f(pts[0].y)} L${f(pts[1].x)},${f(pts[1].y)}`;
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    d += ` C${f(pts[i].x + h / 3)},${f(pts[i].y + (t[i] * h) / 3)} ${f(pts[i + 1].x - h / 3)},${f(pts[i + 1].y - (t[i + 1] * h) / 3)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

/**
 * Tooltip visual em SVG: título (data/nome) + linhas "rótulo … valor" com o
 * valor alinhado à direita. Fica acima do ponto, sempre dentro da largura
 * do gráfico; se não couber acima, desce para baixo do ponto.
 */
function svgTooltip(x: number, y: number, W: number, title: string, lines: { label: string; value: string; color?: string }[]): string {
  const lineH = 16;
  const padX = 10;
  const charW = 6.6;
  const longest = Math.max(title.length * 1.05, ...lines.map((l) => l.label.length + l.value.length + 4));
  const width = Math.min(W - 8, Math.max(130, longest * charW + padX * 2));
  const height = 10 + lineH + lines.length * lineH + 8;
  const bx = Math.max(4, Math.min(W - width - 4, x - width / 2));
  let by = y - height - 12;
  if (by < 2) by = y + 16;
  const rows = lines
    .map((l, i) => {
      const ly = by + 10 + lineH + (i + 1) * lineH - 4;
      const swatch = l.color ? `<rect x="${(bx + padX).toFixed(1)}" y="${(ly - 8).toFixed(1)}" width="8" height="8" rx="2" fill="${l.color}" />` : "";
      return `${swatch}<text x="${(bx + padX + (l.color ? 13 : 0)).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11.5" fill="${COLORS.text}">${escapeHtml(l.label)}</text>
        <text x="${(bx + width - padX).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11.5" font-weight="600" fill="#f8fafc" text-anchor="end">${escapeHtml(l.value)}</text>`;
    })
    .join("");
  return `<g class="ttp"><rect x="${(bx + 1).toFixed(1)}" y="${(by + 2).toFixed(1)}" width="${width.toFixed(1)}" height="${height}" rx="7" fill="#020617" opacity="0.35" />
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${width.toFixed(1)}" height="${height}" rx="7" fill="#0b1220" stroke="#334155" />
    <text x="${(bx + padX).toFixed(1)}" y="${(by + 10 + 4).toFixed(1)}" font-size="10.5" font-weight="600" letter-spacing="0.06em" fill="${COLORS.neutral}">${escapeHtml(title.toUpperCase())}</text>${rows}</g>`;
}

export function emptyChart(message = "Ainda não existem dados suficientes neste período."): string {
  return `<div class="chart-empty"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.55;display:block;margin:0 auto 8px"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>${escapeHtml(message)}</div>`;
}

/** Linha/área temporal com até duas séries (eixo secundário opcional, deixado explícito na legenda). */
export function lineChart(opts: { series: Series[]; height?: number; ariaLabel: string }): string {
  const { series } = opts;
  if (series.length === 0 || !hasData(series)) return emptyChart();
  const W = 960;
  const H = opts.height ?? 280;
  const padL = 60;
  const padR = series.some((s) => s.secondary) ? 68 : 20;
  const padT = 16;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(...series.map((s) => s.points.length));
  if (n === 0) return emptyChart();

  const maxPrimary = niceMax(Math.max(0, ...series.filter((s) => !s.secondary).flatMap((s) => s.points.map((p) => p.value ?? 0))));
  const maxSecondary = niceMax(Math.max(0, ...series.filter((s) => s.secondary).flatMap((s) => s.points.map((p) => p.value ?? 0))));

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number, secondary: boolean) => padT + innerH - (v / (secondary ? maxSecondary : maxPrimary)) * innerH;

  const primary = series.find((s) => !s.secondary);
  const secondarySeries = series.find((s) => s.secondary);
  // Grid discreto: linha base sólida, demais tracejadas; rótulos dos eixos com respiro.
  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = (padT + innerH - f * innerH).toFixed(1);
      const left = primary ? primary.format(f * maxPrimary) : "";
      const right = secondarySeries ? secondarySeries.format(f * maxSecondary) : "";
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" stroke-width="1" ${f === 0 ? "" : 'stroke-dasharray="2 4"'} />
        <text x="${padL - 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(left)}</text>
        ${secondarySeries ? `<text x="${W - padR + 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="start" font-size="10.5" fill="${secondarySeries.color}" opacity="0.9">${escapeHtml(right)}</text>` : ""}`;
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(n / 8));
  // Último rótulo sempre aparece; o penúltimo "regular" é omitido se ficaria colado nele.
  const showLabel = (i: number) => i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= Math.ceil(labelEvery / 2));
  const xLabels = series[0].points
    .map((p, i) => (showLabel(i) ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(p.label)}</text>` : ""))
    .join("");

  // Área com gradiente muito sutil só sob a série principal (a secundária fica tracejada, sem área).
  const gradId = nextGradientId("lc");
  const defs = primary
    ? `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${primary.color}" stop-opacity="0.22" /><stop offset="100%" stop-color="${primary.color}" stop-opacity="0" /></linearGradient></defs>`
    : "";

  const paths = series
    .map((s) => {
      // Segmentos contíguos (um valor null interrompe a linha, como antes).
      const segments: { x: number; y: number }[][] = [];
      let cur: { x: number; y: number }[] = [];
      s.points.forEach((p, i) => {
        if (p.value === null || p.value === undefined) {
          if (cur.length) segments.push(cur);
          cur = [];
          return;
        }
        cur.push({ x: x(i), y: y(p.value, !!s.secondary) });
      });
      if (cur.length) segments.push(cur);
      const d = segments.map(smoothPath).join(" ");
      const baseline = (padT + innerH).toFixed(1);
      const area =
        s === primary
          ? segments
              .filter((seg) => seg.length > 1)
              .map((seg) => `<path d="${smoothPath(seg)} L${seg[seg.length - 1].x.toFixed(1)},${baseline} L${seg[0].x.toFixed(1)},${baseline} Z" fill="url(#${gradId})" />`)
              .join("")
          : "";
      return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.secondary ? 1.75 : 2.25}" stroke-linejoin="round" stroke-linecap="round" ${s.secondary ? 'stroke-dasharray="6 5"' : ""} />`;
    })
    .join("");

  // Pontos + tooltip: um grupo por dia reúne todas as séries daquele dia (hover em qualquer altura da coluna).
  const colW = Math.max(6, innerW / Math.max(1, n - 1));
  const points = series[0].points
    .map((_, i) => {
      const values = series.map((s) => ({ s, v: s.points[i]?.value ?? null })).filter((e) => e.v !== null && e.v !== undefined);
      if (values.length === 0) return "";
      const cx = x(i);
      const topY = Math.min(...values.map((e) => y(e.v as number, !!e.s.secondary)));
      const dots = values
        .map(
          (e) =>
            `<circle class="dot" cx="${cx.toFixed(1)}" cy="${y(e.v as number, !!e.s.secondary).toFixed(1)}" r="3.2" fill="#0f172a" stroke="${e.s.color}" stroke-width="2"><title>${escapeHtml(`${series[0].points[i].label} — ${e.s.name}: ${e.s.format(e.v as number)}`)}</title></circle>`
        )
        .join("");
      const tip = svgTooltip(cx, topY, W, series[0].points[i].label, values.map((e) => ({ label: e.s.name, value: e.s.format(e.v as number), color: e.s.color })));
      return `<g class="pt"><rect x="${(cx - colW / 2).toFixed(1)}" y="${padT}" width="${colW.toFixed(1)}" height="${innerH}" fill="transparent" /><line class="ttp" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${padT}" y2="${padT + innerH}" stroke="${COLORS.neutral}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />${dots}${tip}</g>`;
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
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg">${defs}${gridLines}${xLabels}${paths}${points}</svg>
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
  // Largura menor que a do gráfico de linha: este gráfico costuma viver em meia coluna,
  // e o SVG escala com o container — assim o texto continua legível.
  const rowH = 30;
  const W = 600;
  const labelW = 170;
  const valueW = 100;
  const trackW = W - labelW - valueW;
  const H = items.length * rowH + 8;
  const rows = items
    .map((it, idx) => {
      const v = it.value as number;
      const w = Math.max(3, (v / max) * trackW);
      const yy = idx * rowH + 4;
      const color = it.color ?? COLORS.accent;
      // Trilha discreta atrás da barra (comparação visual entre linhas) + barra arredondada com hover.
      return `<g class="pt bar-g">
        <title>${escapeHtml(it.tooltip ?? `${it.label}: ${opts.format(v)}`)}</title>
        <rect x="0" y="${yy}" width="${W}" height="${rowH - 2}" fill="transparent" />
        <text x="${labelW - 12}" y="${yy + 18}" text-anchor="end" font-size="12" fill="${COLORS.text}">${escapeHtml(it.label.length > 24 ? it.label.slice(0, 23) + "…" : it.label)}</text>
        <rect x="${labelW}" y="${yy + 6}" width="${trackW}" height="${rowH - 14}" rx="4" fill="${COLORS.grid}" opacity="0.6" />
        <rect class="bar" x="${labelW}" y="${yy + 6}" width="${w.toFixed(1)}" height="${rowH - 14}" rx="4" fill="${color}" opacity="0.8" />
        <text x="${(labelW + w + 10).toFixed(1)}" y="${yy + 18}" font-size="12" font-weight="600" fill="#f8fafc">${escapeHtml(opts.format(v))}</text>
      </g>`;
    })
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg" style="max-height:${H}px">${rows}</svg></div>`;
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
        ${s.href ? `<a href="${escapeHtml(s.href)}" class="funnel-link">${inner}</a>` : `<div>${inner}</div>`}
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
    .map((v, i) => (v === null || v === undefined ? null : { x: (i / (n - 1)) * W, y: H - ((v - min) / range) * (H - 6) - 3 }))
    .filter((p): p is { x: number; y: number } => p !== null);
  if (pts.length < 2) return "";
  // Curva suave + área sutil + ponto final (mesmos valores, só acabamento).
  const id = nextGradientId("sp");
  const d = smoothPath(pts);
  const last = pts[pts.length - 1];
  const area = `${d} L${last.x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="sparkline" aria-hidden="true" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.2" fill="${color}"/></svg>`;
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
  const H = 320;
  const padL = 60;
  const padR = 24;
  const padT = 20;
  const padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  // Folga de ~20% nos eixos para a maior bolha (e o rótulo acima dela) não ser cortada na borda.
  const maxX = niceMax(Math.max(...points.map((p) => p.x)) * 1.2);
  const maxY = Math.min(1, niceMax(Math.max(...points.map((p) => p.y), 0.05) * 1.2));
  const maxSize = Math.max(...points.map((p) => p.size), 1);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = (padT + innerH - f * innerH).toFixed(1);
      const xx = (padL + f * innerW).toFixed(1);
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" ${f === 0 ? "" : 'stroke-dasharray="2 4"'} />
        <text x="${padL - 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${(f * maxY * 100).toFixed(0)}%</text>
        <text x="${xx}" y="${H - 14}" text-anchor="middle" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(formatX(f * maxX))}</text>`;
    })
    .join("");
  const circles = points
    .map((p) => {
      const cx = padL + (p.x / maxX) * innerW;
      const cy = padT + innerH - (Math.min(p.y, maxY) / maxY) * innerH;
      const r = 7 + Math.sqrt(p.size / maxSize) * 24;
      const color = p.color ?? COLORS.accent;
      // O texto do tooltip é o mesmo de antes (uma linha); só ganha o balão visual no hover.
      const [tipTitle, tipRest] = p.tooltip.includes(" — ") ? [p.tooltip.slice(0, p.tooltip.indexOf(" — ")), p.tooltip.slice(p.tooltip.indexOf(" — ") + 3)] : [p.label, p.tooltip];
      const tipLines = tipRest.split(", ").map((seg) => {
        const cut = seg.lastIndexOf(" ");
        return cut > 0 ? { label: seg.slice(0, cut), value: seg.slice(cut + 1) } : { label: seg, value: "" };
      });
      return `<g class="pt"><circle class="dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="0.5" stroke="${color}" stroke-width="1.5"><title>${escapeHtml(p.tooltip)}</title></circle>
        <text x="${cx.toFixed(1)}" y="${(cy - r - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="500" fill="${COLORS.text}">${escapeHtml(p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label)}</text>
        ${svgTooltip(cx, cy - r, W, tipTitle, tipLines)}</g>`;
    })
    .join("");
  return `<div class="chart">
    <div class="chart-legend"><span class="meta">Eixo X: CPL (menor é melhor) · Eixo Y: taxa de fechamento (maior é melhor) · Tamanho: investimento</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Custo por lead versus taxa de fechamento por campanha" class="chart-svg">${grid}${circles}</svg>
  </div>`;
}
