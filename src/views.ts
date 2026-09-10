import type { Company, MembershipWithCompany, Role, User } from "./models";

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
      </div>
    </div>`
  );
}

export function forbiddenPage(): string {
  return page(
    "Acesso negado",
    `<div class="center-screen">
      <div class="card">
        <h1>403 — Acesso negado</h1>
        <p style="color:#94a3b8">Você não tem permissão para acessar este recurso.</p>
        <p><a href="/">Voltar</a></p>
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

export function adminPage(companies: Company[]): string {
  const rows = companies
    .map(
      (c) => `<li>
        <span>${escapeHtml(c.name)}</span>
        <span class="role-tag">${escapeHtml(c.slug)}</span>
      </li>`
    )
    .join("");
  return page(
    "Painel da plataforma — HUB ACTION",
    `<div class="center-screen">
      <div class="card" style="max-width:480px">
        <h1>Painel da plataforma</h1>
        <p style="color:#94a3b8;font-size:0.85rem">Empresas cadastradas. O conteúdo das conversas de cada empresa não é exibido aqui.</p>
        <ul class="list">${rows || "<li>Nenhuma empresa cadastrada.</li>"}</ul>
        <p><a href="/logout">Sair</a></p>
      </div>
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

  return page(
    `${opts.company.name} — HUB ACTION`,
    `<div class="layout">
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

export function emptyState(title: string, description: string): string {
  return `<div class="empty-state">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description)}</p>
  </div>`;
}
