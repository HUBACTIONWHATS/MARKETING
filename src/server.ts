import "./env"; // precisa vir antes de tudo: carrega .env em process.env
import express from "express";
import session from "express-session";
import path from "path";
import { requireAuth, requireCompanyAccess, requirePlatformAdmin, verifyPassword } from "./auth";
import {
  addMessage,
  assumeConversation,
  closeConversation,
  createConversation,
  findOrCreateContact,
  findOrCreateOpenConversation,
  getContact,
  getConversation,
  listConversations,
  listMessages,
  summarizeWait,
  type ConversationMode,
} from "./attendance";
import { parseBusinessHours, zonedTimeToUtc, type BusinessHours, type WeekdayKey } from "./businessHours";
import {
  addStage,
  createOpportunity,
  deleteStage,
  ensureDefaultPipelineStages,
  listOpportunitiesByStage,
  listStages,
  moveOpportunity,
  renameStage,
  reorderStage,
  updateOpportunityDetails,
} from "./crm";
import { computeDashboard } from "./dashboard";
import { runMigrations } from "./db";
import {
  findUserByEmail,
  listCompanies,
  listCompanyMembers,
  listMembershipsForUser,
  updateCompanySettings,
  updateSlaTarget,
} from "./models";
import {
  findConnectionByPhoneNumberId,
  getWhatsappCredentials,
  listConnectionsForCompany,
  parseWebhookPayload,
  sendWhatsAppMessage,
  verifyWebhookSignature,
} from "./whatsapp";
import {
  adminPage,
  appShell,
  companySelectorPage,
  conversationDetailPage,
  crmPage,
  crmStagesPage,
  dashboardPage,
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
// index:false — sem isso um index.html em public/ responderia "/" antes do redirecionamento para o login.
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
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

// --- Webhook oficial do WhatsApp (Meta Cloud API) ---------------------------
// Sem credenciais configuradas, o handshake e a validação de assinatura
// recusam de forma explícita — nunca processa nada não verificado.

app.get("/webhooks/whatsapp", (req, res) => {
  const { verifyToken } = getWhatsappCredentials();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!verifyToken) {
    res.status(503).send("WHATSAPP_VERIFY_TOKEN não configurado neste servidor.");
    return;
  }
  if (mode === "subscribe" && token === verifyToken) {
    res.status(200).send(String(challenge ?? ""));
    return;
  }
  res.status(403).send("Verificação do webhook falhou.");
});

// express.json com `verify` guarda o corpo bruto em req.rawBody — necessário
// para checar a assinatura HMAC antes de confiar no JSON já decodificado.
const whatsappJsonParser = express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
});

app.post("/webhooks/whatsapp", whatsappJsonParser, async (req, res) => {
  const { appSecret } = getWhatsappCredentials();
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  if (!appSecret) {
    console.error("[whatsapp] webhook recebido mas WHATSAPP_APP_SECRET não configurado — recusando processar.");
    res.status(503).send("Integração não configurada.");
    return;
  }
  const signature = req.header("X-Hub-Signature-256");
  if (!rawBody || !verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.error("[whatsapp] assinatura inválida no webhook — requisição rejeitada.");
    res.status(403).send("Assinatura inválida.");
    return;
  }

  // Responde 200 mesmo quando não há o que fazer (ex.: número não mapeado a
  // nenhuma empresa) — a Meta reentrega por até 7 dias em caso de erro, e
  // reentregar não resolveria um mapeamento ausente. Falhas de banco, essas
  // sim, deixam o handler estourar para virar 500 e pedir nova tentativa.
  const entries = parseWebhookPayload(req.body);
  for (const entry of entries) {
    const connection = findConnectionByPhoneNumberId(entry.phoneNumberId);
    if (!connection) {
      console.warn(`[whatsapp] mensagem recebida para phone_number_id ${entry.phoneNumberId}, sem empresa associada.`);
      continue;
    }
    for (const msg of entry.messages) {
      const contact = findOrCreateContact(connection.company_id, msg.contactName ?? msg.fromPhone, msg.fromPhone);
      const conv = findOrCreateOpenConversation(connection.company_id, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
      addMessage({
        companyId: connection.company_id,
        conversationId: conv.id,
        authorType: "CLIENTE",
        body: msg.body,
        externalId: msg.waMessageId,
      });
    }
  }
  res.status(200).send("EVENT_RECEIVED");
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

app.post("/empresa/:companyId/conversas/:conversationId/encerrar", requireCompanyAccess, (req, res) => {
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  closeConversation(res.locals.company.id, conv.id);
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/responder", requireCompanyAccess, async (req, res) => {
  const conv = loadConversationOrNotFound(req, res);
  if (!conv) return;
  const company = res.locals.company;
  const { body, simular_falha } = req.body as { body?: string; simular_falha?: string };
  if (!body || !body.trim()) {
    res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
    return;
  }

  let sendStatus: "ENVIADA" | "FALHOU";
  if (conv.channel === "WHATSAPP_OFICIAL") {
    // Canal real: a resposta é de fato enviada pela Cloud API. O checkbox de
    // "simular falha" (dev) não se aplica aqui — a falha, se houver, é real.
    const connections = listConnectionsForCompany(company.id);
    const connection = connections.find((c) => c.active);
    const contact = getContact(company.id, conv.contact_id);
    if (!connection || !contact) {
      sendStatus = "FALHOU";
      console.error(`[whatsapp] envio recusado: conexão ou contato ausente (empresa ${company.id}, conversa ${conv.id})`);
    } else {
      const result = await sendWhatsAppMessage(connection.phone_number_id, contact.phone, body);
      sendStatus = result.ok ? "ENVIADA" : "FALHOU";
      if (!result.ok) console.error(`[whatsapp] falha ao enviar (conversa ${conv.id}): ${result.error}`);
    }
  } else {
    sendStatus = IS_DEV && simular_falha === "1" ? "FALHOU" : "ENVIADA";
  }

  addMessage({
    companyId: company.id,
    conversationId: conv.id,
    authorType: "HUMANO",
    authorUserId: res.locals.user.id,
    body,
    sendStatus,
  });
  res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
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

// --- CRM: funil configurável, separado de contato --------------------------

app.get("/empresa/:companyId/crm", requireCompanyAccess, (_req, res) => {
  const company = res.locals.company;
  ensureDefaultPipelineStages(company.id);
  res.send(
    crmPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      stages: listStages(company.id),
      byStage: listOpportunitiesByStage(company.id),
      members: listCompanyMembers(company.id),
    })
  );
});

/** "YYYY-MM-DDTHH:MM" digitado no formulário é interpretado no fuso da empresa (não no do servidor). */
function parseScheduledAt(value: string | undefined, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone).toISOString();
}

function parseReais(value: string | undefined): number {
  const n = Number((value || "0").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

app.post("/empresa/:companyId/crm/oportunidades", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  if (!body.contact_name || !body.contact_phone || !body.title) {
    res.status(400).send("Contato e título são obrigatórios.");
    return;
  }
  const contact = findOrCreateContact(company.id, body.contact_name, body.contact_phone);
  createOpportunity({
    companyId: company.id,
    contactId: contact.id,
    title: body.title,
    valueCents: parseReais(body.value),
    responsibleUserId: body.responsible_user_id ? Number(body.responsible_user_id) : null,
    scheduledAt: parseScheduledAt(body.scheduled_at, company.timezone),
  });
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/oportunidades/:opportunityId/mover", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  const result = moveOpportunity(company.id, Number(req.params.opportunityId), Number(body.stage_id), body.lost_reason);
  if (!result.ok) {
    res.status(400).send(
      crmPage({
        company,
        user: res.locals.user,
        role: res.locals.membership.role,
        stages: listStages(company.id),
        byStage: listOpportunitiesByStage(company.id),
        members: listCompanyMembers(company.id),
        error: result.error,
      })
    );
    return;
  }
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/oportunidades/:opportunityId/editar", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  updateOpportunityDetails(company.id, Number(req.params.opportunityId), {
    responsibleUserId: body.responsible_user_id ? Number(body.responsible_user_id) : null,
    valueCents: parseReais(body.value),
    scheduledAt: parseScheduledAt(body.scheduled_at, company.timezone),
  });
  res.redirect(`/empresa/${company.id}/crm`);
});

app.get("/empresa/:companyId/crm/etapas", requireCompanyAccess, (_req, res) => {
  const company = res.locals.company;
  ensureDefaultPipelineStages(company.id);
  res.send(crmStagesPage({ company, user: res.locals.user, role: res.locals.membership.role, stages: listStages(company.id) }));
});

app.post("/empresa/:companyId/crm/etapas", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const { name } = req.body as { name?: string };
  if (name && name.trim()) addStage(company.id, name.trim());
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/renomear", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const { name } = req.body as { name?: string };
  if (name && name.trim()) renameStage(company.id, Number(req.params.stageId), name.trim());
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/mover", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const { direction } = req.body as { direction?: string };
  reorderStage(company.id, Number(req.params.stageId), direction === "up" ? "up" : "down");
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/excluir", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const result = deleteStage(company.id, Number(req.params.stageId));
  if (!result.ok) {
    res
      .status(400)
      .send(crmStagesPage({ company, user: res.locals.user, role: res.locals.membership.role, stages: listStages(company.id), error: result.error }));
    return;
  }
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

// --- Dashboard: indicadores reais da empresa conectada ----------------------

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

app.get("/empresa/:companyId/dashboard", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  const query = req.query as Record<string, string | undefined>;
  const from = query.de || daysAgoIsoDate(29);
  const to = query.ate || todayIsoDate();
  const attendantUserId = query.atendente ? Number(query.atendente) : null;

  const data = computeDashboard(company.id, company.timezone, company.sla_first_response_minutes, {
    from,
    to,
    attendantUserId,
  });

  res.send(
    dashboardPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      isDev: IS_DEV,
      canEditSla: res.locals.membership.role === "COMPANY_ADMIN",
      members: listCompanyMembers(company.id),
      filters: { from, to, attendantUserId },
      data,
    })
  );
});

app.post("/empresa/:companyId/dashboard/meta-sla", requireCompanyAccess, (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode editar a meta.");
    return;
  }
  const minutos = Number((req.body as { minutos?: string }).minutos);
  if (Number.isFinite(minutos) && minutos > 0) {
    updateSlaTarget(company.id, Math.round(minutos));
  }
  res.redirect(`/empresa/${company.id}/dashboard`);
});

// --- Demais páginas de navegação: ainda em estado vazio (etapas futuras) ----

const NAV_PAGES: Record<string, { title: string; description: string }> = {
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
