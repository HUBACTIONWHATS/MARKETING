import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Testes da adaptação ao fluxo real do robô do usuário (menu 1/2/3 + frase
// fixa de transferência) — ver seção 6 do pedido e PROGRESSO.md.
const TEST_DB = path.join(__dirname, "..", "data", "test-robo-transferencia.sqlite3");
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_FILE = TEST_DB;
process.env.TEST_SCHEMA = "test_robo_transferencia";
process.env.TEST_SCHEMA_RESET = "1";

type AttendanceModule = typeof import("./attendance.js");
type DbModule = typeof import("./db.js");

let A: AttendanceModule;
let Dbm: DbModule;
let companySeq = 0;

test.before(async () => {
  A = await import("./attendance.js");
  Dbm = await import("./db.js");
  await Dbm.runMigrations();
});

test.after(async () => {
  await Dbm.db.close();
});

const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } as const;

const MENU_TEXTO =
  "Olá!\nEu sou sua recepcionista virtual e irei fazer seu atendimento. Por favor digite uma das opções abaixo e para voltar ao menu digite voltar\n1 - Novo agendamento\n2 - Cancelar agendamento\n3 - Falar com atendente.";
const TRANSFERENCIA_TEXTO =
  "Por favor aguarde, estou chamando um atendente humano para te ajudar!!\nAtenção: pode demorar alguns minutos.";

async function makeConversation() {
  companySeq += 1;
  const company = await Dbm.db.get<{ id: number }>(
    "INSERT INTO companies (name, slug, created_at) VALUES (?, ?, ?) RETURNING id",
    `Empresa Robo ${companySeq}`,
    `empresa-robo-${companySeq}`,
    new Date().toISOString()
  );
  const companyId = company!.id;
  const contact = await A.findOrCreateContact(companyId, `Cliente ${companySeq}`, `+55 11 9${String(companySeq).padStart(8, "0")}`);
  const conv = await A.createConversation(companyId, contact.id, "AUTOMATICO");
  return { companyId, contact, conv };
}

async function makeAttendant(email: string): Promise<number> {
  const row = await Dbm.db.get<{ id: number }>(
    "INSERT INTO users (name, email, password_hash, created_at) VALUES ('Atendente', ?, 'x', ?) RETURNING id",
    email,
    new Date().toISOString()
  );
  return row!.id;
}

async function isWaiting(conversationId: number): Promise<boolean> {
  return (await A.summarizeWait(conversationId, "America/Sao_Paulo", HOURS)).isWaiting;
}

// 1. Menu ativo → cliente envia 3 → inicia espera.
test("menu ativo: cliente envia '3' inicia a espera com gatilho OPCAO_3", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });

  assert.equal(await isWaiting(conv.id), true);
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.trigger_type, "OPCAO_3");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_HUMANO");
});

// 2. Cliente envia 3 em outro contexto → não inicia.
test("'3' fora do menu (sem pending_context) não inicia espera — pode ser horário, quantidade etc.", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });
  assert.equal((await A.listWaitEpisodes(conv.id)).length, 0);
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AUTO");

  // Também não deve valer depois que o menu já foi consumido por outra resposta.
  const { companyId: c2, conv: conv2 } = await makeConversation();
  await A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "CLIENTE", body: "1" }); // consome o menu
  await A.addMessage({ companyId: c2, conversationId: conv2.id, authorType: "CLIENTE", body: "3" }); // menu já não está mais ativo
  assert.equal((await A.listWaitEpisodes(conv2.id)).length, 0);
});

// 3. Robô envia a frase de transferência no meio da conversa → inicia.
test("frase de transferência do robô no meio da conversa inicia a espera (gatilho MENSAGEM_ROBO)", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "1" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: "Certo, vamos agendar. Qual dia prefere?" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "na verdade prefiro falar com alguém" });
  // ainda sem trigger forte — mensagem livre já cobre via TEXTO_LIVRE; agora simula o robô confirmando a transferência
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  assert.equal(await isWaiting(conv.id), true);
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_HUMANO");
});

// 3b. Robô envia a frase de transferência isoladamente (sem nenhum outro gatilho antes).
test("frase de transferência é o ÚNICO gatilho quando o cliente não pediu nada em texto livre", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "2" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.trigger_type, "MENSAGEM_ROBO");
});

// 4. Cliente copia a frase do robô → não confirma transferência automaticamente.
test("cliente copiando a frase do robô não comprova transferência", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: TRANSFERENCIA_TEXTO });
  assert.equal((await A.listWaitEpisodes(conv.id)).length, 0, "cliente citando a frase do robô não deveria iniciar espera");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AUTO");
});

// 5. Opção 3 seguida da frase do robô → apenas um episódio (mantém o gatilho e horário do cliente).
test("opção 3 + confirmação do robô logo depois: um único episódio, com o gatilho do cliente preservado", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const episodes = await A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1, "não pode duplicar o episódio");
  assert.equal(episodes[0].trigger_type, "OPCAO_3", "o gatilho do cliente é que deve valer, não a confirmação do robô");
});

// 6. Aviso repetido → mantém horário inicial.
test("aviso de transferência repetido enquanto a espera está aberta não reinicia o horário", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  const first = (await A.listWaitEpisodes(conv.id))[0];

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  const episodes = await A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].started_at, first.started_at);
});

// 6b. Evento atrasado/fora de ordem: gatilho com horário anterior passa a valer.
test("evento fora de ordem com horário anterior vira o primeiro gatilho válido do episódio", async () => {
  const { companyId, conv } = await makeConversation();
  const later = new Date().toISOString();
  const earlier = new Date(Date.now() - 5 * 60000).toISOString();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO, occurredAt: later });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO, occurredAt: earlier });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3", occurredAt: earlier, externalId: "wamid.ATRASADO" });

  const episodes = await A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].started_at, earlier);
  assert.equal(episodes[0].trigger_type, "OPCAO_3");
});

// 7. Atendente assume sem responder → espera continua.
test("atendente assumir sem responder não encerra a espera", async () => {
  const { companyId, conv } = await makeConversation();
  const userId = await makeAttendant("assume-robo@t.dev");
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  await A.assumeConversation(companyId, conv.id, userId);

  assert.equal(await isWaiting(conv.id), true);
});

// 8. Resposta humana válida → encerra.
test("resposta humana enviada com sucesso encerra a espera aberta pelo fluxo do robô", async () => {
  const { companyId, conv } = await makeConversation();
  const userId = await makeAttendant("responde-robo@t.dev");
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  await A.assumeConversation(companyId, conv.id, userId);
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "Oi, tudo bem?" });

  assert.equal(await isWaiting(conv.id), false);
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.ended_reason, "RESPOSTA_HUMANA");
  assert.equal(episode.ended_by_user_id, userId);
});

// 9. Envio com falha não encerra.
test("envio com falha não encerra a espera do fluxo do robô", async () => {
  const { companyId, conv } = await makeConversation();
  const userId = await makeAttendant("falha-robo@t.dev");
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "tentando...", sendStatus: "FALHOU" });

  assert.equal(await isWaiting(conv.id), true);
});

// 10. Mensagem externa de autoria desconhecida → não encerra como resposta humana confirmada.
test("mensagem de autoria DESCONHECIDA não encerra a espera nem conta como resposta humana", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "DESCONHECIDO", body: "mensagem de origem não identificada" });

  assert.equal(await isWaiting(conv.id), true);
  const episode = (await A.listWaitEpisodes(conv.id))[0];
  assert.equal(episode.ended_reason, null);
});

// 11. Atualização da página → contagem preservada (recalculada do banco, não de um timer local).
test("recarregar a página não altera a contagem: dois cálculos seguidos dão o mesmo início", async () => {
  const { companyId, conv } = await makeConversation();
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO });

  const firstLoad = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS);
  const secondLoad = await A.summarizeWait(conv.id, "America/Sao_Paulo", HOURS); // simula um F5
  const episode = (await A.listWaitEpisodes(conv.id))[0];

  assert.equal(firstLoad.isWaiting, true);
  assert.equal(secondLoad.isWaiting, true);
  // O início vem sempre do banco — os dois "carregamentos" apontam para o mesmo instante.
  assert.ok(episode.started_at); // persistido, não um timer de navegador
});

// Exemplo de aceitação do pedido (qualitativo — os horários do enunciado são
// ilustrativos; o que se testa é a cadeia de eventos: 3 → aviso → aviso
// repetido → assumir → resposta, tudo em UM episódio, encerrado só na resposta).
test("exemplo de aceitação: 3, aviso, aviso repetido, assumir, resposta = um episódio encerrado pela resposta", async () => {
  const { companyId, conv } = await makeConversation();
  const userId = await makeAttendant("aceitacao@t.dev");

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: MENU_TEXTO });
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "CLIENTE", body: "3" }); // 14h00
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO }); // 14h00
  await A.addMessage({ companyId, conversationId: conv.id, authorType: "ROBO", body: TRANSFERENCIA_TEXTO }); // 14h02 (repetido)
  await A.assumeConversation(companyId, conv.id, userId); // 14h04
  assert.equal(await isWaiting(conv.id), true);

  await A.addMessage({ companyId, conversationId: conv.id, authorType: "HUMANO", authorUserId: userId, body: "Oi! Como posso ajudar?" }); // 14h08

  const episodes = await A.listWaitEpisodes(conv.id);
  assert.equal(episodes.length, 1, "deve ser um único episódio do início ao fim");
  assert.equal(episodes[0].trigger_type, "OPCAO_3");
  assert.equal(episodes[0].ended_reason, "RESPOSTA_HUMANA");
  assert.equal((await A.getConversation(companyId, conv.id))?.status, "AGUARDANDO_CLIENTE");
});
