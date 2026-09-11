import "./env"; // precisa vir antes de tudo: carrega .env em process.env
import express from "express";
import session from "express-session";
import path from "path";
import {
  acceptInvite,
  audit,
  completePasswordReset,
  createInvite,
  createPasswordReset,
  findValidToken,
  listAuditEntries,
  listPendingInvites,
} from "./access";
import { requireAuth, requireCompanyAccess, requirePlatformAdmin, verifyPassword } from "./auth";
import { csrfMiddleware } from "./csrf";
import { checkLoginThrottle, clearLoginThrottle, recordLoginFailure } from "./loginThrottle";
import { SqliteSessionStore } from "./sessionStore";
import {
  addMessage,
  assumeConversation,
  closeConversation,
  createConversation,
  detectHumanRequest,
  findOrCreateContact,
  findOrCreateOpenConversation,
  getContact,
  getConversation,
  listConversations,
  listMessages,
  listWaitEpisodes,
  summarizeWait,
  updateMessageDeliveryStatus,
  type Conversation,
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
import { db, runMigrations } from "./db";
import {
  createCompany,
  findCompanyById,
  findUserByEmail,
  findUserById,
  listCompaniesForAdmin,
  listCompanyMembers,
  listCompanyUsers,
  listMembershipsForUser,
  setUserActive,
  updateCompanyPlan,
  updateCompanySettings,
  updateSlaTarget,
  type CompanyPlan,
  type Role,
} from "./models";
import {
  buildConnectionStatusReport,
  findConnectionByPhoneNumberId,
  getWhatsappCredentials,
  listConnectionsForCompany,
  parseWebhookPayload,
  recordVerification,
  sendWhatsAppMessage,
  verifyPhoneNumberConnection,
  verifyWebhookSignature,
} from "./whatsapp";
import {
  adminPage,
  appShell,
  auditLogPage,
  companySelectorPage,
  conversationDetailPage,
  invitePage,
  messagePage,
  resetPage,
  crmPage,
  crmStagesPage,
  dashboardPage,
  emptyState,
  inboxPage,
  loginPage,
  noCompanyPage,
  settingsPage,
} from "./views";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Duas coisas independentes, que já foram confundidas numa flag só e por
// isso são explicadas aqui:
// - IS_PRODUCTION: estamos numa hospedagem de verdade, exposta na internet?
//   Liga o endurecimento de segurança (cookie seguro, exigir SESSION_SECRET
//   forte, confiar no proxy). Vem de NODE_ENV=production.
// - DEMO_MODE: mostra o aviso de dados fictícios e libera o simulador
//   (cliente/robô simulados)? Independente da anterior — o piloto de
//   demonstração no Render roda com as DUAS ligadas ao mesmo tempo (é
//   produção de verdade, mas ainda é uma demonstração). Um cliente real
//   futuro rodaria com IS_PRODUCTION=true e DEMO_MODE=false.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEMO_MODE = process.env.DEMO_MODE !== "false"; // padrão: ligado, a não ser que seja desligado explicitamente

if (IS_PRODUCTION) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.error("SESSION_SECRET ausente ou curto demais (mínimo 32 caracteres). Recusando iniciar em produção.");
    process.exit(1);
  }
  app.set("trust proxy", 1); // confia no HTTPS terminado pelo proxy da hospedagem (Render)
}

app.use(express.urlencoded({ extended: false }));
// index:false — sem isso um index.html em public/ responderia "/" antes do redirecionamento para o login.
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || "dev-secret-nao-usar-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: IS_PRODUCTION, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(csrfMiddleware);

/** URL pública base (para montar links de convite/redefinição), respeitando o proxy em produção. */
function publicBaseUrl(req: express.Request): string {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function clientIp(req: express.Request): string {
  return req.ip ?? "";
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", db: db.dialect });
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
    const connection = await findConnectionByPhoneNumberId(entry.phoneNumberId);
    if (!connection) {
      if (entry.messages.length > 0 || entry.statuses.length > 0) {
        console.warn(`[whatsapp] evento recebido para phone_number_id ${entry.phoneNumberId}, sem empresa associada.`);
      }
      continue;
    }
    for (const msg of entry.messages) {
      const contact = await findOrCreateContact(connection.company_id, msg.contactName ?? msg.fromPhone, msg.fromPhone);
      const conv = await findOrCreateOpenConversation(connection.company_id, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
      // Botão oficial cujo texto bate com pedido de atendente = gatilho B; qualquer outro clique é uma mensagem normal.
      const platformSignal = msg.isInteractiveReply && detectHumanRequest(msg.body) ? "BOTAO_PLATAFORMA" : undefined;
      // A Meta manda o timestamp (segundos Unix) de quando o cliente enviou —
      // é ele que vale para o cronômetro, mesmo se a entrega atrasar.
      const ts = Number(msg.timestamp);
      const occurredAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null;
      await addMessage({
        companyId: connection.company_id,
        conversationId: conv.id,
        authorType: "CLIENTE",
        body: msg.body,
        externalId: msg.waMessageId,
        platformSignal,
        occurredAt,
      });
      console.log(
        `[whatsapp] mensagem ${msg.waMessageId} registrada (empresa ${connection.company_id}, conversa ${conv.id})${platformSignal ? ` [gatilho ${platformSignal}]` : ""}`
      );
    }
    for (const status of entry.statuses) {
      if (status.status === "delivered") {
        await updateMessageDeliveryStatus(connection.company_id, status.waMessageId, "ENTREGUE");
      } else if (status.status === "read") {
        await updateMessageDeliveryStatus(connection.company_id, status.waMessageId, "LIDA");
      } else if (status.status === "failed") {
        console.warn(`[whatsapp] Meta reportou falha de entrega para ${status.waMessageId} (conversa não é reaberta automaticamente).`);
      }
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

app.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const ip = clientIp(req);

  const throttle = email ? checkLoginThrottle(ip, email) : { locked: false };
  if (throttle.locked) {
    await audit("login_bloqueado", { detail: `e-mail: ${email!.trim().slice(0, 120)}, aguardar ${throttle.retryAfterMinutes} min`, ip });
    res.status(429).send(loginPage(`Muitas tentativas com este e-mail. Tente de novo em ${throttle.retryAfterMinutes} minuto(s).`));
    return;
  }

  const user = email ? (await findUserByEmail(email.trim().toLowerCase())) ?? (await findUserByEmail(email.trim())) : undefined;
  if (!user || !password || !verifyPassword(password, user.password_hash) || !user.active) {
    if (email) recordLoginFailure(ip, email);
    await audit("login_falhou", { userId: user?.id ?? null, detail: email ? `e-mail: ${email.trim().slice(0, 120)}` : undefined, ip });
    res.status(401).send(loginPage("E-mail ou senha inválidos."));
    return;
  }

  if (email) clearLoginThrottle(ip, email);
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).send(loginPage("Erro ao iniciar sessão. Tente novamente."));
      return;
    }
    req.session.userId = user.id;
    audit("login_ok", { userId: user.id, ip }).catch((e) => console.error("[audit]", e));
    res.redirect("/");
  });
});

// --- Convite (cria acesso) e redefinição de senha por link ----------------

app.get("/convite/:token", async (req, res) => {
  const token = String(req.params.token);
  const invite = await findValidToken("CONVITE", token);
  const company = invite?.company_id ? await findCompanyById(invite.company_id) : undefined;
  if (!invite || !company) {
    res.status(404).send(messagePage("Convite inválido", "Este convite não existe, já foi usado ou expirou. Peça um novo link a quem te convidou."));
    return;
  }
  res.send(invitePage({ token, email: invite.email, companyName: company.name }));
});

app.post("/convite/:token", async (req, res) => {
  const token = String(req.params.token);
  const { name, password } = req.body as { name?: string; password?: string };
  const invite = await findValidToken("CONVITE", token);
  const company = invite?.company_id ? await findCompanyById(invite.company_id) : undefined;
  if (!invite || !company) {
    res.status(404).send(messagePage("Convite inválido", "Este convite não existe, já foi usado ou expirou."));
    return;
  }
  if (!name || !name.trim()) {
    res.status(400).send(invitePage({ token, email: invite.email, companyName: company.name, error: "Informe seu nome." }));
    return;
  }
  const result = await acceptInvite(token, name, password ?? "");
  if (!result.ok) {
    res.status(400).send(invitePage({ token, email: invite.email, companyName: company.name, error: result.error }));
    return;
  }
  await audit("convite_aceito", { companyId: company.id, userId: result.userId, detail: invite.email, ip: clientIp(req) });
  res.send(messagePage("Acesso criado", `Pronto! Entre com o e-mail ${invite.email} e a senha que você acabou de criar.`));
});

app.get("/redefinir/:token", async (req, res) => {
  const token = String(req.params.token);
  if (!(await findValidToken("REDEFINICAO", token))) {
    res.status(404).send(messagePage("Link inválido", "Este link de redefinição não existe, já foi usado ou expirou (vale por 2 horas). Peça um novo."));
    return;
  }
  res.send(resetPage({ token }));
});

app.post("/redefinir/:token", async (req, res) => {
  const token = String(req.params.token);
  const { password } = req.body as { password?: string };
  const result = await completePasswordReset(token, password ?? "");
  if (!result.ok) {
    res.status(400).send(resetPage({ token, error: result.error }));
    return;
  }
  await audit("senha_redefinida", { userId: result.userId, ip: clientIp(req) });
  res.send(messagePage("Senha alterada", "Sua nova senha já vale. Entre novamente."));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, async (_req, res) => {
  const user = res.locals.user;
  if (user.is_platform_admin) {
    res.redirect("/admin");
    return;
  }
  const memberships = await listMembershipsForUser(user.id);
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

app.get("/empresas", requireAuth, async (_req, res) => {
  const memberships = await listMembershipsForUser(res.locals.user.id);
  res.send(companySelectorPage(memberships));
});

// --- Painel da Hub Action: empresas, usuários, planos manuais, conexões -----

async function renderAdmin(
  res: express.Response,
  extra: { generatedLink?: { label: string; url: string }; notice?: string; error?: string } = {}
): Promise<void> {
  const companies = await listCompaniesForAdmin();
  const statuses = new Map(await Promise.all(companies.map(async (c) => [c.id, await buildConnectionStatusReport(c.id)] as const)));
  const usersByCompany = new Map(await Promise.all(companies.map(async (c) => [c.id, await listCompanyUsers(c.id)] as const)));
  const invitesByCompany = new Map(await Promise.all(companies.map(async (c) => [c.id, await listPendingInvites(c.id)] as const)));
  res.send(adminPage({ currentUserId: res.locals.user.id, companies, statuses, usersByCompany, invitesByCompany, ...extra }));
}

app.get("/admin", requirePlatformAdmin, async (_req, res) => renderAdmin(res));

app.get("/admin/log", requirePlatformAdmin, async (_req, res) => {
  res.send(auditLogPage(await listAuditEntries(200), "/admin"));
});

app.post("/admin/empresas", requirePlatformAdmin, async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    await renderAdmin(res, { error: "Informe o nome da empresa." });
    return;
  }
  const company = await createCompany(name);
  await audit("empresa_criada", { companyId: company.id, userId: res.locals.user.id, detail: company.name, ip: clientIp(req) });
  await renderAdmin(res, { notice: `Empresa "${company.name}" criada em modo demonstração. Gere um convite de administrador para o cliente entrar.` });
});

app.post("/admin/empresas/:companyId/plano", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  if (!company) {
    await renderAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const body = req.body as { plan?: string; suspended?: string; plan_notes?: string };
  const plan: CompanyPlan = body.plan === "PILOTO" || body.plan === "ATIVO" ? body.plan : "DEMONSTRACAO";
  const suspended = body.suspended === "1";
  await updateCompanyPlan(companyId, plan, suspended, body.plan_notes?.trim() || null);
  await audit("plano_alterado", {
    companyId,
    userId: res.locals.user.id,
    detail: `${plan}${suspended ? " (suspensa)" : ""}`,
    ip: clientIp(req),
  });
  await renderAdmin(res, { notice: `Plano de "${company.name}" atualizado.` });
});

app.post("/admin/empresas/:companyId/convites", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  const { email, role } = req.body as { email?: string; role?: string };
  if (!company || !email || !email.includes("@")) {
    await renderAdmin(res, { error: "Empresa ou e-mail inválido." });
    return;
  }
  const inviteRole: Role = role === "COMPANY_ADMIN" ? "COMPANY_ADMIN" : "AGENT";
  const token = await createInvite(companyId, email, inviteRole, res.locals.user.id);
  await audit("convite_criado", { companyId, userId: res.locals.user.id, detail: `${email} (${inviteRole})`, ip: clientIp(req) });
  await renderAdmin(res, {
    generatedLink: { label: `Convite para ${email} — ${company.name}`, url: `${publicBaseUrl(req)}/convite/${token}` },
  });
});

app.post("/admin/usuarios/:userId/redefinir", requirePlatformAdmin, async (req, res) => {
  const user = await findUserById(Number(req.params.userId));
  if (!user) {
    await renderAdmin(res, { error: "Usuário não encontrado." });
    return;
  }
  const token = await createPasswordReset(user.id, user.email, res.locals.user.id);
  await audit("redefinicao_gerada", { userId: user.id, detail: `por Hub Action (${res.locals.user.email})`, ip: clientIp(req) });
  await renderAdmin(res, {
    generatedLink: { label: `Nova senha para ${user.name} (${user.email}) — vale 2 horas`, url: `${publicBaseUrl(req)}/redefinir/${token}` },
  });
});

app.post("/admin/usuarios/:userId/ativo", requirePlatformAdmin, async (req, res) => {
  const user = await findUserById(Number(req.params.userId));
  if (!user || user.id === res.locals.user.id) {
    await renderAdmin(res, { error: "Usuário inválido." });
    return;
  }
  const active = (req.body as { active?: string }).active === "1";
  await setUserActive(user.id, active);
  await audit(active ? "usuario_reativado" : "usuario_desativado", { userId: user.id, detail: `por Hub Action (${res.locals.user.email})`, ip: clientIp(req) });
  await renderAdmin(res, { notice: `${user.name} ${active ? "reativado" : "desativado"}.` });
});

// --- Conversas (caixa de entrada + simulador exclusivo de desenvolvimento) --

app.get("/empresa/:companyId/conversas", requireCompanyAccess, async (_req, res) => {
  const items = await listConversations(res.locals.company.id);
  res.send(
    inboxPage({ company: res.locals.company, user: res.locals.user, role: res.locals.membership.role, items, isDev: DEMO_MODE })
  );
});

app.post("/empresa/:companyId/conversas/nova", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const { name, phone, mode } = req.body as { name?: string; phone?: string; mode?: string };
  if (!name || !phone) {
    res.status(400).send("Nome e telefone são obrigatórios.");
    return;
  }
  const company = res.locals.company;
  const contact = await findOrCreateContact(company.id, name, phone);
  const conv = await createConversation(company.id, contact.id, mode === "MANUAL" ? "MANUAL" : ("AUTOMATICO" as ConversationMode));
  res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
});

async function loadConversationOrNotFound(req: express.Request, res: express.Response): Promise<Conversation | undefined> {
  const conversationId = Number(req.params.conversationId);
  const company = res.locals.company;
  const conv = Number.isInteger(conversationId) ? await getConversation(company.id, conversationId) : undefined;
  if (!conv) {
    res.status(404).send("Conversa não encontrada.");
    return undefined;
  }
  return conv;
}

app.get("/empresa/:companyId/conversas/:conversationId", requireCompanyAccess, async (req, res) => {
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  const company = res.locals.company;
  const contact = await getContact(company.id, conv.contact_id);
  if (!contact) {
    res.status(404).send("Contato não encontrado.");
    return;
  }
  const hours = parseBusinessHours(company.business_hours);
  const wait = await summarizeWait(conv.id, company.timezone, hours);
  const assignedUser = conv.assigned_user_id ? await findUserById(conv.assigned_user_id) : undefined;
  res.send(
    conversationDetailPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      conversation: conv,
      contact,
      messages: await listMessages(conv.id),
      wait,
      episodes: await listWaitEpisodes(conv.id),
      assignedUserName: assignedUser?.name ?? null,
      isDev: DEMO_MODE,
    })
  );
});

app.post("/empresa/:companyId/conversas/:conversationId/assumir", requireCompanyAccess, async (req, res) => {
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  await assumeConversation(res.locals.company.id, conv.id, res.locals.user.id);
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/encerrar", requireCompanyAccess, async (req, res) => {
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  await closeConversation(res.locals.company.id, conv.id);
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/responder", requireCompanyAccess, async (req, res) => {
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  const company = res.locals.company;
  const { body, simular_falha } = req.body as { body?: string; simular_falha?: string };
  if (!body || !body.trim()) {
    res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
    return;
  }

  let sendStatus: "ENVIADA" | "FALHOU";
  let waMessageId: string | null = null;
  if (conv.channel === "WHATSAPP_OFICIAL") {
    // Canal real: a resposta é de fato enviada pela Cloud API. O checkbox de
    // "simular falha" (dev) não se aplica aqui — a falha, se houver, é real.
    const connections = await listConnectionsForCompany(company.id);
    const connection = connections.find((c) => c.active);
    const contact = await getContact(company.id, conv.contact_id);
    if (!connection || !contact) {
      sendStatus = "FALHOU";
      console.error(`[whatsapp] envio recusado: conexão ou contato ausente (empresa ${company.id}, conversa ${conv.id})`);
    } else {
      const result = await sendWhatsAppMessage(connection.phone_number_id, contact.phone, body);
      sendStatus = result.ok ? "ENVIADA" : "FALHOU";
      waMessageId = result.waMessageId ?? null;
      if (!result.ok) console.error(`[whatsapp] falha ao enviar (conversa ${conv.id}): ${result.error}`);
      else console.log(`[whatsapp] resposta enviada (conversa ${conv.id}, atendente ${res.locals.user.id}, wamid ${waMessageId}).`);
    }
  } else {
    sendStatus = DEMO_MODE && simular_falha === "1" ? "FALHOU" : "ENVIADA";
  }

  // O atendente autenticado (author_user_id) e o resultado do envio (send_status)
  // já identificam quem respondeu e se foi aceito pela Meta. waMessageId liga essa
  // mensagem aos eventos de status (ENTREGUE/LIDA) que chegam depois pelo webhook.
  await addMessage({
    companyId: company.id,
    conversationId: conv.id,
    authorType: "HUMANO",
    authorUserId: res.locals.user.id,
    body,
    sendStatus,
    externalId: waMessageId,
  });
  res.redirect(`/empresa/${company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/cliente", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  const { body } = req.body as { body?: string };
  if (body && body.trim()) {
    await addMessage({ companyId: res.locals.company.id, conversationId: conv.id, authorType: "CLIENTE", body });
  }
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/pedir-humano", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  await addMessage({
    companyId: res.locals.company.id,
    conversationId: conv.id,
    authorType: "CLIENTE",
    body: "🔘 Cliente clicou no botão \"Falar com atendente\"",
    platformSignal: "BOTAO_PLATAFORMA",
  });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

// Textos exatos do robô real do usuário — reaproveitados aqui (dev) e como
// referência de comparação em attendance.ts (looksLikeMenuMessage /
// looksLikeTransferMessage), que normalizam antes de comparar.
export const ROBO_MENU_TEXTO =
  'Olá!\nEu sou sua recepcionista virtual e irei fazer seu atendimento. Por favor digite uma das opções abaixo e para voltar ao menu digite voltar\n1 - Novo agendamento\n2 - Cancelar agendamento\n3 - Falar com atendente.';
export const ROBO_TRANSFERENCIA_TEXTO =
  'Por favor aguarde, estou chamando um atendente humano para te ajudar!!\nAtenção: pode demorar alguns minutos.';

app.post("/empresa/:companyId/conversas/:conversationId/simular/robo/menu", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  await addMessage({ companyId: res.locals.company.id, conversationId: conv.id, authorType: "ROBO", body: ROBO_MENU_TEXTO });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/robo/transferencia", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  await addMessage({ companyId: res.locals.company.id, conversationId: conv.id, authorType: "ROBO", body: ROBO_TRANSFERENCIA_TEXTO });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

app.post("/empresa/:companyId/conversas/:conversationId/simular/robo", requireCompanyAccess, async (req, res) => {
  if (!DEMO_MODE) {
    res.status(404).send("Não encontrado.");
    return;
  }
  const conv = await loadConversationOrNotFound(req, res);
  if (!conv) return;
  const { body } = req.body as { body?: string };
  await addMessage({
    companyId: res.locals.company.id,
    conversationId: conv.id,
    authorType: "ROBO",
    body: body && body.trim() ? body : "Posso ajudar com algo? (dados de teste)",
  });
  res.redirect(`/empresa/${res.locals.company.id}/conversas/${conv.id}`);
});

// --- Configurações: fuso horário e expediente da empresa --------------------

type TeamExtra = { generatedLink?: { label: string; url: string }; notice?: string; error?: string };

/** Dados da equipe para a tela de Configurações (só admin da empresa). */
async function teamData(res: express.Response, extra: TeamExtra = {}) {
  const company = res.locals.company;
  return {
    users: await listCompanyUsers(company.id),
    invites: await listPendingInvites(company.id),
    currentUserId: res.locals.user.id as number,
    ...extra,
  };
}

async function renderSettings(res: express.Response, teamExtra: TeamExtra = {}): Promise<void> {
  const company = res.locals.company;
  const canEdit = res.locals.membership.role === "COMPANY_ADMIN";
  res.send(
    settingsPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      canEdit,
      hours: parseBusinessHours(company.business_hours),
      whatsapp: canEdit ? await buildConnectionStatusReport(company.id) : undefined,
      team: canEdit ? await teamData(res, teamExtra) : undefined,
    })
  );
}

app.get("/empresa/:companyId/configuracoes", requireCompanyAccess, async (_req, res) => renderSettings(res));

async function requireCompanyAdmin(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  await requireCompanyAccess(req, res, () => {
    if (res.locals.membership.role !== "COMPANY_ADMIN") {
      res.status(403).send("Apenas o administrador da empresa pode fazer isso.");
      return;
    }
    next();
  });
}

app.post("/empresa/:companyId/configuracoes/equipe/convites", requireCompanyAdmin, async (req, res) => {
  const company = res.locals.company;
  const { email, role } = req.body as { email?: string; role?: string };
  if (!email || !email.includes("@")) {
    await renderSettings(res, { error: "Informe um e-mail válido." });
    return;
  }
  const inviteRole: Role = role === "COMPANY_ADMIN" ? "COMPANY_ADMIN" : "AGENT";
  const token = await createInvite(company.id, email, inviteRole, res.locals.user.id);
  await audit("convite_criado", { companyId: company.id, userId: res.locals.user.id, detail: `${email} (${inviteRole})`, ip: clientIp(req) });
  await renderSettings(res, { generatedLink: { label: `Convite para ${email}`, url: `${publicBaseUrl(req)}/convite/${token}` } });
});

app.post("/empresa/:companyId/configuracoes/equipe/:userId/redefinir", requireCompanyAdmin, async (req, res) => {
  const company = res.locals.company;
  const target = (await listCompanyUsers(company.id)).find((u) => u.user_id === Number(req.params.userId));
  if (!target) {
    await renderSettings(res, { error: "Usuário não pertence a esta empresa." });
    return;
  }
  const token = await createPasswordReset(target.user_id, target.email, res.locals.user.id);
  await audit("redefinicao_gerada", { companyId: company.id, userId: target.user_id, detail: `por ${res.locals.user.email}`, ip: clientIp(req) });
  await renderSettings(res, { generatedLink: { label: `Nova senha para ${target.name} — vale 2 horas`, url: `${publicBaseUrl(req)}/redefinir/${token}` } });
});

app.post("/empresa/:companyId/configuracoes/equipe/:userId/ativo", requireCompanyAdmin, async (req, res) => {
  const company = res.locals.company;
  const target = (await listCompanyUsers(company.id)).find((u) => u.user_id === Number(req.params.userId));
  if (!target || target.user_id === res.locals.user.id) {
    await renderSettings(res, { error: "Usuário inválido." });
    return;
  }
  const active = (req.body as { active?: string }).active === "1";
  await setUserActive(target.user_id, active);
  await audit(active ? "usuario_reativado" : "usuario_desativado", { companyId: company.id, userId: target.user_id, detail: `por ${res.locals.user.email}`, ip: clientIp(req) });
  await renderSettings(res, { notice: `${target.name} ${active ? "reativado" : "desativado"}.` });
});

const WEEKDAY_KEYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

app.post("/empresa/:companyId/configuracoes", requireCompanyAccess, async (req, res) => {
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
      settingsPage({
        company,
        user: res.locals.user,
        role: res.locals.membership.role,
        canEdit: true,
        hours,
        whatsapp: await buildConnectionStatusReport(company.id),
        team: await teamData(res),
        error,
      })
    );
    return;
  }

  await updateCompanySettings(company.id, timezone, JSON.stringify(hours));
  res.send(
    settingsPage({
      company: { ...company, timezone, business_hours: JSON.stringify(hours) },
      user: res.locals.user,
      role: res.locals.membership.role,
      canEdit: true,
      hours,
      whatsapp: await buildConnectionStatusReport(company.id),
      team: await teamData(res),
      success: "Configurações salvas.",
    })
  );
});

app.post("/empresa/:companyId/configuracoes/whatsapp/verificar", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode verificar a conexão.");
    return;
  }
  const connection = (await listConnectionsForCompany(company.id)).find((c) => c.active === 1);
  let whatsappVerifySuccess: string | undefined;
  let whatsappVerifyError: string | undefined;
  if (!connection) {
    whatsappVerifyError = "Nenhum número associado a esta empresa para verificar.";
  } else {
    const result = await verifyPhoneNumberConnection(connection.phone_number_id);
    await recordVerification(connection.phone_number_id, result);
    if (result.ok) whatsappVerifySuccess = result.detail;
    else whatsappVerifyError = result.detail;
  }

  res.send(
    settingsPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      canEdit: true,
      hours: parseBusinessHours(company.business_hours),
      whatsapp: await buildConnectionStatusReport(company.id),
      team: await teamData(res),
      whatsappVerifySuccess,
      whatsappVerifyError,
    })
  );
});

// --- CRM: funil configurável, separado de contato --------------------------

async function renderCrm(res: express.Response, error?: string): Promise<void> {
  const company = res.locals.company;
  await ensureDefaultPipelineStages(company.id);
  res.send(
    crmPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      stages: await listStages(company.id),
      byStage: await listOpportunitiesByStage(company.id),
      members: await listCompanyMembers(company.id),
      error,
    })
  );
}

app.get("/empresa/:companyId/crm", requireCompanyAccess, async (_req, res) => renderCrm(res));

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

app.post("/empresa/:companyId/crm/oportunidades", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  if (!body.contact_name || !body.contact_phone || !body.title) {
    res.status(400).send("Contato e título são obrigatórios.");
    return;
  }
  const contact = await findOrCreateContact(company.id, body.contact_name, body.contact_phone);
  await createOpportunity({
    companyId: company.id,
    contactId: contact.id,
    title: body.title,
    valueCents: parseReais(body.value),
    responsibleUserId: body.responsible_user_id ? Number(body.responsible_user_id) : null,
    scheduledAt: parseScheduledAt(body.scheduled_at, company.timezone),
  });
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/oportunidades/:opportunityId/mover", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  const result = await moveOpportunity(company.id, Number(req.params.opportunityId), Number(body.stage_id), body.lost_reason);
  if (!result.ok) {
    res.status(400);
    await renderCrm(res, result.error);
    return;
  }
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/oportunidades/:opportunityId/editar", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  await updateOpportunityDetails(company.id, Number(req.params.opportunityId), {
    responsibleUserId: body.responsible_user_id ? Number(body.responsible_user_id) : null,
    valueCents: parseReais(body.value),
    scheduledAt: parseScheduledAt(body.scheduled_at, company.timezone),
  });
  res.redirect(`/empresa/${company.id}/crm`);
});

app.get("/empresa/:companyId/crm/etapas", requireCompanyAccess, async (_req, res) => {
  const company = res.locals.company;
  await ensureDefaultPipelineStages(company.id);
  res.send(crmStagesPage({ company, user: res.locals.user, role: res.locals.membership.role, stages: await listStages(company.id) }));
});

app.post("/empresa/:companyId/crm/etapas", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const { name } = req.body as { name?: string };
  if (name && name.trim()) await addStage(company.id, name.trim());
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/renomear", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const { name } = req.body as { name?: string };
  if (name && name.trim()) await renameStage(company.id, Number(req.params.stageId), name.trim());
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/mover", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const { direction } = req.body as { direction?: string };
  await reorderStage(company.id, Number(req.params.stageId), direction === "up" ? "up" : "down");
  res.redirect(`/empresa/${company.id}/crm/etapas`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/excluir", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const result = await deleteStage(company.id, Number(req.params.stageId));
  if (!result.ok) {
    res
      .status(400)
      .send(crmStagesPage({ company, user: res.locals.user, role: res.locals.membership.role, stages: await listStages(company.id), error: result.error }));
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

app.get("/empresa/:companyId/dashboard", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const query = req.query as Record<string, string | undefined>;
  const from = query.de || daysAgoIsoDate(29);
  const to = query.ate || todayIsoDate();
  const attendantUserId = query.atendente ? Number(query.atendente) : null;

  const data = await computeDashboard(company.id, company.timezone, company.sla_first_response_minutes, {
    from,
    to,
    attendantUserId,
  });

  res.send(
    dashboardPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      isDev: DEMO_MODE,
      canEditSla: res.locals.membership.role === "COMPANY_ADMIN",
      members: await listCompanyMembers(company.id),
      filters: { from, to, attendantUserId },
      data,
    })
  );
});

app.post("/empresa/:companyId/dashboard/meta-sla", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode editar a meta.");
    return;
  }
  const minutos = Number((req.body as { minutos?: string }).minutos);
  if (Number.isFinite(minutos) && minutos > 0) {
    await updateSlaTarget(company.id, Math.round(minutos));
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

// Erro não tratado em rota async: nunca vaza stack trace para o cliente.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[erro não tratado]", err);
  if (!res.headersSent) res.status(500).send("Erro interno. Tente novamente.");
});

async function main(): Promise<void> {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`HUB ACTION - CRM WhatsApp rodando em http://localhost:${PORT} (banco: ${db.dialect})`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
