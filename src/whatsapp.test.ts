import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TEST_DB = path.join(__dirname, "..", "data", "test-whatsapp.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_whatsapp";
process.env.TEST_SCHEMA_RESET = "1";

type AttendanceModule = typeof import("./attendance.js");
type DbModule = typeof import("./db.js");
type WhatsappModule = typeof import("./whatsapp.js");

let A: AttendanceModule;
let Dbm: DbModule;
let W: WhatsappModule;
let companySeq = 0;

test.before(async () => {
  A = await import("./attendance.js");
  Dbm = await import("./db.js");
  W = await import("./whatsapp.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  companySeq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    `Empresa WA ${companySeq}`,
    `empresa-wa-${companySeq}`,
    new Date().toISOString()
  );
  return row!.id;
}

async function makeConnection(companyId: number, phoneNumberId: string): Promise<void> {
  await Dbm.db.run(
    "INSERT INTO whatsapp_connections (company_id, phone_number_id, environment, active, created_at) VALUES (?, ?, 'TESTE', 1, ?)",
    companyId,
    phoneNumberId,
    new Date().toISOString()
  );
}

// --- Assinatura do webhook ---------------------------------------------------

test("assinatura válida é aceita; corpo alterado ou segredo errado é rejeitado", () => {
  const secret = "segredo-de-teste";
  const body = Buffer.from(JSON.stringify({ a: 1, b: "mensagem" }));
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(W.verifyWebhookSignature(body, sig, secret), true);
  assert.equal(W.verifyWebhookSignature(Buffer.from(JSON.stringify({ a: 1, b: "adulterado" })), sig, secret), false);
  assert.equal(W.verifyWebhookSignature(body, sig, "segredo-errado"), false);
  assert.equal(W.verifyWebhookSignature(body, undefined, secret), false);
  assert.equal(W.verifyWebhookSignature(body, "assinatura-sem-prefixo", secret), false);
});

// --- Parsing do payload (formato oficial documentado) -----------------------

test("extrai mensagem de texto do payload oficial do webhook", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "1234567890" },
              contacts: [{ wa_id: "5511999998888", profile: { name: "Maria Cliente" } }],
              messages: [
                { id: "wamid.ABC123", from: "5511999998888", timestamp: "1700000000", type: "text", text: { body: "quero falar com atendente" } },
              ],
            },
          },
        ],
      },
    ],
  };

  const entries = W.parseWebhookPayload(payload);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].phoneNumberId, "1234567890");
  assert.equal(entries[0].messages.length, 1);
  const msg = entries[0].messages[0];
  assert.equal(msg.waMessageId, "wamid.ABC123");
  assert.equal(msg.fromPhone, "5511999998888");
  assert.equal(msg.contactName, "Maria Cliente");
  assert.equal(msg.body, "quero falar com atendente");
  assert.equal(msg.supported, true);
});

test("mensagem interativa (botão) vira texto do título; tipo não suportado vira aviso, não perde o evento", () => {
  const base = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" } } as any }] }] };

  const withButton = structuredClone(base);
  withButton.entry[0].changes[0].value.messages = [
    { id: "w1", from: "55119", timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "x", title: "Falar com atendente" } } },
  ];
  assert.equal(W.parseWebhookPayload(withButton)[0].messages[0].body, "Falar com atendente");
  assert.equal(W.parseWebhookPayload(withButton)[0].messages[0].supported, true);
  assert.equal(W.parseWebhookPayload(withButton)[0].messages[0].isInteractiveReply, true);

  const withImage = structuredClone(base);
  withImage.entry[0].changes[0].value.messages = [{ id: "w2", from: "55119", timestamp: "1", type: "image", image: { id: "media1" } }];
  const parsedImage = W.parseWebhookPayload(withImage)[0].messages[0];
  assert.equal(parsedImage.supported, false);
  assert.match(parsedImage.body, /não suportado/);
});

test("payload de outro objeto (não whatsapp_business_account) é ignorado sem erro", () => {
  assert.deepEqual(W.parseWebhookPayload({ object: "page", entry: [] }), []);
  assert.deepEqual(W.parseWebhookPayload(null), []);
  assert.deepEqual(W.parseWebhookPayload({}), []);
});

// --- Idempotência (reentrega do mesmo evento pela Meta) ----------------------

test("mesmo external_id não duplica mensagem nem reinicia a espera (webhook pode reentregar)", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente WA", "+55 11 90000-9001");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");

  const first = await A.addMessage({
    companyId,
    conversationId: conv.id,
    authorType: "CLIENTE",
    body: "quero atendente",
    externalId: "wamid.DUPLICADO",
  });
  const second = await A.addMessage({
    companyId,
    conversationId: conv.id,
    authorType: "CLIENTE",
    body: "quero atendente",
    externalId: "wamid.DUPLICADO",
  });

  assert.equal(first.id, second.id, "reentrega deveria devolver a mesma mensagem, não criar outra");
  const all = await A.listMessages(conv.id);
  assert.equal(all.length, 1, "não pode duplicar a mensagem no histórico");
  assert.equal((await A.listWaitEpisodes(conv.id)).length, 1, "não pode duplicar o episódio de espera");
});

test("conversa em aberto do mesmo contato é reaproveitada; contato encerrado abre uma nova", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Reaproveita", "+55 11 90000-9002");

  const conv1 = await A.findOrCreateOpenConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  const conv1Again = await A.findOrCreateOpenConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  assert.equal(conv1.id, conv1Again.id);

  await A.closeConversation(companyId, conv1.id);
  const conv2 = await A.findOrCreateOpenConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  assert.notEqual(conv2.id, conv1.id, "conversa encerrada não deveria ser reaproveitada");
});

test("status de entrega (ENTREGUE/LIDA) é gravado na mensagem enviada pelo wamid, só na empresa dona", async () => {
  const companyId = await makeCompany();
  const otherCompanyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Entrega", "+55 11 90000-9003");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", body: "olá", externalId: "wamid.OUT9" });

  await A.updateMessageDeliveryStatus(otherCompanyId, "wamid.OUT9", "LIDA"); // outra empresa não pode alterar
  assert.equal((await A.listMessages(conv.id))[0].delivery_status, null);

  await A.updateMessageDeliveryStatus(companyId, "wamid.OUT9", "ENTREGUE");
  assert.equal((await A.listMessages(conv.id))[0].delivery_status, "ENTREGUE");
});

// --- Envio sem credenciais -----------------------------------------------------

test("enviar sem WHATSAPP_ACCESS_TOKEN configurado recusa com erro claro, não tenta chamar a Meta", async () => {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  const result = await W.sendWhatsAppMessage("123", "+5511999998888", "oi");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /não configurado/);
});

// --- Status real da conexão (nunca "Conectado" só por campo preenchido) -----

function clearWhatsappEnv(): void {
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
}

function setFakeCredentials(): void {
  process.env.WHATSAPP_VERIFY_TOKEN = "v";
  process.env.WHATSAPP_APP_SECRET = "s";
  process.env.WHATSAPP_ACCESS_TOKEN = "t";
}

test("sem número associado: modo demonstração, mesmo com credenciais configuradas", async () => {
  clearWhatsappEnv();
  setFakeCredentials();
  const companyId = await makeCompany();

  const report = await W.buildConnectionStatusReport(companyId);
  assert.equal(report.mode, "DEMONSTRACAO");
  assert.equal(report.statusLabel, "Modo demonstração");
  assert.equal(report.connection, null);
  clearWhatsappEnv();
});

test("número associado mas credenciais ausentes: 'Configuração incompleta', nunca 'Conectado'", async () => {
  clearWhatsappEnv();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN1");

  const report = await W.buildConnectionStatusReport(companyId);
  assert.equal(report.statusLabel, "Configuração incompleta");
  assert.notEqual(report.statusLabel, "Conectado");
});

test("número associado e credenciais completas, nunca verificado: 'Ainda não verificado'", async () => {
  clearWhatsappEnv();
  setFakeCredentials();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN2");

  const report = await W.buildConnectionStatusReport(companyId);
  assert.equal(report.statusLabel, "Ainda não verificado");
  clearWhatsappEnv();
});

test("recordVerification grava o resultado real; status reflete sucesso e falha corretamente", async () => {
  clearWhatsappEnv();
  setFakeCredentials();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN3");

  await W.recordVerification("PN3", { ok: true, detail: "Confirmado pela Meta: +55 11 90000-0000." });
  assert.equal((await W.buildConnectionStatusReport(companyId)).statusLabel, "Verificado pela Meta");

  await W.recordVerification("PN3", { ok: false, detail: "Token expirado." });
  const failReport = await W.buildConnectionStatusReport(companyId);
  assert.equal(failReport.statusLabel, "Falha na última verificação");
  assert.ok(failReport.pendencies.some((p) => p.includes("Token expirado")));
  clearWhatsappEnv();
});

test("evidências reais: última mensagem recebida/enviada só aparecem quando existem de verdade (com wamid)", async () => {
  clearWhatsappEnv();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN4");

  const reportBefore = await W.buildConnectionStatusReport(companyId);
  assert.equal(reportBefore.lastInbound, null);
  assert.equal(reportBefore.lastOutbound, null);
  assert.ok(reportBefore.pendencies.some((p) => p.includes("Nenhuma mensagem real de cliente")));

  const contact = await A.findOrCreateContact(companyId, "Cliente Evidencia", "+55 11 90000-9999");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO", "WHATSAPP_OFICIAL");
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "oi", externalId: "wamid.IN1" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", body: "olá!", externalId: "wamid.OUT1" });

  const reportAfter = await W.buildConnectionStatusReport(companyId);
  assert.ok(reportAfter.lastInbound);
  assert.ok(reportAfter.lastOutbound);
});

test("a pendência sobre o robô/atendimento atual não comprovado aparece sempre, mesmo tudo verificado", async () => {
  clearWhatsappEnv();
  setFakeCredentials();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN5");
  await W.recordVerification("PN5", { ok: true, detail: "ok" });

  const report = await W.buildConnectionStatusReport(companyId);
  assert.ok(report.pendencies.some((p) => p.includes("robô/atendimento atual") && p.includes("não foi comprovada")));
  clearWhatsappEnv();
});

test("verificar conexão sem token de acesso não chama a Meta e recusa com erro claro", async () => {
  clearWhatsappEnv();
  const result = await W.verifyPhoneNumberConnection("qualquer-id");
  assert.equal(result.ok, false);
  assert.match(result.detail, /não configurado/);
});

test("upsertConnection reatribui um número já cadastrado e mantém a unicidade do phone_number_id", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  await W.upsertConnection(companyA, "PN-REUSO", null, "+55 11 1", "TESTE");
  await W.upsertConnection(companyB, "PN-REUSO", "WABA", "+55 11 2", "PRODUCAO");
  const found = await W.findConnectionByPhoneNumberId("PN-REUSO");
  assert.equal(found?.company_id, companyB);
  assert.equal(found?.environment, "PRODUCAO");
  assert.equal((await W.listConnectionsForCompany(companyA)).length, 0);
});
