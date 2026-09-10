import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, "dev.sqlite3");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/** Aplica migrações em migrations/*.sql que ainda não constam em _migrations. */
export function runMigrations(): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: string }[]).map((r) => r.id)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(file);
    });
    apply();
    console.log(`Migração aplicada: ${file}`);
  }
}
