/**
 * Telas do administrador geral da Hub Action: Integrações (Meta/Google/
 * WhatsApp — conectar, listar contas, vincular a empresas, sincronizar,
 * saúde), Marketing agregado (totais por moeda, ranking de empresas,
 * sincronizações, regras de alerta) e Agência (carteira + semáforo).
 * Nenhum token aparece — só "configurado"/status.
 */
import type { AlertRow } from "./alerts";
import { RULE_KINDS } from "./alerts";
import type { CompanyBi } from "./bi";
import { deltaPercent } from "./bi";
import { fmtBRL, fmtDelta, fmtNum, fmtPct, SEVERITY_LABELS, type CompanyGoals, type HealthScore } from "./insights";
import type { ConnectionView, MarketingAccountWithConnection, MarketingProvider, SyncRun } from "./marketingModels";
import type { ProviderOAuthConfig } from "./marketingOAuth";
import type { Company } from "./models";
import { escapeHtml, page } from "./views";
import { fmtDateTime, freshnessLabel, providerChip } from "./viewsMarketing";
import type { ConnectionAdminView } from "./whatsapp";
import { STATUS_LABELS as WA_STATUS_LABELS } from "./whatsapp";

export const FREE_TIER_NOTICE =
  "Ambiente gratuito sujeito a suspensão por inatividade. Sincronizações automáticas podem ser afetadas. Não recomendado para operação contínua em produção.";

function adminHead(title: string, sub: string, active: string): string {
  const links: [string, string][] = [
    ["/admin", "Administração"],
    ["/admin/integracoes", "Integrações"],
    ["/admin/marketing", "Marketing"],
    ["/admin/agencia", "Agência"],
    ["/admin/whatsapp", "Conexões do WhatsApp"],
    ["/admin/log", "Log de auditoria"],
  ];
  return `<div class="page-head"><div><div class="eyebrow">HUB ACTION · Administração geral</div><h2>${escapeHtml(title)}</h2><div class="sub">${escapeHtml(sub)}</div></div>
    <form method="post" action="/logout"><button type="submit" class="btn btn-small">Sair</button></form></div>
    <div class="tabs">${links.map(([href, label]) => `<a href="${href}" class="${href === active ? "active" : ""}">${label}</a>`).join("")}</div>`;
}

function wrap(title: string, body: string): string {
  return page(`${title} — HUB ACTION`, `<div style="max-width:1200px;margin:0 auto;padding:1.5rem">${body}</div>`);
}

const CONN_STATUS_LABEL: Record<string, string> = {
  CONECTADA: "Conectada",
  EXPIRADA: "Expirada",
  ERRO: "Erro",
  REVOGADA: "Revogada",
  RECONEXAO_NECESSARIA: "Reconexão necessária",
};

function connStatusChip(status: string): string {
  const cls = status === "CONECTADA" ? "chip-ok" : status === "REVOGADA" ? "chip-muted" : "chip-bad";
  return `<span class="chip ${cls}">${escapeHtml(CONN_STATUS_LABEL[status] ?? status)}</span>`;
}

function accountHealthChip(a: MarketingAccountWithConnection, now: Date): string {
  if (a.connection_status !== "CONECTADA") return connStatusChip(a.connection_status);
  if (!a.company_id) return '<span class="chip chip-muted">Não vinculada</span>';
  if (!a.sync_enabled) return '<span class="chip chip-muted">Sincronização desligada</span>';
  if (a.last_error_sanitized && (!a.last_success_at || a.last_sync_at! > a.last_success_at)) return '<span class="chip chip-bad">Erro</span>';
  if (!a.last_success_at) return '<span class="chip chip-warn">Aguardando 1ª sincronização</span>';
  const hours = (now.getTime() - new Date(a.last_success_at).getTime()) / 3600000;
  return hours > 24 ? '<span class="chip chip-warn">Dados antigos</span>' : '<span class="chip chip-ok">Sincronizando</span>';
}

// --- Integrações ---------------------------------------------------------------------------

export function adminIntegrationsPage(o: {
  meta: ProviderOAuthConfig;
  google: ProviderOAuthConfig;
  encryptionConfigured: boolean;
  connections: ConnectionView[];
  accounts: MarketingAccountWithConnection[];
  companies: Company[];
  whatsapp: { company: Company; connection: ConnectionAdminView | null }[];
  syncIntervalMinutes: number;
  notice?: string;
  error?: string;
  now?: Date;
}): string {
  const now = o.now ?? new Date();
  const providerCard = (provider: MarketingProvider, cfg: ProviderOAuthConfig) => {
    const conns = o.connections.filter((c) => c.provider === provider);
    const label = provider === "META" ? "Meta Ads" : "Google Ads";
    const key = provider === "META" ? "meta" : "google";
    const connectBtn = cfg.configured && o.encryptionConfigured
      ? `<form method="post" action="/admin/integracoes/${key}/conectar"><button type="submit" class="btn btn-small btn-primary">Conectar ${label}</button></form>`
      : `<p class="small" style="color:#fde68a">Não configurado no servidor — faltam: ${escapeHtml([...cfg.missing, ...(o.encryptionConfigured ? [] : ["CREDENTIAL_ENCRYPTION_KEY"])].join(", "))}. Redirect URI a cadastrar no app: <code>${escapeHtml(cfg.redirectUri)}</code></p>`;
    const list = conns.length
      ? `<ul class="list" style="margin-top:0.75rem">${conns
          .map(
            (c) => `<li><span>${escapeHtml(c.display_name ?? c.external_user_id ?? `conexão #${c.id}`)} <span class="muted small">· token ${c.hasAccessToken ? "cifrado ✓" : "ausente"}${c.token_expires_at ? ` · expira ${fmtDateTime(c.token_expires_at, "America/Sao_Paulo")}` : ""}</span>${c.last_error_sanitized ? `<br /><span class="small" style="color:#f87171">${escapeHtml(c.last_error_sanitized)}</span>` : ""}</span>
            <span style="display:flex;gap:0.3rem;align-items:center">${connStatusChip(c.status)}
              <form method="post" action="/admin/integracoes/conexoes/${c.id}/descobrir" style="display:inline"><button type="submit" class="btn btn-small" ${c.status === "REVOGADA" ? "disabled" : ""}>Listar contas</button></form>
              <form method="post" action="/admin/integracoes/conexoes/${c.id}/revogar" style="display:inline"><button type="submit" class="btn btn-small btn-danger">Revogar</button></form></span></li>`
          )
          .join("")}</ul>`
      : '<p class="muted small" style="margin-top:0.75rem">Nenhuma conexão ainda.</p>';
    return `<div class="card-block"><h3>${providerChip(provider)} <span class="actions">${connectBtn}</span></h3>
      <p class="small muted">Permissões somente de leitura (${provider === "META" ? "ads_read, read_insights" : "adwords, via OAuth 2.0 + PKCE; nível de acesso definido pelo projeto Google Cloud das credenciais"}). Nenhuma campanha é criada, editada ou pausada por este sistema.</p>${list}</div>`;
  };

  const companyOptions = (selected: number | null) => `<option value="">— escolher empresa —</option>` + o.companies.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  const accountsRows = o.accounts.length
    ? o.accounts
        .map(
          (a) => `<tr>
      <td class="left">${providerChip(a.provider)}</td>
      <td class="left">${escapeHtml(a.name ?? "—")}<br /><span class="muted small">${escapeHtml(a.external_account_id)}${a.is_manager ? " · gerenciadora (MCC)" : ""}${a.login_customer_id ? ` · via ${escapeHtml(a.login_customer_id)}` : ""}</span></td>
      <td class="left">${escapeHtml(a.currency ?? "—")} · ${escapeHtml(a.timezone ?? "—")}</td>
      <td class="left"><form method="post" action="/admin/integracoes/contas/${a.id}/vincular" class="inline-form" style="gap:0.3rem"><select name="company_id" style="width:auto">${companyOptions(a.company_id)}</select><label class="checkbox-line"><input type="checkbox" name="sync" value="1" ${a.sync_enabled ? "checked" : ""} /> sincronizar</label><button type="submit" class="btn btn-small">Salvar</button></form>${a.company_id ? `<form method="post" action="/admin/integracoes/contas/${a.id}/desvincular" style="margin-top:0.3rem"><button type="submit" class="btn btn-small btn-danger">Desvincular</button></form>` : ""}</td>
      <td class="left">${accountHealthChip(a, now)}</td>
      <td class="left muted small">${fmtDateTime(a.last_sync_at, "America/Sao_Paulo")}<br />ok: ${fmtDateTime(a.last_success_at, "America/Sao_Paulo")}${a.last_error_sanitized ? `<br /><span style="color:#f87171">${escapeHtml(a.last_error_sanitized)}</span>` : ""}</td>
      <td class="left">${a.company_id && a.sync_enabled ? `<form method="post" action="/admin/integracoes/contas/${a.id}/sincronizar"><button type="submit" class="btn btn-small">Atualizar agora</button></form>` : '<span class="muted small">vincule e ative</span>'}</td>
    </tr>`
        )
        .join("")
    : '<tr><td colspan="7" class="left muted">Nenhuma conta descoberta. Conecte um provedor e clique em "Listar contas".</td></tr>';

  const waRows = o.whatsapp
    .map(
      (w) => `<tr><td class="left">${escapeHtml(w.company.name)}</td><td class="left">${w.connection ? escapeHtml(w.connection.display_phone_number ?? w.connection.phone_number_id) : "—"}</td>
      <td class="left">${w.connection ? `<span class="chip ${w.connection.status === "CONECTADO" ? "chip-ok" : w.connection.status === "ERRO" ? "chip-bad" : "chip-warn"}">${escapeHtml(WA_STATUS_LABELS[w.connection.status])}</span>` : '<span class="chip chip-muted">Não configurado</span>'}</td>
      <td class="left muted small">${w.connection ? fmtDateTime(w.connection.last_verified_at, "America/Sao_Paulo") : "—"}</td>
      <td class="left"><a href="/admin/whatsapp" class="btn btn-small">Gerenciar</a></td></tr>`
    )
    .join("");

  const body = `${adminHead("Integrações", "Central de saúde: Meta Ads, Google Ads e WhatsApp", "/admin/integracoes")}
    ${o.notice ? `<p class="success">${escapeHtml(o.notice)}</p>` : ""}${o.error ? `<p class="error">${escapeHtml(o.error)}</p>` : ""}
    <div class="notice-box">${escapeHtml(FREE_TIER_NOTICE)} Sincronização automática em processo a cada ${o.syncIntervalMinutes || "— (desligada)"} min enquanto a instância estiver ativa; o botão "Atualizar agora" é o caminho garantido.</div>
    <div class="grid-12"><div class="col-6">${providerCard("META", o.meta)}</div><div class="col-6">${providerCard("GOOGLE", o.google)}</div></div>
    <div class="card-block"><h3>Contas de anúncio descobertas <span class="actions"><form method="post" action="/admin/integracoes/sincronizar-tudo"><button type="submit" class="btn btn-small">Atualizar todas agora</button></form></span></h3>
      <p class="small muted">Vincule cada conta a UMA empresa. Uma empresa nunca vê a conta de outra.</p>
      <div class="data-table-wrap"><table class="data-table" style="min-width:1000px"><thead><tr><th class="left">Provedor</th><th class="left">Conta</th><th class="left">Moeda · fuso</th><th class="left">Empresa vinculada</th><th class="left">Estado</th><th class="left">Última sync / sucesso</th><th class="left">Ação</th></tr></thead><tbody>${accountsRows}</tbody></table></div></div>
    <div class="card-block"><h3>WhatsApp por empresa</h3><div class="data-table-wrap"><table class="data-table" style="min-width:700px"><thead><tr><th class="left">Empresa</th><th class="left">Número</th><th class="left">Status</th><th class="left">Última validação</th><th class="left"></th></tr></thead><tbody>${waRows || '<tr><td colspan="5" class="left muted">Nenhuma empresa.</td></tr>'}</tbody></table></div></div>`;
  return wrap("Integrações", body);
}

// --- Marketing agregado ---------------------------------------------------------------------

export interface CompanySummary {
  company: Company;
  bi: CompanyBi;
  health: HealthScore;
  goals: CompanyGoals | null;
  accounts: MarketingAccountWithConnection[];
  whatsapp: ConnectionAdminView | null;
}

function spendByCurrency(summaries: CompanySummary[], provider?: MarketingProvider): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of summaries) {
    for (const a of s.accounts) {
      if (provider && a.provider !== provider) continue;
    }
    const rows = provider ? s.bi.providers.filter((p) => p.provider === provider) : [{ platform: s.bi.current.platform }];
    for (const r of rows) {
      if (!r.platform.hasSpendData) continue;
      const cur = r.platform.currencies[0] ?? "BRL";
      map.set(cur, (map.get(cur) ?? 0) + r.platform.spendCents);
    }
  }
  return map;
}

function moneyByCurrency(map: Map<string, number>): string {
  if (map.size === 0) return "—";
  return [...map.entries()].map(([cur, cents]) => (cur === "BRL" ? fmtBRL(cents) : `${cur} ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)).join(" + ");
}

export function adminMarketingPage(o: {
  summaries: CompanySummary[];
  periodLabel: string;
  syncRuns: (SyncRun & { account_name: string | null; company_name: string | null })[];
  openAlerts: AlertRow[];
  rules: { kind: string; threshold: number }[];
  notice?: string;
  error?: string;
  now?: Date;
}): string {
  const now = o.now ?? new Date();
  const S = o.summaries;
  const allAccounts = S.flatMap((s) => s.accounts);
  const metaAccounts = allAccounts.filter((a) => a.provider === "META");
  const googleAccounts = allAccounts.filter((a) => a.provider === "GOOGLE");
  const needReconnect = allAccounts.filter((a) => a.connection_status !== "CONECTADA");
  const withErrors = allAccounts.filter((a) => a.last_error_sanitized);
  const activeCampaigns = S.reduce((n, s) => n + s.bi.campaigns.filter((r) => /ACTIVE|ENABLED/i.test(r.campaign.status ?? "")).length, 0);
  const advertising = S.filter((s) => s.bi.current.platform.hasSpendData).length;
  const noIntegration = S.filter((s) => s.accounts.length === 0).length;
  const leads = S.reduce((n, s) => n + s.bi.current.crm.leads, 0);
  const customers = S.reduce((n, s) => n + s.bi.current.crm.newCustomers, 0);
  const attributedRevenue = S.reduce((n, s) => n + s.bi.current.crm.attributedRevenueCents, 0);
  const totalSpend = spendByCurrency(S);
  const brlSpend = totalSpend.get("BRL") ?? 0;
  const brlOnly = totalSpend.size === 1 && totalSpend.has("BRL");
  const cacAvg = brlOnly && customers > 0 ? brlSpend / customers : null;
  const roasAgg = brlOnly && brlSpend > 0 ? attributedRevenue / brlSpend : null;

  const card = (label: string, value: string, tip = "") => `<div class="kpi kpi-secondary"><div class="kpi-label"><span title="${escapeHtml(tip)}">${escapeHtml(label)}</span></div><div class="kpi-value">${value}</div></div>`;
  const cards = `<div class="kpi-grid">
    ${card("Total investido", moneyByCurrency(totalSpend), "Somado só por moeda — moedas diferentes nunca são misturadas.")}
    ${card("Investido Meta", moneyByCurrency(spendByCurrency(S, "META")))}
    ${card("Investido Google", moneyByCurrency(spendByCurrency(S, "GOOGLE")))}
    ${card("Contas conectadas", `${allAccounts.length} <span class="small muted">(${metaAccounts.length} Meta · ${googleAccounts.length} Google)</span>`)}
    ${card("Exigindo reconexão", String(needReconnect.length))}
    ${card("Erros de sincronização", String(withErrors.length))}
    ${card("Campanhas ativas", String(activeCampaigns))}
    ${card("Empresas anunciando", `${advertising} <span class="small muted">/ ${S.length}</span>`)}
    ${card("Empresas sem integração", String(noIntegration))}
    ${card("Leads gerados", String(leads))}
    ${card("Clientes gerados", String(customers))}
    ${card("Receita atribuída", fmtBRL(attributedRevenue))}
    ${card("CAC médio", cacAvg === null ? "—" : fmtBRL(cacAvg), brlOnly ? "Investimento total (BRL) ÷ clientes" : "Indisponível: contas em moedas diferentes")}
    ${card("ROAS agregado", roasAgg === null ? "—" : `${fmtNum(roasAgg)}x`, brlOnly ? "Receita atribuída ÷ investimento (BRL)" : "Indisponível: contas em moedas diferentes")}
  </div>`;

  const rank = (title: string, items: CompanySummary[], value: (s: CompanySummary) => string) =>
    `<div class="card-block"><h3>${escapeHtml(title)}</h3>${items.length ? `<ol style="margin:0;padding-left:1.2rem;font-size:0.85rem">${items.map((s) => `<li><a href="/empresa/${s.company.id}/marketing" title="Abrir Meta Ads + Google Ads + CRM desta empresa">${escapeHtml(s.company.name)}</a> <span class="muted">— ${value(s)}</span></li>`).join("")}</ol>` : '<p class="muted small">Sem dados suficientes.</p>'}</div>`;
  const withSpend = S.filter((s) => s.bi.current.platform.hasSpendData);
  const rankings = `<div class="grid-12">
    <div class="col-4">${rank("Maior investimento", [...withSpend].sort((a, b) => b.bi.current.platform.spendCents - a.bi.current.platform.spendCents).slice(0, 5), (s) => fmtBRL(s.bi.current.platform.spendCents))}</div>
    <div class="col-4">${rank("Mais leads", [...S].filter((s) => s.bi.current.crm.leads > 0).sort((a, b) => b.bi.current.crm.leads - a.bi.current.crm.leads).slice(0, 5), (s) => `${s.bi.current.crm.leads} leads`)}</div>
    <div class="col-4">${rank("Menor CPL", [...S].filter((s) => s.bi.current.kpis.cpl !== null).sort((a, b) => a.bi.current.kpis.cpl! - b.bi.current.kpis.cpl!).slice(0, 5), (s) => fmtBRL(s.bi.current.kpis.cpl))}</div>
    <div class="col-4">${rank("Menor CAC", [...S].filter((s) => s.bi.current.kpis.cac !== null).sort((a, b) => a.bi.current.kpis.cac! - b.bi.current.kpis.cac!).slice(0, 5), (s) => fmtBRL(s.bi.current.kpis.cac))}</div>
    <div class="col-4">${rank("Maior receita atribuída", [...S].filter((s) => s.bi.current.crm.attributedRevenueCents > 0).sort((a, b) => b.bi.current.crm.attributedRevenueCents - a.bi.current.crm.attributedRevenueCents).slice(0, 5), (s) => fmtBRL(s.bi.current.crm.attributedRevenueCents))}</div>
    <div class="col-4">${rank("Melhor ROAS", [...S].filter((s) => s.bi.current.kpis.roasCrm !== null).sort((a, b) => b.bi.current.kpis.roasCrm! - a.bi.current.kpis.roasCrm!).slice(0, 5), (s) => `${fmtNum(s.bi.current.kpis.roasCrm)}x`)}</div>
    <div class="col-6">${rank("Piora significativa (CAC +30% ou receita −30% vs período anterior)", S.filter((s) => (deltaPercent(s.bi.current.kpis.cac, s.bi.previous.kpis.cac) ?? 0) >= 30 || (deltaPercent(s.bi.current.crm.revenueCents, s.bi.previous.crm.revenueCents) ?? 0) <= -30), (s) => `CAC ${fmtDelta(deltaPercent(s.bi.current.kpis.cac, s.bi.previous.kpis.cac))} · receita ${fmtDelta(deltaPercent(s.bi.current.crm.revenueCents, s.bi.previous.crm.revenueCents))}`)}</div>
    <div class="col-6">${rank("Integração com erro", S.filter((s) => s.accounts.some((a) => a.connection_status !== "CONECTADA" || a.last_error_sanitized)), (s) => s.accounts.filter((a) => a.connection_status !== "CONECTADA" || a.last_error_sanitized).map((a) => `${a.provider}: ${CONN_STATUS_LABEL[a.connection_status] ?? a.connection_status}${a.last_error_sanitized ? ` (${a.last_error_sanitized})` : ""}`).join("; "))}</div>
  </div>`;

  const runs = o.syncRuns.length
    ? `<div class="data-table-wrap"><table class="data-table" style="min-width:900px"><thead><tr><th class="left">Início</th><th class="left">Empresa</th><th class="left">Provedor</th><th class="left">Conta</th><th class="left">Gatilho</th><th class="left">Status</th><th class="left">Janela</th><th>Registros</th><th class="left">Erro</th></tr></thead><tbody>${o.syncRuns
        .map(
          (r) => `<tr><td class="left muted">${fmtDateTime(r.started_at, "America/Sao_Paulo")}</td><td class="left">${escapeHtml(r.company_name ?? "—")}</td><td class="left">${providerChip(r.provider)}</td><td class="left">${escapeHtml(r.account_name ?? "—")}</td><td class="left">${r.trigger_kind}</td><td class="left"><span class="chip ${r.status === "OK" ? "chip-ok" : r.status === "ERRO" ? "chip-bad" : "chip-warn"}">${r.status}</span></td><td class="left muted small">${escapeHtml(r.window_from ?? "")} → ${escapeHtml(r.window_to ?? "")}</td><td>${r.processed_count}</td><td class="left small" style="white-space:normal;max-width:320px;color:#f87171">${escapeHtml(r.error_sanitized ?? "")}</td></tr>`
        )
        .join("")}</tbody></table></div>`
    : '<p class="muted small">Nenhuma sincronização executada ainda.</p>';

  const ruleValue = (kind: string) => o.rules.find((r) => r.kind === kind)?.threshold;
  const rulesForm = `<form method="post" action="/admin/alertas/regras" class="form-grid">${RULE_KINDS.map(
    (r) => `<label>${escapeHtml(r.label)}<input type="number" step="any" min="0" name="${r.kind}" value="${ruleValue(r.kind) !== undefined ? (r.kind === "spendWithoutLeadCents" ? (ruleValue(r.kind)! / 100).toFixed(2) : ruleValue(r.kind)) : ""}" placeholder="padrão" /></label>`
  ).join("")}<div style="align-self:end"><button type="submit" class="btn btn-small btn-primary">Salvar limiares globais</button></div></form>
  <p class="small muted">Valores em branco usam o padrão do sistema. "Investimento sem lead" é informado em R$.</p>`;

  const alerts = o.openAlerts.length
    ? `<ul class="attention-list">${o.openAlerts.slice(0, 30).map((a) => `<li><div><span class="sev sev-${a.severity}">${SEVERITY_LABELS[a.severity]}</span><div class="small muted" style="margin-top:0.3rem">${escapeHtml(a.company_name ?? "")}</div></div><div class="fact">${escapeHtml(a.description)}</div></li>`).join("")}</ul>`
    : '<p class="muted small">Nenhum alerta aberto.</p>';

  const body = `${adminHead("Marketing", `Visão agregada de todas as empresas · ${o.periodLabel}`, "/admin/marketing")}
    ${o.notice ? `<p class="success">${escapeHtml(o.notice)}</p>` : ""}${o.error ? `<p class="error">${escapeHtml(o.error)}</p>` : ""}
    <div class="notice-box">${escapeHtml(FREE_TIER_NOTICE)}</div>
    ${cards}
    <h3 class="section-title">Ranking de empresas (analítico — sem julgamento comercial)</h3>${rankings}
    <div class="card-block"><h3>Alertas abertos (todas as empresas)</h3>${alerts}</div>
    <div class="card-block"><h3>Regras de alerta (padrão global)</h3>${rulesForm}</div>
    <div class="card-block"><h3>Sincronizações recentes</h3>${runs}</div>`;
  return wrap("Marketing", body);
}

// --- Agência (carteira + semáforo) --------------------------------------------------------

export function adminAgencyPage(o: { summaries: CompanySummary[]; periodLabel: string; sort: string | null; now?: Date }): string {
  const now = o.now ?? new Date();
  const S = o.summaries;
  const withMeta = S.filter((s) => s.accounts.some((a) => a.provider === "META")).length;
  const withGoogle = S.filter((s) => s.accounts.some((a) => a.provider === "GOOGLE")).length;
  const withBoth = S.filter((s) => s.accounts.some((a) => a.provider === "META") && s.accounts.some((a) => a.provider === "GOOGLE")).length;
  const spend = spendByCurrency(S);
  const leads = S.reduce((n, s) => n + s.bi.current.crm.leads, 0);
  const qualified = S.reduce((n, s) => n + s.bi.current.crm.qualified, 0);
  const customers = S.reduce((n, s) => n + s.bi.current.crm.newCustomers, 0);
  const revenue = S.reduce((n, s) => n + s.bi.current.crm.attributedRevenueCents, 0);
  const brl = spend.size === 1 && spend.has("BRL") ? spend.get("BRL")! : null;
  const problems = S.filter((s) => s.accounts.some((a) => a.connection_status !== "CONECTADA" || a.last_error_sanitized)).length;
  const expired = S.reduce((n, s) => n + s.accounts.filter((a) => a.connection_status === "EXPIRADA" || a.connection_status === "RECONEXAO_NECESSARIA").length, 0);
  const unattended = S.reduce((n, s) => n + (s.bi.sla.longestOpenWaitMs !== null ? 1 : 0), 0);
  const card = (label: string, value: string) => `<div class="kpi kpi-secondary"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${value}</div></div>`;
  const cards = `<div class="kpi-grid">
    ${card("Clientes ativos", String(S.filter((s) => !s.company.suspended).length))}
    ${card("Com Meta Ads", String(withMeta))}${card("Com Google Ads", String(withGoogle))}${card("Com ambos", String(withBoth))}
    ${card("Investimento administrado", moneyByCurrency(spend))}
    ${card("Leads gerados", String(leads))}${card("Qualificados", String(qualified))}${card("Clientes gerados", String(customers))}
    ${card("Receita atribuída", fmtBRL(revenue))}
    ${card("CAC médio", brl !== null && customers ? fmtBRL(brl / customers) : "—")}
    ${card("ROAS médio", brl ? `${fmtNum(revenue / brl)}x` : "—")}
    ${card("Contas com problema", String(problems))}${card("Integrações vencidas", String(expired))}${card("Empresas com espera sem resposta", String(unattended))}
  </div>`;

  const sortKey = o.sort ?? "investimento";
  const val = (s: CompanySummary): number => {
    switch (sortKey) {
      case "pior_cac": return -(s.bi.current.kpis.cac ?? -1);
      case "melhor_cac": return s.bi.current.kpis.cac ?? Infinity;
      case "menor_conversao": return s.bi.current.kpis.closeRate ?? Infinity;
      case "maior_roas": return -(s.bi.current.kpis.roasCrm ?? -1);
      case "problemas": return s.health.semaphore === "VERMELHO" ? 0 : s.health.semaphore === "AMARELO" ? 1 : 2;
      default: return -s.bi.current.platform.spendCents;
    }
  };
  const sorted = [...S].sort((a, b) => val(a) - val(b));
  const sortLink = (key: string, label: string) => `<a href="/admin/agencia?ordenar=${key}" class="${sortKey === key ? "active" : ""}">${label}</a>`;
  const rows = sorted
    .map((s) => {
      const c = s.bi.current;
      const goalRev = s.goals?.revenue_cents ?? null;
      const attainment = goalRev ? c.crm.revenueCents / goalRev : null;
      const fresh = freshnessLabel(s.bi.freshness.lastSuccessAt, now);
      const chip = (present: boolean, ok: boolean) => (present ? `<span class="chip ${ok ? "chip-ok" : "chip-bad"}">${ok ? "ok" : "erro"}</span>` : '<span class="chip chip-muted">—</span>');
      const meta = s.accounts.filter((a) => a.provider === "META");
      const google = s.accounts.filter((a) => a.provider === "GOOGLE");
      return `<tr>
        <td class="left"><a href="/empresa/${s.company.id}/marketing" title="Abrir a central de marketing da empresa (Meta + Google + CRM)">${escapeHtml(s.company.name)}</a> <a class="small muted" href="/admin/agencia/empresa/${s.company.id}">resumo</a></td>
        <td class="left">${s.company.suspended ? '<span class="chip chip-bad">suspensa</span>' : `<span class="chip chip-muted">${escapeHtml(s.company.plan.toLowerCase())}</span>`}</td>
        <td class="left">${chip(meta.length > 0, meta.every((a) => a.connection_status === "CONECTADA" && !a.last_error_sanitized))}</td>
        <td class="left">${chip(google.length > 0, google.every((a) => a.connection_status === "CONECTADA" && !a.last_error_sanitized))}</td>
        <td class="left">${s.whatsapp ? `<span class="chip ${s.whatsapp.status === "CONECTADO" ? "chip-ok" : "chip-warn"}">${escapeHtml(WA_STATUS_LABELS[s.whatsapp.status])}</span>` : '<span class="chip chip-muted">—</span>'}</td>
        <td>${c.platform.hasSpendData ? fmtBRL(c.platform.spendCents) : "—"}</td>
        <td>${c.crm.leads}</td><td>${c.crm.qualified}</td><td>${c.crm.newCustomers}</td>
        <td>${c.kpis.cac === null ? "—" : fmtBRL(c.kpis.cac)}</td>
        <td>${c.kpis.roasCrm === null ? "—" : `${fmtNum(c.kpis.roasCrm)}x`}</td>
        <td>${goalRev === null ? "—" : fmtBRL(goalRev)}</td>
        <td>${attainment === null ? "—" : fmtPct(attainment)}</td>
        <td class="left"><span class="semaforo semaforo-${s.health.semaphore}" title="${escapeHtml(s.health.reasons.join(" "))}"></span> ${s.health.score ?? "—"}</td>
        <td class="left muted small">${escapeHtml(fresh.text)}</td>
      </tr>`;
    })
    .join("");
  const body = `${adminHead("Agência", `Carteira de clientes · ${o.periodLabel}`, "/admin/agencia")}
    ${cards}
    <div class="card-block"><h3>Carteira de clientes <span class="actions preset-links">${sortLink("investimento", "Maior investimento")}${sortLink("pior_cac", "Pior CAC")}${sortLink("melhor_cac", "Melhor CAC")}${sortLink("menor_conversao", "Menor conversão")}${sortLink("maior_roas", "Maior ROAS")}${sortLink("problemas", "Problemas técnicos")}</span></h3>
      <div class="data-table-wrap"><table class="data-table" style="min-width:1200px"><thead><tr><th class="left">Empresa</th><th class="left">Status</th><th class="left">Meta</th><th class="left">Google</th><th class="left">WhatsApp</th><th>Investimento</th><th>Leads</th><th>Qualif.</th><th>Clientes</th><th>CAC</th><th>ROAS</th><th>Meta mensal</th><th>Atingimento</th><th class="left">Saúde</th><th class="left">Última sync</th></tr></thead><tbody>${rows || '<tr><td colspan="15" class="left muted">Nenhuma empresa.</td></tr>'}</tbody></table></div>
      <p class="small muted" style="margin-top:0.5rem">Semáforo: verde = dentro das metas e integrações saudáveis; amarelo = alguma métrica fora da meta; vermelho = problema grave ou integração quebrada; cinza = dados insuficientes. Fórmula transparente na Central de Performance de cada empresa.</p></div>`;
  return wrap("Agência", body);
}
