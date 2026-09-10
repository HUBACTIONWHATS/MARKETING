/**
 * Associa um número real do WhatsApp (phone_number_id da Cloud API) a uma
 * empresa do Hub Action. Uso administrativo, rodado por quem tem acesso ao
 * servidor — não existe tela para isso ainda (ver CONEXAO_WHATSAPP.md).
 *
 * Uso:
 *   npx tsx src/conectar-whatsapp.ts <slug-da-empresa> <phone_number_id> [waba_id] [numero_exibido]
 *
 * Exemplo:
 *   npx tsx src/conectar-whatsapp.ts empresa-demo-a 123456789012345 987654321098765 "+55 11 91234-5678"
 */
import "./env";
import { db, runMigrations } from "./db";
import { upsertConnection } from "./whatsapp";

function main(): void {
  const [slug, phoneNumberId, wabaId, displayPhoneNumber] = process.argv.slice(2);
  if (!slug || !phoneNumberId) {
    console.error("Uso: npx tsx src/conectar-whatsapp.ts <slug-da-empresa> <phone_number_id> [waba_id] [numero_exibido]");
    process.exit(1);
  }

  runMigrations();

  const company = db.prepare("SELECT id, name FROM companies WHERE slug = ?").get(slug) as
    | { id: number; name: string }
    | undefined;
  if (!company) {
    console.error(`Empresa com slug "${slug}" não encontrada.`);
    process.exit(1);
  }

  upsertConnection(company.id, phoneNumberId, wabaId || null, displayPhoneNumber || null);
  console.log(`OK: phone_number_id ${phoneNumberId} associado à empresa "${company.name}" (id ${company.id}).`);
  console.log("Lembrete: isso só faz efeito de verdade se WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET e");
  console.log("WHATSAPP_ACCESS_TOKEN também estiverem configurados no .env e o webhook cadastrado no Meta for Developers.");
}

main();
