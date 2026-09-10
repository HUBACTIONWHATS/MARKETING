/**
 * Store de sessão do express-session gravado no próprio banco (tabela
 * `sessions`, funciona em SQLite e PostgreSQL). A MemoryStore padrão não
 * serve para produção: perde todas as sessões a cada reinício e vaza memória.
 * Sem dependência nova.
 */
import session from "express-session";
import { db } from "./db";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export class SqliteSessionStore extends session.Store {
  private lastPurge = 0;

  private async purgeExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurge < 60_000) return; // no máximo uma limpeza por minuto
    this.lastPurge = now;
    await db.run("DELETE FROM sessions WHERE expires_at < ?", now);
  }

  private expiresAt(sess: session.SessionData): number {
    const cookieExpires = sess.cookie?.expires;
    if (cookieExpires) return new Date(cookieExpires).getTime();
    const maxAge = sess.cookie?.maxAge;
    return Date.now() + (typeof maxAge === "number" ? maxAge : DEFAULT_TTL_MS);
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    (async () => {
      await this.purgeExpired();
      const row = await db.get<{ sess: string; expires_at: number }>("SELECT sess, expires_at FROM sessions WHERE sid = ?", sid);
      if (!row || Number(row.expires_at) < Date.now()) return null;
      return JSON.parse(row.sess) as session.SessionData;
    })().then(
      (sess) => callback(null, sess),
      (err) => callback(err)
    );
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    db.run(
      "INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?) ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at",
      sid,
      JSON.stringify(sess),
      this.expiresAt(sess)
    ).then(
      () => callback?.(),
      (err) => callback?.(err)
    );
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    db.run("DELETE FROM sessions WHERE sid = ?", sid).then(
      () => callback?.(),
      (err) => callback?.(err)
    );
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    db.run("UPDATE sessions SET expires_at = ? WHERE sid = ?", this.expiresAt(sess), sid).then(
      () => callback?.(),
      () => callback?.()
    );
  }
}
