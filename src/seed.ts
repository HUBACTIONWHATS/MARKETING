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

function upsertCompany(name: string, slug: string): number {
  const existing = db.prepare("SELECT id FROM companies WHERE slug = ?").get(slug) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db.prepare("INSERT INTO companies (name, slug) VALUES (?, ?)").run(name, slug);
  return Number(info.lastInsertRowid);
}

function upsertUser(name: string, email: string, password: string, isPlatformAdmin = false): number {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO users (name, email, password_hash, is_platform_admin) VALUES (?, ?, ?, ?)"
    )
    .run(name, email, hashPassword(password), isPlatformAdmin ? 1 : 0);
  return Number(info.lastInsertRowid);
}

function upsertMembership(userId: number, companyId: number, role: "COMPANY_ADMIN" | "AGENT"): void {
  const existing = db
    .prepare("SELECT id FROM memberships WHERE user_id = ? AND company_id = ?")
    .get(userId, companyId);
  if (existing) return;
  db.prepare("INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, ?)").run(
    userId,
    companyId,
    role
  );
}

/** Cria uma conversa de demonstração (dado de teste) já com pedido de atendente pendente. */
function seedDemoConversation(companyId: number, contactName: string, phone: string, firstMessage: string): void {
  const existing = db.prepare("SELECT id FROM contacts WHERE company_id = ? AND phone = ?").get(companyId, phone);
  if (existing) return; // seed já rodou antes, não duplica
  const contact = findOrCreateContact(companyId, contactName, phone);
  const conv = createConversation(companyId, contact.id, "AUTOMATICO");
  addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: firstMessage });
}

/** Cria uma oportunidade de demonstração (dado de teste), se o contato ainda não existir. */
function seedDemoOpportunity(
  companyId: number,
  contactName: string,
  phone: string,
  title: string,
  valueCents: number,
  responsibleUserId: number
): void {
  const existing = db.prepare("SELECT id FROM contacts WHERE company_id = ? AND phone = ?").get(companyId, phone);
  if (existing) return;
  const contact = findOrCreateContact(companyId, contactName, phone);
  createOpportunity({ companyId, contactId: contact.id, title, valueCents, responsibleUserId });
}

function main(): void {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Seed de demonstração bloqueado: NODE_ENV=production. Credenciais de teste não podem existir em produção."
    );
    process.exit(1);
  }

  runMigrations();

  const platformAdminId = upsertUser("Admin Hub Action", "admin@hubaction.dev", "trocar123", true);

  const empresaAId = upsertCompany("Empresa Demo A", "empresa-demo-a");
  const empresaBId = upsertCompany("Empresa Demo B", "empresa-demo-b");

  const adminAId = upsertUser("Admin Empresa A", "admin@empresa-a.dev", "trocar123");
  const atendenteAId = upsertUser("Atendente Empresa A", "atendente@empresa-a.dev", "trocar123");
  const adminBId = upsertUser("Admin Empresa B", "admin@empresa-b.dev", "trocar123");
  const atendenteBId = upsertUser("Atendente Empresa B", "atendente@empresa-b.dev", "trocar123");

  upsertMembership(adminAId, empresaAId, "COMPANY_ADMIN");
  upsertMembership(atendenteAId, empresaAId, "AGENT");
  upsertMembership(adminBId, empresaBId, "COMPANY_ADMIN");
  upsertMembership(atendenteBId, empresaBId, "AGENT");

  seedDemoConversation(empresaAId, "Cliente Demo A", "+55 11 90000-1001", "minha internet caiu, quero falar com atendente");
  seedDemoConversation(empresaBId, "Cliente Demo B", "+55 21 90000-2001", "preciso de suporte, chama um atendente por favor");

  ensureDefaultPipelineStages(empresaAId);
  ensureDefaultPipelineStages(empresaBId);
  seedDemoOpportunity(empresaAId, "Lead Demo A", "+55 11 90000-1002", "Plano mensal", 19900, adminAId);
  seedDemoOpportunity(empresaBId, "Lead Demo B", "+55 21 90000-2002", "Plano anual", 149000, adminBId);

  console.log("Seed de desenvolvimento aplicado (dados de teste, não usar em produção):");
  console.log(`- admin@hubaction.dev / trocar123 (administrador da plataforma) [id ${platformAdminId}]`);
  console.log(`- admin@empresa-a.dev / trocar123 (administrador — Empresa Demo A)`);
  console.log(`- atendente@empresa-a.dev / trocar123 (atendente — Empresa Demo A)`);
  console.log(`- admin@empresa-b.dev / trocar123 (administrador — Empresa Demo B)`);
  console.log(`- atendente@empresa-b.dev / trocar123 (atendente — Empresa Demo B)`);
}

main();
