import { currentShell, PROVIDER_NAV_LABEL, type ShellContext } from "./shellContext";
import type { MarketingProvider } from "./marketingModels";
import type {
  AuthorType,
  Conversation,
  ConversationListItem,
  ConversationStatus,
  MessageWithAuthor,
  WaitEpisode,
  WaitSummary,
  WaitTriggerType,
} from "./attendance";
import type { BusinessHours, WeekdayKey } from "./businessHours";
import type { OpportunityWithDetails, PipelineStage } from "./crm";
import { STATUS_LABELS, type ConnectionAdminView, type ConnectionStatusReport } from "./whatsapp";
import type { DashboardData, DashboardFilters } from "./dashboard";
import type { AuditEntry } from "./access";
import { CONFIDENCE_LABELS, LEAD_SOURCES, SOURCE_LABELS, type AttributionConfidence, type LeadSource } from "./attribution";
import type { Company, CompanyAdminRow, CompanyPlan, CompanyUserRow, MembershipWithCompany, Role, User } from "./models";

type PendingInvite = { email: string; role: Role; expires_at: string };
type GeneratedLink = { label: string; url: string };

type CompanyMember = { user_id: number; name: string; role: Role };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BASE_STYLE = `

  /* =====================================================================
     HUB ACTION — design system (camada visual; nenhuma classe removida)
     Espaçamento: 4 8 12 16 20 24 32 · raios 6/10/14 · fontes 11/12/13/14/20/26
     Cores com significado: accent (ação/seleção), success, warning, danger,
     meta (violeta), google (laranja). Tudo sóbrio: sem glow, sem vidro.
     ===================================================================== */
  :root {
    color-scheme: dark;
    --bg-primary: #0b1220; --bg-secondary: #0f172a; --surface: #111a2b; --surface-2: #0d1526; --surface-hover: #172033;
    --border: #1e293b; --border-strong: #2f3d52; --border-focus: #38bdf8;
    --text-primary: #f1f5f9; --text-secondary: #cbd5e1; --text-muted: #94a3b8; --text-faint: #64748b;
    --accent: #38bdf8; --accent-strong: #0ea5e9; --accent-soft: rgba(56,189,248,0.12);
    --success: #4ade80; --success-soft: rgba(74,222,128,0.12);
    --warning: #fbbf24; --warning-soft: rgba(251,191,36,0.12);
    --danger: #f87171; --danger-soft: rgba(248,113,113,0.12);
    --meta: #a78bfa; --google: #fb923c;
    /* aliases mantidos para compatibilidade com nomes já usados no projeto */
    --bg: var(--bg-primary); --bg-elev: var(--bg-secondary); --text: var(--text-primary); --text-2: var(--text-secondary);
    --muted: var(--text-muted); --muted-2: var(--text-faint); --positive: var(--success); --positive-soft: var(--success-soft);
    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s8: 32px;
    --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius: var(--radius-md); --r-pill: 999px;
    --shadow-sm: 0 1px 2px rgba(2,6,23,0.35);
    --font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --t: 140ms cubic-bezier(0.2, 0, 0, 1);
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg-secondary); color: var(--text-primary); font-family: var(--font); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: var(--radius-sm); }
  h1, h2, h3 { margin-top: 0; letter-spacing: -0.01em; }
  h2 { font-size: 20px; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }

  /* ---------- Autenticação / páginas centrais ---------- */
  .center-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--s8) var(--s4); background: var(--bg-primary); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--s8); width: 100%; max-width: 400px; }
  .card h1 { font-size: 18px; font-weight: 600; margin: 0 0 var(--s5); }
  label { display: block; font-size: 12.5px; font-weight: 500; color: var(--text-muted); margin-bottom: var(--s4); }
  input, select, textarea {
    display: block; width: 100%; margin-top: var(--s1); padding: 0 var(--s3); min-height: 36px;
    border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-primary);
    font-size: 13.5px; font-family: inherit; transition: border-color var(--t), box-shadow var(--t);
  }
  textarea { padding: var(--s2) var(--s3); min-height: 80px; }
  input:hover, select:hover, textarea:hover { border-color: #475569; }
  input:focus, select:focus, textarea:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-soft); outline: none; }
  input[type="checkbox"], input[type="radio"] { width: 16px; height: 16px; min-height: 0; margin: 0; accent-color: var(--accent); display: inline-block; }
  input[type="date"], input[type="time"], input[type="datetime-local"], input[type="number"] { color-scheme: dark; }
  select { appearance: none; -webkit-appearance: none; padding-right: 30px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }
  button {
    width: 100%; min-height: 38px; padding: 0 var(--s4); border-radius: var(--radius-sm); border: none;
    background: var(--accent); color: #0b1220; font-weight: 600; font-family: inherit; font-size: 14px; cursor: pointer;
    transition: background var(--t), transform var(--t);
  }
  button:hover { background: #5cc9fa; }
  button:active { transform: translateY(1px); }
  button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .error { color: var(--danger); font-size: 13px; margin: 0 0 var(--s4); padding: var(--s2) var(--s3); background: var(--danger-soft); border: 1px solid rgba(248,113,113,0.25); border-radius: var(--radius-sm); }
  .success { color: var(--success); font-size: 13px; margin: 0 0 var(--s4); padding: var(--s2) var(--s3); background: var(--success-soft); border: 1px solid rgba(74,222,128,0.25); border-radius: var(--radius-sm); }

  /* ---------- Shell: sidebar / topbar / conteúdo ---------- */
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: 232px; background: var(--bg-primary); border-right: 1px solid var(--border); padding: var(--s5) var(--s3); flex-shrink: 0; display: flex; flex-direction: column; gap: var(--s2); }
  .sidebar .brand { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; padding: var(--s1) var(--s2) var(--s4); color: var(--text-primary); line-height: 1.2; }
  .sidebar .brand .mark { width: 34px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .sidebar .brand .mark svg, .login-brand .mark svg { width: 100%; height: 100%; display: block; }
  .login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: var(--s5); }
  .login-brand .mark { width: 44px; height: 36px; flex-shrink: 0; }
  .login-brand strong { display: block; font-size: 15px; letter-spacing: 0.06em; }
  .login-brand small { display: block; font-size: 11px; color: var(--text-muted); letter-spacing: 0.04em; text-transform: uppercase; }
  .sidebar .brand small { display: block; font-weight: 500; letter-spacing: 0; color: var(--text-muted); font-size: 11px; margin-top: 2px; }
  .sidebar nav a {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); color: var(--text-secondary); text-decoration: none;
    font-size: 13.5px; font-weight: 500; margin-bottom: 2px; position: relative; transition: background var(--t), color var(--t);
  }
  .sidebar nav a svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
  .sidebar nav a:hover { background: var(--surface-hover); color: var(--text-primary); }
  .sidebar nav a.active { background: var(--accent-soft); color: var(--text-primary); font-weight: 600; }
  .sidebar nav a.active svg { opacity: 1; color: var(--accent); }
  .sidebar nav a.active::before { content: ""; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
  .sidebar nav .nav-group { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-faint); font-weight: 600; padding: var(--s4) 10px var(--s1); }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); padding: 12px var(--s8); border-bottom: 1px solid var(--border); background: var(--bg-secondary); position: sticky; top: 0; z-index: 30; min-height: 56px; }
  .topbar .company { font-weight: 600; font-size: 14px; }
  .topbar .who { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 10px; }
  .topbar form { display: inline; }
  .topbar button.logout { width: auto; min-height: 32px; background: transparent; border: 1px solid var(--border-strong); color: var(--text-secondary); padding: 0 var(--s3); font-weight: 500; font-size: 12.5px; }
  .topbar button.logout:hover { background: var(--surface-hover); color: var(--text-primary); }
  .content { padding: var(--s6) var(--s8) var(--s8); flex: 1; max-width: 1480px; width: 100%; }

  /* ---------- Cabeçalhos, seções, texto ---------- */
  .page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--s4); flex-wrap: wrap; margin-bottom: var(--s5); }
  .page-head h2 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  .page-head .sub { color: var(--text-muted); font-size: 13px; margin-top: 2px; }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 600; }
  .section-title { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: var(--s6) 0 var(--s3); color: var(--text-muted); display: flex; align-items: center; gap: var(--s3); }
  .section-title::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  .section-title:first-of-type { margin-top: 0; }
  .meta { font-size: 12.5px; color: var(--text-muted); }
  .muted { color: var(--text-muted); } .small { font-size: 12px; } .num { font-variant-numeric: tabular-nums; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--s5); gap: var(--s4); flex-wrap: wrap; }
  .toolbar h2 { font-size: 22px; letter-spacing: -0.02em; }
  .demo-banner { background: var(--warning-soft); color: #fde68a; border-bottom: 1px solid rgba(251,191,36,0.25); padding: 7px var(--s4); font-size: 12.5px; margin-bottom: var(--s5); display: flex; align-items: center; gap: var(--s2); }
  .notice-box { border: 1px solid rgba(251,191,36,0.3); background: var(--warning-soft); color: #fde68a; border-radius: var(--radius-sm); padding: 10px var(--s3); font-size: 12.5px; margin-bottom: var(--s4); }

  /* ---------- Botões ---------- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; width: auto;
    transition: background var(--t), border-color var(--t), color var(--t), transform var(--t); white-space: nowrap;
  }
  .btn:hover { background: var(--surface-hover); border-color: #475569; color: var(--text-primary); }
  .btn:active { transform: translateY(1px); }
  .btn-primary { background: var(--accent); color: #0b1220; border-color: var(--accent); font-weight: 600; }
  .btn-primary:hover { background: #5cc9fa; border-color: #5cc9fa; color: #0b1220; }
  .btn-danger { background: transparent; color: var(--danger); border-color: rgba(248,113,113,0.35); }
  .btn-danger:hover { background: var(--danger-soft); color: var(--danger); }
  .btn-small { min-height: 28px; padding: 0 10px; font-size: 12px; }
  .btn:disabled, .btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }

  /* ---------- Badges / chips / status ---------- */
  .badge, .chip, .role-tag {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; line-height: 1;
    padding: 4px 9px; border-radius: var(--r-pill); border: 1px solid var(--border-strong); color: var(--text-secondary); white-space: nowrap; background: rgba(148,163,184,0.06);
  }
  .role-tag { color: var(--accent); }
  .badge-auto { color: var(--text-muted); }
  .badge-aguardando, .chip-warn { color: var(--warning); border-color: rgba(251,191,36,0.35); background: var(--warning-soft); }
  .badge-humano, .chip-ok { color: var(--success); border-color: rgba(74,222,128,0.35); background: var(--success-soft); }
  .badge-cliente-aguarda { color: var(--accent); border-color: rgba(56,189,248,0.35); background: var(--accent-soft); }
  .badge-encerrado, .chip-muted { color: var(--text-muted); background: transparent; }
  .chip-bad { color: var(--danger); border-color: rgba(248,113,113,0.35); background: var(--danger-soft); }
  .chip-meta { color: var(--meta); border-color: rgba(167,139,250,0.4); background: rgba(167,139,250,0.10); }
  .chip-google { color: var(--google); border-color: rgba(251,146,60,0.4); background: rgba(251,146,60,0.10); }
  .sev { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 5px; text-transform: uppercase; letter-spacing: 0.06em; }
  .sev-CRITICO { background: var(--danger-soft); color: var(--danger); } .sev-ATENCAO { background: var(--warning-soft); color: var(--warning); }
  .sev-OPORTUNIDADE { background: var(--success-soft); color: var(--success); } .sev-INFORMACAO { background: rgba(148,163,184,0.15); color: var(--text-muted); }
  .semaforo { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; }
  .semaforo-VERDE { background: var(--success); } .semaforo-AMARELO { background: var(--warning); } .semaforo-VERMELHO { background: var(--danger); } .semaforo-CINZA { background: var(--text-faint); }

  /* ---------- Painéis, cards, listas ---------- */
  .panel, .card-block { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--s5); margin-bottom: var(--s4); background: var(--surface); }
  .panel h3, .card-block > h3 { font-size: 11.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 var(--s4); display: flex; justify-content: space-between; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .card-block > h3 .actions { display: flex; gap: var(--s2); text-transform: none; letter-spacing: 0; align-items: center; flex-wrap: wrap; font-weight: 500; }
  .card-block > h3 .actions select { margin: 0; min-height: 30px; font-size: 12.5px; padding-left: 10px; }
  .chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s4); flex-wrap: wrap; margin-bottom: var(--s4); }
  .chart-head h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--text-primary); text-transform: none; letter-spacing: -0.01em; display: block; }
  .chart-head .sub { font-size: 12.5px; color: var(--text-muted); }
  .chart-head .actions { display: flex; gap: var(--s2); align-items: center; flex-wrap: wrap; }
  .chart-head .actions select { margin: 0; min-height: 30px; font-size: 12.5px; padding-left: 10px; }
  details.panel > summary { cursor: pointer; font-weight: 600; color: var(--accent); list-style: none; font-size: 13.5px; }
  details.panel > summary::-webkit-details-marker { display: none; }
  details.panel[open] > summary { margin-bottom: var(--s4); }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li { padding: 10px var(--s3); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: var(--s2); display: flex; justify-content: space-between; align-items: center; gap: var(--s3); font-size: 13.5px; background: var(--surface-2); }
  .empty-state { border: 1px dashed var(--border-strong); border-radius: var(--radius-md); padding: var(--s8) var(--s6); text-align: center; color: var(--text-muted); background: var(--surface-2); }
  .empty-state h2 { color: var(--text-primary); margin: var(--s3) 0 var(--s2); font-size: 16px; font-weight: 600; }
  .empty-state p { margin: 0 auto; font-size: 13px; max-width: 480px; }
  .empty-state .es-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
  .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: var(--s5); align-items: start; }
  .grid-12 { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--s4); margin-bottom: var(--s4); }
  .col-12 { grid-column: span 12; } .col-8 { grid-column: span 8; } .col-7 { grid-column: span 7; } .col-6 { grid-column: span 6; } .col-5 { grid-column: span 5; } .col-4 { grid-column: span 4; } .col-3 { grid-column: span 3; }
  .grid-12 > [class*="col-"] > .card-block { height: 100%; margin-bottom: 0; }
  .field { margin-bottom: var(--s3); }
  .field label { font-size: 12.5px; color: var(--text-muted); display: block; margin-bottom: var(--s1); }
  .inline-form { display: flex; gap: var(--s2); align-items: center; flex-wrap: wrap; }
  .inline-form textarea, .inline-form input[type="text"] { flex: 1; margin-top: 0; }
  .inline-form .btn, .inline-form button { width: auto; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--s3); align-items: end; }
  .form-grid label { margin-bottom: 0; }
  .form-grid button { width: auto; }
  .checkbox-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); margin-bottom: 0; cursor: pointer; }
  .checkbox-line input { width: auto; }

  /* ---------- KPI cards ---------- */
  .metrics-grid, .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s3); margin-bottom: var(--s4); }
  .col-8 .kpi-grid, .col-7 .kpi-grid, .col-6 .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-card, .kpi {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px var(--s4) 12px; min-height: 108px;
    display: flex; flex-direction: column; gap: 3px; position: relative; transition: border-color var(--t);
  }
  .metric-card:hover, .kpi:hover { border-color: var(--border-strong); }
  .metric-card .label, .kpi .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 600; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
  .metric-card .value, .kpi .kpi-value { font-size: 27px; font-weight: 650; letter-spacing: -0.03em; line-height: 1.1; margin: 5px 0 3px; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .metric-card .help { font-size: 12px; color: var(--text-faint); margin-top: auto; line-height: 1.35; }
  .kpi .kpi-delta { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; flex-wrap: wrap; }
  .kpi .kpi-delta .arrow { display: inline-flex; width: 18px; height: 18px; border-radius: 5px; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: rgba(148,163,184,0.12); flex-shrink: 0; }
  .kpi .kpi-delta .vs, .kpi .kpi-delta.muted { color: var(--text-faint); }
  .kpi .kpi-delta.up { color: var(--success); } .kpi .kpi-delta.down { color: var(--danger); }
  .kpi .kpi-delta.up.bad { color: var(--danger); } .kpi .kpi-delta.down.good { color: var(--success); }
  .kpi .kpi-delta.up .arrow { background: var(--success-soft); } .kpi .kpi-delta.down .arrow { background: var(--danger-soft); }
  .kpi .kpi-delta.up.bad .arrow { background: var(--danger-soft); } .kpi .kpi-delta.down.good .arrow { background: var(--success-soft); }
  .kpi .sparkline { width: 100%; height: 30px; margin-top: 6px; }
  .kpi.kpi-secondary { min-height: 84px; padding: 12px 14px; } .kpi.kpi-secondary .kpi-value { font-size: 19px; }
  .tip { position: relative; cursor: help; border-bottom: 1px dotted var(--text-faint); }
  .tip::after {
    content: attr(data-tip); position: absolute; left: 0; top: calc(100% + 6px); z-index: 40; width: max-content; max-width: 260px;
    background: #0b1220; color: var(--text-secondary); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px; font-weight: 400;
    text-transform: none; letter-spacing: 0; white-space: normal; line-height: 1.4; opacity: 0; pointer-events: none; transition: opacity var(--t); box-shadow: 0 6px 16px rgba(2,6,23,0.4);
  }
  .tip:hover::after, .tip:focus::after { opacity: 1; }

  /* ---------- Gráficos ---------- */
  .chart { width: 100%; } .chart-svg { width: 100%; height: auto; display: block; font-family: var(--font); }
  .chart-legend { display: flex; gap: var(--s4); flex-wrap: wrap; font-size: 12px; color: var(--text-muted); margin-bottom: var(--s2); }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; } .legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .chart-empty { border: 1px dashed var(--border-strong); border-radius: var(--radius-md); padding: var(--s8) var(--s5); text-align: center; color: var(--text-muted); font-size: 13px; background: var(--surface-2); }
  .chart-svg .pt .ttp { opacity: 0; transition: opacity var(--t); pointer-events: none; }
  .chart-svg .pt:hover .ttp { opacity: 1; }
  .chart-svg .pt .dot { transition: r var(--t); }
  .chart-svg .pt:hover .dot { r: 5; }
  .chart-svg .bar-g .bar { transition: opacity var(--t); } .chart-svg .bar-g:hover .bar { opacity: 1; }
  .sparkline { display: block; }
  .funnel { display: flex; flex-direction: column; gap: 2px; }
  .funnel-row { display: grid; grid-template-columns: minmax(128px, 0.8fr) minmax(0, 2.2fr) minmax(112px, auto); gap: var(--s4); align-items: center; padding: 7px 10px; border-radius: var(--radius-sm); text-decoration: none; color: inherit; transition: background var(--t); }
  .funnel-row:hover { background: rgba(148,163,184,0.05); }
  .funnel-stage { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
  .funnel-name { font-size: 12.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .funnel-value { font-size: 16px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .funnel-cost { font-size: 11.5px; color: var(--text-faint); white-space: nowrap; }
  .funnel-track { position: relative; display: flex; justify-content: center; align-items: center; min-height: 30px; }
  .funnel-bar { height: 28px; border-radius: 6px; background: var(--accent); transition: filter var(--t); }
  .funnel-row:hover .funnel-bar { filter: brightness(1.15); }
  .funnel-conv { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; font-variant-numeric: tabular-nums; }
  .funnel-rate { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
  .funnel-cum { font-size: 11.5px; color: var(--text-muted); }
  .funnel-loss { color: var(--warning); font-size: 11px; background: var(--warning-soft); padding: 2px 7px; border-radius: var(--r-pill); }
  .funnel-note { font-size: 11px; color: var(--text-faint); margin: 8px 10px 0; }
  .funnel-tip { position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); z-index: 40; min-width: 250px; background: #0b1220; border: 1px solid var(--border-strong); border-radius: 7px; padding: 10px 12px; box-shadow: 0 6px 16px rgba(2,6,23,0.4); opacity: 0; pointer-events: none; transition: opacity var(--t); }
  .funnel-row:nth-child(-n+2) .funnel-tip { bottom: auto; top: calc(100% + 8px); }
  .funnel-row:hover .funnel-tip, .funnel-row:focus-visible .funnel-tip { opacity: 1; }
  .funnel-tip .tip-title { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; }
  .funnel-tip .tip-row { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; color: var(--text-secondary); line-height: 1.55; white-space: nowrap; }
  .funnel-tip .tip-row strong { color: #f8fafc; font-weight: 600; font-variant-numeric: tabular-nums; }
  .gauge { display: flex; justify-content: center; }
  .gauge-svg { max-width: 300px; }
  .gauge-status { display: flex; justify-content: center; margin: 2px 0 10px; }
  .gauge-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; font-size: 11.5px; color: var(--text-muted); margin-bottom: var(--s3); }
  .gauge-legend span { display: inline-flex; align-items: center; gap: 6px; } .gauge-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .chart-head.compact { margin-bottom: var(--s2); } .chart-head.compact h3 { font-size: 13px; }

  /* ---------- Tabelas ---------- */
  .data-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); }
  .data-table, .hours-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
  .data-table { min-width: 900px; }
  .data-table th, .hours-table th { position: sticky; top: 0; z-index: 1; background: var(--surface); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.08em; text-align: right; padding: 10px 12px; border-bottom: 1px solid var(--border-strong); white-space: nowrap; }
  .hours-table th { text-align: left; }
  .data-table th:first-child, .data-table td:first-child, .data-table th.left, .data-table td.left { text-align: left; }
  .data-table td, .hours-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; vertical-align: middle; }
  .hours-table td { text-align: left; }
  .data-table tbody tr:last-child td, .hours-table tbody tr:last-child td { border-bottom: none; }
  .data-table tbody tr td, .hours-table tbody tr td { transition: background var(--t); }
  .data-table tbody tr:hover td, .hours-table tbody tr:hover td { background: rgba(56,189,248,0.05); }
  .data-table a { color: var(--text-primary); text-decoration: none; font-weight: 500; } .data-table a:hover { color: var(--accent); }
  .data-table th a { color: inherit; text-decoration: none; }
  .hours-table input[type="time"] { padding: 4px 8px; min-height: 30px; width: auto; display: inline-block; margin: 0; }
  .hours-table .btn { min-height: 28px; }

  /* ---------- Filtros / abas / períodos ---------- */
  .filters-form, .filter-bar { display: flex; gap: var(--s3); flex-wrap: wrap; align-items: end; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--s3) var(--s4); margin-bottom: var(--s5); }
  .filters-form .field, .filter-bar .field { margin: 0; min-width: 150px; }
  .filters-form label, .filter-bar label { margin-bottom: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .filters-form select, .filters-form input, .filter-bar select, .filter-bar input { font-size: 13px; min-height: 34px; }
  .filters-form button, .filter-bar button { width: auto; min-height: 34px; align-self: end; }
  .preset-links { display: flex; gap: 6px; flex-wrap: wrap; }
  .preset-links a { font-size: 12px; font-weight: 500; padding: 6px 11px; border-radius: var(--r-pill); border: 1px solid var(--border-strong); color: var(--text-secondary); text-decoration: none; transition: background var(--t), color var(--t), border-color var(--t); }
  .preset-links a:hover { background: var(--surface-hover); color: var(--text-primary); }
  .preset-links a.active { background: var(--accent); color: #0b1220; border-color: var(--accent); font-weight: 600; }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin-bottom: var(--s5); overflow-x: auto; }
  .tabs a { padding: 10px 14px; color: var(--text-muted); text-decoration: none; font-size: 13.5px; font-weight: 500; border-bottom: 2px solid transparent; white-space: nowrap; margin-bottom: -1px; transition: color var(--t), border-color var(--t); }
  .tabs a:hover { color: var(--text-primary); }
  .tabs a.active { color: var(--text-primary); border-bottom-color: var(--accent); }
  .freshness { font-size: 12px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: var(--r-pill); background: var(--surface-2); border: 1px solid var(--border); align-self: center; }
  .freshness .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); display: inline-block; }
  .freshness.stale .dot { background: var(--warning); }
  .freshness.none .dot { background: var(--text-faint); }

  /* ---------- Conversas / atendimento ---------- */
  .conv-list { list-style: none; padding: 0; margin: 0; }
  .conv-list li a { display: flex; justify-content: space-between; align-items: center; gap: var(--s4); padding: 12px var(--s4); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: var(--s2); text-decoration: none; color: inherit; background: var(--surface); transition: border-color var(--t), background var(--t); }
  .conv-list li a:hover { border-color: var(--border-strong); background: var(--surface-hover); }
  .conv-list .meta { font-size: 12px; color: var(--text-muted); }
  .chat { display: flex; flex-direction: column; gap: var(--s2); margin-bottom: var(--s4); max-height: 460px; overflow-y: auto; padding: var(--s3); background: var(--surface-2); border-radius: var(--radius-sm); border: 1px solid var(--border); }
  .bubble { max-width: 78%; padding: 8px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.45; }
  .bubble .author { font-size: 11px; opacity: 0.7; margin-bottom: 3px; display: flex; gap: 6px; align-items: center; }
  .bubble.cliente { align-self: flex-start; background: #1e293b; border-bottom-left-radius: 4px; }
  .bubble.robo { align-self: flex-end; background: #0c4a6e; border-bottom-right-radius: 4px; }
  .bubble.humano { align-self: flex-end; background: #14532d; border-bottom-right-radius: 4px; }
  .bubble.automacao { align-self: flex-end; background: #3730a3; border-bottom-right-radius: 4px; }
  .bubble.desconhecido { align-self: flex-start; background: #451a03; }
  .bubble.falhou { border: 1px dashed var(--danger); }
  .fail-tag { color: var(--danger); font-size: 11px; }
  .dev-panel { border: 1px dashed rgba(251,191,36,0.4); background: rgba(251,191,36,0.04); }
  .dev-panel h3 { color: var(--warning); }

  /* ---------- CRM ---------- */
  .stage-section { margin-bottom: var(--s5); }
  .stage-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--s2); padding-bottom: var(--s2); border-bottom: 1px solid var(--border); }
  .stage-head h3 { margin: 0; text-transform: none; font-size: 14px; color: var(--text-primary); letter-spacing: 0; font-weight: 600; }
  .opp-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: var(--s2); background: var(--surface); transition: border-color var(--t); }
  .opp-card:hover { border-color: var(--border-strong); }
  .opp-card .title { font-weight: 600; font-size: 14px; }
  .opp-card .meta-row { font-size: 12.5px; color: var(--text-muted); margin: 4px 0 10px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .opp-card form { margin-top: var(--s2); }
  .opp-card details summary { color: var(--text-muted); font-size: 12.5px; cursor: pointer; margin-top: 6px; }
  .lost-reason { color: var(--danger); font-size: 12.5px; }

  /* ---------- Command Center: blocos ---------- */
  .attention-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--s2); }
  .attention-list li { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; display: grid; grid-template-columns: 120px 1fr; gap: var(--s3); align-items: start; font-size: 13.5px; background: var(--surface-2); }
  .attention-list .fact { color: var(--text-primary); } .attention-list .hyp { color: var(--text-muted); font-size: 12.5px; margin-top: 3px; }
  .goal-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1.2fr 1.2fr; gap: var(--s2); align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px; font-variant-numeric: tabular-nums; }
  .goal-row:last-child { border-bottom: none; }
  .goal-row + .goal-row .eyebrow { display: none; }
  .goal-row .bar { height: 6px; border-radius: 3px; background: var(--border-strong); position: relative; overflow: hidden; }
  .goal-row .bar > span { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 3px; }
  .provider-compare { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); }
  .provider-card { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--s4); background: var(--surface-2); }
  .provider-card h4 { margin: 0 0 var(--s3); font-size: 14px; display: flex; align-items: center; gap: var(--s2); }
  .provider-card dl { display: grid; grid-template-columns: 1fr auto; gap: 6px var(--s4); margin: 0; font-size: 13px; }
  .provider-card dt { color: var(--text-muted); } .provider-card dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
  .skeleton { background: linear-gradient(90deg, #1e293b 25%, #273449 50%, #1e293b 75%); background-size: 200% 100%; border-radius: 4px; min-height: 1em; animation: shimmer 1.4s infinite; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* ---------- Command Center: menu com estado do provedor, procedência dos dados, comparativo ---------- */
  .nav-status { width: 7px; height: 7px; border-radius: 50%; margin-left: auto; background: var(--text-faint); flex-shrink: 0; }
  .nav-status.on { background: var(--success); } .nav-status.warn { background: var(--warning); }
  .provenance { display: flex; gap: var(--s2); flex-wrap: wrap; align-items: center; margin: 0 0 var(--s4); }
  .provenance .chip { background: var(--surface); }
  .chip-xs { font-size: 10px; padding: 2px 6px; letter-spacing: 0.04em; }
  .kpi .kpi-label .chip-xs { margin-left: auto; }
  .compare-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
  .compare-table th { text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 8px 12px; border-bottom: 1px solid var(--border-strong); background: var(--surface); }
  .compare-table th:first-child { text-align: left; }
  .compare-table td { padding: 7px 12px; border-bottom: 1px solid var(--border); text-align: right; font-variant-numeric: tabular-nums; }
  .compare-table td:first-child { text-align: left; color: var(--text-secondary); }
  .compare-table tbody tr:last-child td { border-bottom: none; }
  .compare-table tbody tr:hover td { background: rgba(56,189,248,0.05); }
  .compare-table .best { color: var(--success); font-weight: 600; }
  .compare-table .na { color: var(--text-faint); }
  .empty-state .actions { display: flex; gap: var(--s2); justify-content: center; margin-top: var(--s4); flex-wrap: wrap; }
  .integration-cards { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); }
  .integration-card { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--s4); background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
  .integration-card h4 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: var(--s2); }
  .integration-card dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--s3); margin: 0; font-size: 12.5px; }
  .integration-card dt { color: var(--text-muted); } .integration-card dd { margin: 0; }
  .seg-links { display: inline-flex; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 3px; }
  .seg-links a { font-size: 12px; padding: 4px 10px; border-radius: var(--r-pill); color: var(--text-secondary); text-decoration: none; }
  .seg-links a.active { background: var(--accent); color: #0b1220; font-weight: 600; }
  .fact-list { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; }
  @media (max-width: 720px) { .integration-cards { grid-template-columns: 1fr; } }

  /* ---------- Responsividade (desktop primeiro: 1920 → 1280 intactos) ---------- */
  @media (max-width: 1200px) {
    .content { padding: var(--s5) var(--s5) var(--s6); }
    .topbar { padding-left: var(--s5); padding-right: var(--s5); }
  }
  @media (max-width: 960px) {
    .col-8, .col-7, .col-6, .col-5, .col-4, .col-3 { grid-column: span 12; }
    .metrics-grid, .kpi-grid, .col-8 .kpi-grid, .col-7 .kpi-grid, .col-6 .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .provider-compare { grid-template-columns: 1fr; }
    .goal-row { grid-template-columns: 1fr 1fr 1fr; }
    .funnel-row { grid-template-columns: 1fr auto; gap: 6px var(--s3); } .funnel-track { order: 3; grid-column: 1 / -1; }
    .attention-list li { grid-template-columns: 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 720px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); padding: var(--s2) var(--s3); flex-direction: row; align-items: center; gap: var(--s2); overflow-x: auto; }
    .sidebar nav { display: flex; gap: 2px; }
    .sidebar nav a { white-space: nowrap; margin-bottom: 0; padding: 6px 10px; }
    .sidebar nav a.active::before { display: none; }
    .sidebar nav a svg { display: none; }
    .sidebar .brand { display: none; }
    .sidebar nav .nav-group { display: none; }
    .topbar { padding: 10px var(--s4); position: static; }
    .content { padding: var(--s4); }
    .card { max-width: 100%; }
    .metrics-grid, .kpi-grid { gap: var(--s2); }
    .metric-card .value, .kpi .kpi-value { font-size: 22px; }
    .page-head h2 { font-size: 19px; }
  }
  @media (max-width: 480px) { .metrics-grid, .kpi-grid, .col-8 .kpi-grid, .col-7 .kpi-grid, .col-6 .kpi-grid { grid-template-columns: 1fr; } }
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

export function loginPage(error?: string): string {
  return page(
    "Login — HUB ACTION",
    `<div class="center-screen">
      <div class="card">
        <div class="login-brand"><span class="mark">${BRAND_MARK}</span><div><strong>HUB ACTION</strong><small>Marketing que gera crescimento.</small></div></div>
        <h1>CRM WhatsApp — entrar</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <form method="post" action="/login">
          <label>E-mail
            <input type="email" name="email" required autofocus />
          </label>
          <label>Senha
            <input type="password" name="password" required />
          </label>
          <button type="submit">Entrar</button>
        </form>
        <p class="meta" style="margin-top:1rem">Esqueceu a senha? Peça ao administrador da sua empresa (ou à Hub Action) um link de redefinição — não há envio automático de e-mail nesta versão.</p>
      </div>
    </div>`
  );
}

export function forbiddenPage(message = "Você não tem permissão para acessar este recurso."): string {
  return page(
    "Acesso negado",
    `<div class="center-screen">
      <div class="card">
        <h1>403 — Acesso negado</h1>
        <p style="color:#94a3b8">${escapeHtml(message)}</p>
        <p><a href="/">Voltar</a></p>
      </div>
    </div>`
  );
}

/** Página simples de aviso (link inválido, conta criada, etc.). */
export function messagePage(title: string, text: string, linkHref = "/login", linkLabel = "Ir para o login"): string {
  return page(
    title,
    `<div class="center-screen">
      <div class="card">
        <h1>${escapeHtml(title)}</h1>
        <p style="color:#94a3b8">${escapeHtml(text)}</p>
        <p><a href="${linkHref}">${escapeHtml(linkLabel)}</a></p>
      </div>
    </div>`
  );
}

/** Aceite de convite: quem recebeu o link cria a própria senha. */
export function invitePage(opts: { token: string; email: string; companyName: string; error?: string }): string {
  return page(
    "Criar acesso — HUB ACTION",
    `<div class="center-screen">
      <div class="card">
        <h1>Criar seu acesso</h1>
        <p style="color:#94a3b8;font-size:0.85rem">Convite para <strong>${escapeHtml(opts.companyName)}</strong>, e-mail <strong>${escapeHtml(opts.email)}</strong>.</p>
        ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
        <form method="post" action="/convite/${encodeURIComponent(opts.token)}">
          <label>Seu nome<input type="text" name="name" required /></label>
          <label>Senha (mínimo 8 caracteres)<input type="password" name="password" required minlength="8" /></label>
          <button type="submit">Criar acesso</button>
        </form>
      </div>
    </div>`
  );
}

export function resetPage(opts: { token: string; error?: string }): string {
  return page(
    "Redefinir senha — HUB ACTION",
    `<div class="center-screen">
      <div class="card">
        <h1>Redefinir senha</h1>
        ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
        <form method="post" action="/redefinir/${encodeURIComponent(opts.token)}">
          <label>Nova senha (mínimo 8 caracteres)<input type="password" name="password" required minlength="8" /></label>
          <button type="submit">Salvar nova senha</button>
        </form>
      </div>
    </div>`
  );
}

export function noCompanyPage(): string {
  return page(
    "Sem empresa associada",
    `<div class="center-screen">
      <div class="card">
        <h1>Nenhuma empresa associada</h1>
        <p style="color:#94a3b8">Seu usuário ainda não foi associado a nenhuma empresa. Fale com um administrador.</p>
        <p><a href="/logout">Sair</a></p>
      </div>
    </div>`
  );
}

export function companySelectorPage(memberships: MembershipWithCompany[]): string {
  const items = memberships
    .map(
      (m) => `<li>
        <span>${escapeHtml(m.company_name)}</span>
        <a href="/empresa/${m.company_id}/dashboard">Entrar &rarr;</a>
      </li>`
    )
    .join("");
  return page(
    "Escolha a empresa — HUB ACTION",
    `<div class="center-screen">
      <div class="card" style="max-width:420px">
        <h1>Escolha a empresa</h1>
        <ul class="list">${items}</ul>
      </div>
    </div>`
  );
}

const PLAN_LABELS: Record<CompanyPlan, string> = {
  DEMONSTRACAO: "Demonstração",
  PILOTO: "Piloto",
  ATIVO: "Ativo",
};

const ROLE_SHORT: Record<Role, string> = { COMPANY_ADMIN: "Administrador", AGENT: "Atendente" };

/** Link gerado (convite/redefinição) — mostrado UMA vez, para quem gerou entregar ao destinatário. */
function generatedLinkPanel(link: GeneratedLink): string {
  return `<div class="panel" style="border-color:#0c4a6e">
    <h3>${escapeHtml(link.label)}</h3>
    <p class="meta">Copie e envie para a pessoa (WhatsApp, e-mail, etc.). Não há envio automático. O link só aparece agora; se perder, gere outro.</p>
    <input type="text" readonly value="${escapeHtml(link.url)}" onclick="this.select()" />
  </div>`;
}

/** Lista de usuários com ações (redefinir senha, ativar/desativar) — reaproveitada pela Hub Action e pelo admin da empresa. */
function usersTable(users: CompanyUserRow[], actionBase: string, currentUserId: number): string {
  if (users.length === 0) return '<p class="meta">Nenhum usuário ainda.</p>';
  const rows = users
    .map(
      (u) => `<tr>
        <td>${escapeHtml(u.name)}<br /><span class="meta">${escapeHtml(u.email)}</span></td>
        <td>${ROLE_SHORT[u.role]}</td>
        <td>${u.active ? '<span class="badge badge-humano">ativo</span>' : '<span class="badge badge-encerrado">desativado</span>'}</td>
        <td style="white-space:nowrap">
          <form method="post" action="${actionBase}/${u.user_id}/redefinir" style="display:inline"><button type="submit" class="btn btn-small">Link de nova senha</button></form>
          ${
            u.user_id === currentUserId
              ? ""
              : `<form method="post" action="${actionBase}/${u.user_id}/ativo" style="display:inline"><input type="hidden" name="active" value="${u.active ? "0" : "1"}" /><button type="submit" class="btn btn-small ${u.active ? "btn-danger" : ""}">${u.active ? "Desativar" : "Reativar"}</button></form>`
          }
        </td>
      </tr>`
    )
    .join("");
  return `<div style="overflow-x:auto"><table class="hours-table">
    <thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function inviteForm(action: string, allowAdmin: boolean): string {
  return `<form method="post" action="${action}" class="form-grid" style="margin-top:0.75rem">
    <label>E-mail do convidado<input type="email" name="email" required /></label>
    <label>Perfil<select name="role"><option value="AGENT">Atendente</option>${allowAdmin ? '<option value="COMPANY_ADMIN">Administrador da empresa</option>' : ""}</select></label>
    <div style="align-self:end"><button type="submit" class="btn btn-small btn-primary">Gerar link de convite</button></div>
  </form>`;
}

function pendingInvitesList(invites: PendingInvite[]): string {
  if (invites.length === 0) return "";
  return `<p class="meta" style="margin-top:0.6rem">Convites ainda não usados: ${invites
    .map((i) => `${escapeHtml(i.email)} (${ROLE_SHORT[i.role]}, vale até ${new Date(i.expires_at).toLocaleDateString("pt-BR")})`)
    .join("; ")}.</p>`;
}

export function adminPage(opts: {
  currentUserId: number;
  companies: CompanyAdminRow[];
  statuses: Map<number, ConnectionStatusReport>;
  usersByCompany: Map<number, CompanyUserRow[]>;
  invitesByCompany: Map<number, PendingInvite[]>;
  generatedLink?: GeneratedLink;
  notice?: string;
  error?: string;
}): string {
  const companyPanels = opts.companies
    .map((c) => {
      const status = opts.statuses.get(c.id);
      return `<div class="panel">
        <div class="toolbar" style="margin-bottom:0.5rem">
          <div>
            <h3 style="text-transform:none;color:#f8fafc;font-size:1rem;margin:0">${escapeHtml(c.name)} <span class="meta">${escapeHtml(c.slug)}</span></h3>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.35rem">
              <span class="badge">${PLAN_LABELS[c.plan]}</span>
              ${c.suspended ? '<span class="badge badge-encerrado">suspensa</span>' : ""}
              ${status ? `<span class="badge">WhatsApp: ${MODE_LABELS[status.mode]} · ${escapeHtml(status.statusLabel)}</span>` : ""}
              <span class="badge">${c.member_count} usuário(s) · ${c.conversation_count} conversa(s)</span>
            </div>
          </div>
        </div>
        <form method="post" action="/admin/empresas/${c.id}/plano" class="form-grid">
          <label>Plano (controle manual, sem cobrança)
            <select name="plan">${(Object.keys(PLAN_LABELS) as CompanyPlan[]).map((p) => `<option value="${p}" ${p === c.plan ? "selected" : ""}>${PLAN_LABELS[p]}</option>`).join("")}</select>
          </label>
          <label>Observações<input type="text" name="plan_notes" value="${escapeHtml(c.plan_notes ?? "")}" placeholder="ex.: piloto combinado até dd/mm" /></label>
          <label class="checkbox-line" style="align-self:end"><input type="checkbox" name="suspended" value="1" ${c.suspended ? "checked" : ""} /> Suspender acesso</label>
          <div style="align-self:end"><button type="submit" class="btn btn-small">Salvar plano</button></div>
        </form>
        <h4 style="margin:1rem 0 0.4rem;font-size:0.8rem;color:#94a3b8;text-transform:uppercase">Usuários</h4>
        ${usersTable(opts.usersByCompany.get(c.id) ?? [], `/admin/usuarios`, opts.currentUserId)}
        ${pendingInvitesList(opts.invitesByCompany.get(c.id) ?? [])}
        ${inviteForm(`/admin/empresas/${c.id}/convites`, true)}
      </div>`;
    })
    .join("");

  return page(
    "Administração Hub Action",
    `${IS_DEMO ? '<div class="demo-banner" style="margin:0;border-radius:0">⚠️ Ambiente de teste — dados fictícios (modo de demonstração), sem conexão com WhatsApp real.</div>' : ""}
    <div style="max-width:1000px;margin:0 auto;padding:1.5rem">
      <div class="toolbar">
        <h2 style="margin:0">Administração Hub Action</h2>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <a href="/admin/integracoes" class="btn btn-small">Integrações</a>
          <a href="/admin/marketing" class="btn btn-small">Marketing</a>
          <a href="/admin/agencia" class="btn btn-small">Agência</a>
          <a href="/admin/whatsapp" class="btn btn-small">Conexões do WhatsApp</a>
          <a href="/admin/log" class="btn btn-small">Log de auditoria</a>
          <form method="post" action="/logout"><button type="submit" class="btn btn-small">Sair</button></form>
        </div>
      </div>
      <p class="meta">Empresas, usuários, planos (manuais) e situação da conexão do WhatsApp. O conteúdo das conversas de cada empresa não é exibido aqui.</p>
      ${opts.notice ? `<p class="success">${escapeHtml(opts.notice)}</p>` : ""}
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
      ${opts.generatedLink ? generatedLinkPanel(opts.generatedLink) : ""}
      <form method="post" action="/admin/empresas" class="panel inline-form">
        <input type="text" name="name" required placeholder="Nome da nova empresa cliente" />
        <button type="submit" class="btn btn-primary">Criar empresa</button>
      </form>
      ${companyPanels || '<p class="meta">Nenhuma empresa cadastrada.</p>'}
    </div>`
  );
}

export function auditLogPage(entries: AuditEntry[], backHref: string): string {
  const rows = entries
    .map(
      (e) => `<tr>
        <td style="white-space:nowrap">${new Date(e.created_at).toLocaleString("pt-BR")}</td>
        <td>${escapeHtml(e.action)}</td>
        <td>${e.company_name ? escapeHtml(e.company_name) : "—"}</td>
        <td>${e.user_name ? escapeHtml(e.user_name) : "—"}</td>
        <td>${e.detail ? escapeHtml(e.detail) : ""}</td>
      </tr>`
    )
    .join("");
  return page(
    "Log de auditoria",
    `<div style="max-width:1000px;margin:0 auto;padding:1.5rem">
      <div class="toolbar"><h2 style="margin:0">Log de auditoria</h2><a href="${backHref}" class="btn btn-small">&larr; Voltar</a></div>
      <div style="overflow-x:auto"><table class="hours-table">
        <thead><tr><th>Quando</th><th>Ação</th><th>Empresa</th><th>Usuário</th><th>Detalhe</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="meta">Nada registrado ainda.</td></tr>'}</tbody>
      </table></div>
    </div>`
  );
}

const CONNECTION_STATUS_BADGE: Record<string, string> = {
  CONECTADO: "badge-humano",
  ERRO: "badge-encerrado",
  DESATIVADO: "badge-encerrado",
  PENDENTE: "badge-aguardando",
  EM_VALIDACAO: "badge-aguardando",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Um painel por empresa: cadastro inicial (se ainda não existe conexão) ou
 * gerenciamento completo (testar/ativar/desativar/substituir credencial/
 * assinar webhook) — sempre com CSRF automático (form method="post") e
 * auditado pelo servidor. O Access Token NUNCA aparece aqui — só um badge de
 * "configurado" e um campo em branco para digitar um NOVO valor.
 */
function whatsappAdminCompanyPanel(company: CompanyAdminRow, connection: ConnectionAdminView | null): string {
  const base = `/admin/whatsapp/${company.id}`;

  if (!connection) {
    return `<div class="panel">
      <div class="toolbar" style="margin-bottom:0.5rem">
        <h3 style="text-transform:none;color:#f8fafc;font-size:1rem;margin:0">${escapeHtml(company.name)}</h3>
        <span class="badge badge-aguardando">Sem conexão cadastrada</span>
      </div>
      <form method="post" action="${base}/cadastrar" class="form-grid">
        <label>WABA ID<input type="text" name="waba_id" required /></label>
        <label>Phone Number ID<input type="text" name="phone_number_id" required /></label>
        <label>Ambiente
          <select name="environment"><option value="TESTE">Teste</option><option value="PRODUCAO">Produção</option></select>
        </label>
        <label>Access Token<input type="password" name="access_token" autocomplete="off" required /></label>
        <div style="align-self:end"><button type="submit" class="btn btn-small btn-primary">Cadastrar conexão</button></div>
      </form>
    </div>`;
  }

  const statusBadge = CONNECTION_STATUS_BADGE[connection.status] ?? "badge-aguardando";
  const canActivate = connection.status !== "CONECTADO";
  const canDeactivate = connection.active === 1;

  return `<div class="panel">
    <div class="toolbar" style="margin-bottom:0.5rem">
      <h3 style="text-transform:none;color:#f8fafc;font-size:1rem;margin:0">${escapeHtml(company.name)}</h3>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
        <span class="badge">${MODE_LABELS[connection.environment]}</span>
        <span class="badge ${statusBadge}">${escapeHtml(STATUS_LABELS[connection.status])}</span>
      </div>
    </div>

    <ul class="list" style="margin-bottom:0.75rem">
      <li><span>WABA ID</span> <span>${escapeHtml(connection.waba_id ?? "—")}</span></li>
      <li><span>Phone Number ID</span> <span>${escapeHtml(connection.phone_number_id)}</span></li>
      <li><span>Número confirmado pela Meta</span> <span>${connection.display_phone_number ? escapeHtml(connection.display_phone_number) : "ainda não confirmado"}</span></li>
      <li><span>Nome de exibição confirmado</span> <span>${connection.verified_name ? escapeHtml(connection.verified_name) : "ainda não confirmado"}</span></li>
      <li><span>Qualidade (Meta)</span> <span>${connection.quality_rating ? escapeHtml(connection.quality_rating) : "—"}</span></li>
      <li><span>Access Token</span> <span class="badge ${connection.hasAccessToken ? "badge-humano" : "badge-encerrado"}">${connection.hasAccessToken ? "configurado" : "não configurado"}</span></li>
      <li><span>Última validação</span> <span>${connection.last_verified_at ? fmtDateTime(connection.last_verified_at) : "nunca"}</span></li>
      ${connection.last_verified_ok === 0 ? `<li><span>Último erro</span> <span class="error" style="margin:0">${escapeHtml(connection.last_verified_detail ?? "sem detalhes")}</span></li>` : ""}
    </ul>

    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
      <form method="post" action="${base}/testar" style="display:inline"><button type="submit" class="btn btn-small">Testar conexão</button></form>
      ${canActivate ? `<form method="post" action="${base}/ativar" style="display:inline"><button type="submit" class="btn btn-small btn-primary">Ativar</button></form>` : ""}
      ${canDeactivate ? `<form method="post" action="${base}/desativar" style="display:inline"><button type="submit" class="btn btn-small btn-danger">Desativar</button></form>` : ""}
    </div>

    <details style="margin-bottom:0.75rem">
      <summary class="btn btn-small" style="display:inline-block;cursor:pointer">Substituir credencial</summary>
      <form method="post" action="${base}/substituir-token" class="form-grid" style="margin-top:0.6rem">
        <label>Novo Access Token<input type="password" name="access_token" autocomplete="off" required /></label>
        <div style="align-self:end"><button type="submit" class="btn btn-small">Salvar novo token</button></div>
      </form>
    </details>

    <details>
      <summary class="btn btn-small" style="display:inline-block;cursor:pointer">Ver instruções do webhook</summary>
      <div style="margin-top:0.6rem">
        <p class="meta">Ação separada e opcional — assina o aplicativo no WABA para o campo <code>messages</code>, para a Meta começar a chamar o webhook para os números deste WABA. Exige confirmação explícita e fica registrada no log de auditoria.</p>
        <form method="post" action="${base}/assinar-webhook">
          <label class="checkbox-line"><input type="checkbox" name="confirmar" value="1" required /> Confirmo que quero assinar o aplicativo neste WABA agora</label>
          <button type="submit" class="btn btn-small" style="margin-top:0.5rem">Assinar aplicativo no WABA</button>
        </form>
      </div>
    </details>
  </div>`;
}

export function whatsappAdminPage(opts: {
  companies: CompanyAdminRow[];
  connections: Map<number, ConnectionAdminView | null>;
  graphApiVersion: string;
  webhookUrl: string;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  notice?: string;
  error?: string;
}): string {
  const panels = opts.companies.map((c) => whatsappAdminCompanyPanel(c, opts.connections.get(c.id) ?? null)).join("");

  return page(
    "Conexões do WhatsApp — HUB ACTION",
    `<div style="max-width:1000px;margin:0 auto;padding:1.5rem">
      <div class="toolbar"><h2 style="margin:0">Conexões do WhatsApp</h2><a href="/admin" class="btn btn-small">&larr; Voltar</a></div>
      <p class="meta">Área exclusiva do administrador geral. Cadastre, teste, ative ou desative a conexão oficial de cada empresa cliente. Credenciais nunca aparecem em texto — só "configurado" ou não.</p>

      ${opts.notice ? `<p class="success">${escapeHtml(opts.notice)}</p>` : ""}
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}

      <div class="panel">
        <h3>Configuração global do servidor</h3>
        <ul class="list" style="margin-bottom:0.75rem">
          <li><span>Versão da Graph API</span> <span>${escapeHtml(opts.graphApiVersion)}</span></li>
          <li><span>Verify Token do webhook</span> <span class="badge ${opts.verifyTokenConfigured ? "badge-humano" : "badge-encerrado"}">${opts.verifyTokenConfigured ? "configurado" : "não configurado"}</span></li>
          <li><span>App Secret</span> <span class="badge ${opts.appSecretConfigured ? "badge-humano" : "badge-encerrado"}">${opts.appSecretConfigured ? "configurado" : "não configurado"}</span></li>
        </ul>
        <p class="meta">URL de callback do webhook (cadastre no painel da Meta, campo "Callback URL"):</p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <input id="whatsapp-webhook-url" type="text" readonly value="${escapeHtml(opts.webhookUrl)}" onclick="this.select()" style="flex:1;min-width:260px" />
          <button type="button" class="btn btn-small" onclick="navigator.clipboard.writeText(document.getElementById('whatsapp-webhook-url').value)">Copiar URL</button>
        </div>
        <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Passo a passo</h4>
        <ol class="list" style="padding-left:1.1rem">
          <li>Criar ou selecionar o aplicativo no Meta for Developers.</li>
          <li>Obter o WABA ID e o Phone Number ID do número da empresa.</li>
          <li>Gerar um token de acesso apropriado para produção (token de sistema, não o temporário de 24h).</li>
          <li>Cadastrar esses dados abaixo, na empresa correta.</li>
          <li>Clicar em "Testar conexão" e confirmar que a Meta reconheceu o número.</li>
          <li>Cadastrar a URL acima + o Verify Token na tela de Webhooks do app, na Meta.</li>
          <li>Assinar o campo <code>messages</code> (pelo painel da Meta, ou pelo botão "Assinar aplicativo no WABA" abaixo).</li>
          <li>Só então clicar em "Ativar" — nunca antes de todas as verificações acima.</li>
        </ol>
      </div>

      ${panels || '<p class="meta">Nenhuma empresa cadastrada.</p>'}
    </div>`
  );
}

export interface NavItem {
  key: string;
  label: string;
  /** Item que representa um provedor de mídia: mostra o estado (conectado / não conectado) ao lado. */
  provider?: MarketingProvider;
}

/** OPERAÇÃO */
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "conversas", label: "Conversas" },
  { key: "crm", label: "CRM" },
];

/** MARKETING — mídia paga/inteligência: administrador geral sempre; administrador da empresa sempre; atendente só com a capability can_view_marketing. Meta e Google aparecem SEMPRE (mesmo sem conexão). */
export const MARKETING_NAV_ITEMS: NavItem[] = [
  { key: "marketing", label: "Visão Geral" },
  { key: "marketing/meta", label: "Meta Ads", provider: "META" },
  { key: "marketing/google", label: "Google Ads", provider: "GOOGLE" },
  { key: "marketing/campanhas", label: "Campanhas" },
  { key: "marketing/funil", label: "Funil & Conversão" },
  { key: "inteligencia", label: "Inteligência" },
  { key: "alertas", label: "Alertas" },
];

/** GESTÃO */
export const MANAGEMENT_NAV_ITEMS: NavItem[] = [
  { key: "relatorios", label: "Relatórios" },
  { key: "configuracoes", label: "Configurações" },
];

const ROLE_LABEL: Record<Role, string> = {
  COMPANY_ADMIN: "Administrador da empresa",
  AGENT: "Atendente",
};

/** Ícones discretos do menu (SVG inline, 16px, traço 1.75) — só visual. */
const svgIcon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/** Marca inspirada na logo da Hub Action (H inclinado azul + seta laranja). Traços planos, sem brilho. */
const BRAND_MARK = `<svg viewBox="0 0 40 32" aria-hidden="true"><path d="M3 9l8-5v18l-8 5z" fill="#3b7ddd"/><path d="M15 11l8-5v18l-8 5z" fill="#1f4fa8"/><path d="M11 17l4-3v5l-4 3z" fill="#2c66c4"/><path d="M26 6l12 9-12 9z" fill="#f26a1b"/></svg>`;
const NAV_ICONS: Record<string, string> = {
  dashboard: svgIcon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  conversas: svgIcon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  crm: svgIcon('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 13.5a6 6 0 0 1 3 5"/>'),
  "marketing/meta": svgIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>'),
  "marketing/google": svgIcon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  "marketing/campanhas": svgIcon('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  "marketing/funil": svgIcon('<path d="M4 4h16l-6 8v6l-4 2v-8z"/>'),
  relatorios: svgIcon('<path d="M4 20h16"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-6"/>'),
  configuracoes: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  marketing: svgIcon('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>'),
  inteligencia: svgIcon('<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  alertas: svgIcon('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
};

export function appShell(opts: {
  company: Company;
  user: User;
  role: Role;
  active: string;
  body: string;
  /** Mostra o grupo Marketing no menu (decidido no servidor, não no navegador). Se omitido, usa o contexto de shell da requisição. */
  canViewMarketing?: boolean;
  /** Contexto de shell explícito (testes); por padrão vem do middleware da requisição. */
  nav?: ShellContext;
}): string {
  const shell = opts.nav ?? currentShell();
  const link = (item: NavItem) => {
    const active = item.key === opts.active;
    const status = item.provider && shell ? shell.providers[item.provider] : undefined;
    const dot = status ? `<span class="nav-status ${status === "CONECTADO" ? "on" : status === "RECONEXAO" ? "warn" : "off"}" title="${PROVIDER_NAV_LABEL[status]}"></span>` : "";
    return `<a href="/empresa/${opts.company.id}/${item.key}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${NAV_ICONS[item.key] ?? ""}<span>${escapeHtml(item.label)}</span>${dot}</a>`;
  };
  const showMarketing = opts.canViewMarketing ?? shell?.canViewMarketing ?? opts.role === "COMPANY_ADMIN";
  const group = (title: string, items: NavItem[]) => `<div class="nav-group">${title}</div>${items.map(link).join("")}`;
  const nav = group("Operação", NAV_ITEMS) + (showMarketing ? group("Marketing", MARKETING_NAV_ITEMS) : "") + group("Gestão", MANAGEMENT_NAV_ITEMS);
  const roleLabel = Number(opts.user.is_platform_admin) === 1 || shell?.isPlatformAdmin ? "Administrador geral (Hub Action)" : ROLE_LABEL[opts.role];

  // Modo de demonstração: mesmo critério do simulador (fora de produção, tudo é dado fictício).
  const demoBanner = IS_DEMO
    ? `<div class="demo-banner" style="margin:0;border-radius:0">⚠️ Ambiente de teste — dados fictícios (modo de demonstração), sem conexão com WhatsApp real.</div>`
    : "";

  return page(
    `${opts.company.name} — HUB ACTION`,
    `${demoBanner}<div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="mark">${BRAND_MARK}</span><span>HUB ACTION<small>CRM · Command Center</small></span></div>
        <nav aria-label="Navegação principal">${nav}</nav>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <div class="company">${escapeHtml(opts.company.name)}</div>
            <div class="who">${escapeHtml(opts.user.name)} &middot; ${roleLabel}</div>
          </div>
          <form method="post" action="/logout"><button type="submit" class="logout">Sair</button></form>
        </div>
        <div class="content">${opts.body}</div>
      </div>
    </div>`
  );
}

// Independente de NODE_ENV: o piloto no Render roda com NODE_ENV=production
// (segurança ligada) e DEMO_MODE=true (banner/simulador ligados) ao mesmo
// tempo — ver a explicação completa em server.ts, perto de IS_PRODUCTION.
const IS_DEMO = process.env.DEMO_MODE !== "false";

export function emptyState(title: string, description: string): string {
  return `<div class="empty-state">
    <span class="es-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/></svg></span>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description)}</p>
  </div>`;
}

// --- Conversas / atendimento -------------------------------------------------

const STATUS_INFO: Record<ConversationStatus, { label: string; badge: string }> = {
  AUTO: { label: "Em atendimento automático", badge: "badge-auto" },
  AGUARDANDO_HUMANO: { label: "Aguardando humano", badge: "badge-aguardando" },
  HUMANO: { label: "Em atendimento humano", badge: "badge-humano" },
  AGUARDANDO_CLIENTE: { label: "Aguardando cliente", badge: "badge-cliente-aguarda" },
  ENCERRADO: { label: "Encerrado", badge: "badge-encerrado" },
};

const AUTHOR_INFO: Record<AuthorType, { label: string; css: string }> = {
  CLIENTE: { label: "Cliente", css: "cliente" },
  ROBO: { label: "Robô", css: "robo" },
  HUMANO: { label: "Humano", css: "humano" },
  AUTOMACAO: { label: "Automação", css: "automacao" },
  DESCONHECIDO: { label: "Desconhecido", css: "desconhecido" },
};

/** Gatilho que iniciou o episódio de espera — "origem" pedida no painel. Confiabilidade acompanha: gatilhos com evidência explícita são "confirmado"; a heurística de texto livre é "heurística". */
const TRIGGER_INFO: Record<WaitTriggerType, { label: string; confidence: "Confirmado" | "Heurística" }> = {
  OPCAO_3: { label: "Opção 3 do menu", confidence: "Confirmado" },
  BOTAO_PLATAFORMA: { label: "Botão da plataforma", confidence: "Confirmado" },
  MENSAGEM_ROBO: { label: "Aviso de transferência do robô", confidence: "Confirmado" },
  EVENTO_PLATAFORMA: { label: "Evento da plataforma", confidence: "Confirmado" },
  TEXTO_LIVRE: { label: "Texto livre do cliente", confidence: "Heurística" },
  MODO_MANUAL: { label: "Modo manual (sem robô)", confidence: "Confirmado" },
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function inboxPage(opts: { company: Company; user: User; role: Role; items: ConversationListItem[]; isDev: boolean }): string {
  const rows = opts.items
    .map((c) => {
      const info = STATUS_INFO[c.status];
      const preview = c.last_message_preview ? escapeHtml(c.last_message_preview).slice(0, 90) : "Sem mensagens";
      const waiting = c.open_wait_started_at
        ? `<span class="badge badge-aguardando">espera aberta há ${formatDuration(Date.now() - new Date(c.open_wait_started_at).getTime())}</span>`
        : "";
      return `<li><a href="/empresa/${opts.company.id}/conversas/${c.id}">
        <div>
          <div><strong>${escapeHtml(c.contact_name)}</strong> <span class="meta">${escapeHtml(c.contact_phone)}</span></div>
          <div class="meta">${preview}</div>
        </div>
        <span style="display:flex;gap:0.4rem;flex-wrap:wrap;justify-content:flex-end">${c.channel === "SIMULADO" ? '<span class="badge" title="Conversa simulada — não é WhatsApp real">simulada</span>' : ""}${waiting}<span class="badge ${info.badge}">${info.label}</span></span>
      </a></li>`;
    })
    .join("");

  const newConvForm = opts.isDev
    ? `<form method="post" action="/empresa/${opts.company.id}/conversas/nova" class="panel dev-panel">
        <h3>Simulador (dev) — nova conversa de teste</h3>
        <div class="field"><label>Nome do cliente<input type="text" name="name" required placeholder="Cliente Teste" /></label></div>
        <div class="field"><label>Telefone<input type="text" name="phone" required placeholder="+55 11 90000-0000" /></label></div>
        <div class="field">
          <label>Modo</label>
          <select name="mode">
            <option value="AUTOMATICO">Automático (robô responde primeiro)</option>
            <option value="MANUAL">Manual (sem robô — 1ª mensagem já inicia espera)</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Criar conversa de teste</button>
      </form>`
    : "";

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "conversas",
    body: `<div class="toolbar"><h2 style="margin:0">Caixa de entrada</h2></div>
      ${newConvForm}
      <ul class="conv-list">${rows || "<li style=\"color:#94a3b8\">Nenhuma conversa ainda.</li>"}</ul>`,
  });
}

export function conversationDetailPage(opts: {
  company: Company;
  user: User;
  role: Role;
  conversation: Conversation;
  contact: { name: string; phone: string };
  messages: MessageWithAuthor[];
  wait: WaitSummary;
  episodes: WaitEpisode[];
  assignedUserName: string | null;
  isDev: boolean;
}): string {
  const { conversation: conv } = opts;
  const info = STATUS_INFO[conv.status];

  const bubbles = opts.messages
    .map((m) => {
      const a = AUTHOR_INFO[m.author_type];
      const failed = m.send_status === "FALHOU";
      const time = new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const who = m.author_type === "HUMANO" && m.author_name ? `${a.label} (${escapeHtml(m.author_name)})` : a.label;
      const delivery =
        m.delivery_status === "LIDA" ? " · lida" : m.delivery_status === "ENTREGUE" ? " · entregue" : "";
      return `<div class="bubble ${a.css}${failed ? " falhou" : ""}">
        <div class="author">${who} &middot; ${time}${delivery}${failed ? ' <span class="fail-tag">falha no envio</span>' : ""}</div>
        <div>${escapeHtml(m.body)}</div>
      </div>`;
    })
    .join("");

  const clockTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const episodeRows = opts.episodes
    .slice()
    .reverse()
    .map((ep) => {
      const trigger = ep.trigger_type ? TRIGGER_INFO[ep.trigger_type] : null;
      const isOpen = !ep.ended_at;
      const duration = isOpen ? formatDuration(Date.now() - new Date(ep.started_at).getTime()) : formatDuration(new Date(ep.ended_at!).getTime() - new Date(ep.started_at).getTime());
      return `<tr>
        <td>${trigger ? escapeHtml(trigger.label) : "—"}</td>
        <td><span class="badge ${trigger?.confidence === "Confirmado" ? "badge-humano" : "badge-aguardando"}">${trigger?.confidence ?? "—"}</span></td>
        <td>${clockTime(ep.started_at)}</td>
        <td>${isOpen ? "Em aberto" : ep.ended_reason === "RESPOSTA_HUMANA" ? clockTime(ep.ended_at!) : "Encerrado sem resposta"}</td>
        <td>${duration}</td>
      </tr>`;
    })
    .join("");

  const waitBox = `<div class="panel">
    <h3>Espera por atendimento humano</h3>
    ${
      opts.wait.isWaiting
        ? `<p><span class="badge badge-aguardando">Aguardando agora</span></p>
           <p>Tempo corrido: <strong>${formatDuration(opts.wait.currentElapsedMs ?? 0)}</strong></p>
           <p>Tempo dentro do expediente: <strong>${formatMinutes(opts.wait.currentBusinessMinutes ?? 0)}</strong></p>`
        : `<p style="color:#94a3b8">Nenhuma espera em aberto no momento.</p>`
    }
    <p class="meta">Responsável: ${opts.assignedUserName ? escapeHtml(opts.assignedUserName) : "ainda não atribuído"}</p>
    <hr style="border-color:#1f2937" />
    <p class="meta">Total acumulado (todos os episódios): ${formatDuration(opts.wait.totalElapsedMs)} corridos
      / ${formatMinutes(opts.wait.totalBusinessMinutes)} de expediente.</p>
    ${
      episodeRows
        ? `<div style="overflow-x:auto;margin-top:0.75rem">
            <table class="hours-table">
              <thead><tr><th>Gatilho</th><th>Confiabilidade</th><th>Início</th><th>1ª resposta humana</th><th>Duração</th></tr></thead>
              <tbody>${episodeRows}</tbody>
            </table>
          </div>`
        : ""
    }
  </div>`;

  const canRespond = conv.status !== "ENCERRADO";
  const respondForm = canRespond
    ? `<form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/responder" class="panel">
        <h3>Responder como atendente</h3>
        <div class="field"><textarea name="body" rows="2" required placeholder="Digite a resposta..."></textarea></div>
        ${
          opts.isDev
            ? `<label class="checkbox-line"><input type="checkbox" name="simular_falha" value="1" /> Simular falha de envio (não encerra a espera)</label>`
            : ""
        }
        <div style="margin-top:0.6rem"><button type="submit" class="btn btn-primary">Enviar resposta</button></div>
      </form>`
    : `<p class="meta">Conversa encerrada — não é possível responder.</p>`;

  const assumeForm =
    conv.status !== "ENCERRADO"
      ? `<form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/assumir" style="display:inline">
          <button type="submit" class="btn">Assumir atendimento</button>
        </form>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/encerrar" style="display:inline">
          <button type="submit" class="btn btn-danger">Encerrar atendimento</button>
        </form>`
      : "";

  const devPanel = opts.isDev
    ? `<div class="panel dev-panel">
        <h3>Simulador (dev — não conecta WhatsApp real)</h3>
        <p class="meta" style="margin-top:-0.4rem">Reproduz o fluxo real do robô do usuário: menu numerado, opção "3" e frase fixa de transferência.</p>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/simular/robo/menu" style="margin-bottom:0.5rem">
          <button type="submit" class="btn btn-small">Robô envia o menu inicial</button>
        </form>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/simular/robo/transferencia" style="margin-bottom:0.5rem">
          <button type="submit" class="btn btn-small">Robô envia aviso de transferência</button>
        </form>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/simular/cliente" class="inline-form" style="margin-bottom:0.5rem">
          <textarea name="body" rows="1" required placeholder='Mensagem do cliente (ex.: "3")'></textarea>
          <button type="submit" class="btn btn-small">Cliente envia</button>
        </form>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/simular/pedir-humano" style="margin-bottom:0.5rem">
          <button type="submit" class="btn btn-small">Cliente clica no botão "Falar com atendente"</button>
        </form>
        <form method="post" action="/empresa/${opts.company.id}/conversas/${conv.id}/simular/robo" class="inline-form">
          <textarea name="body" rows="1" placeholder="Outra mensagem do robô (texto livre, opcional)"></textarea>
          <button type="submit" class="btn btn-small">Robô envia</button>
        </form>
      </div>`
    : "";

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "conversas",
    body: `<div class="toolbar">
        <div>
          <h2 style="margin:0 0 0.25rem">${escapeHtml(opts.contact.name)} <span class="meta">${escapeHtml(opts.contact.phone)}</span></h2>
          <span class="badge ${info.badge}">${info.label}</span>
          ${conv.mode === "MANUAL" ? '<span class="badge">modo manual</span>' : ""}
          ${conv.channel === "SIMULADO" ? '<span class="badge">conversa simulada — não é WhatsApp real</span>' : '<span class="badge badge-humano">WhatsApp oficial</span>'}
        </div>
        <div>${assumeForm}</div>
      </div>
      <div class="grid-2">
        <div>
          <div class="panel">
            <div class="chat">${bubbles || '<p style="color:#94a3b8">Sem mensagens ainda.</p>'}</div>
          </div>
          ${respondForm}
          ${devPanel}
        </div>
        <div>${waitBox}</div>
      </div>`,
  });
}

// --- Configurações (expediente / fuso) --------------------------------------

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
  sun: "Domingo",
};

const WEEKDAY_ORDER: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Noronha",
  "America/Rio_Branco",
];

const MODE_LABELS: Record<ConnectionStatusReport["mode"], string> = {
  DEMONSTRACAO: "Demonstração",
  TESTE: "Teste (número de teste da Meta)",
  PRODUCAO: "Produção",
};

/**
 * Área "Conexão do WhatsApp" — SÓ LEITURA para o administrador da empresa:
 * status, número conectado e data da última validação. Cadastrar, testar,
 * ativar/desativar ou trocar credenciais é exclusivo do administrador geral
 * da Hub Action, na área /admin/whatsapp (ver whatsappAdminPage) — o
 * administrador da empresa não vê nem consegue acionar isso aqui de propósito.
 */
function whatsappConnectionPanel(report: ConnectionStatusReport): string {
  const statusBadgeClass =
    report.statusLabel === "Conectado" ? "badge-humano" : report.statusLabel === "Erro" ? "badge-encerrado" : "badge-aguardando";

  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return `<div class="panel">
    <h3>Conexão do WhatsApp</h3>
    <p class="meta" style="margin-top:-0.3rem">Visível só para administradores da empresa. Cadastro e credenciais são gerenciados pela Hub Action — aqui é só acompanhamento.</p>

    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin:0.75rem 0">
      <span class="badge">${MODE_LABELS[report.mode]}</span>
      <span class="badge ${statusBadgeClass}">${escapeHtml(report.statusLabel)}</span>
    </div>

    ${
      report.connection
        ? `<p class="meta">Número conectado: <strong>${report.connection.display_phone_number ? escapeHtml(report.connection.display_phone_number) : report.connection.phone_number_id}</strong>${report.connection.verified_name ? ` — ${escapeHtml(report.connection.verified_name)}` : ""}</p>
           <p class="meta">Última validação: ${report.connection.last_verified_at ? fmt(report.connection.last_verified_at) : "ainda não validada"}</p>`
        : `<p class="meta">Nenhuma conexão foi cadastrada para esta empresa ainda — a empresa está em modo demonstração.</p>`
    }

    <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Evidências reais</h4>
    <p class="meta">Última mensagem recebida: ${report.lastInbound ? `${fmt(report.lastInbound.createdAt)} — "${escapeHtml(report.lastInbound.preview.slice(0, 60))}"` : "nenhuma ainda"}</p>
    <p class="meta">Última resposta enviada com sucesso: ${report.lastOutbound ? fmt(report.lastOutbound.createdAt) : "nenhuma ainda"}</p>

    <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Pendências e o que falta (em linguagem simples)</h4>
    <ul class="list">
      ${report.pendencies.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
    </ul>
  </div>`;
}

export function settingsPage(opts: {
  company: Company;
  user: User;
  role: Role;
  canEdit: boolean;
  hours: BusinessHours;
  whatsapp?: ConnectionStatusReport;
  team?: { users: CompanyUserRow[]; invites: PendingInvite[]; currentUserId: number; generatedLink?: GeneratedLink; notice?: string; error?: string };
  error?: string;
  success?: string;
}): string {
  const teamPanel = opts.team
    ? `<div class="panel">
        <h3>Equipe</h3>
        <p class="meta" style="margin-top:-0.3rem">Convide atendentes por link e gere links de nova senha. Não há envio automático de e-mail: você entrega o link.</p>
        ${opts.team.notice ? `<p class="success">${escapeHtml(opts.team.notice)}</p>` : ""}
        ${opts.team.error ? `<p class="error">${escapeHtml(opts.team.error)}</p>` : ""}
        ${opts.team.generatedLink ? generatedLinkPanel(opts.team.generatedLink) : ""}
        ${usersTable(opts.team.users, `/empresa/${opts.company.id}/configuracoes/equipe`, opts.team.currentUserId)}
        ${pendingInvitesList(opts.team.invites)}
        ${inviteForm(`/empresa/${opts.company.id}/configuracoes/equipe/convites`, true)}
      </div>`
    : "";
  const tzOptions = COMMON_TIMEZONES.map(
    (tz) => `<option value="${tz}" ${tz === opts.company.timezone ? "selected" : ""}>${tz}</option>`
  ).join("");

  const rows = WEEKDAY_ORDER.map((key) => {
    const w = opts.hours[key];
    return `<tr>
      <td>${WEEKDAY_LABELS[key]}</td>
      <td><label class="checkbox-line"><input type="checkbox" name="${key}_aberto" value="1" ${w ? "checked" : ""} ${opts.canEdit ? "" : "disabled"} /> aberto</label></td>
      <td><input type="time" name="${key}_inicio" value="${w?.start ?? "09:00"}" ${opts.canEdit ? "" : "disabled"} /></td>
      <td><input type="time" name="${key}_fim" value="${w?.end ?? "18:00"}" ${opts.canEdit ? "" : "disabled"} /></td>
    </tr>`;
  }).join("");

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "configuracoes",
    body: `<h2>Configurações</h2>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
      ${opts.success ? `<p class="success">${escapeHtml(opts.success)}</p>` : ""}
      <form method="post" action="/empresa/${opts.company.id}/configuracoes" class="panel">
        <h3>Fuso horário e expediente</h3>
        <div class="field" style="max-width:320px">
          <label>Fuso horário da empresa
            <select name="timezone" ${opts.canEdit ? "" : "disabled"}>${tzOptions}</select>
          </label>
        </div>
        <table class="hours-table">
          <thead><tr><th>Dia</th><th>Status</th><th>Início</th><th>Fim</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${opts.canEdit ? '<div style="margin-top:1rem"><button type="submit" class="btn btn-primary">Salvar</button></div>' : '<p class="meta" style="margin-top:1rem">Apenas o administrador da empresa pode editar.</p>'}
      </form>
      ${opts.canEdit ? teamPanel : ""}
      ${opts.canEdit && opts.whatsapp ? whatsappConnectionPanel(opts.whatsapp) : ""}`,
  });
}

// --- CRM: funil de oportunidades ---------------------------------------------

function formatCurrencyCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Data/hora curta no fuso da empresa (mesmo fuso usado para gravar o agendamento). */
function formatDateShort(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Valor para <input type="datetime-local"> ("YYYY-MM-DDTHH:MM") no fuso da empresa. */
function toDatetimeLocal(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function crmPage(opts: {
  company: Company;
  user: User;
  role: Role;
  stages: PipelineStage[];
  byStage: Map<number, OpportunityWithDetails[]>;
  members: CompanyMember[];
  error?: string;
}): string {
  const tz = opts.company.timezone;
  const memberOptions = (selected: number | null) =>
    `<option value="">Sem responsável</option>` +
    opts.members
      .map((m) => `<option value="${m.user_id}" ${m.user_id === selected ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
      .join("");

  const stageOptions = (currentStageId: number) =>
    opts.stages
      .map((s) => `<option value="${s.id}" ${s.id === currentStageId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
      .join("");

  const sections = opts.stages
    .map((stage) => {
      const items = opts.byStage.get(stage.id) ?? [];
      const totalCents = items.reduce((sum, o) => sum + o.value_cents, 0);
      const cards = items
        .map((o) => {
          const scheduled = formatDateShort(o.scheduled_at, tz);
          const attended = formatDateShort(o.attended_at, tz);
          const sourceLabel = SOURCE_LABELS[o.contact_source as LeadSource] ?? o.contact_source;
          const confidenceCls = o.contact_confidence === "CONFIRMADA" ? "badge-humano" : o.contact_confidence === "PROVAVEL" ? "badge-aguardando" : "badge-encerrado";
          const originForm =
            o.contact_confidence === "CONFIRMADA"
              ? ""
              : `<form method="post" action="/empresa/${opts.company.id}/crm/contatos/${o.contact_id}/origem" class="inline-form" style="margin-top:0.35rem;max-width:360px">
                  <select name="source" style="flex:1">${LEAD_SOURCES.map((s) => `<option value="${s}" ${s === o.contact_source ? "selected" : ""}>${escapeHtml(SOURCE_LABELS[s])}</option>`).join("")}</select>
                  <button type="submit" class="btn btn-small">Declarar origem</button>
                </form>`;
          return `<div class="opp-card">
            <div class="title">${escapeHtml(o.title)}</div>
            <div class="meta-row">
              <span>${escapeHtml(o.contact_name)} &middot; ${escapeHtml(o.contact_phone)}</span>
              <span>${formatCurrencyCents(o.value_cents)}</span>
              <span>${o.responsible_name ? escapeHtml(o.responsible_name) : "Sem responsável"}</span>
              ${scheduled ? `<span>Agendado: ${scheduled}</span>` : ""}
              ${attended ? `<span>Compareceu: ${attended}</span>` : ""}
              <span>Origem: ${escapeHtml(sourceLabel)} <span class="badge ${confidenceCls}" title="Confiança da atribuição">${escapeHtml(CONFIDENCE_LABELS[o.contact_confidence as AttributionConfidence] ?? o.contact_confidence)}</span></span>
            </div>
            ${o.lost_reason ? `<div class="lost-reason">Motivo da perda: ${escapeHtml(o.lost_reason)}</div>` : ""}
            <form method="post" action="/empresa/${opts.company.id}/crm/oportunidades/${o.id}/mover" class="inline-form" style="flex-wrap:wrap">
              <select name="stage_id" style="flex:1;min-width:140px">${stageOptions(o.stage_id)}</select>
              <input type="text" name="lost_reason" placeholder="Motivo (só se for p/ Perdido)" style="flex:1;min-width:160px" />
              <button type="submit" class="btn btn-small">Mover</button>
            </form>
            <details>
              <summary style="cursor:pointer;color:#94a3b8;font-size:0.78rem;margin-top:0.4rem">Editar responsável / valor / agendamento</summary>
              <form method="post" action="/empresa/${opts.company.id}/crm/oportunidades/${o.id}/editar" class="form-grid" style="margin-top:0.5rem">
                <label>Responsável<select name="responsible_user_id">${memberOptions(o.responsible_user_id)}</select></label>
                <label>Valor (R$)<input type="number" step="0.01" min="0" name="value" value="${(o.value_cents / 100).toFixed(2)}" /></label>
                <label>Agendamento<input type="datetime-local" name="scheduled_at" value="${toDatetimeLocal(o.scheduled_at, tz)}" /></label>
                <label>Compareceu em<input type="datetime-local" name="attended_at" value="${toDatetimeLocal(o.attended_at, tz)}" /></label>
                <div style="align-self:end"><button type="submit" class="btn btn-small">Salvar</button></div>
              </form>
              ${originForm}
            </details>
          </div>`;
        })
        .join("");

      return `<section class="stage-section">
        <div class="stage-head">
          <h3>${escapeHtml(stage.name)} <span class="meta">(${items.length})</span></h3>
          <span class="badge">${formatCurrencyCents(totalCents)}</span>
        </div>
        ${cards || '<p class="meta">Nenhuma oportunidade nesta etapa.</p>'}
      </section>`;
    })
    .join("");

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "crm",
    body: `<div class="toolbar">
        <h2 style="margin:0">CRM — Funil de vendas</h2>
        <a href="/empresa/${opts.company.id}/crm/etapas" class="btn btn-small">Configurar etapas</a>
      </div>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
      <details class="panel" style="margin-bottom:1.5rem">
        <summary>+ Nova oportunidade</summary>
        <form method="post" action="/empresa/${opts.company.id}/crm/oportunidades" class="form-grid">
          <label>Nome do contato<input type="text" name="contact_name" required /></label>
          <label>Telefone<input type="text" name="contact_phone" required /></label>
          <label>Título da oportunidade<input type="text" name="title" required placeholder="Ex: Plano mensal" /></label>
          <label>Valor (R$)<input type="number" step="0.01" min="0" name="value" value="0.00" /></label>
          <label>Responsável<select name="responsible_user_id">${memberOptions(null)}</select></label>
          <label>Agendamento (opcional)<input type="datetime-local" name="scheduled_at" /></label>
          <div style="align-self:end"><button type="submit" class="btn btn-primary">Criar oportunidade</button></div>
        </form>
      </details>
      ${sections}`,
  });
}

export function crmStagesPage(opts: { company: Company; user: User; role: Role; stages: PipelineStage[]; error?: string }): string {
  const rows = opts.stages
    .map((s, idx) => {
      const protectedStage = s.is_won || s.is_lost;
      const tag = s.is_won ? '<span class="badge badge-humano">venda concluída</span>' : s.is_lost ? '<span class="badge badge-encerrado">perdido</span>' : "";
      const flags = s.is_won || s.is_lost
        ? ""
        : `<form method="post" action="/empresa/${opts.company.id}/crm/etapas/${s.id}/marcadores" class="inline-form" style="gap:0.8rem;align-items:center">
            <label class="checkbox-line"><input type="checkbox" name="is_qualified" value="1" ${s.is_qualified ? "checked" : ""} /> conta como lead qualificado</label>
            <label class="checkbox-line"><input type="checkbox" name="is_attended" value="1" ${s.is_attended ? "checked" : ""} /> conta como comparecimento</label>
            <button type="submit" class="btn btn-small">Salvar marcadores</button>
          </form>`;
      return `<li style="flex-direction:column;align-items:stretch;gap:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${escapeHtml(s.name)} ${tag}${s.is_qualified ? ' <span class="badge">qualificado</span>' : ""}${s.is_attended ? ' <span class="badge">comparecimento</span>' : ""}</span>
          <span style="display:flex;gap:0.3rem">
            <form method="post" action="/empresa/${opts.company.id}/crm/etapas/${s.id}/mover" style="display:inline">
              <input type="hidden" name="direction" value="up" />
              <button type="submit" class="btn btn-small" ${idx === 0 ? "disabled" : ""}>&uarr;</button>
            </form>
            <form method="post" action="/empresa/${opts.company.id}/crm/etapas/${s.id}/mover" style="display:inline">
              <input type="hidden" name="direction" value="down" />
              <button type="submit" class="btn btn-small" ${idx === opts.stages.length - 1 ? "disabled" : ""}>&darr;</button>
            </form>
          </span>
        </div>
        <form method="post" action="/empresa/${opts.company.id}/crm/etapas/${s.id}/renomear" class="inline-form">
          <input type="text" name="name" value="${escapeHtml(s.name)}" />
          <button type="submit" class="btn btn-small">Renomear</button>
        </form>
        ${flags}
        ${
          protectedStage
            ? '<p class="meta">Etapa de encerramento do funil — não pode ser excluída.</p>'
            : `<form method="post" action="/empresa/${opts.company.id}/crm/etapas/${s.id}/excluir">
                <button type="submit" class="btn btn-small btn-danger">Excluir etapa</button>
              </form>`
        }
      </li>`;
    })
    .join("");

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "crm",
    body: `<div class="toolbar">
        <h2 style="margin:0">Configurar etapas do funil</h2>
        <a href="/empresa/${opts.company.id}/crm" class="btn btn-small">&larr; Voltar ao CRM</a>
      </div>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
      <ul class="conv-list">${rows}</ul>
      <div class="panel">
        <h3>Adicionar etapa</h3>
        <form method="post" action="/empresa/${opts.company.id}/crm/etapas" class="inline-form">
          <input type="text" name="name" required placeholder="Nome da nova etapa" />
          <button type="submit" class="btn btn-primary">Adicionar</button>
        </form>
      </div>`,
  });
}

// --- Dashboard -----------------------------------------------------------------

/** Card de indicador do dashboard operacional: rótulo com tooltip explicativo, valor grande e legenda curta. Só visual — mesmos dados de sempre. */
function metricCard(label: string, value: string, help: string): string {
  return `<div class="metric-card">
    <div class="label"><span class="tip" data-tip="${escapeHtml(help)}" tabindex="0">${escapeHtml(label)}</span></div>
    <div class="value">${value}</div>
    <div class="help">${escapeHtml(help)}</div>
  </div>`;
}

export function dashboardPage(opts: {
  company: Company;
  user: User;
  role: Role;
  isDev: boolean;
  canEditSla: boolean;
  members: CompanyMember[];
  filters: DashboardFilters;
  data: DashboardData | null;
}): string {
  const attendantOptions =
    `<option value="">Todos</option>` +
    opts.members
      .map(
        (m) => `<option value="${m.user_id}" ${m.user_id === opts.filters.attendantUserId ? "selected" : ""}>${escapeHtml(m.name)}</option>`
      )
      .join("");

  const filtersForm = `<form method="get" class="filters-form">
    <div class="field"><label>De<input type="date" name="de" value="${opts.filters.from}" /></label></div>
    <div class="field"><label>Até<input type="date" name="ate" value="${opts.filters.to}" /></label></div>
    <div class="field"><label>Atendente<select name="atendente">${attendantOptions}</select></label></div>
    <button type="submit" class="btn btn-primary">Aplicar filtros</button>
  </form>`;

  // Cabeçalho da página: só apresentação (período vem dos filtros já existentes).
  const periodLabel = `${opts.filters.from.split("-").reverse().join("/")} a ${opts.filters.to.split("-").reverse().join("/")}`;
  const pageHead = `<div class="page-head">
    <div><div class="eyebrow">Operação</div><h2>Dashboard</h2><div class="sub">Visão geral do atendimento · ${escapeHtml(periodLabel)}${opts.isDev ? " · indicadores calculados sobre dados de demonstração" : ""}</div></div>
  </div>`;

  if (!opts.data || !opts.data.hasAnyData) {
    return appShell({
      company: opts.company,
      user: opts.user,
      role: opts.role,
      active: "dashboard",
      body: `${pageHead}${filtersForm}${emptyState(
        "Nenhum dado ainda",
        "Assim que houver contatos, conversas ou oportunidades registrados, os indicadores aparecem aqui."
      )}`,
    });
  }

  const d = opts.data;

  const slaForm = `<form method="post" action="/empresa/${opts.company.id}/dashboard/meta-sla" class="inline-form" style="max-width:420px">
    <label style="flex:1;margin:0">Meta de 1ª resposta humana (minutos)
      <input type="number" min="1" name="minutos" value="${d.slaTargetMinutes}" ${opts.canEditSla ? "" : "disabled"} />
    </label>
    ${opts.canEditSla ? '<button type="submit" class="btn btn-small" style="align-self:end">Salvar</button>' : ""}
  </form>`;

  const funnelSection = `<h3 class="section-title">Funil no período</h3>
    <div class="metrics-grid">
      ${metricCard("Novos contatos", String(d.newContacts), "Contatos criados dentro do período selecionado.")}
      ${metricCard("Oportunidades", String(d.opportunitiesCreated), "Oportunidades criadas no período (filtra por responsável).")}
      ${metricCard("Agendamentos", String(d.scheduledCount), "Oportunidades com data de agendamento dentro do período.")}
      ${metricCard(
        "Vendas e receita",
        `${d.wonCount} &middot; ${formatCurrencyCents(d.wonRevenueCents)}`,
        "Oportunidades movidas para 'Venda concluída' com fechamento dentro do período; receita é a soma dos valores."
      )}
    </div>`;

  const pendingSection = `<h3 class="section-title">Pendências agora</h3>
    <div class="metrics-grid">
      ${metricCard("Aguardando humano", String(d.waitingNow), "Conversas com espera aberta neste exato momento (não é filtrado por período).")}
      ${metricCard(
        "Maior espera atual",
        d.longestWaitMs !== null ? formatDuration(d.longestWaitMs) : "—",
        "Tempo corrido do episódio de espera mais antigo ainda em aberto agora."
      )}
    </div>`;

  const completedSection = `<h3 class="section-title">Espera humana concluída no período</h3>
    <div class="metrics-grid">
      ${metricCard(
        "Média 1ª resposta",
        d.firstResponse.avgMinutes !== null ? formatDuration(d.firstResponse.avgMinutes * 60000) : "—",
        `Média do tempo corrido entre o pedido de atendente e a 1ª resposta humana enviada com sucesso (${d.firstResponse.count} atendimento(s) no período).`
      )}
      ${metricCard(
        "Mediana 1ª resposta",
        d.firstResponse.medianMinutes !== null ? formatDuration(d.firstResponse.medianMinutes * 60000) : "—",
        "Valor do meio da mesma lista de tempos — menos sensível a casos extremos do que a média."
      )}
      ${metricCard(
        "Dentro do prazo",
        d.firstResponse.withinSlaPercent !== null ? `${d.firstResponse.withinSlaPercent}%` : "—",
        `Percentual das 1ªs respostas concluídas em até ${d.slaTargetMinutes} min (tempo corrido). Meta editável abaixo.`
      )}
      ${metricCard(
        "Encerrados sem resposta",
        String(d.closedWithoutReply),
        "Atendimentos encerrados no período em que nenhuma resposta humana foi enviada com sucesso."
      )}
    </div>
    <div class="card-block" style="margin-top:12px"><h3>Meta de atendimento</h3>${slaForm}</div>`;

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "dashboard",
    body: `${pageHead}${filtersForm}${funnelSection}${pendingSection}${completedSection}`,
  });
}
