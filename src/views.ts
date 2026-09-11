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
import type { ConnectionStatusReport } from "./whatsapp";
import type { DashboardData, DashboardFilters } from "./dashboard";
import type { AuditEntry } from "./access";
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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0f172a;
    color: #f8fafc;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: #38bdf8; }
  .center-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .card {
    background: #111827;
    border: 1px solid #1f2937;
    border-radius: 12px;
    padding: 2rem;
    width: 100%;
    max-width: 360px;
  }
  .card h1 { font-size: 1.25rem; margin: 0 0 1.25rem; }
  label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 1rem; }
  input {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0b1220;
    color: #f8fafc;
    font-size: 0.95rem;
  }
  button {
    width: 100%;
    padding: 0.6rem;
    border-radius: 6px;
    border: none;
    background: #38bdf8;
    color: #0f172a;
    font-weight: 600;
    cursor: pointer;
  }
  .error { color: #f87171; font-size: 0.85rem; margin: 0 0 1rem; }
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 220px;
    background: #111827;
    border-right: 1px solid #1f2937;
    padding: 1.25rem 0.75rem;
    flex-shrink: 0;
  }
  .sidebar .brand { font-size: 0.9rem; font-weight: 700; padding: 0 0.5rem 1rem; color: #38bdf8; }
  .sidebar nav a {
    display: block;
    padding: 0.55rem 0.6rem;
    border-radius: 6px;
    color: #cbd5e1;
    text-decoration: none;
    font-size: 0.9rem;
    margin-bottom: 0.15rem;
  }
  .sidebar nav a.active { background: #1e293b; color: #f8fafc; font-weight: 600; }
  .sidebar nav a:hover { background: #1e293b; }
  .main { flex: 1; display: flex; flex-direction: column; }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.5rem;
    border-bottom: 1px solid #1f2937;
  }
  .topbar .company { font-weight: 600; }
  .topbar .who { font-size: 0.8rem; color: #94a3b8; }
  .topbar form { display: inline; }
  .topbar button.logout {
    width: auto;
    background: transparent;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.35rem 0.75rem;
    font-weight: 500;
    font-size: 0.8rem;
  }
  .content { padding: 2rem; flex: 1; }
  .empty-state {
    border: 1px dashed #334155;
    border-radius: 12px;
    padding: 3rem 2rem;
    text-align: center;
    color: #94a3b8;
  }
  .empty-state h2 { color: #f8fafc; margin: 0 0 0.5rem; font-size: 1.1rem; }
  .list { list-style: none; padding: 0; margin: 0; }
  .list li {
    padding: 0.85rem 1rem;
    border: 1px solid #1f2937;
    border-radius: 8px;
    margin-bottom: 0.6rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .role-tag {
    font-size: 0.75rem;
    color: #38bdf8;
    border: 1px solid #334155;
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
  }
  h1, h2, h3 { margin-top: 0; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; gap: 1rem; flex-wrap: wrap; }
  .btn {
    display: inline-block;
    padding: 0.5rem 0.9rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #1e293b;
    color: #f8fafc;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn-primary { background: #38bdf8; color: #0f172a; border-color: #38bdf8; }
  .btn-danger { background: transparent; color: #f87171; border-color: #7f1d1d; }
  .btn-small { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
  textarea, select {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0b1220;
    color: #f8fafc;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    border: 1px solid #334155;
    white-space: nowrap;
  }
  .badge-auto { color: #94a3b8; }
  .badge-aguardando { color: #fbbf24; border-color: #78350f; }
  .badge-humano { color: #4ade80; border-color: #14532d; }
  .badge-cliente-aguarda { color: #38bdf8; border-color: #0c4a6e; }
  .badge-encerrado { color: #64748b; }
  .conv-list { list-style: none; padding: 0; margin: 0; }
  .conv-list li a {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 1rem;
    border: 1px solid #1f2937;
    border-radius: 8px;
    margin-bottom: 0.6rem;
    text-decoration: none;
    color: inherit;
  }
  .conv-list li a:hover { border-color: #334155; }
  .conv-list .meta { font-size: 0.75rem; color: #94a3b8; }
  .panel {
    border: 1px solid #1f2937;
    border-radius: 10px;
    padding: 1.25rem;
    margin-bottom: 1.25rem;
    background: #111827;
  }
  .panel h3 { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
  .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; align-items: start; }
  .chat { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem; max-height: 420px; overflow-y: auto; }
  .bubble { max-width: 80%; padding: 0.55rem 0.8rem; border-radius: 10px; font-size: 0.88rem; }
  .bubble .author { font-size: 0.7rem; opacity: 0.75; margin-bottom: 0.2rem; display: flex; gap: 0.4rem; align-items: center; }
  .bubble.cliente { align-self: flex-start; background: #1e293b; }
  .bubble.robo { align-self: flex-end; background: #0c4a6e; }
  .bubble.humano { align-self: flex-end; background: #14532d; }
  .bubble.automacao { align-self: flex-end; background: #3730a3; }
  .bubble.desconhecido { align-self: flex-start; background: #451a03; }
  .bubble.falhou { border: 1px dashed #f87171; }
  .fail-tag { color: #f87171; font-size: 0.7rem; }
  .dev-panel { border: 1px dashed #78350f; background: #1c1206; }
  .dev-panel h3 { color: #fbbf24; }
  .field { margin-bottom: 0.9rem; }
  .field label { font-size: 0.8rem; color: #94a3b8; display: block; margin-bottom: 0.3rem; }
  .inline-form { display: flex; gap: 0.5rem; }
  .inline-form textarea { flex: 1; }
  .hours-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .hours-table td, .hours-table th { padding: 0.4rem 0.5rem; text-align: left; }
  .hours-table input[type="time"] {
    padding: 0.3rem; border-radius: 6px; border: 1px solid #334155; background: #0b1220; color: #f8fafc;
  }
  .success { color: #4ade80; font-size: 0.85rem; margin: 0 0 1rem; }
  .checkbox-line { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: #cbd5e1; }
  .checkbox-line input { width: auto; }

  /* CRM */
  input[type="text"], input[type="number"], input[type="email"], input[type="password"],
  input[type="date"], input[type="datetime-local"] {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #0b1220;
    color: #f8fafc;
    font-size: 0.9rem;
  }
  details.panel > summary { cursor: pointer; font-weight: 600; color: #38bdf8; list-style: none; }
  details.panel > summary::-webkit-details-marker { display: none; }
  details.panel[open] > summary { margin-bottom: 1rem; }
  .stage-section { margin-bottom: 1.25rem; }
  .stage-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.6rem; }
  .stage-head h3 { margin: 0; text-transform: none; font-size: 1rem; color: #f8fafc; letter-spacing: 0; }
  .opp-card { border: 1px solid #1f2937; border-radius: 8px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; }
  .opp-card .title { font-weight: 600; }
  .opp-card .meta-row { font-size: 0.78rem; color: #94a3b8; margin: 0.2rem 0 0.5rem; display: flex; gap: 0.9rem; flex-wrap: wrap; }
  .opp-card form { margin-top: 0.5rem; }
  .lost-reason { color: #f87171; font-size: 0.78rem; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.7rem; }

  /* Dashboard */
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; }
  .metric-card { border: 1px solid #1f2937; border-radius: 10px; padding: 1rem; background: #111827; }
  .metric-card .value { font-size: 1.6rem; font-weight: 700; margin: 0.15rem 0; }
  .metric-card .label { font-size: 0.78rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
  .metric-card .help { font-size: 0.75rem; color: #64748b; margin-top: 0.35rem; }
  .section-title { font-size: 1rem; margin: 1.75rem 0 0.75rem; color: #f8fafc; }
  .section-title:first-of-type { margin-top: 0; }
  .demo-banner {
    background: #78350f;
    color: #fde68a;
    border-radius: 8px;
    padding: 0.6rem 1rem;
    font-size: 0.8rem;
    margin-bottom: 1.25rem;
  }
  .filters-form { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin-bottom: 1.25rem; }
  .filters-form .field { margin-bottom: 0; min-width: 150px; }

  @media (max-width: 720px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; border-right: none; border-bottom: 1px solid #1f2937; padding: 0.75rem; }
    .sidebar nav { display: flex; overflow-x: auto; gap: 0.25rem; }
    .sidebar nav a { white-space: nowrap; margin-bottom: 0; }
    .sidebar .brand { display: none; }
    .content { padding: 1.1rem; }
    .grid-2 { grid-template-columns: 1fr; }
    .card { max-width: 100%; }
  }
`;

function page(title: string, body: string): string {
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
        <h1>HUB ACTION — CRM WhatsApp</h1>
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
    "Painel da Hub Action",
    `${IS_DEMO ? '<div class="demo-banner" style="margin:0;border-radius:0">⚠️ Ambiente de teste — dados fictícios (modo de demonstração), sem conexão com WhatsApp real.</div>' : ""}
    <div style="max-width:1000px;margin:0 auto;padding:1.5rem">
      <div class="toolbar">
        <h2 style="margin:0">Painel da Hub Action</h2>
        <div style="display:flex;gap:0.5rem">
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

export interface NavItem {
  key: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "conversas", label: "Conversas" },
  { key: "crm", label: "CRM" },
  { key: "relatorios", label: "Relatórios" },
  { key: "configuracoes", label: "Configurações" },
];

const ROLE_LABEL: Record<Role, string> = {
  COMPANY_ADMIN: "Administrador da empresa",
  AGENT: "Atendente",
};

export function appShell(opts: {
  company: Company;
  user: User;
  role: Role;
  active: string;
  body: string;
}): string {
  const nav = NAV_ITEMS.map(
    (item) =>
      `<a href="/empresa/${opts.company.id}/${item.key}" class="${item.key === opts.active ? "active" : ""}">${item.label}</a>`
  ).join("");

  // Modo de demonstração: mesmo critério do simulador (fora de produção, tudo é dado fictício).
  const demoBanner = IS_DEMO
    ? `<div class="demo-banner" style="margin:0;border-radius:0">⚠️ Ambiente de teste — dados fictícios (modo de demonstração), sem conexão com WhatsApp real.</div>`
    : "";

  return page(
    `${opts.company.name} — HUB ACTION`,
    `${demoBanner}<div class="layout">
      <aside class="sidebar">
        <div class="brand">HUB ACTION</div>
        <nav>${nav}</nav>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <div class="company">${escapeHtml(opts.company.name)}</div>
            <div class="who">${escapeHtml(opts.user.name)} &middot; ${ROLE_LABEL[opts.role]}</div>
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

/** Área "Conexão do WhatsApp" — exclusiva de administrador; status sempre calculado, nunca "Conectado" por campo preenchido. */
function whatsappConnectionPanel(companyId: number, report: ConnectionStatusReport, verifySuccess?: string, verifyError?: string): string {
  const statusBadgeClass =
    report.statusLabel === "Verificado pela Meta"
      ? "badge-humano"
      : report.statusLabel === "Falha na última verificação"
        ? "badge-encerrado"
        : "badge-aguardando";

  const credRow = (label: string, present: boolean) =>
    `<li><span>${escapeHtml(label)}</span> <span class="badge ${present ? "badge-humano" : "badge-encerrado"}">${present ? "configurado" : "não configurado"}</span></li>`;

  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return `<div class="panel">
    <h3>Conexão do WhatsApp</h3>
    <p class="meta" style="margin-top:-0.3rem">Visível só para administradores da empresa. Credenciais nunca aparecem aqui — só se estão configuradas ou não.</p>

    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin:0.75rem 0">
      <span class="badge">${MODE_LABELS[report.mode]}</span>
      <span class="badge ${statusBadgeClass}">${escapeHtml(report.statusLabel)}</span>
    </div>

    ${
      report.connection
        ? `<p class="meta">Número associado: <strong>${report.connection.display_phone_number ? escapeHtml(report.connection.display_phone_number) : report.connection.phone_number_id}</strong></p>`
        : `<p class="meta">Nenhum número associado — a empresa está em modo demonstração.</p>`
    }

    <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Credenciais no servidor</h4>
    <ul class="list" style="margin-bottom:0.75rem">
      ${credRow("Token de verificação do webhook", report.credentials.verifyToken)}
      ${credRow("Segredo do aplicativo", report.credentials.appSecret)}
      ${credRow("Token de acesso (envio)", report.credentials.accessToken)}
    </ul>

    <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Evidências reais</h4>
    <p class="meta">Última mensagem recebida: ${report.lastInbound ? `${fmt(report.lastInbound.createdAt)} — "${escapeHtml(report.lastInbound.preview.slice(0, 60))}"` : "nenhuma ainda"}</p>
    <p class="meta">Última resposta enviada com sucesso: ${report.lastOutbound ? fmt(report.lastOutbound.createdAt) : "nenhuma ainda"}</p>

    ${
      report.connection
        ? `<form method="post" action="/empresa/${companyId}/configuracoes/whatsapp/verificar" style="margin:0.75rem 0">
            <button type="submit" class="btn btn-small">Verificar agora com a Meta</button>
            ${report.connection.last_verified_at ? `<span class="meta"> última checagem: ${fmt(report.connection.last_verified_at)}</span>` : ""}
          </form>`
        : ""
    }
    ${verifySuccess ? `<p class="success">${escapeHtml(verifySuccess)}</p>` : ""}
    ${verifyError ? `<p class="error">${escapeHtml(verifyError)}</p>` : ""}

    <h4 style="margin:1rem 0 0.4rem;font-size:0.85rem;color:#94a3b8;text-transform:uppercase">Pendências e o que falta (em linguagem simples)</h4>
    <ul class="list">
      ${report.pendencies.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
    </ul>
    <p class="meta" style="margin-top:0.75rem">
      Se a Meta indicar um erro de cadastro (ex.: número já registrado em outro aplicativo), essa tela não resolve
      isso automaticamente — o ajuste é feito direto no painel da Meta for Developers.
      Passo a passo completo para concluir a conexão: arquivo <strong>CONEXAO_WHATSAPP.md</strong> no projeto.
    </p>
  </div>`;
}

export function settingsPage(opts: {
  company: Company;
  user: User;
  role: Role;
  canEdit: boolean;
  hours: BusinessHours;
  whatsapp?: ConnectionStatusReport;
  whatsappVerifySuccess?: string;
  whatsappVerifyError?: string;
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
      ${opts.canEdit && opts.whatsapp ? whatsappConnectionPanel(opts.company.id, opts.whatsapp, opts.whatsappVerifySuccess, opts.whatsappVerifyError) : ""}`,
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
          return `<div class="opp-card">
            <div class="title">${escapeHtml(o.title)}</div>
            <div class="meta-row">
              <span>${escapeHtml(o.contact_name)} &middot; ${escapeHtml(o.contact_phone)}</span>
              <span>${formatCurrencyCents(o.value_cents)}</span>
              <span>${o.responsible_name ? escapeHtml(o.responsible_name) : "Sem responsável"}</span>
              ${scheduled ? `<span>Agendado: ${scheduled}</span>` : ""}
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
                <div style="align-self:end"><button type="submit" class="btn btn-small">Salvar</button></div>
              </form>
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
      return `<li style="flex-direction:column;align-items:stretch;gap:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${escapeHtml(s.name)} ${tag}</span>
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

function metricCard(label: string, value: string, help: string): string {
  return `<div class="metric-card">
    <div class="label">${escapeHtml(label)}</div>
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
    <div class="field"><button type="submit" class="btn btn-primary">Aplicar filtros</button></div>
  </form>`;

  // O aviso de dados fictícios agora é global (appShell); aqui só reforça no cabeçalho.
  const demoBanner = opts.isDev ? `<p class="meta" style="margin:-0.5rem 0 1rem">Indicadores calculados sobre dados de demonstração.</p>` : "";

  if (!opts.data || !opts.data.hasAnyData) {
    return appShell({
      company: opts.company,
      user: opts.user,
      role: opts.role,
      active: "dashboard",
      body: `${demoBanner}<h2>Dashboard</h2>${filtersForm}${emptyState(
        "Nenhum dado ainda",
        "Assim que houver contatos, conversas ou oportunidades registrados, os indicadores aparecem aqui."
      )}`,
    });
  }

  const d = opts.data;

  const slaForm = `<form method="post" action="/empresa/${opts.company.id}/dashboard/meta-sla" class="inline-form" style="max-width:360px">
    <label style="flex:1">Meta de 1ª resposta humana (minutos)
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
    <div style="margin-top:0.75rem">${slaForm}</div>`;

  return appShell({
    company: opts.company,
    user: opts.user,
    role: opts.role,
    active: "dashboard",
    body: `${demoBanner}<h2>Dashboard</h2>${filtersForm}${funnelSection}${pendingSection}${completedSection}`,
  });
}
