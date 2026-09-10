import express from "express";
import session from "express-session";
import path from "path";
import { requireAuth, requireCompanyAccess, requirePlatformAdmin, verifyPassword } from "./auth";
import {
  addMessage,
  assumeConversation,
  createConversation,
  findOrCreateContact,
  getContact,
  getConversation,
  listConversations,
  listMessages,
  summarizeWait,
  type ConversationMode,
} from "./attendance";
import { parseBusinessHours, type BusinessHours, type WeekdayKey } from "./businessHours";
import { runMigrations } from "./db";
import { findUserByEmail, listCompanies, listMembershipsForUser, updateCompanySettings } from "./models";
import {
  adminPage,
  appShell,
  companySelectorPage,
  conversationDetailPage,
  emptyState,
  inboxPage,
  loginPage,
  noCompanyPage,
  settingsPage,
} from "./views";

runMigrations();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const IS_DEV = process.env.NODE_ENV !== "production";

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

// --- Conversas (caixa de entrada + simulador exclusivo de desenvolvimento) --

app.get("/empresa/:companyId/conversas", requireCompanyAccess, (_req, res) => {
  const items = listConversations(res.locals.company.id);
  res.send(
    inboxPage({ company: res.locals.company, user: res.locals.user, role: res.locals.membership.role, items, isDev: IS_DEV })
  );
});

app.post("/empresa/:companyId/conversas/nova", requireCompanyAccess, (req, res) => {
  if (!IS_DEV) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const { name, phone, mode } = req.body as { name?: string; phone?: string; mode?: string };
  if (!name || !phone) {
    res.status(400).send("Nome e telefone são obrigatórios.");
    return;
  }
  const company = res.locals.company;
  const contact = findOrCreateContact(company.id, name, phone);
  const conv = createConversation(company.id, contact.id, mode === "MANUAL" ? "MANUAL" : ("AUTOMATICO" as ConversationMode));
  res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
});

function loadConversationOrNotFound(req: express.Request, res: express.Response) {
  const conversationId = Number(req.params.conversationId);
  const company = res.locals.company;
  const conv = Number.isInteger(conversationId) ? getConversation(company.id, conversationId) : undefined;
  if (!conv) {
    res.status(404).send("Conversa não encontrada.");
    return undefined;
  }
  return conv;
}

app.get("/empresa/:companyId/conversas/:conversationId", requireCompanyAccess, (req, res) => {
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  const company = res.locals.company;
  const contact = getContact(company.id, conv.contact_id);
  if (!contact) {
    res.status(404).send("Contato não encontrado.");
    return;
  }
  const hours = parseBusinessHours(company.business_hours);
  const wait = summarizeWait(conv.id, company.timezone, hours);
  res.send(
    conversationDetailPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      conversation: conv,
      contact,
      messages: listMessages(conv.id),
      wait,
      isDev: IS_DEV,
    })
  );
});

app.post("/empresa/:companyId/conversas/:conversationId/assumir", requireCompanyAccess, (req, res) => {
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  assumeConversation(res.locals.company.id, conv.id, res.locals.user.id);
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/responder", requireCompanyAccess, (req, res) => {
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  const { body, simular_falha } = req.body as { body?: string; simular_falha?: string };
  if (!body || !body.trim()) {
    res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
    return;
  }
  const willFail = IS_DEV && simular_falha === "1";
  addMessage({
    companyId: res.locals.company.id,
    conversationId: conv.id,
    authorType: "HUMANO",
    authorUserId: res.locals.user.id,
    body,
    sendStatus: willFail ? "FALHOU" : "ENVIADA",
  });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/cliente", requireCompanyAccess, (req, res) => {
  if (!IS_DEV) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  const { body } = req.body as { body?: string };
  if (body && body.trim()) {
    addMessage({ companyId: res.locals.company.id, conversationId: conv.id, authorType: "CLIENTE", body });
  }
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/pedir-humano", requireCompanyAccess, (req, res) => {
  if (!IS_DEV) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  addMessage({
    companyId: res.locals.company.id,
    conversationId: conv.id,
    authorType: "CLIENTE",
    body: "🔘 Cliente clicou em \"Falar com atendente\"",
    humanRequestButton: true,
  });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/robo", requireCompanyAccess, (req, res) => {
  if (!IS_DEV) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  addMessage({
    companyId: res.locals.company.id,
    conversationId: conv.id,
    authorType: "ROBO",
    body: "Olá! Sou o assistente automático (dados de teste). Posso ajudar com algo, ou você prefere falar com um atendente?",
  });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

// --- Configurações: fuso horário e expediente da empresa --------------------

app.get("/empresa/:companyId/configuracoes", requireCompanyAccess, (_req, res) => {
  const company = res.locals.company;
  const canEdit = res.locals.membership.role === "COMPANY_ADMIN";
  res.send(
    settingsPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      canEdit,
      hours: parseBusinessHours(company.business_hours),
    })
  );
});

const WEEKDAY_KEYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

app.post("/empresa/:companyId/configuracoes", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode editar.");
    return;
  }
  const body = req.body as Record<string, string | undefined>;
  const timezone = body.timezone || company.timezone;
  const hours: BusinessHours = {} as BusinessHours;
  let error: string | undefined;

  for (const key of WEEKDAY_KEYS) {
    const open = body[`${key}_aberto`] === "1";
    if (!open) {
      hours[key] = null;
      continue;
    }
    const start = body[`${key}_inicio`] || "09:00";
    const end = body[`${key}_fim`] || "18:00";
    if (start >= end) {
      error = "O horário de início precisa ser antes do horário de fim em todos os dias marcados como abertos.";
    }
    hours[key] = { start, end };
  }

  if (error) {
    res.status(400).send(
      settingsPage({ company, user: res.locals.user, role: res.locals.membership.role, canEdit: true, hours, error })
    );
    return;
  }

  updateCompanySettings(company.id, timezone, JSON.stringify(hours));
  res.send(
    settingsPage({
      company: { ...company, timezone, business_hours: JSON.stringify(hours) },
      user: res.locals.user,
      role: res.locals.membership.role,
      canEdit: true,
      hours,
      success: "Configurações salvas.",
    })
  );
});

// --- Demais páginas de navegação: ainda em estado vazio (etapas futuras) ----

const NAV_PAGES: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Nenhum dado ainda",
    description:
      "O dashboard vai mostrar pessoas aguardando atendimento, tempo de resposta humana e o resumo do período assim que essa etapa for implementada.",
  },
  crm: {
    title: "Nenhuma oportunidade ainda",
    description: "Contatos e oportunidades registrados vão aparecer aqui.",
  },
  relatorios: {
    title: "Sem dados para o período",
    description: "Os relatórios por período vão aparecer aqui assim que houver atendimentos registrados.",
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
