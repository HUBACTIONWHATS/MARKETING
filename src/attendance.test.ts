import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Banco isolado só para este teste — nunca mexe em data/dev.sqlite3.
// Importante: os módulos de dados são importados via import() dinâmico dentro
// de test.before(), porque um `import` estático é resolvido/hoistado antes
// deste arquivo rodar, o que abriria a conexão com o banco padrão antes de
// definirmos DATABASE_FILE aqui embaixo. No Postgres (DATABASE_URL definida),
// TEST_SCHEMA isola este arquivo num schema próprio, recriado a cada execução.
const TEST_DB = path.join(__dirname, "..", "data", "test-attendance.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_attendance";
process.env.TEST_SCHEMA_RESET = "1";

type AttendanceModule = typeof import("./attendance.js");
type DbModule = typeof import("./db.js");
type BusinessHoursModule = typeof import("./businessHours.js");

let A: AttendanceModule;
let Dbm: DbModule;
let HOURS: ReturnType<BusinessHoursModule["defaultBusinessHours"]>;
let companySeq = 0;

test.before(async () => {
  A = await import("./attendance.js");
  Dbm = await import("./db.js");
  const BH: BusinessHoursModule = await import("./businessHours.js");
  await Dbm.runMigrations();
  HOURS = BH.defaultBusinessHours();
});

test.after(async () => {
  await Dbm.db.close();
});

async function makeCompany(): Promise<number> {
  companySeq += 1;
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    `Empresa Teste ${companySeq}`,
    `empresa-teste-${companySeq}`,
    new Date().toISOString()
  );
  return row!.id;
}

test("banco de teste está isolado do banco de desenvolvimento", () => {
  assert.equal(process.env.DATABASE_FILE, TEST_DB);
  assert.notEqual(TEST_DB, path.join(__dirname, "..", "data", "dev.sqlite3"));
});

test("detecção de pedido de atendente por texto, considerando negações", async () => {
  const { detectHumanRequest } = A;
  assert.equal(detectHumanRequest("quero falar com um atendente"), true);
  assert.equal(detectHumanRequest("preciso de um humano agora"), true);
  assert.equal(detectHumanRequest("me chama um supervisor"), true);
  assert.equal(detectHumanRequest("não quero atendente"), false);
  assert.equal(detectHumanRequest("não, sem atendente por favor"), false);
  assert.equal(detectHumanRequest("qual o preço do plano?"), false);
});

test("robô não encerra a espera", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Robo", "+55 11 90000-0001");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "oi, quero falar com atendente" });
  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, true, "pedido deveria iniciar espera");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: "Mensagem automática de teste." });
  const afterBot = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(afterBot.isWaiting, true, "resposta do robô não deveria encerrar a espera");
  assert.equal((await A.listWaitEpisodes(conv.id)).length, 1, "não deveria criar novo episódio");
});

test("assumir atendimento não encerra a espera", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Assumir", "+55 11 90000-0002");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente" });
  const user = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, created_at) VALUES ('Ag', 'ag@t.dev', 'x', ?) RETURNING id",
    new Date().toISOString()
  );
  const userId = user!.id;

  await A.assumeConversation(companyId, conv.id, userId);

  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, true, "assumir não deveria encerrar a espera");
  assert.equal((await A.getConversation(companyId, conv.id))?.assigned_user_id, userId);
});

test("envio com falha não encerra a espera", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Falha", "+55 11 90000-0003");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "atendente por favor" });
  await A.addMessage({
    companyId,
    conversationId: conv.id,
    authorType: "HUMANO",
    body: "tentando responder...",
    sendStatus: "FALHOU",
  });

  const wait = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(wait.isWaiting, true, "falha no envio não deveria encerrar a espera");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_HUMANO", "status não deveria mudar em caso de falha");
});

test("pedido repetido não reinicia o cronômetro", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Repetido", "+55 11 90000-0004");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente" });
  const firstEpisode = (await A.listWaitEpisodes(conv.id))[0];

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente de novo" });
  const episodesAfterRepeat = await A.listWaitEpisodes(conv.id);

  assert.equal(episodesAfterRepeat.length, 1, "pedido repetido não deveria criar novo episódio");
  assert.equal(episodesAfterRepeat[0].started_at, firstEpisode.started_at, "started_at não deveria mudar");
});

test("resposta humana enviada com sucesso encerra a espera", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Resolvido", "+55 11 90000-0005");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero falar com atendente" });
  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, true);

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", body: "Olá, como posso ajudar?" });

  const wait = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(wait.isWaiting, false, "resposta humana enviada deveria encerrar a espera");
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.ended_reason, "RESPOSTA_HUMANA");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_CLIENTE");
});

test("modo manual: primeira mensagem do cliente já inicia a espera (sem robô)", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Manual", "+55 11 90000-0006");
  const conv = await A.createConversation(companyId, contact.id, "MANUAL");

  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, false);
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "oi, preciso de ajuda com meu pedido" });
  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, true);
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_HUMANO");
});

test("encerrar atendimento fecha a espera aberta como ENCERRADO_SEM_RESPOSTA (não conta como resposta humana)", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Encerrado", "+55 11 90000-0008");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente" });
  await A.closeConversation(companyId, conv.id);

  const summary = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(summary.isWaiting, false, "conversa encerrada não pode continuar 'aguardando agora'");
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.ended_reason, "ENCERRADO_SEM_RESPOSTA");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "ENCERRADO");

  // Reabrir com novo pedido cria um episódio novo, sem herdar o anterior.
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "voltei, quero atendente" });
  assert.equal((await A.listWaitEpisodes(conv.id)).length, 2);
  assert.equal((await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting, true);
});

test("autoria desconhecida nunca é tratada como humana (não encerra espera)", async () => {
  const companyId = await makeCompany();
  const contact = await A.findOrCreateContact(companyId, "Cliente Desconhecido", "+55 11 90000-0007");
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "atendente, por favor" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "DESCONHECIDO", body: "evento de origem não identificada" });

  assert.equal(
    (await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS)).isWaiting,
    true,
    "autoria desconhecida não pode encerrar a espera"
  );
});
