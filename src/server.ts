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
import { checkActionThrottle, recordAction } from "./actionThrottle";
import { evaluateAlerts, listAlerts, listAlertsAllCompanies, listGlobalRules, RULE_KINDS, saveThreshold, updateAlertStatus, type AlertStatus } from "./alerts";
import { applyContactAttribution, declareContactSource, LEAD_SOURCES, parseWhatsAppReferral, type LeadSource } from "./attribution";
import { computeCompanyBi, EMPTY_FILTERS, parseFilters, resolvePeriod, type BiFilters, type CompanyBi, type ResolvedPeriod } from "./bi";
import { recordConversionEvent } from "./conversionFeedback";
import { csrfMiddleware } from "./csrf";
import { decryptSecret, isCredentialEncryptionConfigured } from "./credentialCrypto";
import {
  buildAttention,
  costVsQuality,
  detectBottlenecks,
  executiveFunnel,
  executiveSummary,
  getGoals,
  healthScore,
  hotLeads,
  projectMonth,
  saveGoals,
  scoreLeads,
  stalledOpportunities,
} from "./insights";
import {
  createConnection,
  getAccount,
  getConnection,
  linkAccountToCompany,
  listAccountsForCompany,
  listAllAccounts,
  listCampaignsForCompany,
  listConnections,
  listSyncRuns,
  decryptConnectionTokens,
  getCampaignForCompany,
  listAdGroupsForCampaign,
  listAdsForCampaign,
  revokeConnection,
  toConnectionView,
  unlinkAccount,
  upsertAccount,
  type MarketingProvider,
} from "./marketingModels";
import { buildGoogleAuthorizeUrl, buildMetaAuthorizeUrl, consumeOAuthState, createOAuthState, googleOAuthConfig, metaOAuthConfig, metaScopes } from "./marketingOAuth";
import {
  googleExchangeCode,
  googleGetCustomer,
  googleListAccessibleCustomers,
  googleListCustomerClients,
  metaExchangeCode,
  metaGetMe,
  metaListAdAccounts,
  ProviderError,
  sanitizeText,
} from "./marketingProviders";
import { startSyncScheduler, syncAccount, syncAllEnabled, syncIntervalMinutes } from "./marketingSync";
import {
  adminAgencyPage,
  adminIntegrationsPage,
  adminMarketingPage,
  type CompanySummary,
} from "./viewsAdminMarketing";
import {
  alertsPage,
  attentionBlock,
  campaignsTable,
  executiveCards,
  funnelBlock,
  intelligencePage,
  marketingCampaignDetailPage,
  marketingCampaignsPage,
  marketingFunnelPage,
  marketingOverviewPage,
  marketingProviderPage,
  marketingReportPage,
  providerComparisonBlock,
  secondaryKpis,
  type MarketingPageBase,
} from "./viewsMarketing";
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
  getOpportunity,
  listOpportunitiesByStage,
  listStages,
  moveOpportunity,
  renameStage,
  reorderStage,
  setStageFlags,
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
  activateConnection,
  buildConnectionStatusReport,
  createCompanyConnection,
  deactivateConnection,
  findConnectionByCompanyId,
  findConnectionByPhoneNumberId,
  getWhatsappCredentials,
  listConnectionsForCompany,
  parseWebhookPayload,
  replaceConnectionToken,
  subscribeAppToWaba,
  testCompanyConnection,
  toAdminViewModel,
  sendWhatsAppMessage,
  verifyWebhookSignature,
  type WhatsappEnvironment,
} from "./whatsapp";
import {
  adminPage,
  appShell,
  auditLogPage,
  page as htmlPage,
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
  whatsappAdminPage,
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

// Domínio real da única instância hoje publicada (Render). Usado só como
// último recurso, quando PUBLIC_BASE_URL não está definida — nunca deduzido
// de req.protocol/req.get("host") (evita depender de cabeçalhos de proxy
// que podem vir errados) nem de qualquer outra fonte. Atenção ao digitar:
// é "hub-action-crm-demo.onrender.com" — ponto antes de "onrender.com",
// nunca hífen (".onrender.com", não "-onrender.com").
const FALLBACK_BASE_URL = "https://hub-action-crm-demo.onrender.com";

/**
 * URL pública base para TODO link absoluto do sistema (convite, redefinição
 * de senha, instruções de webhook do WhatsApp) — fonte única de verdade,
 * sempre a variável de ambiente PUBLIC_BASE_URL; sem ela, usa o domínio fixo
 * acima. Nunca deriva do cabeçalho Host da requisição.
 */
function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL || FALLBACK_BASE_URL;
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
      // Atribuição CONFIRMADA: mensagem iniciada por anúncio "Clique para o WhatsApp" traz `referral` oficial.
      const referralSignals = parseWhatsAppReferral(msg.referral);
      if (referralSignals) await applyContactAttribution(connection.company_id, contact.id, referralSignals);
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

/**
 * Motivo específico de uma falha de login — só para o console do servidor
 * (Render → Logs), nunca para a resposta HTTP nem para o log de auditoria
 * visível na tela (que continua genérico, de propósito, para não revelar se
 * o e-mail existe). NUNCA inclui a senha digitada nem o hash guardado —
 * só o fato de terem batido ou não.
 */
type LoginFailureReason = "usuario_nao_encontrado" | "senha_incorreta" | "usuario_inativo" | "senha_ausente";

function logLoginAttempt(reason: LoginFailureReason | "ok", emailAttempted: string | undefined, userId: number | null, ip: string): void {
  console.log(`[login] ${reason} — e-mail tentado: ${emailAttempted ?? "(vazio)"}${userId ? `, user_id: ${userId}` : ""}, ip: ${ip}`);
}

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

  // Motivo específico só para diagnóstico (console) — a mensagem ao usuário e
  // o audit_log continuam genéricos, de propósito (não revelar se o e-mail existe).
  let failureReason: LoginFailureReason | undefined;
  if (!user) failureReason = "usuario_nao_encontrado";
  else if (!password) failureReason = "senha_ausente";
  else if (!verifyPassword(password, user.password_hash)) failureReason = "senha_incorreta";
  else if (!user.active) failureReason = "usuario_inativo";

  if (failureReason) {
    if (email) recordLoginFailure(ip, email);
    logLoginAttempt(failureReason, email, user?.id ?? null, ip);
    await audit("login_falhou", { userId: user?.id ?? null, detail: email ? `e-mail: ${email.trim().slice(0, 120)}` : undefined, ip });
    res.status(401).send(loginPage("E-mail ou senha inválidos."));
    return;
  }

  if (email) clearLoginThrottle(ip, email);
  req.session.regenerate((err) => {
    if (err) {
      console.error(`[login] erro_de_sessao — user_id: ${user!.id}, ip: ${ip}, erro: ${err instanceof Error ? err.message : err}`);
      res.status(500).send(loginPage("Erro ao iniciar sessão. Tente novamente."));
      return;
    }
    req.session.userId = user!.id;
    logLoginAttempt("ok", email, user!.id, ip);
    audit("login_ok", { userId: user!.id, ip }).catch((e) => console.error("[audit]", e));
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
    console.log(`[login] vinculo_inexistente — usuário autenticado sem nenhuma empresa associada, user_id: ${user.id}`);
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

// --- Administração Hub Action: empresas, usuários, planos manuais, conexões -

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

// --- Conexões do WhatsApp: área exclusiva do administrador geral -----------
// Só requirePlatformAdmin (nunca administrador de empresa nem atendente).
// Cada rota audita quem fez o quê, sem nunca gravar o segredo — ver access.ts.

async function renderWhatsappAdmin(res: express.Response, extra: { notice?: string; error?: string } = {}): Promise<void> {
  const companies = await listCompaniesForAdmin();
  const connections = new Map(
    (
      await Promise.all(
        companies.map(async (c) => {
          const row = await findConnectionByCompanyId(c.id);
          return [c.id, row ? toAdminViewModel(row) : null] as const;
        })
      )
    ).filter(([, v]) => v !== null)
  );
  res.send(
    whatsappAdminPage({
      companies,
      connections,
      graphApiVersion: getWhatsappCredentials().graphApiVersion,
      webhookUrl: `${publicBaseUrl()}/webhooks/whatsapp`,
      verifyTokenConfigured: !!getWhatsappCredentials().verifyToken,
      appSecretConfigured: !!getWhatsappCredentials().appSecret,
      ...extra,
    })
  );
}

app.get("/admin/whatsapp", requirePlatformAdmin, async (_req, res) => renderWhatsappAdmin(res, {}));

app.post("/admin/whatsapp/:companyId/cadastrar", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  const { waba_id, phone_number_id, access_token, environment } = req.body as {
    waba_id?: string;
    phone_number_id?: string;
    access_token?: string;
    environment?: string;
  };
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const env: WhatsappEnvironment = environment === "PRODUCAO" ? "PRODUCAO" : "TESTE";
  const result = await createCompanyConnection(companyId, {
    wabaId: waba_id ?? "",
    phoneNumberId: phone_number_id ?? "",
    accessToken: access_token ?? "",
    environment: env,
  });
  await audit("whatsapp_credencial_cadastrada", {
    companyId,
    userId: res.locals.user.id,
    detail: result.ok ? `WABA ${waba_id}, ambiente ${env}` : `falhou: ${result.error}`,
    ip: clientIp(req),
  });
  await renderWhatsappAdmin(
    res,
    result.ok ? { notice: `Conexão cadastrada para "${company.name}". Use "Testar conexão" antes de ativar.` } : { error: result.error }
  );
});

app.post("/admin/whatsapp/:companyId/substituir-token", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  const { access_token } = req.body as { access_token?: string };
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const result = await replaceConnectionToken(companyId, access_token ?? "");
  await audit("whatsapp_credencial_substituida", {
    companyId,
    userId: res.locals.user.id,
    detail: result.ok ? "token substituído" : `falhou: ${result.error}`,
    ip: clientIp(req),
  });
  await renderWhatsappAdmin(
    res,
    result.ok
      ? { notice: `Credencial de "${company.name}" substituída. A conexão foi desativada até um novo teste confirmar o token.` }
      : { error: result.error }
  );
});

app.post("/admin/whatsapp/:companyId/testar", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const throttle = checkActionThrottle("whatsapp_testar", clientIp(req), companyId, 20);
  if (!throttle.allowed) {
    await renderWhatsappAdmin(res, { error: `Muitos testes seguidos. Tente de novo em ${throttle.retryAfterMinutes} minuto(s).` });
    return;
  }
  recordAction("whatsapp_testar", clientIp(req), companyId);
  const result = await testCompanyConnection(companyId, getWhatsappCredentials().graphApiVersion);
  await audit("whatsapp_conexao_testada", {
    companyId,
    userId: res.locals.user.id,
    detail: result.ok ? `sucesso: ${result.detail}` : `falhou: ${result.detail}`,
    ip: clientIp(req),
  });
  await renderWhatsappAdmin(
    res,
    result.ok ? { notice: `Teste de "${company.name}": ${result.detail}` } : { error: `Teste de "${company.name}" falhou: ${result.detail}` }
  );
});

app.post("/admin/whatsapp/:companyId/ativar", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const result = await activateConnection(companyId);
  await audit("whatsapp_conexao_ativada", { companyId, userId: res.locals.user.id, detail: result.ok ? "ativada" : `falhou: ${result.error}`, ip: clientIp(req) });
  await renderWhatsappAdmin(res, result.ok ? { notice: `Conexão de "${company.name}" ativada.` } : { error: result.error });
});

app.post("/admin/whatsapp/:companyId/desativar", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  const result = await deactivateConnection(companyId);
  await audit("whatsapp_conexao_desativada", { companyId, userId: res.locals.user.id, detail: result.ok ? "desativada" : `falhou: ${result.error}`, ip: clientIp(req) });
  await renderWhatsappAdmin(res, result.ok ? { notice: `Conexão de "${company.name}" desativada.` } : { error: result.error });
});

app.post("/admin/whatsapp/:companyId/assinar-webhook", requirePlatformAdmin, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const company = await findCompanyById(companyId);
  const { confirmar } = req.body as { confirmar?: string };
  if (!company) {
    await renderWhatsappAdmin(res, { error: "Empresa não encontrada." });
    return;
  }
  if (confirmar !== "1") {
    await renderWhatsappAdmin(res, { error: "Confirme a caixa de seleção para assinar o aplicativo no WABA." });
    return;
  }
  const throttle = checkActionThrottle("whatsapp_assinar", clientIp(req), companyId, 10);
  if (!throttle.allowed) {
    await renderWhatsappAdmin(res, { error: `Muitas tentativas seguidas. Tente de novo em ${throttle.retryAfterMinutes} minuto(s).` });
    return;
  }
  recordAction("whatsapp_assinar", clientIp(req), companyId);
  const result = await subscribeAppToWaba(companyId, getWhatsappCredentials().graphApiVersion);
  await audit("whatsapp_app_assinado_waba", {
    companyId,
    userId: res.locals.user.id,
    detail: result.ok ? "assinado" : `falhou: ${result.detail}`,
    ip: clientIp(req),
  });
  await renderWhatsappAdmin(
    res,
    result.ok ? { notice: `"${company.name}": ${result.detail}` } : { error: `"${company.name}": ${result.detail}` }
  );
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
    generatedLink: { label: `Convite para ${email} — ${company.name}`, url: `${publicBaseUrl()}/convite/${token}` },
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
    generatedLink: { label: `Nova senha para ${user.name} (${user.email}) — vale 2 horas`, url: `${publicBaseUrl()}/redefinir/${token}` },
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
    let accessToken: string | undefined;
    try {
      accessToken = connection?.access_token_encrypted ? decryptSecret(connection.access_token_encrypted) : undefined;
    } catch {
      accessToken = undefined; // token salvo não decifra (chave trocada?) — trata como ausente, nunca quebra o envio de forma confusa
    }
    if (!connection || !contact) {
      sendStatus = "FALHOU";
      console.error(`[whatsapp] envio recusado: conexão ou contato ausente (empresa ${company.id}, conversa ${conv.id})`);
    } else {
      const result = await sendWhatsAppMessage(accessToken, connection.phone_number_id, contact.phone, body, getWhatsappCredentials().graphApiVersion);
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
  await renderSettings(res, { generatedLink: { label: `Convite para ${email}`, url: `${publicBaseUrl()}/convite/${token}` } });
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
  await renderSettings(res, { generatedLink: { label: `Nova senha para ${target.name} — vale 2 horas`, url: `${publicBaseUrl()}/redefinir/${token}` } });
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

// A validação real da conexão (chamar a Meta) é exclusiva do administrador
// geral — ver /admin/whatsapp/:companyId/testar. O administrador da empresa
// só visualiza o status (settingsPage, mais acima) — não existe mais rota de
// "verificar" aqui de propósito (ver ACESSO E ISOLAMENTO no pedido da etapa).

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
  // Marcos reais do funil → fila de feedback de conversão (só registra; nada é enviado à Meta/Google).
  const opp = result.opportunity;
  if (opp && result.reached) {
    const at = new Date().toISOString();
    if (result.reached.qualified) await recordConversionEvent({ companyId: company.id, contactId: opp.contact_id, opportunityId: opp.id, eventType: "QualifiedLead", eventTime: at, valueCents: null, currency: "BRL" });
    if (result.reached.attended) await recordConversionEvent({ companyId: company.id, contactId: opp.contact_id, opportunityId: opp.id, eventType: "AppointmentAttended", eventTime: at, valueCents: null, currency: "BRL" });
    if (result.reached.won) await recordConversionEvent({ companyId: company.id, contactId: opp.contact_id, opportunityId: opp.id, eventType: "Purchase", eventTime: at, valueCents: opp.value_cents, currency: "BRL" });
  }
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/oportunidades/:opportunityId/editar", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const body = req.body as Record<string, string | undefined>;
  const opportunityId = Number(req.params.opportunityId);
  const before = await getOpportunity(company.id, opportunityId);
  const scheduledAt = parseScheduledAt(body.scheduled_at, company.timezone);
  const attendedAt = parseScheduledAt(body.attended_at, company.timezone);
  await updateOpportunityDetails(company.id, opportunityId, {
    responsibleUserId: body.responsible_user_id ? Number(body.responsible_user_id) : null,
    valueCents: parseReais(body.value),
    scheduledAt,
    attendedAt,
  });
  if (before) {
    if (scheduledAt && !before.scheduled_at) await recordConversionEvent({ companyId: company.id, contactId: before.contact_id, opportunityId, eventType: "AppointmentScheduled", eventTime: scheduledAt, valueCents: null, currency: "BRL" });
    if (attendedAt && !before.attended_at) await recordConversionEvent({ companyId: company.id, contactId: before.contact_id, opportunityId, eventType: "AppointmentAttended", eventTime: attendedAt, valueCents: null, currency: "BRL" });
  }
  res.redirect(`/empresa/${company.id}/crm`);
});

/** Origem declarada pelo atendente (sempre "provável"; nunca sobrescreve uma atribuição confirmada). */
app.post("/empresa/:companyId/crm/contatos/:contactId/origem", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  const { source } = req.body as { source?: string };
  const contact = await getContact(company.id, Number(req.params.contactId));
  if (contact && source && (LEAD_SOURCES as string[]).includes(source)) {
    await declareContactSource(company.id, contact.id, source as LeadSource);
  }
  res.redirect(`/empresa/${company.id}/crm`);
});

app.post("/empresa/:companyId/crm/etapas/:stageId/marcadores", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode alterar os marcadores das etapas.");
    return;
  }
  const body = req.body as { is_qualified?: string; is_attended?: string };
  await setStageFlags(company.id, Number(req.params.stageId), { isQualified: body.is_qualified === "1", isAttended: body.is_attended === "1" });
  res.redirect(`/empresa/${company.id}/crm/etapas`);
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

app.get("/empresa/:companyId/:page", requireCompanyAccess, (req, res, next) => {
  const page = String(req.params.page);
  const def = NAV_PAGES[page];
  if (!def) {
    // Não é uma página vazia: deixa as rotas registradas depois (marketing, inteligencia, alertas) tentarem; sem nenhuma, o Express responde 404.
    next();
    return;
  }
  res.send(
    appShell({
      company: res.locals.company,
      user: res.locals.user,
      role: res.locals.membership.role,
      active: page,
      canViewMarketing: canViewMarketing(res),
      body: emptyState(def.title, def.description),
    })
  );
});

// ============================================================================
// COMMAND CENTER — Marketing (Meta Ads / Google Ads, somente leitura),
// Inteligência e Alertas por empresa. Toda autorização no servidor:
// requireCompanyAccess (membership) + capability de mídia paga.
// ============================================================================

/** Administrador da empresa sempre; atendente só com memberships.can_view_marketing = 1. */
async function requireMarketingAccess(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  await requireCompanyAccess(req, res, () => {
    const m = res.locals.membership;
    if (m.role !== "COMPANY_ADMIN" && Number(m.can_view_marketing) !== 1) {
      res.status(403).send(appShell({ company: res.locals.company, user: res.locals.user, role: m.role, active: "", canViewMarketing: false, body: emptyState("Sem acesso aos relatórios de mídia paga", "Peça ao administrador da empresa para liberar o acesso.") }));
      return;
    }
    next();
  });
}

function canViewMarketing(res: express.Response): boolean {
  const m = res.locals.membership;
  return m.role === "COMPANY_ADMIN" || Number(m.can_view_marketing) === 1;
}

async function marketingContext(req: express.Request, res: express.Response, forced: Partial<BiFilters> = {}, presetOverride?: string): Promise<MarketingPageBase & { period: ResolvedPeriod }> {
  const company = res.locals.company;
  const q = req.query as Record<string, string | undefined>;
  const period = resolvePeriod(presetOverride ?? q.periodo, { from: q.de, to: q.ate }, company.timezone);
  const filters: BiFilters = { ...parseFilters(q), ...forced };
  const bi = await computeCompanyBi(company.id, company.timezone, period, filters);
  const m1 = q.m1 && /^[a-z]+$/.test(q.m1) ? q.m1 : "investimento";
  const m2 = q.m2 === undefined ? "receita" : q.m2 && /^[a-z]+$/.test(q.m2) ? q.m2 : null;
  const sort = q.ordenar && /^[a-z_]+$/.test(q.ordenar) ? q.ordenar : null;
  const members = await listCompanyMembers(company.id);
  const stages = await listStages(company.id);
  return {
    company,
    user: res.locals.user,
    role: res.locals.membership.role,
    canViewMarketing: canViewMarketing(res),
    bi,
    filterOptions: { campaigns: await listCampaignsForCompany(company.id), members, stages },
    m1,
    m2,
    sort,
    attention: await evaluateAlerts(company.id, bi),
    funnel: executiveFunnel(bi.current),
    period,
  };
}

app.get("/empresa/:companyId/marketing", requireMarketingAccess, async (req, res) => {
  res.send(marketingOverviewPage(await marketingContext(req, res)));
});

app.get("/empresa/:companyId/marketing/campanhas", requireMarketingAccess, async (req, res) => {
  res.send(marketingCampaignsPage(await marketingContext(req, res)));
});

app.get("/empresa/:companyId/marketing/campanhas/:campaignId", requireMarketingAccess, async (req, res) => {
  const company = res.locals.company;
  const campaign = await getCampaignForCompany(company.id, Number(req.params.campaignId));
  if (!campaign) {
    res.status(404).send("Campanha não encontrada.");
    return;
  }
  const base = await marketingContext(req, res, { campaignId: campaign.id });
  const row = base.bi.campaigns.find((r) => r.campaign.id === campaign.id) ?? null;
  const account = (await listAccountsForCompany(company.id)).find((a) => a.id === campaign.account_id) ?? null;
  res.send(marketingCampaignDetailPage(base, campaign, row, await listAdGroupsForCampaign(company.id, campaign.id), await listAdsForCampaign(company.id, campaign.id), account));
});

app.get("/empresa/:companyId/marketing/meta", requireMarketingAccess, async (req, res) => {
  const base = await marketingContext(req, res, { channel: "META_ADS" });
  res.send(marketingProviderPage(base, "META", (await listAccountsForCompany(res.locals.company.id)).filter((a) => a.provider === "META")));
});

app.get("/empresa/:companyId/marketing/google", requireMarketingAccess, async (req, res) => {
  const base = await marketingContext(req, res, { channel: "GOOGLE_ADS" });
  res.send(marketingProviderPage(base, "GOOGLE", (await listAccountsForCompany(res.locals.company.id)).filter((a) => a.provider === "GOOGLE")));
});

app.get("/empresa/:companyId/marketing/funil", requireMarketingAccess, async (req, res) => {
  const base = await marketingContext(req, res);
  res.send(marketingFunnelPage(base, detectBottlenecks(base.bi.current)));
});

app.get("/empresa/:companyId/marketing/relatorios", requireMarketingAccess, async (req, res) => {
  const base = await marketingContext(req, res);
  res.send(marketingReportPage(base, executiveSummary(base.bi), costVsQuality(base.bi.campaigns)));
});

/** Refresh limitado pelo administrador da empresa: no máximo 4 por hora por empresa (≈ 1 a cada 15 min). */
app.post("/empresa/:companyId/marketing/atualizar", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode pedir atualização.");
    return;
  }
  const throttle = checkActionThrottle("marketing_refresh", "empresa", company.id, 4);
  if (!throttle.allowed) {
    res.status(429).send(`Atualização já solicitada recentemente. Tente de novo em ${throttle.retryAfterMinutes} minuto(s).`);
    return;
  }
  recordAction("marketing_refresh", "empresa", company.id);
  const accounts = (await listAccountsForCompany(company.id)).filter((a) => a.sync_enabled);
  for (const a of accounts) await syncAccount(a.id, "MANUAL", res.locals.user.id, publicBaseUrl());
  res.redirect(`/empresa/${company.id}/marketing`);
});

// --- Inteligência (Central de Performance) -------------------------------------------

async function renderIntelligence(req: express.Request, res: express.Response, extra: { notice?: string; error?: string } = {}): Promise<void> {
  const company = res.locals.company;
  const tz = company.timezone;
  const month = resolvePeriod("mes_atual", {}, tz);
  const week = resolvePeriod("7d", {}, tz);
  const bi = await computeCompanyBi(company.id, tz, month, EMPTY_FILTERS);
  const bi7 = await computeCompanyBi(company.id, tz, week, EMPTY_FILTERS);
  const goals = await getGoals(company.id);
  const scored = await scoreLeads(company.id);
  res.send(
    intelligencePage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      canViewMarketing: canViewMarketing(res),
      bi,
      bi7,
      goals,
      projection: projectMonth(bi.current, goals, tz),
      attention: await evaluateAlerts(company.id, bi7),
      bottlenecks: detectBottlenecks(bi.current),
      hot: hotLeads(scored),
      stalled: stalledOpportunities(scored),
      health: await healthScore(company.id, bi, goals),
      summary: executiveSummary(bi7),
      costQuality: costVsQuality(bi.campaigns),
      funnel: executiveFunnel(bi.current),
      ...extra,
    })
  );
}

app.get("/empresa/:companyId/inteligencia", requireMarketingAccess, async (req, res) => renderIntelligence(req, res));

app.post("/empresa/:companyId/inteligencia/metas", requireCompanyAccess, async (req, res) => {
  const company = res.locals.company;
  if (res.locals.membership.role !== "COMPANY_ADMIN") {
    res.status(403).send("Apenas o administrador da empresa pode definir metas.");
    return;
  }
  const b = req.body as Record<string, string | undefined>;
  const cents = (v?: string) => (v && v.trim() ? parseReais(v) : null);
  const int = (v?: string) => (v && v.trim() && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
  await saveGoals(company.id, {
    revenue_cents: cents(b.revenue),
    new_customers: int(b.new_customers),
    leads: int(b.leads),
    qualified_leads: int(b.qualified_leads),
    appointments: int(b.appointments),
    attendances: int(b.attendances),
    max_cac_cents: cents(b.max_cac),
    max_cpl_cents: cents(b.max_cpl),
    min_roas: b.min_roas && b.min_roas.trim() ? Number(b.min_roas.replace(",", ".")) : null,
    planned_monthly_spend_cents: cents(b.planned_spend),
  });
  await audit("metas_atualizadas", { companyId: company.id, userId: res.locals.user.id, ip: clientIp(req) });
  await renderIntelligence(req, res, { notice: "Metas salvas." });
});

// --- Alertas por empresa -----------------------------------------------------------------

app.get("/empresa/:companyId/alertas", requireMarketingAccess, async (req, res) => {
  const company = res.locals.company;
  const q = req.query as { status?: string };
  const status = (["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO", "TODOS"] as (AlertStatus | "TODOS")[]).includes(q.status as any) ? (q.status as AlertStatus | "TODOS") : "ABERTO";
  res.send(
    alertsPage({
      company,
      user: res.locals.user,
      role: res.locals.membership.role,
      canViewMarketing: canViewMarketing(res),
      alerts: await listAlerts(company.id, status),
      status,
      members: await listCompanyMembers(company.id),
    })
  );
});

app.post("/empresa/:companyId/alertas/:alertId/status", requireMarketingAccess, async (req, res) => {
  const company = res.locals.company;
  const { status, assignee } = req.body as { status?: string; assignee?: string };
  const valid = (["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO"] as AlertStatus[]).includes(status as AlertStatus);
  if (valid) {
    const members = await listCompanyMembers(company.id);
    const assigneeId = assignee && members.some((m) => m.user_id === Number(assignee)) ? Number(assignee) : null;
    await updateAlertStatus(company.id, Number(req.params.alertId), status as AlertStatus, assigneeId);
  }
  res.redirect(`/empresa/${company.id}/alertas`);
});

// ============================================================================
// ADMINISTRAÇÃO GERAL — Integrações (OAuth Meta/Google), Marketing agregado,
// Agência. Só requirePlatformAdmin; todas as ações auditadas; nenhum token
// devolvido ao navegador; nenhuma operação de escrita nas plataformas.
// ============================================================================

const providerFetch = (url: string, init?: any) => fetch(url, init) as any;

async function renderIntegrations(res: express.Response, extra: { notice?: string; error?: string } = {}): Promise<void> {
  const companies = await listCompaniesForAdmin();
  const whatsapp = await Promise.all(
    companies.map(async (c) => {
      const row = await findConnectionByCompanyId(c.id);
      return { company: c, connection: row ? toAdminViewModel(row) : null };
    })
  );
  res.send(
    adminIntegrationsPage({
      meta: metaOAuthConfig(publicBaseUrl()),
      google: googleOAuthConfig(publicBaseUrl()),
      encryptionConfigured: isCredentialEncryptionConfigured(),
      connections: (await listConnections()).map(toConnectionView),
      accounts: await listAllAccounts(),
      companies,
      whatsapp,
      syncIntervalMinutes: syncIntervalMinutes(),
      ...extra,
    })
  );
}

app.get("/admin/integracoes", requirePlatformAdmin, async (_req, res) => renderIntegrations(res));

app.post("/admin/integracoes/meta/conectar", requirePlatformAdmin, async (req, res) => {
  const cfg = metaOAuthConfig(publicBaseUrl());
  if (!cfg.configured || !isCredentialEncryptionConfigured()) {
    await renderIntegrations(res, { error: "Meta Ads não configurado no servidor (variáveis ausentes)." });
    return;
  }
  const { state } = await createOAuthState("META", res.locals.user.id);
  await audit("oauth_iniciado", { userId: res.locals.user.id, detail: `META (escopos: ${metaScopes()})`, ip: clientIp(req) });
  res.redirect(buildMetaAuthorizeUrl(cfg, state));
});

app.get("/admin/integracoes/meta/callback", requirePlatformAdmin, async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const cfg = metaOAuthConfig(publicBaseUrl());
  const st = await consumeOAuthState("META", q.state, res.locals.user.id);
  if (!st.ok) {
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `META: ${st.error}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: "Autorização inválida ou expirada. Inicie a conexão de novo." });
    return;
  }
  if (q.error || !q.code || !cfg.configured) {
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `META: ${sanitizeText(q.error_description ?? q.error ?? "sem código")}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: "A Meta não concluiu a autorização. Tente novamente ou verifique as permissões do aplicativo." });
    return;
  }
  try {
    const token = await metaExchangeCode(providerFetch, cfg.clientId!, process.env.META_APP_SECRET!, cfg.redirectUri, q.code);
    const me = await metaGetMe(providerFetch, token.accessToken);
    const id = await createConnection({ provider: "META", externalUserId: me.id, displayName: me.name, scopes: metaScopes(), accessToken: token.accessToken, refreshToken: null, expiresAt: token.expiresAt, createdByUserId: res.locals.user.id });
    await audit("oauth_concluido", { userId: res.locals.user.id, detail: `META conexão #${id} (${me.name ?? me.id})`, ip: clientIp(req) });
    await renderIntegrations(res, { notice: `Meta Ads conectado (${me.name ?? me.id}). Clique em "Listar contas" para descobrir as contas de anúncio.` });
  } catch (err) {
    const msg = err instanceof ProviderError ? err.sanitized : sanitizeText(err instanceof Error ? err.message : String(err));
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `META: ${msg}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: `Não foi possível concluir a conexão com a Meta: ${msg}` });
  }
});

app.post("/admin/integracoes/google/conectar", requirePlatformAdmin, async (req, res) => {
  const cfg = googleOAuthConfig(publicBaseUrl());
  if (!cfg.configured || !isCredentialEncryptionConfigured()) {
    await renderIntegrations(res, { error: "Google Ads não configurado no servidor (variáveis ausentes)." });
    return;
  }
  const { state, codeChallenge } = await createOAuthState("GOOGLE", res.locals.user.id);
  await audit("oauth_iniciado", { userId: res.locals.user.id, detail: "GOOGLE (adwords, PKCE)", ip: clientIp(req) });
  res.redirect(buildGoogleAuthorizeUrl(cfg, state, codeChallenge!));
});

app.get("/admin/integracoes/google/callback", requirePlatformAdmin, async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const cfg = googleOAuthConfig(publicBaseUrl());
  const st = await consumeOAuthState("GOOGLE", q.state, res.locals.user.id);
  if (!st.ok) {
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `GOOGLE: ${st.error}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: "Autorização inválida ou expirada. Inicie a conexão de novo." });
    return;
  }
  if (q.error || !q.code || !cfg.configured) {
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `GOOGLE: ${sanitizeText(q.error ?? "sem código")}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: "O Google não concluiu a autorização. Tente novamente." });
    return;
  }
  try {
    const token = await googleExchangeCode(providerFetch, cfg.clientId!, process.env.GOOGLE_CLIENT_SECRET!, cfg.redirectUri, q.code, st.codeVerifier ?? null);
    const id = await createConnection({ provider: "GOOGLE", externalUserId: null, displayName: "Conta Google", scopes: "adwords", accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt, createdByUserId: res.locals.user.id });
    await audit("oauth_concluido", { userId: res.locals.user.id, detail: `GOOGLE conexão #${id}${token.refreshToken ? "" : " (SEM refresh token — reconexão será necessária ao expirar)"}`, ip: clientIp(req) });
    await renderIntegrations(res, { notice: `Google Ads conectado. Clique em "Listar contas" para descobrir as contas acessíveis.` });
  } catch (err) {
    const msg = err instanceof ProviderError ? err.sanitized : sanitizeText(err instanceof Error ? err.message : String(err));
    await audit("oauth_falhou", { userId: res.locals.user.id, detail: `GOOGLE: ${msg}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: `Não foi possível concluir a conexão com o Google: ${msg}` });
  }
});

/** Descobre as contas de anúncio acessíveis pela conexão (leitura) e grava em marketing_accounts, sem vincular a empresa. */
app.post("/admin/integracoes/conexoes/:id/descobrir", requirePlatformAdmin, async (req, res) => {
  const connection = await getConnection(Number(req.params.id));
  if (!connection || connection.status === "REVOGADA") {
    await renderIntegrations(res, { error: "Conexão não encontrada ou revogada." });
    return;
  }
  const throttle = checkActionThrottle("marketing_descobrir", clientIp(req), connection.id, 10);
  if (!throttle.allowed) {
    await renderIntegrations(res, { error: `Muitas tentativas. Tente em ${throttle.retryAfterMinutes} min.` });
    return;
  }
  recordAction("marketing_descobrir", clientIp(req), connection.id);
  try {
    const tokens = await decryptConnectionTokens(connection.id);
    if (!tokens.accessToken) throw new ProviderError("AUTH_EXPIRED", "Conexão sem token — reconecte.");
    let count = 0;
    if (connection.provider === "META") {
      for (const a of await metaListAdAccounts(providerFetch, tokens.accessToken)) {
        await upsertAccount({ connectionId: connection.id, provider: "META", ...a });
        count += 1;
      }
    } else {
      const ids = await googleListAccessibleCustomers(providerFetch, tokens.accessToken);
      for (const cid of ids) {
        const customer = await googleGetCustomer(providerFetch, tokens.accessToken, cid, null);
        if (!customer) continue;
        await upsertAccount({ connectionId: connection.id, provider: "GOOGLE", ...customer });
        count += 1;
        if (customer.isManager) {
          for (const client of await googleListCustomerClients(providerFetch, tokens.accessToken, cid)) {
            await upsertAccount({ connectionId: connection.id, provider: "GOOGLE", ...client });
            count += 1;
          }
        }
      }
    }
    await audit("marketing_contas_descobertas", { userId: res.locals.user.id, detail: `${connection.provider} conexão #${connection.id}: ${count} conta(s)`, ip: clientIp(req) });
    await renderIntegrations(res, { notice: `${count} conta(s) encontrada(s). Vincule cada uma à empresa correta.` });
  } catch (err) {
    const msg = err instanceof ProviderError ? err.sanitized : sanitizeText(err instanceof Error ? err.message : String(err));
    await audit("marketing_contas_descobertas_falhou", { userId: res.locals.user.id, detail: `${connection.provider}: ${msg}`, ip: clientIp(req) });
    await renderIntegrations(res, { error: msg });
  }
});

app.post("/admin/integracoes/conexoes/:id/revogar", requirePlatformAdmin, async (req, res) => {
  const connection = await getConnection(Number(req.params.id));
  if (!connection) {
    await renderIntegrations(res, { error: "Conexão não encontrada." });
    return;
  }
  await revokeConnection(connection.id);
  await audit("integracao_removida", { userId: res.locals.user.id, detail: `${connection.provider} conexão #${connection.id} revogada (tokens apagados)`, ip: clientIp(req) });
  await renderIntegrations(res, { notice: "Conexão revogada e tokens apagados. Para parar o acesso do lado da plataforma, remova também o aplicativo nas configurações da sua conta Meta/Google." });
});

app.post("/admin/integracoes/contas/:id/vincular", requirePlatformAdmin, async (req, res) => {
  const { company_id, sync } = req.body as { company_id?: string; sync?: string };
  const account = await getAccount(Number(req.params.id));
  if (!account || !company_id) {
    await renderIntegrations(res, { error: "Escolha uma empresa." });
    return;
  }
  const previous = account.company_id;
  const result = await linkAccountToCompany(account.id, Number(company_id), sync === "1");
  if (!result.ok) {
    await renderIntegrations(res, { error: result.error });
    return;
  }
  const company = await findCompanyById(Number(company_id));
  await audit(previous && previous !== Number(company_id) ? "marketing_conta_reatribuida" : "marketing_conta_vinculada", {
    companyId: Number(company_id),
    userId: res.locals.user.id,
    detail: `${account.provider} ${account.name ?? account.external_account_id}${previous && previous !== Number(company_id) ? ` (antes: empresa #${previous})` : ""}, sync ${sync === "1" ? "ligada" : "desligada"}`,
    ip: clientIp(req),
  });
  await renderIntegrations(res, { notice: `Conta vinculada a "${company?.name ?? company_id}".` });
});

app.post("/admin/integracoes/contas/:id/desvincular", requirePlatformAdmin, async (req, res) => {
  const account = await getAccount(Number(req.params.id));
  if (!account) {
    await renderIntegrations(res, { error: "Conta não encontrada." });
    return;
  }
  await unlinkAccount(account.id);
  await audit("marketing_conta_desvinculada", { companyId: account.company_id, userId: res.locals.user.id, detail: `${account.provider} ${account.name ?? account.external_account_id}`, ip: clientIp(req) });
  await renderIntegrations(res, { notice: "Conta desvinculada. Campanhas e métricas dela deixaram de aparecer para a empresa." });
});

app.post("/admin/integracoes/contas/:id/sincronizar", requirePlatformAdmin, async (req, res) => {
  const account = await getAccount(Number(req.params.id));
  if (!account) {
    await renderIntegrations(res, { error: "Conta não encontrada." });
    return;
  }
  const result = await syncAccount(account.id, "MANUAL", res.locals.user.id, publicBaseUrl());
  await renderIntegrations(res, result.ok ? { notice: `Sincronização concluída: ${result.processed} registro(s) (${result.windowFrom} a ${result.windowTo}).` } : { error: result.error });
});

app.post("/admin/integracoes/sincronizar-tudo", requirePlatformAdmin, async (req, res) => {
  const throttle = checkActionThrottle("marketing_sync_all", clientIp(req), "global", 6);
  if (!throttle.allowed) {
    await renderIntegrations(res, { error: `Aguarde ${throttle.retryAfterMinutes} min para sincronizar tudo de novo.` });
    return;
  }
  recordAction("marketing_sync_all", clientIp(req), "global");
  const results = await syncAllEnabled("MANUAL", res.locals.user.id, publicBaseUrl());
  const ok = results.filter((r) => r.ok).length;
  await renderIntegrations(res, { notice: `${ok} de ${results.length} conta(s) sincronizada(s) com sucesso.` });
});

/** Resumo por empresa para os painéis agregados (30 dias). */
async function companySummaries(): Promise<CompanySummary[]> {
  const companies = await listCompaniesForAdmin();
  const out: CompanySummary[] = [];
  for (const company of companies) {
    const period = resolvePeriod("30d", {}, company.timezone);
    const bi = await computeCompanyBi(company.id, company.timezone, period, EMPTY_FILTERS);
    const goals = await getGoals(company.id);
    const wa = await findConnectionByCompanyId(company.id);
    out.push({ company, bi, health: await healthScore(company.id, bi, goals), goals, accounts: await listAccountsForCompany(company.id), whatsapp: wa ? toAdminViewModel(wa) : null });
  }
  return out;
}

app.get("/admin/marketing", requirePlatformAdmin, async (_req, res) => {
  res.send(adminMarketingPage({ summaries: await companySummaries(), periodLabel: "últimos 30 dias", syncRuns: await listSyncRuns(40), openAlerts: await listAlertsAllCompanies(), rules: await listGlobalRules() }));
});

app.post("/admin/alertas/regras", requirePlatformAdmin, async (req, res) => {
  const body = req.body as Record<string, string | undefined>;
  for (const rule of RULE_KINDS) {
    const raw = body[rule.kind];
    if (raw === undefined || !raw.trim()) continue;
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) continue;
    await saveThreshold(null, rule.kind, rule.kind === "spendWithoutLeadCents" ? Math.round(n * 100) : n);
  }
  await audit("alertas_regras_atualizadas", { userId: res.locals.user.id, ip: clientIp(req) });
  res.send(adminMarketingPage({ summaries: await companySummaries(), periodLabel: "últimos 30 dias", syncRuns: await listSyncRuns(40), openAlerts: await listAlertsAllCompanies(), rules: await listGlobalRules(), notice: "Limiares salvos." }));
});

app.get("/admin/agencia", requirePlatformAdmin, async (req, res) => {
  const q = req.query as { ordenar?: string };
  res.send(adminAgencyPage({ summaries: await companySummaries(), periodLabel: "últimos 30 dias", sort: q.ordenar && /^[a-z_]+$/.test(q.ordenar) ? q.ordenar : null }));
});

/** Visão da empresa para o administrador geral (sem entrar nas telas operacionais da empresa). */
app.get("/admin/agencia/empresa/:companyId", requirePlatformAdmin, async (req, res) => {
  const company = await findCompanyById(Number(req.params.companyId));
  if (!company) {
    res.status(404).send("Empresa não encontrada.");
    return;
  }
  const q = req.query as Record<string, string | undefined>;
  const period = resolvePeriod(q.periodo, { from: q.de, to: q.ate }, company.timezone);
  const bi: CompanyBi = await computeCompanyBi(company.id, company.timezone, period, parseFilters(q));
  const attention = await buildAttention(company.id, bi);
  res.send(
    htmlPage(
      `${company.name} — Agência`,
      `<div style="max-width:1200px;margin:0 auto;padding:1.5rem">
        <div class="page-head"><div><div class="eyebrow">HUB ACTION · Agência</div><h2>${company.name.replace(/</g, "&lt;")}</h2><div class="sub">${bi.period.label} · comparado com ${bi.period.previousLabel}</div></div><a href="/admin/agencia" class="btn btn-small">&larr; Carteira</a></div>
        ${executiveCards(bi)}
        <div class="grid-12"><div class="col-6"><div class="card-block"><h3>Funil</h3>${funnelBlock(executiveFunnel(bi.current), company.id, "", false)}</div></div><div class="col-6"><div class="card-block"><h3>Meta Ads x Google Ads</h3>${providerComparisonBlock(bi)}</div></div></div>
        <div class="card-block"><h3>Custo de aquisição</h3>${secondaryKpis(bi)}</div>
        <div class="card-block"><h3>Campanhas</h3>${campaignsTable(bi.campaigns, company.id, "", company.timezone, null)}</div>
        <div class="card-block"><h3>Precisa de atenção</h3>${attentionBlock(attention)}</div>
      </div>`
    )
  );
});

// Erro não tratado em rota async: nunca vaza stack trace para o cliente.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[erro não tratado]", err);
  if (!res.headersSent) res.status(500).send("Erro interno. Tente novamente.");
});

async function main(): Promise<void> {
  await runMigrations();
  startSyncScheduler(publicBaseUrl());
  app.listen(PORT, () => {
    console.log(`HUB ACTION - CRM WhatsApp rodando em http://localhost:${PORT} (banco: ${db.dialect})`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
