/**
 * Atalho de linha de comando, só para desenvolvimento/demonstração local:
 * associa um phone_number_id a uma empresa SEM Access Token (não cifra nada).
 * Uso real, com credencial de verdade, é pela tela administrativa segura
 * (/admin/whatsapp, exclusiva do administrador geral) — ver
 * createCompanyConnection em whatsapp.ts e o passo a passo em
 * CONEXAO_WHATSAPP.md. Continua existindo porque é uma forma rápida de testar
 * o roteamento do webhook sem preencher credencial nenhuma.
 *
 * Uso:
 *   npx tsx src/conectar-whatsapp.ts <slug-da-empresa> <phone_number_id> [teste|producao] [waba_id] [numero_exibido]
 *
 * O ambiente (teste/produção) é sempre declarado por quem conecta — nunca
 * adivinhado pelo formato do número. Padrão: teste (mais seguro).
 *
 * Exemplo:
 *   npx tsx src/conectar-whatsapp.ts empresa-demo-a 123456789012345 teste 987654321098765 "+55 11 91234-5678"
 */
import "./env";
import { db, runMigrations } from "./db";
import { upsertConnection, type WhatsappEnvironment } from "./whatsapp";

async function main(): Promise<void> {
  const [slug, phoneNumberId, envArg, wabaId, displayPhoneNumber] = process.argv.slice(2);
  if (!slug || !phoneNumberId) {
    console.error(
      "Uso: npx tsx src/conectar-whatsapp.ts <slug-da-empresa> <phone_number_id> [teste|producao] [waba_id] [numero_exibido]"
    );
    process.exit(1);
  }
  if (envArg && envArg !== "teste" && envArg !== "producao") {
    console.error('O terceiro argumento, se usado, precisa ser exatamente "teste" ou "producao".');
    process.exit(1);
  }
  const environment: WhatsappEnvironment = envArg === "producao" ? "PRODUCAO" : "TESTE";

  await runMigrations();

  const company = await db.get<{ id: number; name: string }>("SELECT id, name FROM companies WHERE slug = ?", slug);
  if (!company) {
    console.error(`Empresa com slug "${slug}" não encontrada.`);
    process.exit(1);
  }

  await upsertConnection(company.id, phoneNumberId, wabaId || null, displayPhoneNumber || null, environment);
  console.log(
    `OK: phone_number_id ${phoneNumberId} associado à empresa "${company.name}" (id ${company.id}), ambiente ${environment}.`
  );
  console.log("Lembrete: isso só cadastra o roteamento do webhook (sem Access Token, sem cifrar nada).");
  console.log("Para uma conexão de verdade (com token, validada e ativável), use a tela /admin/whatsapp,");
  console.log("exclusiva do administrador geral — ela também exige WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET");
  console.log("e CREDENTIAL_ENCRYPTION_KEY configurados no .env do servidor.");
  await db.close();
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
