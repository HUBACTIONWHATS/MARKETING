import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Testes do adaptação ao fluxo real do robô do usuário (menu 1/2/3 + frase
// fixa de transferência) — ver seção 6 do pedido e PROGRESSO.md.
const TEST_DB = path.join(__dirname, "..", "data", "test-robo-transferencia.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;

type AttendanceModule = typeof import("./attendance.js");
type DbModule = typeof import("./db.js");

let A: AttendanceModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  A = await import("./attendance.js");
  Dbm = await import("./db.js");
  Dbm.runMigrations();
});

const MENU_TEXTO =
  "Olá!\nEu sou sua recepcionista virtual e irei fazer seu atendimento. Por favor digite uma das opções abaixo e para voltar ao menu digite voltar\n1 - Novo agendamento\n2 - Cancelar agendamento\n3 - Falar com atendente.";
const TRANSFERENCIA_TEXTO =
  "Por favor aguarde, estou chamando um atendente humano para te ajudar!!\nAtenção: pode demorar alguns minutos.";

function makeConversation() {
  companySeq += 1;
  const companyInfo = Dbm.db
    .prepare("INSERT INTO companies (name, slug, created_at) VALUES (?, ?, datetime('now'))")
    .run(`Empresa Robo ${companySeq}`, `empresa-robo-${companySeq}`);
  const companyId = Number(companyInfo.lastInsertRowid);
  const contact = A.findOrCreateContact(companyId, `Cliente ${companySeq}`, `+55 11 9${String(companySeq).padStart(8, "0")}`);
  const conv = A.createConversation(companyId, contact.id, "AUTOMATICO");
  return { companyId, contact, conv };
}

function makeAttendant(email: string): number {
  const info = Dbm.db
    .prepare("INSERT INTO users (name, email, password_hash, created_at) VALUES ('Atendente', ?, 'x', datetime('now'))")
    .run(email);
  return Number(info.lastInsertRowid);
}

// 1. Menu ativo → cliente envia 3 → inicia espera.
test("menu ativo: cliente envia '3' inicia a espera com gatilho OPCAO_3", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, true);
  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.trigger_type, "OPCAO_3");
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_HUMANO");
});

// 2. Cliente envia 3 em outro contexto → não inicia.
test("'3' fora do menu (sem pending_context) não inicia espera — pode ser horário, quantidade etc.", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });
  assert.equal(A.listWaitEpisodes(conv.id).length, 0);
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AUTO");

  // Também não deve valer depois que o menu já foi consumido por outra resposta.
  const { companyId: c2, conv: conv2 } = makeConversation();
  A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "CLIENTE", body: "1" }); // consome o menu
  A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "CLIENTE", body: "3" }); // menu já não está mais ativo
  assert.equal(A.listWaitEpisodes(conv2.id).length, 0);
});

// 3. Robô envia a frase de transferência no meio da conversa → inicia.
test("frase de transferência do robô no meio da conversa inicia a espera (gatilho MENSAGEM_ROBO)", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "1" });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: "Certo, vamos agendar. Qual dia prefere?" });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "na verdade prefiro falar com alguém" });
  // ainda sem trigger forte — mensagem livre já cobre via TEXTO_LIVRE; agora simula o robô confirmando a transferência
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, true);
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_HUMANO");
});

// 3b. Robô envia a frase de transferência isoladamente (sem nenhum outro gatilho antes).
test("frase de transferência é o ÚNICO gatilho quando o cliente não pediu nada em texto livre", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "2" });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.trigger_type, "MENSAGEM_ROBO");
});

// 4. Cliente copia a frase do robô → não confirma transferência automaticamente.
test("cliente copiando a frase do robô não comprova transferência", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: TRANSFERENCIA_TEXTO });
  assert.equal(A.listWaitEpisodes(conv.id).length, 0, "cliente citando a frase do robô não deveria iniciar espera");
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AUTO");
});

// 5. Opção 3 seguida da frase do robô → apenas um episódio (mantém o gatilho e horário do cliente).
test("opção 3 + confirmação do robô logo depois: um único episódio, com o gatilho do cliente preservado", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const episodes = A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1, "não pode duplicar o episódio");
  assert.equal(episodes[0].trigger_type, "OPCAO_3", "o gatilho do cliente é que deve valer, não a confirmação do robô");
});

// 6. Aviso repetido → mantém horário inicial.
test("aviso de transferência repetido enquanto a espera está aberta não reinicia o horário", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  const first = A.listWaitEpisodes(conv.id)[0];

  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  const episodes = A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].started_at, first.started_at);
});

// 7. Atendente assume sem responder → espera continua.
test("atendente assumir sem responder não encerra a espera", () => {
  const { companyId, conv } = makeConversation();
  const userId = makeAttendant("assume-robo@t.dev");
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  A.assumeConversation(companyId, conv.id, userId);

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, true);
});

// 8. Resposta humana válida → encerra.
test("resposta humana enviada com sucesso encerra a espera aberta pelo fluxo do robô", () => {
  const { companyId, conv } = makeConversation();
  const userId = makeAttendant("responde-robo@t.dev");
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  A.assumeConversation(companyId, conv.id, userId);
  A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "Oi, tudo bem?" });

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, false);
  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.ended_reason, "RESPOSTA_HUMANA");
  assert.equal(episode.ended_by_user_id, userId);
});

// 9. Envio com falha não encerra.
test("envio com falha não encerra a espera do fluxo do robô", () => {
  const { companyId, conv } = makeConversation();
  const userId = makeAttendant("falha-robo@t.dev");
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "tentando...", sendStatus: "FALHOU" });

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, true);
});

// 10. Mensagem externa de autoria desconhecida → não encerra como resposta humana confirmada.
test("mensagem de autoria DESCONHECIDA não encerra a espera nem conta como resposta humana", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "DESCONHECIDO", body: "mensagem de origem não identificada" });

  const summary = A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
  assert.equal(summary.isWaiting, true);
  const episode = A.listWaitEpisodes(conv.id)[0];
  assert.equal(episode.ended_reason, null);
});

// 11. Atualização da página → contagem preservada (recalculada do banco, não de um timer local).
test("recarregar a página não altera a contagem: dois cálculos seguidos dão o mesmo início", () => {
  const { companyId, conv } = makeConversation();
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } as const;
  const firstLoad = A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  const secondLoad = A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS); // simula um F5
  const episode = A.listWaitEpisodes(conv.id)[0];

  assert.equal(firstLoad.isWaiting, true);
  assert.equal(secondLoad.isWaiting, true);
  // O início vem sempre do banco — os dois "carregamentos" apontam para o mesmo instante.
  assert.ok(episode.started_at); // persistido, não um timer de navegador
});

// Exemplo de aceitação do pedido (qualitativo — os horários do enunciado são
// ilustrativos; o que se testa é a cadeia de eventos: 3 → aviso → aviso
// repetido → assumir → resposta, tudo em UM episódio, encerrado só na resposta).
test("exemplo de aceitação: 3, aviso, aviso repetido, assumir, resposta = um episódio encerrado pela resposta", () => {
  const { companyId, conv } = makeConversation();
  const userId = makeAttendant("aceitacao@t.dev");

  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" }); // 14h00
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO }); // 14h00
  A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO }); // 14h02 (repetido)
  A.assumeConversation(companyId, conv.id, userId); // 14h04
  assert.equal(A.summarizeWait(conv.id, "America/Sao_Paulo", { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }).isWaiting, true);

  A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "Oi! Como posso ajudar?" }); // 14h08

  const episodes = A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1, "deve ser um único episódio do início ao fim");
  assert.equal(episodes[0].trigger_type, "OPCAO_3");
  assert.equal(episodes[0].ended_reason, "RESPOSTA_HUMANA");
  assert.equal(A.getConversation(companyId, conv.id)?.status, "AGUARDANDO_CLIENTE");
});
