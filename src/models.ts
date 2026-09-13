import { db } from "./db";

export type Role = "COMPANY_ADMIN" | "AGENT";

export interface Company {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  business_hours: string; // JSON — ver src/businessHours.ts
  sla_first_response_minutes: number;
  /** Rótulo controlado manualmente pela Hub Action — sem preço, sem cobrança automática. */
  plan: CompanyPlan;
  suspended: number; // 0 | 1
  plan_notes: string | null;
  created_at: string;
}

export type CompanyPlan = "DEMONSTRACAO" | "PILOTO" | "ATIVO";

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  is_platform_admin: number; // 0 | 1 (INTEGER nos dois bancos)
  active: number; // 0 | 1
  created_at: string;
}

export interface Membership {
  id: number;
  user_id: number;
  company_id: number;
  role: Role;
  created_at: string;
  /** Capability: atendente com acesso aos relatórios de mídia paga (administrador da empresa sempre tem). */
  can_view_marketing: number; // 0 | 1
}

export interface MembershipWithCompany extends Membership {
  company_name: string;
  company_slug: string;
}

export function findUserByEmail(email: string): Promise<User | undefined> {
  return db.get<User>("SELECT * FROM users WHERE email = ?", email);
}

export function findUserById(id: number): Promise<User | undefined> {
  return db.get<User>("SELECT * FROM users WHERE id = ?", id);
}

export function findCompanyById(id: number): Promise<Company | undefined> {
  return db.get<Company>("SELECT * FROM companies WHERE id = ?", id);
}

export function listCompanies(): Promise<Company[]> {
  return db.all<Company>("SELECT * FROM companies ORDER BY name");
}

/** Empresas autorizadas para o usuário, com o perfil dele em cada uma. */
export function listMembershipsForUser(userId: number): Promise<MembershipWithCompany[]> {
  return db.all<MembershipWithCompany>(
    `SELECT m.*, c.name AS company_name, c.slug AS company_slug
     FROM memberships m
     JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = ?
     ORDER BY c.name`,
    userId
  );
}

/** Fonte da verdade do isolamento: só existe acesso se houver uma linha de associação. */
export function findMembership(userId: number, companyId: number): Promise<Membership | undefined> {
  return db.get<Membership>("SELECT * FROM memberships WHERE user_id = ? AND company_id = ?", userId, companyId);
}

export async function updateCompanySettings(companyId: number, timezone: string, businessHoursJson: string): Promise<void> {
  await db.run("UPDATE companies SET timezone = ?, business_hours = ? WHERE id = ?", timezone, businessHoursJson, companyId);
}

export async function updateSlaTarget(companyId: number, minutes: number): Promise<void> {
  await db.run("UPDATE companies SET sla_first_response_minutes = ? WHERE id = ?", minutes, companyId);
}

/** Membros (admin + atendentes) de uma empresa, para preencher filtros e seletores de responsável. */
export function listCompanyMembers(companyId: number): Promise<{ user_id: number; name: string; role: Role }[]> {
  return db.all<{ user_id: number; name: string; role: Role }>(
    `SELECT u.id AS user_id, u.name, m.role
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ?
     ORDER BY u.name`,
    companyId
  );
}

// --- Gestão pela Hub Action (painel da plataforma) ---------------------------

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createCompany(name: string): Promise<Company> {
  const base = slugify(name) || "empresa";
  let slug = base;
  let n = 2;
  while (await db.get("SELECT 1 AS x FROM companies WHERE slug = ?", slug)) slug = `${base}-${n++}`;
  const row = await db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    name.trim(),
    slug,
    new Date().toISOString()
  );
  return (await findCompanyById(row!.id))!;
}

export async function updateCompanyPlan(companyId: number, plan: CompanyPlan, suspended: boolean, notes: string | null): Promise<void> {
  await db.run("UPDATE companies SET plan = ?, suspended = ?, plan_notes = ? WHERE id = ?", plan, suspended ? 1 : 0, notes, companyId);
}

export interface CompanyAdminRow extends Company {
  member_count: number;
  conversation_count: number;
}

export function listCompaniesForAdmin(): Promise<CompanyAdminRow[]> {
  return db.all<CompanyAdminRow>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM memberships m WHERE m.company_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM conversations co WHERE co.company_id = c.id) AS conversation_count
     FROM companies c ORDER BY c.name`
  );
}

export interface CompanyUserRow {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
}

export function listCompanyUsers(companyId: number): Promise<CompanyUserRow[]> {
  return db.all<CompanyUserRow>(
    `SELECT u.id AS user_id, u.name, u.email, m.role, u.active
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = ? ORDER BY u.name`,
    companyId
  );
}

export async function setUserActive(userId: number, active: boolean): Promise<void> {
  await db.run("UPDATE users SET active = ? WHERE id = ?", active ? 1 : 0, userId);
  if (!active) await db.run("DELETE FROM sessions WHERE sess LIKE ?", `%"userId":${userId}%`);
}
