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
export async function createInvite(companyId: number, email: string, role: Role, createdByUserId: number): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db.run(
    `INSERT INTO access_tokens (kind, token_hash, email, company_id, role, created_by_user_id, expires_at, created_at)
     VALUES ('CONVITE', ?, ?, ?, ?, ?, ?, ?)`,
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
export async function createPasswordReset(userId: number, email: string, createdByUserId: number | null): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db.run(
    `INSERT INTO access_tokens (kind, token_hash, email, user_id, created_by_user_id, expires_at, created_at)
     VALUES ('REDEFINICAO', ?, ?, ?, ?, ?, ?)`,
    hashToken(token),
    email,
    userId,
    createdByUserId,
    new Date(now.getTime() + RESET_TTL_MS).toISOString(),
    now.toISOString()
  );
  return token;
}

/** Busca um token válido (existente, não usado, não expirado) do tipo indicado. */
export async function findValidToken(kind: TokenKind, token: string): Promise<AccessToken | undefined> {
  const row = await db.get<AccessToken>("SELECT * FROM access_tokens WHERE kind = ? AND token_hash = ?", kind, hashToken(token));
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
export async function acceptInvite(token: string, name: string, password: string): Promise<AcceptInviteResult> {
  const invite = await findValidToken("CONVITE", token);
  if (!invite || !invite.company_id || !invite.role) return { ok: false, error: "Convite inválido, já usado ou expirado." };
  if (password.length < 8) return { ok: false, error: "A senha precisa ter pelo menos 8 caracteres." };

  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    let user = await tx.get<{ id: number }>("SELECT id FROM users WHERE email = ?", invite.email);
    if (!user) {
      user = await tx.get<{ id: number }>(
        "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, 0, 1, ?) RETURNING id",
        name.trim(),
        invite.email,
        passwordHash,
        now
      );
    } else {
      // E-mail já cadastrado (ex.: convite para segunda empresa): a senha informada passa a valer.
      await tx.run("UPDATE users SET password_hash = ?, active = 1 WHERE id = ?", passwordHash, user.id);
    }
    const member = await tx.get("SELECT id FROM memberships WHERE user_id = ? AND company_id = ?", user!.id, invite.company_id);
    if (!member) {
      await tx.run(
        "INSERT INTO memberships (user_id, company_id, role, created_at) VALUES (?, ?, ?, ?)",
        user!.id,
        invite.company_id,
        invite.role,
        now
      );
    }
    await tx.run("UPDATE access_tokens SET used_at = ? WHERE id = ?", now, invite.id);
    return user!.id;
  });
  return { ok: true, userId };
}

export async function completePasswordReset(token: string, password: string): Promise<AcceptInviteResult> {
  const reset = await findValidToken("REDEFINICAO", token);
  if (!reset || !reset.user_id) return { ok: false, error: "Link inválido, já usado ou expirado." };
  if (password.length < 8) return { ok: false, error: "A senha precisa ter pelo menos 8 caracteres." };
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, reset.user_id);
    await tx.run("UPDATE access_tokens SET used_at = ? WHERE id = ?", now, reset.id);
    // Sessões antigas desse usuário deixam de valer.
    await tx.run("DELETE FROM sessions WHERE sess LIKE ?", `%"userId":${reset.user_id}%`);
  });
  return { ok: true, userId: reset.user_id };
}

/** Convites ainda válidos de uma empresa (para o admin acompanhar quem ainda não entrou). */
export function listPendingInvites(companyId: number): Promise<{ email: string; role: Role; expires_at: string }[]> {
  return db.all<{ email: string; role: Role; expires_at: string }>(
    `SELECT email, role, expires_at FROM access_tokens
     WHERE kind = 'CONVITE' AND company_id = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY id DESC`,
    companyId,
    new Date().toISOString()
  );
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

export async function audit(
  action: string,
  opts: { companyId?: number | null; userId?: number | null; detail?: string; ip?: string }
): Promise<void> {
  await db.run(
    "INSERT INTO audit_log (company_id, user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    opts.companyId ?? null,
    opts.userId ?? null,
    action,
    opts.detail ?? null,
    opts.ip ?? null,
    new Date().toISOString()
  );
}

export function listAuditEntries(limit: number, companyId?: number): Promise<AuditEntry[]> {
  const base = `SELECT a.*, u.name AS user_name, c.name AS company_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN companies c ON c.id = a.company_id`;
  if (companyId !== undefined) {
    return db.all<AuditEntry>(`${base} WHERE a.company_id = ? ORDER BY a.id DESC LIMIT ?`, companyId, limit);
  }
  return db.all<AuditEntry>(`${base} ORDER BY a.id DESC LIMIT ?`, limit);
}
