/**
 * Associa um número real do WhatsApp (phone_number_id da Cloud API) a uma
 * empresa do Hub Action. Uso administrativo, rodado por quem tem acesso ao
 * servidor — não existe tela para isso ainda (ver CONEXAO_WHATSAPP.md).
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
  console.log("Lembrete: isso só faz efeito de verdade se WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET e");
  console.log("WHATSAPP_ACCESS_TOKEN também estiverem configurados no .env e o webhook cadastrado no Meta for Developers.");
  console.log('Na tela Configurações → Conexão do WhatsApp, use "Verificar agora" para confirmar de verdade com a Meta.');
  await db.close();
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
