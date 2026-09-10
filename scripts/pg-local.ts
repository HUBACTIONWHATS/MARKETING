/**
 * PostgreSQL local de verdade (binários oficiais via `embedded-postgres`,
 * dependência só de desenvolvimento) para testar a aplicação no mesmo motor
 * que o piloto (Neon), sem instalar nada no sistema.
 *
 *   npm run test:pg   → sobe um Postgres temporário, roda a suíte inteira nele e derruba tudo
 *   npm run dev:pg    → sobe um Postgres local persistente (data/pg-local) e imprime o
 *                       DATABASE_URL para rodar `npm run dev` / `npm run db:seed` contra ele
 *
 * Nada aqui toca em Neon, Render ou qualquer serviço externo.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PG_LOCAL_PORT || 54329);
const USER = "postgres";
const PASSWORD = "password";

async function startPostgres(databaseDir: string, persistent: boolean) {
  const mod = await import("embedded-postgres");
  const EmbeddedPostgres = mod.default;
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent,
    onLog: () => undefined,
    onError: (msg: unknown) => {
      const text = String(msg);
      if (!/^\s*$/.test(text)) console.error("[pg-local]", text.trim());
    },
  });
  const alreadyInitialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  return pg;
}

function urlFor(database: string): string {
  return `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${database}`;
}

async function runTests(): Promise<number> {
  const databaseDir = path.join(ROOT, "data", "pg-test");
  fs.rmSync(databaseDir, { recursive: true, force: true });
  const pg = await startPostgres(databaseDir, false);
  try {
    await pg.createDatabase("hubaction_test");
    const testFiles = fs
      .readdirSync(path.join(ROOT, "src"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => path.join("src", f));
    const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    console.log(`[pg-local] Postgres de teste na porta ${PORT}; rodando ${testFiles.length} arquivos de teste...`);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [tsxCli, "--test", ...testFiles], {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: urlFor("hubaction_test"),
          DATABASE_SSL: "disable",
          DATABASE_FILE: "",
        },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
    return code;
  } finally {
    await pg.stop();
    fs.rmSync(databaseDir, { recursive: true, force: true });
  }
}

async function serve(): Promise<void> {
  const databaseDir = path.join(ROOT, "data", "pg-local");
  const pg = await startPostgres(databaseDir, true);
  try {
    await pg.createDatabase("hubaction");
  } catch {
    // já existe (execuções anteriores) — tudo bem
  }
  console.log("[pg-local] Postgres local no ar. Em outro terminal, rode com:");
  console.log(`  DATABASE_URL=${urlFor("hubaction")}`);
  console.log("  DATABASE_SSL=disable");
  console.log("(no PowerShell: $env:DATABASE_URL='...'; $env:DATABASE_SSL='disable'; npm run dev). Ctrl+C aqui derruba o banco.");
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => undefined); // fica no ar até Ctrl+C
}

const mode = process.argv[2];
(mode === "serve" ? serve() : runTests().then((code) => process.exit(code))).catch((err) => {
  console.error("[pg-local] falhou:", err);
  process.exit(1);
});
