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
