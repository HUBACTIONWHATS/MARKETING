/**
 * Store de sessão do express-session gravado no próprio banco (tabela
 * `sessions`). A MemoryStore padrão não serve para produção: perde todas as
 * sessões a cada reinício e vaza memória. Sem dependência nova.
 */
import session from "express-session";
import { db } from "./db";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export class SqliteSessionStore extends session.Store {
  private lastPurge = 0;

  private purgeExpired(): void {
    const now = Date.now();
    if (now - this.lastPurge < 60_000) return; // no máximo uma limpeza por minuto
    this.lastPurge = now;
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  }

  private expiresAt(sess: session.SessionData): number {
    const cookieExpires = sess.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    const maxAge = sess.cookie?.maxAge;
    return Date.now() + (typeof maxAge === "number" ? maxAge : DEFAULT_TTL_MS);
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      this.purgeExpired();
      const row = db.prepare("SELECT sess, expires_at FROM sessions WHERE sid = ?").get(sid) as
        | { sess: string; expires_at: number }
        | undefined;
      if (!row || row.expires_at < Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      db.prepare(
        "INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at"
      ).run(sid, JSON.stringify(sess), this.expiresAt(sess));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    try {
      db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(this.expiresAt(sess), sid);
    } finally {
      callback?.();
    }
  }
}
