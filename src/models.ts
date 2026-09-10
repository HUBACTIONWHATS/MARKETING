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
  is_platform_admin: number; // 0 | 1 (SQLite não tem boolean nativo)
  active: number; // 0 | 1
  created_at: string;
}

export interface Membership {
  id: number;
  user_id: number;
  company_id: number;
  role: Role;
  created_at: string;
}

export interface MembershipWithCompany extends Membership {
  company_name: string;
  company_slug: string;
}

export function findUserByEmail(email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function findCompanyById(id: number): Company | undefined {
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as Company | undefined;
}

export function listCompanies(): Company[] {
  return db.prepare("SELECT * FROM companies ORDER BY name").all() as Company[];
}

/** Empresas autorizadas para o usuário, com o perfil dele em cada uma. */
export function listMembershipsForUser(userId: number): MembershipWithCompany[] {
  return db
    .prepare(
      `SELECT m.*, c.name AS company_name, c.slug AS company_slug
       FROM memberships m
       JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = ?
       ORDER BY c.name`
    )
    .all(userId) as MembershipWithCompany[];
}

/** Fonte da verdade do isolamento: só existe acesso se houver uma linha de associação. */
export function findMembership(userId: number, companyId: number): Membership | undefined {
  return db
    .prepare("SELECT * FROM memberships WHERE user_id = ? AND company_id = ?")
    .get(userId, companyId) as Membership | undefined;
}

export function updateCompanySettings(companyId: number, timezone: string, businessHoursJson: string): void {
  db.prepare("UPDATE companies SET timezone = ?, business_hours = ? WHERE id = ?").run(
    timezone,
    businessHoursJson,
    companyId
  );
}

export function updateSlaTarget(companyId: number, minutes: number): void {
  db.prepare("UPDATE companies SET sla_first_response_minutes = ? WHERE id = ?").run(minutes, companyId);
}

/** Membros (admin + atendentes) de uma empresa, para preencher filtros e seletores de responsável. */
export function listCompanyMembers(companyId: number): { user_id: number; name: string; role: Role }[] {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.name, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.company_id = ?
       ORDER BY u.name`
    )
    .all(companyId) as { user_id: number; name: string; role: Role }[];
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

export function createCompany(name: string): Company {
  const base = slugify(name) || "empresa";
  let slug = base;
  let n = 2;
  while (db.prepare("SELECT 1 FROM companies WHERE slug = ?").get(slug)) slug = `${base}-${n++}`;
  const info = db.prepare("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, datetime('now'))").run(name.trim(), slug);
  return findCompanyById(Number(info.lastInsertRowid))!;
}

export function updateCompanyPlan(companyId: number, plan: CompanyPlan, suspended: boolean, notes: string | null): void {
  db.prepare("UPDATE companies SET plan = ?, suspended = ?, plan_notes = ? WHERE id = ?").run(
    plan,
    suspended ? 1 : 0,
    notes,
    companyId
  );
}

export interface CompanyAdminRow extends Company {
  member_count: number;
  conversation_count: number;
}

export function listCompaniesForAdmin(): CompanyAdminRow[] {
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM memberships m WHERE m.company_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM conversations co WHERE co.company_id = c.id) AS conversation_count
       FROM companies c ORDER BY c.name`
    )
    .all() as CompanyAdminRow[];
}

export interface CompanyUserRow {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
}

export function listCompanyUsers(companyId: number): CompanyUserRow[] {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.name, u.email, m.role, u.active
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.company_id = ? ORDER BY u.name`
    )
    .all(companyId) as CompanyUserRow[];
}

export function setUserActive(userId: number, active: boolean): void {
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, userId);
  if (!active) db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run(`%"userId":${userId}%`);
}
