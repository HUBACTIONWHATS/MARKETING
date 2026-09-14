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
  accent: "#ff3d84",
  purple: "#8b5cf6",
  positive: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  meta: "#a78bfa",
  google: "#fb923c",
  neutral: "#94a3b8",
  muted: "#475569",
  grid: "#232330",
  axis: "#3a3a4a",
  surface: "#15151f",
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
      const swatch = l.color ? `<rect x="${(bx + padX).toFixed(1)}" y="${(ly - 5).toFixed(1)}" width="10" height="2.5" rx="1.25" fill="${l.color}" />` : "";
      return `${swatch}<text x="${(bx + padX + (l.color ? 15 : 0)).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11.5" fill="${COLORS.text}">${escapeHtml(l.label)}</text>
        <text x="${(bx + width - padX).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11.5" font-weight="600" fill="#f8fafc" text-anchor="end">${escapeHtml(l.value)}</text>`;
    })
    .join("");
  return `<g class="ttp"><rect x="${(bx + 1).toFixed(1)}" y="${(by + 2).toFixed(1)}" width="${width.toFixed(1)}" height="${height}" rx="7" fill="#020617" opacity="0.35" />
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${width.toFixed(1)}" height="${height}" rx="7" fill="#101018" stroke="#31313f" />
    <text x="${(bx + padX).toFixed(1)}" y="${(by + 10 + 4).toFixed(1)}" font-size="10.5" font-weight="600" letter-spacing="0.06em" fill="${COLORS.neutral}">${escapeHtml(title.toUpperCase())}</text>${rows}</g>`;
}

/**
 * Converte o texto de tooltip já existente ("Meta Ads — leads 150, receita R$ 960,00")
 * em linhas rótulo/valor para o balão visual. Só apresentação: o texto completo segue
 * no <title>. Sem " — " ou sem vírgulas, devolve lista vazia.
 */
function tooltipRows(text: string | undefined): { label: string; value: string }[] {
  if (!text || !text.includes(" — ")) return [];
  const rest = text.slice(text.indexOf(" — ") + 3);
  return rest
    .split(", ")
    .map((seg) => {
      const cut = seg.lastIndexOf(" ");
      if (cut <= 0) return null;
      const label = seg.slice(0, cut);
      return { label: label.charAt(0).toUpperCase() + label.slice(1), value: seg.slice(cut + 1) };
    })
    .filter((r): r is { label: string; value: string } => r !== null);
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
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${f === 0 ? COLORS.axis : COLORS.grid}" stroke-width="1" />
        <text x="${padL - 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(left)}</text>
        ${secondarySeries ? `<text x="${W - padR + 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="start" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(right)}</text>` : ""}`;
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
            `<circle class="dot" cx="${cx.toFixed(1)}" cy="${y(e.v as number, !!e.s.secondary).toFixed(1)}" r="3.5" fill="${e.s.color}" stroke="${COLORS.surface}" stroke-width="2"><title>${escapeHtml(`${series[0].points[i].label} — ${e.s.name}: ${e.s.format(e.v as number)}`)}</title></circle>`
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
export function barChart(opts: { items: BarItem[]; format: (v: number) => string; ariaLabel: string; valueLabel?: string }): string {
  const items = opts.items.filter((i) => i.value !== null && i.value !== undefined);
  if (items.length === 0) return emptyChart();
  // Colunas verticais finas (máx. 40 unidades) sobre uma única linha-base, topo arredondado,
  // valor no topo, categoria embaixo; grid em linhas finas sólidas. O SVG escala com o container.
  const W = 600;
  const H = 236;
  const padL = 78;
  const padR = 16;
  const padT = 30;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const baseY = padT + innerH;
  const max = niceMax(Math.max(...items.map((i) => i.value as number), 0));
  const slot = innerW / items.length;
  const barW = Math.max(14, Math.min(40, slot * 0.45));
  const y = (v: number) => baseY - (Math.max(0, v) / max) * innerH;
  const grid =
    [0.25, 0.5, 0.75, 1]
      .map((f) => {
        const yy = (baseY - f * innerH).toFixed(1);
        return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" stroke-width="1" />
        <text x="${padL - 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(opts.format(f * max))}</text>`;
      })
      .join("") +
    `<line x1="${padL}" x2="${W - padR}" y1="${baseY}" y2="${baseY}" stroke="${COLORS.axis}" stroke-width="1" />
    <text x="${padL - 10}" y="${baseY + 4}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(opts.format(0))}</text>`;
  const maxChars = Math.max(6, Math.floor(slot / 6.4));
  const cols = items
    .map((it, idx) => {
      const v = it.value as number;
      const cx = padL + slot * idx + slot / 2;
      const x0 = cx - barW / 2;
      const top = y(v);
      const h = baseY - top;
      const r = Math.min(4, barW / 2, h / 2);
      const bar =
        h > 0
          ? `<path class="bar" d="M${x0.toFixed(1)},${baseY} V${(top + r).toFixed(1)} Q${x0.toFixed(1)},${top.toFixed(1)} ${(x0 + r).toFixed(1)},${top.toFixed(1)} H${(x0 + barW - r).toFixed(1)} Q${(x0 + barW).toFixed(1)},${top.toFixed(1)} ${(x0 + barW).toFixed(1)},${(top + r).toFixed(1)} V${baseY} Z" fill="${it.color ?? COLORS.accent}" opacity="0.85" />`
          : "";
      const label = it.label.length > maxChars ? it.label.slice(0, maxChars - 1) + "…" : it.label;
      const rows = [{ label: opts.valueLabel ?? "Valor", value: opts.format(v) }, ...tooltipRows(it.tooltip).filter((r) => r.label.toLowerCase() !== (opts.valueLabel ?? "").toLowerCase())];
      return `<g class="pt bar-g">
        <title>${escapeHtml(it.tooltip ?? `${it.label}: ${opts.format(v)}`)}</title>
        <rect x="${(padL + slot * idx).toFixed(1)}" y="${padT - 20}" width="${slot.toFixed(1)}" height="${innerH + 20 + padB}" fill="transparent" />
        ${bar}
        <text x="${cx.toFixed(1)}" y="${(top - 8).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#f8fafc">${escapeHtml(opts.format(v))}</text>
        <text x="${cx.toFixed(1)}" y="${baseY + 20}" text-anchor="middle" font-size="11" fill="${COLORS.neutral}">${escapeHtml(label)}</text>
        ${svgTooltip(cx, top, W, it.label, rows)}
      </g>`;
    })
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg chart-bars">${grid}${cols}</svg></div>`;
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
  const maxVal = Math.max(...valid.map((s) => s.value as number));
  const n = steps.length;
  let prev: number | null = null;
  // Blocos centralizados; rótulo e valor à esquerda, conversão/acumulada/perda à direita; tom da barra
  // escurece etapa a etapa (escala ordinal, uma cor). A LARGURA usa escala logarítmica — do anúncio à
  // venda os volumes variam 5 ordens de grandeza e, em escala linear, tudo abaixo do topo vira um risco.
  // A escala é declarada na nota do componente; os números e taxas ao lado são os valores reais.
  const rows = steps
    .map((s, idx) => {
      const v = s.value;
      const has = v !== null && v !== undefined;
      const widthPct = !has || (v as number) <= 0 || maxVal <= 0 ? 0 : Math.max(5, (Math.log10((v as number) + 1) / Math.log10(maxVal + 1)) * 100);
      const pct = (x: number) => (x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(0)}%`).replace(".", ",");
      // Etapas nem sempre são estritamente aninhadas (ex.: lead criado à mão no CRM sem conversa):
      // quando a etapa é MAIOR que a anterior, não existe "conversão" nem "perda" a mostrar.
      const nested = has && prev !== null && prev > 0 && (v as number) <= prev;
      const stepConv = nested ? pct((v as number) / (prev as number)) : "—";
      const cumConv = has && first > 0 && (v as number) <= first ? pct((v as number) / first) : "—";
      const loss = nested && (v as number) < (prev as number) ? `${pct(((prev as number) - (v as number)) / (prev as number))} perdidos` : "";
      if (has) prev = v as number;
      const valueLabel = has ? (v as number).toLocaleString("pt-BR") : "—";
      const alpha = n > 1 ? 0.35 + 0.55 * (idx / (n - 1)) : 0.7;
      const tip = `<div class="funnel-tip" aria-hidden="true"><div class="tip-title">${escapeHtml(s.label)}</div>
          <div class="tip-row"><span>Quantidade</span><strong>${escapeHtml(valueLabel)}</strong></div>
          <div class="tip-row"><span>Conversão da etapa anterior</span><strong>${stepConv}</strong></div>
          <div class="tip-row"><span>Acumulada desde a 1ª etapa</span><strong>${cumConv}</strong></div>
          ${loss ? `<div class="tip-row"><span>Perda</span><strong>${escapeHtml(loss)}</strong></div>` : ""}
          ${s.costLabel ? `<div class="tip-row"><span>Custo</span><strong>${escapeHtml(s.costLabel)}</strong></div>` : ""}</div>`;
      const inner = `<div class="funnel-stage"><span class="funnel-name">${escapeHtml(s.label)}</span><span class="funnel-value">${escapeHtml(valueLabel)}</span>${s.costLabel ? `<span class="funnel-cost">${escapeHtml(s.costLabel)}</span>` : ""}</div>
        <div class="funnel-track">${has ? `<div class="funnel-bar" style="width:${widthPct.toFixed(1)}%;opacity:${alpha.toFixed(2)}"></div>` : ""}${tip}</div>
        <div class="funnel-conv"><span class="funnel-rate" title="Conversão da etapa anterior para esta">${stepConv}</span><span class="funnel-cum" title="Conversão acumulada desde a primeira etapa">${cumConv} acum.</span>${loss ? `<span class="funnel-loss">${escapeHtml(loss)}</span>` : ""}</div>`;
      return s.href ? `<a href="${escapeHtml(s.href)}" class="funnel-row funnel-link">${inner}</a>` : `<div class="funnel-row">${inner}</div>`;
    })
    .join("");
  return `<div class="funnel">${rows}<div class="funnel-note">Largura das barras em escala logarítmica (para caber do anúncio à venda no mesmo desenho) — as taxas ao lado são os valores reais.</div></div>`;
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
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${f === 0 ? COLORS.axis : COLORS.grid}" stroke-width="1" />
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
      const tipTitle = p.tooltip.includes(" — ") ? p.tooltip.slice(0, p.tooltip.indexOf(" — ")) : p.label;
      const parsed = tooltipRows(p.tooltip);
      const tipLines = parsed.length ? parsed : [{ label: "Detalhes", value: p.tooltip }];
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

export interface GaugeBand {
  /** Limite superior exclusivo da faixa (a última usa o máximo). */
  upTo: number;
  color: string;
  label: string;
}

/**
 * Gauge semicircular: arco de trilha + arco preenchido na cor do estado, faixas de
 * desempenho discretas por fora (limites vêm de quem chama — nunca inventados aqui),
 * valor grande no centro. `value` null → sem preenchimento e "—".
 */
export function gaugeChart(opts: { value: number | null; max?: number; color: string; statusLabel: string; bands?: GaugeBand[]; ariaLabel: string }): string {
  const max = opts.max ?? 100;
  const W = 260;
  const H = 156;
  const cx = 130;
  const cy = 132;
  const r = 92;
  const stroke = 14;
  const f = (v: number) => v.toFixed(2);
  const point = (frac: number, radius: number) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, frac)));
    return { x: cx + radius * Math.cos(a), y: cy - radius * Math.sin(a) };
  };
  const arc = (from: number, to: number, radius: number) => {
    const p0 = point(from, radius);
    const p1 = point(to, radius);
    const large = to - from > 0.5 ? 1 : 0;
    return `M${f(p0.x)},${f(p0.y)} A${radius},${radius} 0 ${large} 1 ${f(p1.x)},${f(p1.y)}`;
  };
  const frac = opts.value === null ? 0 : Math.min(1, Math.max(0, opts.value / max));
  const track = `<path d="${arc(0, 1, r)}" fill="none" stroke="${COLORS.grid}" stroke-width="${stroke}" stroke-linecap="round" />`;
  const fill = frac > 0 ? `<path d="${arc(0, frac, r)}" fill="none" stroke="${opts.color}" stroke-width="${stroke}" stroke-linecap="round" />` : "";
  let bandsSvg = "";
  if (opts.bands && opts.bands.length) {
    let start = 0;
    bandsSvg = opts.bands
      .map((b, i) => {
        const end = i === opts.bands!.length - 1 ? max : b.upTo;
        const seg = `<path d="${arc(start / max, end / max, r + 15)}" fill="none" stroke="${b.color}" stroke-width="3" opacity="0.45" />`;
        const tick =
          i < opts.bands!.length - 1
            ? `<text x="${f(point(end / max, r + 26).x)}" y="${f(point(end / max, r + 26).y + 3)}" text-anchor="middle" font-size="10" fill="${COLORS.neutral}">${end}</text>`
            : "";
        start = end;
        return seg + tick;
      })
      .join("");
  }
  const valueText = opts.value === null ? "—" : String(Math.round(opts.value));
  const tip = svgTooltip(cx, cy - r - stroke, W, "Índice", [
    { label: "Valor", value: opts.value === null ? "—" : `${Math.round(opts.value)} / ${max}` },
    { label: "Estado", value: opts.statusLabel, color: opts.color },
  ]);
  return `<div class="gauge"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg gauge-svg">
    ${bandsSvg}
    <g class="pt"><rect x="0" y="0" width="${W}" height="${H}" fill="transparent" />${track}${fill}
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="40" font-weight="600" letter-spacing="-0.03em" fill="#f8fafc">${escapeHtml(valueText)}</text>
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="11.5" fill="${COLORS.neutral}">de ${max}</text>${tip}</g>
  </svg></div>`;
}

// --- Componentes v3: donut, radar, colunas empilhadas, heatmap, barra de progresso -----------

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

/** Participação (parte do todo) com ≤ 6 fatias; centro mostra o total. Total zero → estado vazio. */
export function donutChart(opts: { items: DonutItem[]; format: (v: number) => string; centerLabel?: string; ariaLabel: string }): string {
  const items = opts.items.filter((i) => i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (items.length === 0 || total <= 0) return emptyChart("Sem valores para distribuir neste período.");
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 66;
  const stroke = 18;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = items
    .map((it) => {
      const frac = it.value / total;
      const len = frac * circ;
      const gap = items.length > 1 ? 2 : 0;
      const seg = `<circle class="dot" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(circ - Math.max(0, len - gap)).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${escapeHtml(`${it.label}: ${opts.format(it.value)} (${(frac * 100).toFixed(1).replace(".", ",")}%)`)}</title></circle>`;
      offset += len;
      return `<g class="pt">${seg}</g>`;
    })
    .join("");
  const legend = items
    .map((it) => `<li><span class="k"><span class="legend-swatch" style="background:${it.color}"></span>${escapeHtml(it.label)}</span><span class="v">${escapeHtml(opts.format(it.value))} · ${((it.value / total) * 100).toFixed(0)}%</span></li>`)
    .join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg" style="max-width:${size}px">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS.grid}" stroke-width="${stroke}" />${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="600" fill="#f8fafc">${escapeHtml(opts.format(total))}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(opts.centerLabel ?? "total")}</text>
  </svg><ul class="donut-legend">${legend}</ul></div>`;
}

/** Radar de performance: valores já normalizados de 0 a 1 por quem chama (a nota diz como). */
export function radarChart(opts: { axes: string[]; series: { name: string; color: string; values: (number | null)[] }[]; ariaLabel: string; note?: string }): string {
  const n = opts.axes.length;
  if (n < 3 || !opts.series.some((s) => s.values.some((v) => v !== null))) return emptyChart("Sem dados suficientes para o radar neste período.");
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const r = 118;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * 2 * Math.PI;
  const pt = (i: number, f: number) => ({ x: cx + r * f * Math.cos(angle(i)), y: cy + r * f * Math.sin(angle(i)) });
  const rings = [0.25, 0.5, 0.75, 1]
    .map((f) => `<polygon points="${opts.axes.map((_, i) => { const p = pt(i, f); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ")}" fill="none" stroke="${COLORS.grid}" stroke-width="1" />`)
    .join("");
  const spokes = opts.axes
    .map((a, i) => {
      const p = pt(i, 1);
      const l = pt(i, 1.2);
      const anchor = Math.abs(Math.cos(angle(i))) < 0.2 ? "middle" : Math.cos(angle(i)) > 0 ? "start" : "end";
      return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${COLORS.grid}" /><text x="${l.x.toFixed(1)}" y="${(l.y + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${COLORS.text}">${escapeHtml(a)}</text>`;
    })
    .join("");
  const polys = opts.series
    .map((s) => {
      const pts = s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v ?? 0))));
      const d = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const dots = pts.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${s.color}" stroke="${COLORS.surface}" stroke-width="2"><title>${escapeHtml(`${s.name} — ${opts.axes[i]}: ${s.values[i] === null ? "—" : `${Math.round((s.values[i] as number) * 100)}%`}`)}</title></circle>`).join("");
      return `<polygon points="${d}" fill="${s.color}" fill-opacity="0.14" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" />${dots}`;
    })
    .join("");
  const legend = opts.series.map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join("");
  return `<div class="chart"><div class="chart-legend">${legend}${opts.note ? `<span class="meta">${escapeHtml(opts.note)}</span>` : ""}</div><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg" style="max-width:420px;margin:0 auto">${rings}${spokes}${polys}</svg></div>`;
}

/** Colunas empilhadas por categoria (ex.: investimento por dia, Meta + Google) com 2px de respiro entre segmentos. */
export function stackedBarChart(opts: { categories: string[]; series: { name: string; color: string; values: (number | null)[] }[]; format: (v: number) => string; ariaLabel: string }): string {
  const n = opts.categories.length;
  const totals = opts.categories.map((_, i) => opts.series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  if (n === 0 || !opts.series.some((s) => s.values.some((v) => v !== null))) return emptyChart();
  const W = 960;
  const H = 260;
  const padL = 64;
  const padR = 16;
  const padT = 18;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const baseY = padT + innerH;
  const max = niceMax(Math.max(...totals, 0));
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(28, slot * 0.6));
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = (baseY - f * innerH).toFixed(1);
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="${COLORS.grid}" /><text x="${padL - 10}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(opts.format(f * max))}</text>`;
    })
    .join("") + `<line x1="${padL}" x2="${W - padR}" y1="${baseY}" y2="${baseY}" stroke="${COLORS.axis}" />`;
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const cols = opts.categories
    .map((cat, i) => {
      const cx = padL + slot * i + slot / 2;
      let y = baseY;
      const segs = opts.series
        .map((se) => {
          const v = se.values[i];
          if (v === null || v <= 0) return "";
          const h = (v / max) * innerH;
          const top = y - h;
          const seg = `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(top + 1).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h - 2).toFixed(1)}" rx="2" fill="${se.color}" opacity="0.9" />`;
          y = top;
          return seg;
        })
        .join("");
      const rows = opts.series.filter((se) => se.values[i] !== null).map((se) => ({ label: se.name, value: opts.format(se.values[i] as number), color: se.color }));
      rows.push({ label: "Total", value: opts.format(totals[i]), color: COLORS.neutral });
      const label = i % labelEvery === 0 || i === n - 1 ? `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="${COLORS.neutral}">${escapeHtml(cat)}</text>` : "";
      return `<g class="pt"><rect x="${(padL + slot * i).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${innerH + padB}" fill="transparent" />${segs}${label}${svgTooltip(cx, y, W, cat, rows)}</g>`;
    })
    .join("");
  const legend = opts.series.map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join("");
  return `<div class="chart"><div class="chart-legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(opts.ariaLabel)}" class="chart-svg">${grid}${cols}</svg></div>`;
}

/** Mapa de calor (linhas × colunas) em uma só cor; tudo null → estado vazio explicando o que falta. */
export function heatmapChart(opts: { rows: string[]; cols: string[]; values: (number | null)[][]; format: (v: number) => string; ariaLabel: string; emptyMessage?: string }): string {
  const flat = opts.values.flat().filter((v): v is number => v !== null);
  if (flat.length === 0) return emptyChart(opts.emptyMessage ?? "Sem dados para o mapa de calor.");
  const max = Math.max(...flat, 0) || 1;
  const head = `<tr><th></th>${opts.cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = opts.rows
    .map((r, ri) => `<tr><th style="text-align:right;padding-right:6px">${escapeHtml(r)}</th>${opts.cols
      .map((c, ci) => {
        const v = opts.values[ri]?.[ci] ?? null;
        const a = v === null ? 0 : 0.12 + 0.78 * (v / max);
        return `<td style="background:rgba(255,61,132,${a.toFixed(2)})" title="${escapeHtml(`${r} · ${c}: ${v === null ? "—" : opts.format(v)}`)}"></td>`;
      })
      .join("")}</tr>`)
    .join("");
  return `<div class="chart" role="img" aria-label="${escapeHtml(opts.ariaLabel)}"><table class="heatmap-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** Barra de progresso (HTML) — tom por atingimento; null → trilha vazia. */
export function progressBar(fraction: number | null, tone: "auto" | "brand" = "auto"): string {
  const pct = fraction === null ? 0 : Math.max(0, Math.min(100, fraction * 100));
  const cls = tone === "brand" || fraction === null ? "" : pct >= 100 ? " ok" : pct >= 60 ? "" : pct >= 30 ? " warn" : " bad";
  return `<div class="progress${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

/** Mini-barras (sparkline em colunas) para cards de KPI — mesmos valores da série diária. */
export function sparkBars(values: (number | null)[], color = COLORS.accent): string {
  const nums = values.filter((v): v is number => v !== null && v !== undefined);
  if (nums.length < 2) return "";
  const W = 120;
  const H = 28;
  const n = values.length;
  const max = Math.max(...nums, 0) || 1;
  const slot = W / n;
  const bw = Math.max(1.5, slot * 0.6);
  const bars = values
    .map((v, i) => {
      if (v === null || v === undefined) return "";
      const h = Math.max(1, (v / max) * (H - 2));
      const last = i === n - 1;
      return `<rect x="${(i * slot + (slot - bw) / 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${color}" opacity="${last ? 1 : 0.45}" />`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="sparkline" aria-hidden="true" preserveAspectRatio="none">${bars}</svg>`;
}
