import { db } from "./db";

export type Role = "COMPANY_ADMIN" | "AGENT";

export interface Company {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  is_platform_admin: number; // 0 | 1 (SQLite não tem boolean nativo)
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
