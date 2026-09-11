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
// Chave de teste (nunca usada fora deste processo) — sem ela createCompanyConnection/
// replaceConnectionToken/testCompanyConnection não conseguem cifrar/decifrar nada.
process.env.CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

type AttendanceModule = typeof import("./attendance.js");
type AuthModule = typeof import("./auth.js");
type DbModule = typeof import("./db.js");
type WhatsappModule = typeof import("./whatsapp.js");

let A: AttendanceModule;
let Auth: AuthModule;
let Dbm: DbModule;
let W: WhatsappModule;
let companySeq = 0;
let userSeq = 0;

test.before(async () => {
  A = await import("./attendance.js");
  Auth = await import("./auth.js");
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

async function makeUser(isPlatformAdmin: boolean): Promise<number> {
  userSeq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, is_platform_admin, active, created_at) VALUES (?, ?, ?, ?, 1, ?) RETURNING id",
    `Usuário WA ${userSeq}`,
    `usuario-wa-${userSeq}@teste.dev`,
    "hash-nao-usado-neste-teste",
    isPlatformAdmin ? 1 : 0,
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

/** Mock temporário de fetch global — restaura o original ao final, mesmo se o teste falhar. */
async function withFakeFetch<T>(impl: (url: string, init?: any) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  (global as any).fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
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

// --- Roteamento por phone_number_id: número desconhecido/desativado --------

test("findConnectionByPhoneNumberId não encontra número desconhecido nem número desativado (webhook trata os dois como 'sem empresa')", async () => {
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN-ROTEIO");

  assert.equal(await W.findConnectionByPhoneNumberId("PN-INEXISTENTE"), undefined);

  assert.ok(await W.findConnectionByPhoneNumberId("PN-ROTEIO"));
  await W.deactivateConnection(companyId);
  assert.equal(await W.findConnectionByPhoneNumberId("PN-ROTEIO"), undefined, "desativada deveria parar de rotear, igual a desconhecida");
});

// --- Envio: token vem sempre do chamador (decifrado), nunca de variável global

test("enviar sem token recusa com erro claro, não tenta chamar a Meta", async () => {
  const result = await W.sendWhatsAppMessage(undefined, "123", "+5511999998888", "oi", "v23.0");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /não configurado/);
});

// --- Status real da conexão (nunca "Conectado" só por campo preenchido) -----

function clearWebhookEnv(): void {
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_APP_SECRET;
}

function setFakeWebhookEnv(): void {
  process.env.WHATSAPP_VERIFY_TOKEN = "v";
  process.env.WHATSAPP_APP_SECRET = "s";
}

test("sem conexão cadastrada: modo demonstração, mesmo com credenciais globais configuradas", async () => {
  clearWebhookEnv();
  setFakeWebhookEnv();
  const companyId = await makeCompany();

  const report = await W.buildConnectionStatusReport(companyId);
  assert.equal(report.mode, "DEMONSTRACAO");
  assert.equal(report.statusLabel, "Modo demonstração");
  assert.equal(report.connection, null);
  clearWebhookEnv();
});

test("conexão cadastrada sem token: status Pendente, nunca Conectado", async () => {
  clearWebhookEnv();
  const companyId = await makeCompany();
  await makeConnection(companyId, "PN1");

  const report = await W.buildConnectionStatusReport(companyId);
  assert.equal(report.statusLabel, "Pendente");
  assert.notEqual(report.statusLabel, "Conectado");
});

test("computeConnectionStatus: pendente sem token; em validação com token (nunca testada, ou testada ok mas ainda não ativa); erro após falha; conectado só com sucesso + active=1 ao mesmo tempo", () => {
  const base = { access_token_encrypted: null, waba_id: "W1", phone_number_id: "P1", active: 1, last_verified_ok: null };
  assert.equal(W.computeConnectionStatus(base), "PENDENTE");
  assert.equal(W.computeConnectionStatus({ ...base, access_token_encrypted: "cifrado" }), "EM_VALIDACAO");
  assert.equal(W.computeConnectionStatus({ ...base, access_token_encrypted: "cifrado", last_verified_ok: 0 }), "ERRO");
  assert.equal(W.computeConnectionStatus({ ...base, access_token_encrypted: "cifrado", last_verified_ok: 1 }), "CONECTADO");
  // Testada com sucesso mas ainda não ativada (active=0, recém-criada ou recém-testada) — "em validação", não "desativado".
  assert.equal(W.computeConnectionStatus({ ...base, access_token_encrypted: "cifrado", last_verified_ok: 1, active: 0 }), "EM_VALIDACAO");
  // "Desativado" nunca sai daqui — é um estado só da ação explícita deactivateConnection (testado à parte).
});

test("evidências reais: última mensagem recebida/enviada só aparecem quando existem de verdade (com wamid)", async () => {
  clearWebhookEnv();
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

test("a pendência sobre o robô/atendimento atual não comprovado aparece sempre, mesmo tudo verificado e ativado", async () => {
  clearWebhookEnv();
  setFakeWebhookEnv();
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA5", phoneNumberId: "PN5", accessToken: "tok-5", environment: "TESTE" });
  await withFakeFetch(
    async () => ({ ok: true, json: async () => ({ data: [{ id: "PN5", display_phone_number: "+55 11 90000-0000", verified_name: "Empresa 5" }] }) }),
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  await W.activateConnection(companyId);

  const report = await W.buildConnectionStatusReport(companyId);
  assert.ok(report.pendencies.some((p) => p.includes("robô/atendimento atual") && p.includes("não foi comprovada")));
  clearWebhookEnv();
});

// --- Área administrativa: cadastro, criptografia, teste, ativação ----------

test("createCompanyConnection cifra o token (nunca grava texto puro) e rejeita cadastro duplicado para a mesma empresa", async () => {
  const companyId = await makeCompany();
  const plainToken = "token-super-secreto-123";
  const result = await W.createCompanyConnection(companyId, { wabaId: "WABA6", phoneNumberId: "PN6", accessToken: plainToken, environment: "TESTE" });
  assert.equal(result.ok, true);

  const row = await W.findConnectionByCompanyId(companyId);
  assert.ok(row?.access_token_encrypted);
  assert.notEqual(row!.access_token_encrypted, plainToken);
  assert.ok(!row!.access_token_encrypted!.includes(plainToken), "o valor gravado não pode conter o token em texto puro");
  assert.equal(row!.status, "EM_VALIDACAO", "token presente + WABA/phone presentes, mas ainda não testado");

  const second = await W.createCompanyConnection(companyId, { wabaId: "WABA6B", phoneNumberId: "PN6B", accessToken: "outro", environment: "TESTE" });
  assert.equal(second.ok, false);
  assert.match(second.error ?? "", /já tem uma conexão/);
});

test("createCompanyConnection rejeita phone_number_id já usado por outra empresa (nunca reatribui em silêncio)", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const okA = await W.createCompanyConnection(companyA, { wabaId: "WABA-A", phoneNumberId: "PN-CONFLITO", accessToken: "tok-a", environment: "TESTE" });
  assert.equal(okA.ok, true);

  const failB = await W.createCompanyConnection(companyB, { wabaId: "WABA-B", phoneNumberId: "PN-CONFLITO", accessToken: "tok-b", environment: "TESTE" });
  assert.equal(failB.ok, false);
  assert.match(failB.error ?? "", /já está cadastrado/);
  assert.equal(await W.findConnectionByCompanyId(companyB), undefined);
});

test("toAdminViewModel nunca inclui o token cifrado, mesmo internamente", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA7", phoneNumberId: "PN7", accessToken: "outro-token-secreto", environment: "TESTE" });
  const row = await W.findConnectionByCompanyId(companyId);
  const view = W.toAdminViewModel(row!);
  assert.equal((view as any).access_token_encrypted, undefined);
  assert.equal(view.hasAccessToken, true);
  assert.ok(!JSON.stringify(view).includes("outro-token-secreto"));
});

test("replaceConnectionToken troca o token, invalida a última validação e nunca grava o texto puro", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA8", phoneNumberId: "PN8", accessToken: "token-antigo", environment: "TESTE" });
  await withFakeFetch(
    async () => ({ ok: true, json: async () => ({ data: [{ id: "PN8", display_phone_number: "+55 11 90000-1111", verified_name: "Empresa 8" }] }) }),
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  assert.equal((await W.findConnectionByCompanyId(companyId))?.last_verified_ok, 1);

  const result = await W.replaceConnectionToken(companyId, "token-novo-secreto");
  assert.equal(result.ok, true);
  const row = await W.findConnectionByCompanyId(companyId);
  assert.ok(!row!.access_token_encrypted!.includes("token-novo-secreto"));
  assert.equal(row!.last_verified_ok, null, "token novo ainda não foi testado — validação anterior não vale mais");
  assert.equal(row!.status, "EM_VALIDACAO");
});

test("testCompanyConnection: sucesso confirma dados reais da Meta (WABA e Phone Number compatíveis); falha mantém Pendente/Erro, nunca Conectado", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA9", phoneNumberId: "PN9", accessToken: "tok-9", environment: "PRODUCAO" });

  const ok = await withFakeFetch(
    async (url: string) => {
      assert.match(url, /WABA9\/phone_numbers/);
      return { ok: true, json: async () => ({ data: [{ id: "PN9", display_phone_number: "+55 11 98888-0000", verified_name: "Empresa 9", quality_rating: "GREEN" }] }) };
    },
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.displayPhoneNumber, "+55 11 98888-0000");
  const afterOk = await W.findConnectionByCompanyId(companyId);
  assert.equal(afterOk?.display_phone_number, "+55 11 98888-0000");
  assert.equal(afterOk?.verified_name, "Empresa 9");
  assert.equal(afterOk?.quality_rating, "GREEN");
  assert.equal(afterOk?.status, "EM_VALIDACAO", "sucesso no teste não ativa sozinho — Ativar é uma ação separada");

  const fail = await withFakeFetch(
    async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Token expirado" } }) }),
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /Token expirado/);
  assert.equal((await W.findConnectionByCompanyId(companyId))?.status, "ERRO");
});

test("testCompanyConnection recusa quando o Phone Number ID não pertence ao WABA ID informado (incompatíveis)", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA10", phoneNumberId: "PN10-ERRADO", accessToken: "tok-10", environment: "TESTE" });

  const result = await withFakeFetch(
    async () => ({ ok: true, json: async () => ({ data: [{ id: "PN10-OUTRO", display_phone_number: "+55 11 1" }] }) }),
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  assert.equal(result.ok, false);
  assert.match(result.detail, /não pertence/);
});

test("activateConnection exige teste com sucesso antes de ativar; deactivateConnection sempre permitido e reversível", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA11", phoneNumberId: "PN11", accessToken: "tok-11", environment: "TESTE" });

  const tooEarly = await W.activateConnection(companyId);
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.error ?? "", /Teste a conexão/);

  await withFakeFetch(
    async () => ({ ok: true, json: async () => ({ data: [{ id: "PN11", display_phone_number: "+55 11 90000-2222" }] }) }),
    () => W.testCompanyConnection(companyId, "v23.0")
  );
  const activated = await W.activateConnection(companyId);
  assert.equal(activated.ok, true);
  assert.equal((await W.findConnectionByCompanyId(companyId))?.status, "CONECTADO");

  const deactivated = await W.deactivateConnection(companyId);
  assert.equal(deactivated.ok, true);
  const afterDeactivate = await W.findConnectionByCompanyId(companyId);
  assert.equal(afterDeactivate?.status, "DESATIVADO");
  assert.equal(afterDeactivate?.active, 0);
});

// --- Isolamento entre empresas: ações de uma nunca afetam a outra ----------

test("isolamento: testar, ativar e desativar a conexão de uma empresa nunca altera a de outra", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  await W.createCompanyConnection(companyA, { wabaId: "WABA-ISO-A", phoneNumberId: "PN-ISO-A", accessToken: "tok-iso-a", environment: "TESTE" });
  await W.createCompanyConnection(companyB, { wabaId: "WABA-ISO-B", phoneNumberId: "PN-ISO-B", accessToken: "tok-iso-b", environment: "TESTE" });

  await withFakeFetch(
    async () => ({ ok: true, json: async () => ({ data: [{ id: "PN-ISO-A", display_phone_number: "+55 11 90000-3333" }] }) }),
    () => W.testCompanyConnection(companyA, "v23.0")
  );
  await W.activateConnection(companyA);

  const b = await W.findConnectionByCompanyId(companyB);
  assert.equal(b?.status, "EM_VALIDACAO", "empresa B não deveria ter sido tocada pela ativação/teste da empresa A");
  assert.equal(b?.last_verified_ok, null);
  assert.equal(b?.display_phone_number, null);

  await W.deactivateConnection(companyA);
  const aAfter = await W.findConnectionByCompanyId(companyA);
  const bAfter = await W.findConnectionByCompanyId(companyB);
  assert.equal(aAfter?.status, "DESATIVADO");
  assert.notEqual(bAfter?.status, "DESATIVADO", "desativar A não pode desativar B");
});

test("isolamento: findConnectionByCompanyId de uma empresa nunca devolve a conexão de outra", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  await makeConnection(companyA, "PN-VIS-A");
  await makeConnection(companyB, "PN-VIS-B");

  assert.equal((await W.findConnectionByCompanyId(companyA))?.phone_number_id, "PN-VIS-A");
  assert.equal((await W.findConnectionByCompanyId(companyB))?.phone_number_id, "PN-VIS-B");
});

test("upsertConnection (CLI de demonstração) reatribui um número já cadastrado e mantém a unicidade do phone_number_id", async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  await W.upsertConnection(companyA, "PN-REUSO", null, "+55 11 1", "TESTE");
  await W.upsertConnection(companyB, "PN-REUSO", "WABA", "+55 11 2", "PRODUCAO");
  const found = await W.findConnectionByPhoneNumberId("PN-REUSO");
  assert.equal(found?.company_id, companyB);
  assert.equal(found?.environment, "PRODUCAO");
  assert.equal((await W.listConnectionsForCompany(companyA)).length, 0);
});

// --- Auditoria: nunca grava o segredo -----------------------------------------

test("nenhuma ação administrativa grava o token em texto puro no log de auditoria", async () => {
  const Access = await import("./access.js");
  const companyId = await makeCompany();
  const platformAdminId = await makeUser(true);
  const plainToken = "TOKEN-QUE-NUNCA-PODE-VAZAR";

  await W.createCompanyConnection(companyId, { wabaId: "WABA-AUDIT", phoneNumberId: "PN-AUDIT", accessToken: plainToken, environment: "TESTE" });
  await Access.audit("whatsapp_credencial_cadastrada", { companyId, userId: platformAdminId, detail: "WABA WABA-AUDIT, ambiente TESTE" });
  await W.replaceConnectionToken(companyId, "TOKEN-SUBSTITUTO-QUE-TAMBEM-NUNCA-PODE-VAZAR");
  await Access.audit("whatsapp_credencial_substituida", { companyId, userId: platformAdminId, detail: "token substituído" });

  const entries = await Access.listAuditEntries(50, companyId);
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes(plainToken));
  assert.ok(!serialized.includes("TOKEN-SUBSTITUTO-QUE-TAMBEM-NUNCA-PODE-VAZAR"));
});

// --- Permissão por perfil: só administrador da plataforma -------------------

test("requirePlatformAdmin bloqueia usuário comum (403), sem chamar next", async () => {
  const normalUserId = await makeUser(false);
  const req: any = { session: { userId: normalUserId } };
  let statusCode: number | undefined;
  const res: any = {
    locals: {},
    redirect: () => {},
    status(code: number) {
      statusCode = code;
      return this;
    },
    send() {
      return this;
    },
  };
  let nextCalled = false;
  await Auth.requirePlatformAdmin(req, res, () => {
    nextCalled = true;
  });
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requirePlatformAdmin libera administrador da plataforma", async () => {
  const adminId = await makeUser(true);
  const req: any = { session: { userId: adminId } };
  const res: any = { locals: {}, redirect: () => {}, status() { return this; }, send() { return this; } };
  let nextCalled = false;
  await Auth.requirePlatformAdmin(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

// --- Persistência: nada fica em memória, tudo lido de volta do banco --------

test("dados cadastrados persistem numa leitura nova (sem cache em memória) — equivalente a sobreviver a um reinício", async () => {
  const companyId = await makeCompany();
  await W.createCompanyConnection(companyId, { wabaId: "WABA-PERSIST", phoneNumberId: "PN-PERSIST", accessToken: "tok-persist", environment: "PRODUCAO" });
  // Simula uma requisição nova, sem nada em memória do passo anterior: refaz a consulta do zero.
  const reread = await Dbm.db.get<{ waba_id: string; environment: string }>(
    "SELECT waba_id, environment FROM whatsapp_connections WHERE company_id = ?",
    companyId
  );
  assert.equal(reread?.waba_id, "WABA-PERSIST");
  assert.equal(reread?.environment, "PRODUCAO");
});
