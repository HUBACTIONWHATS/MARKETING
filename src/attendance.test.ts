import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Banco isolado só para este teste — nunca mexe em data/dev.sqlite3.
// Importante: os módulos de dados são importados via import() dinâmico dentro
// de test.before(), porque um `import` estático é resolvido/hoistado antes
// deste arquivo rodar, o que abriria a conexão com o banco padrão antes de
// definirmos DATABASE_FILE aqui embaixo.
const TEST_DB = path.join(__dirname, "..", "data", "test-attendance.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;

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
  Dbm.runMigrations();
  HOURS = BH.defaultBusinessHours();
});

function makeCompany(): number {
  companySeq += 1;
  const info = Dbm.db
    .prepare("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, datetime('now'))")
    .run(`Empresa Teste ${companySeq}`, `empresa-teste-${companySeq}`);
  return Number(info.lastInsertRowid);
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

test("robô não encerra a espera", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Robo", "+55 11 90000-0001");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "oi, quero falar com atendente" });
  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting, true, "pedido deveria iniciar espera");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: "Mensagem automática de teste." });
  const afterBot = A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(afterBot.isWaiting, true, "resposta do robô não deveria encerrar a espera");
  assert.equal(A.listWaitEpisodes(conv.id).length, 1, "não deveria criar novo episódio");
});

test("assumir atendimento não encerra a espera", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Assumir", "+55 11 90000-0002");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente" });
  const info = Dbm.db
    .prepare("INSERT INTO users (name, email, password_hash, created_at) VALUES ('Ag', 'ag@t.dev', 'x', datetime('now'))")
    .run();
  const userId = Number(info.lastInsertRowid);

  A.assumeConversation(companyId, conv.id, userId);

  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting, true, "assumir não deveria encerrar a espera");
  assert.equal(A.getConversation(companyId, conv.id)?.assigned_user_id, userId);
});

test("envio com falha não encerra a espera", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Falha", "+55 11 90000-0003");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "atendente por favor" });
  A.addMessage({
    companyId,
    conversationId: conv.id,
    authorType: "HUMANO",
    body: "tentando responder...",
    sendStatus: "FALHOU",
  });

  const wait = A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(wait.isWaiting, true, "falha no envio não deveria encerrar a espera");
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_HUMANO", "status não deveria mudar em caso de falha");
});

test("pedido repetido não reinicia o cronômetro", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Repetido", "+55 11 90000-0004");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente" });
  const firstEpisode = A.listWaitEpisodes(conv.id)[0];

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero atendente de novo" });
  const episodesAfterRepeat = A.listWaitEpisodes(conv.id);

  assert.equal(episodesAfterRepeat.length, 1, "pedido repetido não deveria criar novo episódio");
  assert.equal(episodesAfterRepeat[0].started_at, firstEpisode.started_at, "started_at não deveria mudar");
});

test("resposta humana enviada com sucesso encerra a espera", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Resolvido", "+55 11 90000-0005");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "quero falar com atendente" });
  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting, true);

  A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", body: "Olá, como posso ajudar?" });

  const wait = A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  assert.equal(wait.isWaiting, false, "resposta humana enviada deveria encerrar a espera");
  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.ended_reason, "RESPOSTA_HUMANA");
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_CLIENTE");
});

test("modo manual: primeira mensagem do cliente já inicia a espera (sem robô)", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Manual", "+55 11 90000-0006");
  const conv = A.createConversation(companyId, contact.id, "MANUAL");

  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting, false);
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "oi, preciso de ajuda com meu pedido" });
  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting, true);
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_HUMANO");
});

test("autoria desconhecida nunca é tratada como humana (não encerra espera)", () => {
  const companyId = makeCompany();
  const contact = A.findOrCreateContact(companyId, "Cliente Desconhecido", "+55 11 90000-0007");
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "atendente, por favor" });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "DESCONHECIDO", body: "evento de origem não identificada" });

  assert.equal(
    A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS).isWaiting,
    true,
    "autoria desconhecida não pode encerrar a espera"
  );
});
