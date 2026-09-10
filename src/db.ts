/**
 * Camada de acesso ao banco — uma única API assíncrona, dois motores:
 *
 * - SQLite (better-sqlite3): padrão para desenvolvimento local e testes.
 *   Usado quando DATABASE_URL não está definida. Arquivo em DATABASE_FILE
 *   (padrão data/dev.sqlite3).
 * - PostgreSQL (pg): produção/piloto (Neon). Usado quando DATABASE_URL está
 *   definida (postgres://...).
 *
 * As regras de negócio (attendance, crm, dashboard, models, ...) escrevem SQL
 * portável e chamam só db.get / db.all / db.run / db.exec / db.transaction —
 * nunca um driver direto. Diferenças de dialeto ficam aqui:
 * - placeholders: o código usa `?`; para o Postgres viram `$1, $2, ...`.
 * - ids gerados: todo INSERT que precisa do id usa `RETURNING id` (funciona nos dois).
 * - COUNT/SUM no Postgres chegam como texto (bigint/numeric): convertidos para número.
 * - schema/migrações: migrations/sqlite/*.sql e migrations/postgres/*.sql
 *   (DDL é diferente por dialeto; as regras de negócio não).
 */
import fs from "fs";
import path from "path";

export type Dialect = "sqlite" | "postgres";

export interface RunResult {
  changes: number;
}

export interface DbClient {
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  /** Vários comandos DDL de uma vez (migrações). Sem parâmetros. */
  exec(sql: string): Promise<void>;
}

export interface Db extends DbClient {
  readonly dialect: Dialect;
  /** Executa fn dentro de BEGIN/COMMIT (ROLLBACK se lançar). Use o `tx` recebido para as consultas. */
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// --- SQLite -------------------------------------------------------------------

function createSqliteDb(file: string): Db {
  // require dinâmico: em produção com Postgres o better-sqlite3 nem precisa carregar.
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  // As chamadas são síncronas e resolvem em microtask: um bloco `transaction`
  // que só faz await de operações deste banco não intercala com outras
  // requisições (nenhum I/O real acontece entre BEGIN e COMMIT).
  const client: DbClient = {
    async get(sql, ...params) {
      return raw.prepare(sql).get(...params) as any;
    },
    async all(sql, ...params) {
      return raw.prepare(sql).all(...params) as any[];
    },
    async run(sql, ...params) {
      const info = raw.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };

  let inTransaction = false;
  return {
    ...client,
    dialect: "sqlite",
    async transaction(fn) {
      if (inTransaction) return fn(client); // transação aninhada: reaproveita a externa
      inTransaction = true;
      raw.exec("BEGIN");
      try {
        const result = await fn(client);
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      } finally {
        inTransaction = false;
      }
    },
    async close() {
      raw.close();
    },
  };
}

// --- PostgreSQL ---------------------------------------------------------------

/** Troca cada `?` fora de aspas simples por `$1`, `$2`, ... */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (ch === "?" && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function createPostgresDb(connectionString: string): Db {
  const pg = require("pg") as typeof import("pg");
  // COUNT/SUM (bigint) e numeric chegam como string por padrão — o código espera número.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  pg.types.setTypeParser(1700, (v: string) => Number(v));

  const url = new URL(connectionString);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const sslMode = process.env.DATABASE_SSL ?? (isLocal ? "disable" : "require");
  const searchPath = process.env.TEST_SCHEMA; // isolamento por arquivo de teste (ver runMigrations)
  // A string da Neon vem com `?sslmode=require&channel_binding=require`. O TLS
  // é decidido aqui (opção `ssl` abaixo) e channel binding não existe no
  // driver `pg`; tira os dois para não haver ambiguidade sobre o que vale.
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");

  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode !== "no-verify" },
    options: searchPath ? `-c search_path=${searchPath}` : undefined,
  });
  pool.on("error", (err) => console.error("[db] erro no pool do Postgres:", err.message));

  function bind(q: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }): DbClient {
    return {
      async get(sql, ...params) {
        const res = await q.query(toPgPlaceholders(sql), params);
        return res.rows[0];
      },
      async all(sql, ...params) {
        const res = await q.query(toPgPlaceholders(sql), params);
        return res.rows;
      },
      async run(sql, ...params) {
        const res = await q.query(toPgPlaceholders(sql), params);
        return { changes: res.rowCount ?? 0 };
      },
      async exec(sql) {
        await q.query(sql);
      },
    };
  }

  return {
    ...bind(pool),
    dialect: "postgres",
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(bind(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

// --- Seleção por variável de ambiente -----------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_FILE = process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "dev.sqlite3");

export const db: Db = DATABASE_URL ? createPostgresDb(DATABASE_URL) : createSqliteDb(DATABASE_FILE);

// --- Migrações ------------------------------------------------------------------

/** Aplica migrations/<dialeto>/*.sql que ainda não constam em _migrations, em ordem. */
export async function runMigrations(): Promise<void> {
  if (db.dialect === "postgres" && process.env.TEST_SCHEMA) {
    const schema = process.env.TEST_SCHEMA;
    if (!/^test_[a-z0-9_]+$/.test(schema)) throw new Error("TEST_SCHEMA precisa começar com test_ (só para testes).");
    if (process.env.TEST_SCHEMA_RESET === "1") await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }

  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  const migrationsDir = path.join(__dirname, "..", "migrations", db.dialect);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = new Set((await db.all<{ id: string }>("SELECT id FROM _migrations")).map((r) => r.id));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", file, new Date().toISOString());
    });
    console.log(`Migração aplicada (${db.dialect}): ${file}`);
  }
}
