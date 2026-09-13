/**
 * Seed de DEMONSTRAÇÃO: cria empresas e usuários fictícios para testar login,
 * perfis, isolamento entre empresas e o funil/CRM. Roda só manualmente
 * (nunca no boot do servidor) e nunca sobrescreve senha de usuário existente
 * — reexecutar é seguro.
 *
 * Senhas:
 * - Banco local (SQLite): fixas ("trocar123"), como sempre — nunca sai do
 *   seu computador.
 * - Banco remoto (Postgres/Neon — pode ser o mesmo banco que uma hospedagem
 *   pública usa): geradas aleatoriamente a cada conta nova e impressas só
 *   uma vez aqui no terminal. Prefira sobrescrever via variável de ambiente
 *   (PLATFORM_ADMIN_PASSWORD, DEMO_A_ADMIN_PASSWORD, DEMO_A_AGENT_PASSWORD,
 *   DEMO_B_ADMIN_PASSWORD, DEMO_B_AGENT_PASSWORD) se quiser escolher a senha.
 *
 * Uso: npm run db:seed
 */
import "./env";
import crypto from "crypto";
import { addMessage, createConversation, findOrCreateContact } from "./attendance";
import { hashPassword } from "./auth";
import { createOpportunity, ensureDefaultPipelineStages } from "./crm";
import { db, runMigrations } from "./db";
import { createConnection, linkAccountToCompany, upsertAccount, upsertCampaign, upsertDailyMetric } from "./marketingModels";

function nowIso(): string {
  return new Date().toISOString();
}

function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url"); // ~12 caracteres, só letras/números/-/_
}

/** Senha a usar para uma conta nova: variável de ambiente > gerada (Postgres) > fixa (SQLite, só local). */
function passwordFor(envVarName: string): string {
  const override = process.env[envVarName];
  if (override && override.trim()) return override.trim();
  return db.dialect === "sqlite" ? "trocar123" : generatePassword();
}

async function upsertCompany(name: string, slug: string): Promise<number> {
  const existing = await db.get<{ id: number }>("SELECT id FROM companies WHERE slug = ?", slug);
  if (existing) return existing.id;
  const row = await db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", name, slug, nowIso());
  return row!.id;
}

interface UpsertedUser {
  id: number;
  created: boolean;
}

async function upsertUser(name: string, email: string, password: string, isPlatformAdmin = false): Promise<UpsertedUser> {
  const existing = await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email);
  if (existing) return { id: existing.id, created: false }; // já existe: senha NÃO é tocada
  const row = await db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, ?, 1, ?) RETURNING id",
    name,
    email,
    hashPassword(password),
    isPlatformAdmin ? 1 : 0,
    nowIso()
  );
  return { id: row!.id, created: true };
}

async function upsertMembership(userId: number, companyId: number, role: "COMPANY_ADMIN" | "AGENT"): Promise<void> {
  const existing = await db.get("SELECT id FROM memberships WHERE user_id = ? AND company_id = ?", userId, companyId);
  if (existing) return;
  await db.run("INSERT INTO memberships (user_id, company_id, role, created_at) VALUES (?, ?, ?, ?)", userId, companyId, role, nowIso());
}

/** Cria uma conversa de demonstração (dado de teste) já com pedido de atendente pendente. */
async function seedDemoConversation(companyId: number, contactName: string, phone: string, firstMessage: string): Promise<void> {
  const existing = await db.get("SELECT id FROM contacts WHERE company_id = ? AND phone = ?", companyId, phone);
  if (existing) return; // seed já rodou antes, não duplica
  const contact = await findOrCreateContact(companyId, contactName, phone);
  const conv = await createConversation(companyId, contact.id, "AUTOMATICO");
  await addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: firstMessage });
}

/** Cria uma oportunidade de demonstração (dado de teste), se o contato ainda não existir. */
async function seedDemoOpportunity(
  companyId: number,
  contactName: string,
  phone: string,
  title: string,
  valueCents: number,
  responsibleUserId: number
): Promise<void> {
  const existing = await db.get("SELECT id FROM contacts WHERE company_id = ? AND phone = ?", companyId, phone);
  if (existing) return;
  const contact = await findOrCreateContact(companyId, contactName, phone);
  await createOpportunity({ companyId, contactId: contact.id, title, valueCents, responsibleUserId });
}

/**
 * Mídia paga FICTÍCIA só para a Empresa Demo A (plan DEMONSTRACAO): uma
 * conexão Meta "de demonstração" (token cifrado inútil), uma conta, duas
 * campanhas com 30 dias de gasto, e leads/vendas atribuídos — para as telas
 * de Marketing/Inteligência poderem ser vistas com dados. Idempotente: se a
 * empresa já tem conta de anúncio, não faz nada. Nunca toca empresas reais.
 */
async function seedDemoMarketing(companyId: number, createdByUserId: number): Promise<void> {
  const company = await db.get<{ plan: string; slug: string }>("SELECT plan, slug FROM companies WHERE id = ?", companyId);
  if (!company || company.plan !== "DEMONSTRACAO" || !company.slug.startsWith("empresa-demo")) return;
  if (await db.get("SELECT id FROM marketing_accounts WHERE company_id = ?", companyId)) return;
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.log("- mídia paga de demonstração: pulada (CREDENTIAL_ENCRYPTION_KEY ausente).");
    return;
  }
  const connectionId = await createConnection({ provider: "META", externalUserId: "demo", displayName: "Conta Meta de demonstração (fictícia)", scopes: "ads_read,read_insights", accessToken: "token-ficticio-de-demonstracao", refreshToken: null, expiresAt: null, createdByUserId });
  const accountId = await upsertAccount({ connectionId, provider: "META", externalAccountId: "act_demo_a", name: "Empresa Demo A — Meta (fictícia)", currency: "BRL", timezone: "America/Sao_Paulo", accountStatus: "1", isManager: false, loginCustomerId: null });
  await linkAccountToCompany(accountId, companyId, false);
  const campaigns = [
    { externalId: "demo-c1", name: "Corte Premium — Mensagens", spend: 9000, leadsPerDay: 2, wonEvery: 5, value: 12000 },
    { externalId: "demo-c2", name: "Promoção Barba — Alcance", spend: 6000, leadsPerDay: 3, wonEvery: 15, value: 8000 },
  ];
  for (const c of campaigns) {
    const campaignId = await upsertCampaign({ accountId, companyId, provider: "META", externalId: c.externalId, name: c.name, status: "ACTIVE", objective: "OUTCOME_ENGAGEMENT", campaignType: null, dailyBudgetCents: c.spend, lifetimeBudgetCents: null, currency: "BRL", startDate: null, endDate: null });
    let n = 0;
    for (let d = 29; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86400000);
      const date = day.toISOString().slice(0, 10);
      await upsertDailyMetric({ companyId, provider: "META", accountId, campaignId, adGroupId: null, adId: null, level: "CAMPAIGN", dimensionKey: `META:CAMPAIGN:act_demo_a:${c.externalId}::`, metricDate: date, currency: "BRL", spendCents: c.spend, impressions: 4000 + d * 20, reach: 3000, frequency: 1.3, clicks: 120, linkClicks: 90, platformConversations: c.leadsPerDay + 1, platformLeads: null, platformConversions: null, platformConversionValueCents: null, rawMetricsJson: null });
      for (let i = 0; i < c.leadsPerDay; i++) {
        n += 1;
        const phone = `+55 11 9${c.externalId === "demo-c1" ? "7" : "8"}${String(n).padStart(3, "0")}-${String(d).padStart(4, "0")}`;
        const contact = await findOrCreateContact(companyId, `Lead ${c.name.split(" ")[0]} ${n}`, phone);
        await db.run("UPDATE contacts SET created_at = ?, source = 'META_ADS', attribution_confidence = 'CONFIRMADA', attribution_provider = 'META', external_campaign_id = ?, ctwa_clid = ? WHERE id = ?", day.toISOString(), c.externalId, `demo-${c.externalId}-${n}`, contact.id);
        if (n % 2 === 0) {
          const opp = await createOpportunity({ companyId, contactId: contact.id, title: "Serviço", valueCents: c.value });
          const won = n % c.wonEvery === 0;
          const stage = won ? "Venda concluída" : n % 4 === 0 ? "Agendado" : "Qualificado";
          const stageId = (await db.get<{ id: number }>("SELECT id FROM pipeline_stages WHERE company_id = ? AND name = ?", companyId, stage))!.id;
          await db.run(
            "UPDATE opportunities SET stage_id = ?, created_at = ?, updated_at = ?, qualified_at = ?, scheduled_at = ?, attended_at = ?, closed_at = ? WHERE id = ?",
            stageId,
            day.toISOString(),
            day.toISOString(),
            day.toISOString(),
            stage === "Agendado" || won ? day.toISOString() : null,
            won ? day.toISOString() : null,
            won ? day.toISOString() : null,
            opp.id
          );
        }
      }
    }
  }
  console.log("- Empresa Demo A: mídia paga FICTÍCIA (Meta) com 30 dias de dados para as telas de Marketing/Inteligência.");
}

/** Imprime a credencial só quando a conta acabou de ser criada agora — para uma que já existia, a senha não muda e não é mostrada. */
function logAccount(label: string, email: string, password: string, user: UpsertedUser): void {
  if (user.created) {
    console.log(`- ${email} / ${password}  (${label} — conta criada agora)`);
  } else {
    console.log(`- ${email} já existia (${label}) — senha não foi alterada por este seed.`);
  }
}

async function main(): Promise<void> {
  if (process.env.DEMO_MODE === "false") {
    console.error(
      "Seed de demonstração bloqueado: DEMO_MODE=false. Este ambiente não deve ter dados nem contas de teste."
    );
    process.exit(1);
  }

  await runMigrations();

  const platformPw = passwordFor("PLATFORM_ADMIN_PASSWORD");
  const adminAPw = passwordFor("DEMO_A_ADMIN_PASSWORD");
  const agentAPw = passwordFor("DEMO_A_AGENT_PASSWORD");
  const adminBPw = passwordFor("DEMO_B_ADMIN_PASSWORD");
  const agentBPw = passwordFor("DEMO_B_AGENT_PASSWORD");

  const platformAdmin = await upsertUser("Admin Hub Action", "admin@hubaction.dev", platformPw, true);

  const empresaAId = await upsertCompany("Empresa Demo A", "empresa-demo-a");
  const empresaBId = await upsertCompany("Empresa Demo B", "empresa-demo-b");

  const adminA = await upsertUser("Admin Empresa A", "admin@empresa-a.dev", adminAPw);
  const atendenteA = await upsertUser("Atendente Empresa A", "atendente@empresa-a.dev", agentAPw);
  const adminB = await upsertUser("Admin Empresa B", "admin@empresa-b.dev", adminBPw);
  const atendenteB = await upsertUser("Atendente Empresa B", "atendente@empresa-b.dev", agentBPw);

  await upsertMembership(adminA.id, empresaAId, "COMPANY_ADMIN");
  await upsertMembership(atendenteA.id, empresaAId, "AGENT");
  await upsertMembership(adminB.id, empresaBId, "COMPANY_ADMIN");
  await upsertMembership(atendenteB.id, empresaBId, "AGENT");

  await seedDemoConversation(empresaAId, "Cliente Demo A", "+55 11 90000-1001", "minha internet caiu, quero falar com atendente");
  await seedDemoConversation(empresaBId, "Cliente Demo B", "+55 21 90000-2001", "preciso de suporte, chama um atendente por favor");

  await ensureDefaultPipelineStages(empresaAId);
  await ensureDefaultPipelineStages(empresaBId);
  await seedDemoOpportunity(empresaAId, "Lead Demo A", "+55 11 90000-1002", "Plano mensal", 19900, adminA.id);
  await seedDemoOpportunity(empresaBId, "Lead Demo B", "+55 21 90000-2002", "Plano anual", 149000, adminB.id);
  await seedDemoMarketing(empresaAId, platformAdmin.id);

  console.log(`Seed de demonstração aplicado no ${db.dialect} (dados fictícios, não é atendimento real):`);
  if (db.dialect !== "sqlite") {
    console.log("Banco remoto detectado — senhas de contas novas foram geradas aleatoriamente (só aparecem aqui, uma vez).");
  }
  logAccount("administrador da plataforma", "admin@hubaction.dev", platformPw, platformAdmin);
  logAccount("administrador — Empresa Demo A", "admin@empresa-a.dev", adminAPw, adminA);
  logAccount("atendente — Empresa Demo A", "atendente@empresa-a.dev", agentAPw, atendenteA);
  logAccount("administrador — Empresa Demo B", "admin@empresa-b.dev", adminBPw, adminB);
  logAccount("atendente — Empresa Demo B", "atendente@empresa-b.dev", agentBPw, atendenteB);
  await db.close();
}

main().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
