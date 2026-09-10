/**
 * Seed de DESENVOLVIMENTO: cria empresas e usuários fictícios para testar
 * login, perfis e isolamento entre empresas. Nunca rodar em produção.
 * Uso: npm run db:seed
 */
import "./env";
import { addMessage, createConversation, findOrCreateContact } from "./attendance";
import { hashPassword } from "./auth";
import { createOpportunity, ensureDefaultPipelineStages } from "./crm";
import { db, runMigrations } from "./db";

function nowIso(): string {
  return new Date().toISOString();
}

async function upsertCompany(name: string, slug: string): Promise<number> {
  const existing = await db.get<{ id: number }>("SELECT id FROM companies WHERE slug = ?", slug);
  if (existing) return existing.id;
  const row = await db.get<{ id: number }>("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id", name, slug, nowIso());
  return row!.id;
}

async function upsertUser(name: string, email: string, password: string, isPlatformAdmin = false): Promise<number> {
  const existing = await db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email);
  if (existing) return existing.id;
  const row = await db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, ?, 1, ?) RETURNING id",
    name,
    email,
    hashPassword(password),
    isPlatformAdmin ? 1 : 0,
    nowIso()
  );
  return row!.id;
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

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Seed de demonstração bloqueado: NODE_ENV=production. Credenciais de teste não podem existir em produção."
    );
    process.exit(1);
  }

  await runMigrations();

  const platformAdminId = await upsertUser("Admin Hub Action", "admin@hubaction.dev", "trocar123", true);

  const empresaAId = await upsertCompany("Empresa Demo A", "empresa-demo-a");
  const empresaBId = await upsertCompany("Empresa Demo B", "empresa-demo-b");

  const adminAId = await upsertUser("Admin Empresa A", "admin@empresa-a.dev", "trocar123");
  const atendenteAId = await upsertUser("Atendente Empresa A", "atendente@empresa-a.dev", "trocar123");
  const adminBId = await upsertUser("Admin Empresa B", "admin@empresa-b.dev", "trocar123");
  const atendenteBId = await upsertUser("Atendente Empresa B", "atendente@empresa-b.dev", "trocar123");

  await upsertMembership(adminAId, empresaAId, "COMPANY_ADMIN");
  await upsertMembership(atendenteAId, empresaAId, "AGENT");
  await upsertMembership(adminBId, empresaBId, "COMPANY_ADMIN");
  await upsertMembership(atendenteBId, empresaBId, "AGENT");

  await seedDemoConversation(empresaAId, "Cliente Demo A", "+55 11 90000-1001", "minha internet caiu, quero falar com atendente");
  await seedDemoConversation(empresaBId, "Cliente Demo B", "+55 21 90000-2001", "preciso de suporte, chama um atendente por favor");

  await ensureDefaultPipelineStages(empresaAId);
  await ensureDefaultPipelineStages(empresaBId);
  await seedDemoOpportunity(empresaAId, "Lead Demo A", "+55 11 90000-1002", "Plano mensal", 19900, adminAId);
  await seedDemoOpportunity(empresaBId, "Lead Demo B", "+55 21 90000-2002", "Plano anual", 149000, adminBId);

  console.log(`Seed de desenvolvimento aplicado no ${db.dialect} (dados de teste, não usar em produção):`);
  console.log(`- admin@hubaction.dev / trocar123 (administrador da plataforma) [id ${platformAdminId}]`);
  console.log(`- admin@empresa-a.dev / trocar123 (administrador — Empresa Demo A)`);
  console.log(`- atendente@empresa-a.dev / trocar123 (atendente — Empresa Demo A)`);
  console.log(`- admin@empresa-b.dev / trocar123 (administrador — Empresa Demo B)`);
  console.log(`- atendente@empresa-b.dev / trocar123 (atendente — Empresa Demo B)`);
  await db.close();
}

main().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
