import express from "express";
import session from "express-session";
import path from "path";
import { requireAuth, requireCompanyAccess, requirePlatformAdmin, verifyPassword } from "./auth";
import { runMigrations } from "./db";
import { findUserByEmail, listCompanies, listMembershipsForUser } from "./models";
import {
  adminPage,
  appShell,
  companySelectorPage,
  emptyState,
  loginPage,
  noCompanyPage,
} from "./views";

runMigrations();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-nao-usar-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/login", (req, res) => {
  if (req.session.userId) {
    res.redirect("/");
    return;
  }
  res.send(loginPage());
});

app.post("/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const user = email ? findUserByEmail(email) : undefined;
  if (!user || !password || !verifyPassword(password, user.password_hash)) {
    res.status(401).send(loginPage("E-mail ou senha inválidos."));
    return;
  }
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).send(loginPage("Erro ao iniciar sessão. Tente novamente."));
      return;
    }
    req.session.userId = user.id;
    res.redirect("/");
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, (_req, res) => {
  const user = res.locals.user;
  if (user.is_platform_admin) {
    res.redirect("/admin");
    return;
  }
  const memberships = listMembershipsForUser(user.id);
  if (memberships.length === 0) {
    res.send(noCompanyPage());
    return;
  }
  if (memberships.length === 1) {
    res.redirect(`/empresa/${memberships[0].company_id}/dashboard`);
    return;
  }
  res.redirect("/empresas");
});

app.get("/empresas", requireAuth, (_req, res) => {
  const memberships = listMembershipsForUser(res.locals.user.id);
  res.send(companySelectorPage(memberships));
});

app.get("/admin", requirePlatformAdmin, (_req, res) => {
  res.send(adminPage(listCompanies()));
});

const NAV_PAGES: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Nenhum dado ainda",
    description:
      "O dashboard vai mostrar pessoas aguardando atendimento, tempo de resposta humana e o resumo do período assim que houver conversas.",
  },
  conversas: {
    title: "Nenhuma conversa ainda",
    description: "As conversas (simuladas ou conectadas futuramente) vão aparecer aqui.",
  },
  crm: {
    title: "Nenhuma oportunidade ainda",
    description: "Contatos e oportunidades registrados vão aparecer aqui.",
  },
  relatorios: {
    title: "Sem dados para o período",
    description: "Os relatórios por período vão aparecer aqui assim que houver atendimentos registrados.",
  },
  configuracoes: {
    title: "Nada para configurar ainda",
    description: "Equipe, integrações e preferências da empresa vão aparecer aqui.",
  },
};

app.get("/empresa/:companyId/:page", requireCompanyAccess, (req, res) => {
  const page = String(req.params.page);
  const def = NAV_PAGES[page];
  if (!def) {
    res.status(404).send("Página não encontrada.");
    return;
  }
  res.send(
    appShell({
      company: res.locals.company,
      user: res.locals.user,
      role: res.locals.membership.role,
      active: page,
      body: emptyState(def.title, def.description),
    })
  );
});

app.listen(PORT, () => {
  console.log(`HUB ACTION - CRM WhatsApp rodando em http://localhost:${PORT}`);
});
