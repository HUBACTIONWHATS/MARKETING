/**
 * Cadastro por convite, redefinição de senha por link e log de auditoria.
 *
 * Não existe serviço de e-mail (nada pago): o link é gerado na tela e quem
 * criou o convite entrega ao destinatário (WhatsApp, e-mail próprio, etc.).
 * O token só aparece em claro nesse link; no banco fica o hash SHA-256.
 */
import crypto from "crypto";
import { hashPassword } from "./auth";
import { db } from "./db";
import type { Role } from "./models";

export type TokenKind = "CONVITE" | "REDEFINICAO";

export interface AccessToken {
  id: number;
  kind: TokenKind;
  token_hash: string;
  email: string;
  company_id: number | null;
  role: Role | null;
  user_id: number | null;
  created_by_user_id: number | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const RESET_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Cria um convite para entrar numa empresa. Devolve o token em claro (uma única vez) para montar o link. */
export function createInvite(companyId: number, email: string, role: Role, createdByUserId: number): string {
  const token = newToken();
  const now = new Date();
  db.prepare(
    `INSERT INTO access_tokens (kind, token_hash, email, company_id, role, created_by_user_id, expires_at, created_at)
     VALUES ('CONVITE', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hashToken(token),
    email.trim().toLowerCase(),
    companyId,
    role,
    createdByUserId,
    new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    now.toISOString()
  );
  return token;
}

/** Cria um link de redefinição de senha para um usuário existente. */
export function createPasswordReset(userId: number, email: string, createdByUserId: number | null): string {
  const token = newToken();
  const now = new Date();
  db.prepare(
    `INSERT INTO access_tokens (kind, token_hash, email, user_id, created_by_user_id, expires_at, created_at)
     VALUES ('REDEFINICAO', ?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), email, userId, createdByUserId, new Date(now.getTime() + RESET_TTL_MS).toISOString(), now.toISOString());
  return token;
}

/** Busca um token válido (existente, não usado, não expirado) do tipo indicado. */
export function findValidToken(kind: TokenKind, token: string): AccessToken | undefined {
  const row = db.prepare("SELECT * FROM access_tokens WHERE kind = ? AND token_hash = ?").get(kind, hashToken(token)) as
    | AccessToken
    | undefined;
  if (!row || row.used_at) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  return row;
}

export interface AcceptInviteResult {
  ok: boolean;
  error?: string;
  userId?: number;
}

/**
 * Aceita um convite: cria o usuário (ou reaproveita se o e-mail já existir e
 * ainda não for membro) e associa à empresa com o perfil do convite. Uso único.
 */
export function acceptInvite(token: string, name: string, password: string): AcceptInviteResult {
  const invite = findValidToken("CONVITE", token);
  if (!invite || !invite.company_id || !invite.role) return { ok: false, error: "Convite inválido, já usado ou expirado." };
  if (password.length < 8) return { ok: false, error: "A senha precisa ter pelo menos 8 caracteres." };

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    let user = db.prepare("SELECT id FROM users WHERE email = ?").get(invite.email) as { id: number } | undefined;
    if (!user) {
      const info = db
        .prepare("INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, 0, 1, ?)")
        .run(name.trim(), invite.email, hashPassword(password), now);
      user = { id: Number(info.lastInsertRowid) };
    } else {
      // E-mail já cadastrado (ex.: convite para segunda empresa): a senha informada passa a valer.
      db.prepare("UPDATE users SET password_hash = ?, active = 1 WHERE id = ?").run(hashPassword(password), user.id);
    }
    const member = db
      .prepare("SELECT id FROM memberships WHERE user_id = ? AND company_id = ?")
      .get(user.id, invite.company_id);
    if (!member) {
      db.prepare("INSERT INTO memberships (user_id, company_id, role, created_at) VALUES (?, ?, ?, datetime('now'))").run(
        user.id,
        invite.company_id,
        invite.role
      );
    }
    db.prepare("UPDATE access_tokens SET used_at = ? WHERE id = ?").run(now, invite.id);
    return user.id;
  });
  const userId = tx();
  return { ok: true, userId };
}

export function completePasswordReset(token: string, password: string): AcceptInviteResult {
  const reset = findValidToken("REDEFINICAO", token);
  if (!reset || !reset.user_id) return { ok: false, error: "Link inválido, já usado ou expirado." };
  if (password.length < 8) return { ok: false, error: "A senha precisa ter pelo menos 8 caracteres." };
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), reset.user_id);
    db.prepare("UPDATE access_tokens SET used_at = ? WHERE id = ?").run(now, reset.id);
    // Sessões antigas desse usuário deixam de valer.
    db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run(`%"userId":${reset.user_id}%`);
  });
  tx();
  return { ok: true, userId: reset.user_id };
}

/** Convites ainda válidos de uma empresa (para o admin acompanhar quem ainda não entrou). */
export function listPendingInvites(companyId: number): { email: string; role: Role; expires_at: string }[] {
  return db
    .prepare(
      `SELECT email, role, expires_at FROM access_tokens
       WHERE kind = 'CONVITE' AND company_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY id DESC`
    )
    .all(companyId, new Date().toISOString()) as { email: string; role: Role; expires_at: string }[];
}

// --- Log de auditoria ---------------------------------------------------------

export interface AuditEntry {
  id: number;
  company_id: number | null;
  user_id: number | null;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
  user_name: string | null;
  company_name: string | null;
}

export function audit(action: string, opts: { companyId?: number | null; userId?: number | null; detail?: string; ip?: string }): void {
  db.prepare("INSERT INTO audit_log (company_id, user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    opts.companyId ?? null,
    opts.userId ?? null,
    action,
    opts.detail ?? null,
    opts.ip ?? null,
    new Date().toISOString()
  );
}

export function listAuditEntries(limit: number, companyId?: number): AuditEntry[] {
  const base = `SELECT a.*, u.name AS user_name, c.name AS company_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN companies c ON c.id = a.company_id`;
  if (companyId !== undefined) {
    return db.prepare(`${base} WHERE a.company_id = ? ORDER BY a.id DESC LIMIT ?`).all(companyId, limit) as AuditEntry[];
  }
  return db.prepare(`${base} ORDER BY a.id DESC LIMIT ?`).all(limit) as AuditEntry[];
}
