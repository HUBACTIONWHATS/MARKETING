/**
 * Carrega o arquivo .env (se existir) para process.env, usando a API nativa
 * do Node (sem dependência nova). Sem .env, segue normalmente em modo
 * simulado — só a integração com WhatsApp real fica desativada.
 * Precisa ser o primeiro import de quem inicia o processo (server.ts, seed.ts).
 */
import path from "path";

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
