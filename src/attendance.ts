import type { BusinessHours } from "./businessHours";
import { businessMinutesBetween } from "./businessHours";
import { db } from "./db";

export type ConversationStatus = "AUTO" | "AGUARDANDO_HUMANO" | "HUMANO" | "AGUARDANDO_CLIENTE" | "ENCERRADO";
export type ConversationMode = "AUTOMATICO" | "MANUAL";
export type AuthorType = "CLIENTE" | "ROBO" | "HUMANO" | "AUTOMACAO" | "DESCONHECIDO";
export type SendStatus = "ENVIADA" | "FALHOU";
export type DeliveryStatus = "ENTREGUE" | "LIDA";
/** Contexto de conversa pendente de resposta do cliente (ex.: menu do robô aguardando escolha). */
export type PendingContext = "MENU_PRINCIPAL";

/**
 * Gatilho que iniciou um episódio de espera — ver detectTrigger() e
 * addMessage(). Cada valor corresponde a um dos gatilhos A–D do fluxo real
 * do robô, mais os dois gatilhos genéricos que já existiam (texto livre e
 * modo manual).
 */
export type WaitTriggerType =
  | "OPCAO_3" // cliente respondeu "3" com o menu ativo
  | "BOTAO_PLATAFORMA" // botão oficial da plataforma cujo id/título é "falar com atendente"
  | "MENSAGEM_ROBO" // robô enviou a frase fixa de transferência
  | "EVENTO_PLATAFORMA" // evento explícito de transferência da integração (nenhum fornecedor atual oferece isso)
  | "TEXTO_LIVRE" // heurística de palavras-chave em mensagem livre do cliente
  | "MODO_MANUAL"; // conversa sem robô: qualquer mensagem do cliente já é espera

export interface Contact {
  id: number;
  company_id: number;
  name: string;
  phone: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  company_id: number;
  contact_id: number;
  channel: string;
  mode: ConversationMode;
  status: ConversationStatus;
  assigned_user_id: number | null;
  created_at: string;
  updated_at: string;
  pending_context: PendingContext | null;
}

export interface Message {
  id: number;
  company_id: number;
  conversation_id: number;
  author_type: AuthorType;
  author_user_id: number | null;
  body: string;
  send_status: SendStatus;
  created_at: string;
  external_id: string | null;
  delivery_status: DeliveryStatus | null;
}

export interface WaitEpisode {
  id: number;
  company_id: number;
  conversation_id: number;
  started_at: string;
  ended_at: string | null;
  ended_reason: "RESPOSTA_HUMANA" | "ENCERRADO_SEM_RESPOSTA" | null;
  ended_by_user_id: number | null;
  created_at: string;
  trigger_type: WaitTriggerType | null;
  trigger_evidence: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Detecção de pedido de atendente por texto (regras, sem IA) -----------

const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /atendente/i,
  /\bhumano\b/i,
  /pessoa\s+(real|de\s+verdade)/i,
  /falar\s+com\s+(algu[eé]m|uma\s+pessoa)/i,
  /\bsupervisor\b/i,
];

// Negações que cancelam um pedido detectado acima (ex.: "não quero atendente").
const NEGATION_PATTERNS: RegExp[] = [
  /n[aã]o\s+(quero|preciso|precisa|desejo)?\s*(falar\s+com\s+)?(um[a]?\s+)?(atendente|humano|pessoa|supervisor)/i,
  /sem\s+(atendente|humano|supervisor)/i,
  /nem\s+(atendente|humano|supervisor)/i,
];

export function detectHumanRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (!HUMAN_REQUEST_PATTERNS.some((p) => p.test(t))) return false;
  if (NEGATION_PATTERNS.some((p) => p.test(t))) return false;
  return true;
}

// --- Fluxo real do robô (menu numerado + frase fixa de transferência) ------
//
// Regras exatas pedidas: normalizar espaços, quebras de linha, maiúsculas,
// pontuação e caracteres invisíveis antes de comparar; "3" só conta como
// pedido de atendente se o menu estiver com escolha pendente na conversa
// (pending_context); a frase do robô só conta se vier de autoria ROBO/AUTOMACAO
// — um cliente copiando o texto não comprova transferência.

/** Remove acentos, pontuação, espaços e caracteres invisíveis — sobra só letras/números em minúsculo, para comparar "a grosso". */
function normalizeCompact(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // acentos (forma decomposta pelo NFKD)
    .replace(/[​‌‍﻿]/g, "") // caracteres invisíveis comuns (zero-width, BOM)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // pontuação, espaços e quebras de linha — sobra só letras/números
}

const MENU_MARKERS_COMPACT = ["novoagendamento", "cancelaragendamento", "falarcomatendente"];

/** Detecta a mensagem de menu do robô (1/2/3) por presença das três opções, tolerante a formatação. */
export function looksLikeMenuMessage(text: string): boolean {
  const compact = normalizeCompact(text);
  return MENU_MARKERS_COMPACT.every((marker) => compact.includes(marker));
}

const TRANSFER_PHRASE_COMPACT = normalizeCompact("Por favor aguarde, estou chamando um atendente humano para te ajudar");

/** Detecta a frase fixa de transferência do robô (o trecho "Atenção: pode demorar..." é opcional). */
export function looksLikeTransferMessage(text: string): boolean {
  return normalizeCompact(text).includes(TRANSFER_PHRASE_COMPACT);
}

/** "3" (só isso, tolerando ponto/traço/dois-pontos depois) — não confunde com horário, quantidade etc. */
export function isExactOptionThree(text: string): boolean {
  return /^3[.\-–—:)]*$/.test(text.trim());
}

// --- Contatos e conversas ---------------------------------------------------

export async function findOrCreateContact(companyId: number, name: string, phone: string): Promise<Contact> {
  const existing = await db.get<Contact>("SELECT * FROM contacts WHERE company_id = ? AND phone = ?", companyId, phone);
  if (existing) return existing;
  const row = await db.get<{ id: number }>(
    "INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, ?, ?, ?) RETURNING id",
    companyId,
    name,
    phone,
    nowIso()
  );
  return (await db.get<Contact>("SELECT * FROM contacts WHERE id = ?", row!.id))!;
}

export async function createConversation(
  companyId: number,
  contactId: number,
  mode: ConversationMode,
  channel: string = "SIMULADO"
): Promise<Conversation> {
  const at = nowIso();
  const row = await db.get<{ id: number }>(
    `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'AUTO', ?, ?) RETURNING id`,
    companyId,
    contactId,
    channel,
    mode,
    at,
    at
  );
  return (await getConversation(companyId, row!.id))!;
}

export function getContact(companyId: number, contactId: number): Promise<Contact | undefined> {
  return db.get<Contact>("SELECT * FROM contacts WHERE id = ? AND company_id = ?", contactId, companyId);
}

/** Última conversa ainda não encerrada desse contato (qualquer canal) — evita criar uma conversa nova a cada mensagem recebida. */
export function findOpenConversationForContact(companyId: number, contactId: number): Promise<Conversation | undefined> {
  return db.get<Conversation>(
    `SELECT * FROM conversations
     WHERE company_id = ? AND contact_id = ? AND status != 'ENCERRADO'
     ORDER BY updated_at DESC LIMIT 1`,
    companyId,
    contactId
  );
}

export async function findOrCreateOpenConversation(
  companyId: number,
  contactId: number,
  mode: ConversationMode,
  channel: string
): Promise<Conversation> {
  return (await findOpenConversationForContact(companyId, contactId)) ?? (await createConversation(companyId, contactId, mode, channel));
}

export function getConversation(companyId: number, conversationId: number): Promise<Conversation | undefined> {
  return db.get<Conversation>("SELECT * FROM conversations WHERE id = ? AND company_id = ?", conversationId, companyId);
}

export interface ConversationListItem extends Conversation {
  contact_name: string;
  contact_phone: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  /** started_at do episódio de espera aberto, se houver — mesmo dado que o dashboard usa. */
  open_wait_started_at: string | null;
}

export function listConversations(companyId: number): Promise<ConversationListItem[]> {
  return db.all<ConversationListItem>(
    `SELECT co.*, ct.name AS contact_name, ct.phone AS contact_phone,
            lm.body AS last_message_preview, lm.created_at AS last_message_at,
            (SELECT started_at FROM wait_episodes we
               WHERE we.conversation_id = co.id AND we.ended_at IS NULL
               ORDER BY we.id DESC LIMIT 1) AS open_wait_started_at
     FROM conversations co
     JOIN contacts ct ON ct.id = co.contact_id
     LEFT JOIN messages lm ON lm.id = (
       SELECT id FROM messages WHERE conversation_id = co.id ORDER BY id DESC LIMIT 1
     )
     WHERE co.company_id = ?
     ORDER BY co.updated_at DESC`,
    companyId
  );
}

export interface MessageWithAuthor extends Message {
  /** Nome do atendente autenticado, só para author_type = HUMANO. */
  author_name: string | null;
}

export function listMessages(conversationId: number): Promise<MessageWithAuthor[]> {
  return db.all<MessageWithAuthor>(
    `SELECT m.*, u.name AS author_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_user_id
     WHERE m.conversation_id = ?
     ORDER BY m.id`,
    conversationId
  );
}

async function setConversationStatus(conversationId: number, status: ConversationStatus, at: string): Promise<void> {
  await db.run("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?", status, at, conversationId);
}

/** Contexto de menu ativo (ex.: robô acabou de mandar o menu 1/2/3 e aguarda a escolha do cliente). */
async function setPendingContext(conversationId: number, context: PendingContext | null): Promise<void> {
  await db.run("UPDATE conversations SET pending_context = ? WHERE id = ?", context, conversationId);
}

/** Atualiza o status de entrega (ENTREGUE/LIDA) de uma mensagem já enviada, a partir do webhook de status da Meta. */
export async function updateMessageDeliveryStatus(companyId: number, externalId: string, status: DeliveryStatus): Promise<void> {
  await db.run("UPDATE messages SET delivery_status = ? WHERE company_id = ? AND external_id = ?", status, companyId, externalId);
}

// --- Episódios de espera por atendimento humano -----------------------------

export function findOpenWaitEpisode(conversationId: number): Promise<WaitEpisode | undefined> {
  return db.get<WaitEpisode>(
    "SELECT * FROM wait_episodes WHERE conversation_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
    conversationId
  );
}

export function listWaitEpisodes(conversationId: number): Promise<WaitEpisode[]> {
  return db.all<WaitEpisode>("SELECT * FROM wait_episodes WHERE conversation_id = ? ORDER BY id", conversationId);
}

/**
 * Pedido repetido não reinicia: se já existe episódio aberto, não faz nada —
 * exceto quando o novo gatilho é cronologicamente ANTERIOR ao que abriu o
 * episódio (evento atrasado/fora de ordem): nesse caso ele é o "primeiro
 * gatilho válido" de verdade, e passa a valer (started_at, tipo e evidência).
 */
export async function startWaitIfNeeded(
  companyId: number,
  conversationId: number,
  triggerType: WaitTriggerType,
  triggerEvidence: string | null,
  at: string = nowIso()
): Promise<void> {
  const evidence = triggerEvidence ? triggerEvidence.slice(0, 300) : null;
  const open = await findOpenWaitEpisode(conversationId);

  if (!open) {
    await db.run(
      "INSERT INTO wait_episodes (company_id, conversation_id, started_at, created_at, trigger_type, trigger_evidence) VALUES (?, ?, ?, ?, ?, ?)",
      companyId,
      conversationId,
      at,
      at,
      triggerType,
      evidence
    );
    return;
  }

  if (new Date(at).getTime() < new Date(open.started_at).getTime()) {
    await db.run(
      "UPDATE wait_episodes SET started_at = ?, trigger_type = ?, trigger_evidence = ? WHERE id = ?",
      at,
      triggerType,
      evidence,
      open.id
    );
  }
}

/** Só uma resposta humana enviada com sucesso deve chamar isto (ver addMessage). */
export async function endOpenWaitEpisode(
  conversationId: number,
  reason: "RESPOSTA_HUMANA",
  endedByUserId: number | null,
  at: string = nowIso()
): Promise<void> {
  const open = await findOpenWaitEpisode(conversationId);
  if (!open) return;
  await db.run(
    "UPDATE wait_episodes SET ended_at = ?, ended_reason = ?, ended_by_user_id = ? WHERE id = ?",
    at,
    reason,
    endedByUserId,
    open.id
  );
}

export interface WaitSummary {
  isWaiting: boolean;
  currentElapsedMs: number | null;
  currentBusinessMinutes: number | null;
  totalElapsedMs: number;
  totalBusinessMinutes: number;
}

export async function summarizeWait(conversationId: number, timeZone: string, businessHours: BusinessHours): Promise<WaitSummary> {
  const episodes = await listWaitEpisodes(conversationId);
  const now = new Date();

  let totalElapsedMs = 0;
  let totalBusinessMinutes = 0;
  let open: WaitEpisode | undefined;

  for (const ep of episodes) {
    const start = new Date(ep.started_at);
    const end = ep.ended_at ? new Date(ep.ended_at) : now;
    totalElapsedMs += end.getTime() - start.getTime();
    totalBusinessMinutes += businessMinutesBetween(start, end, timeZone, businessHours);
    if (!ep.ended_at) open = ep;
  }

  return {
    isWaiting: !!open,
    currentElapsedMs: open ? now.getTime() - new Date(open.started_at).getTime() : null,
    currentBusinessMinutes: open ? businessMinutesBetween(new Date(open.started_at), now, timeZone, businessHours) : null,
    totalElapsedMs,
    totalBusinessMinutes,
  };
}

// --- Ações do atendimento ----------------------------------------------------

/** Atribuir responsável NUNCA encerra a espera — só muda quem está cuidando. */
export async function assumeConversation(companyId: number, conversationId: number, userId: number): Promise<void> {
  const convo = await getConversation(companyId, conversationId);
  if (!convo || convo.status === "ENCERRADO") return;
  await db.run(
    "UPDATE conversations SET assigned_user_id = ?, status = 'HUMANO', updated_at = ? WHERE id = ?",
    userId,
    nowIso(),
    conversationId
  );
}

/**
 * Encerra o atendimento. Se havia espera aberta, o episódio é fechado com
 * ENCERRADO_SEM_RESPOSTA — isso NÃO é uma resposta humana (não entra nas
 * métricas de 1ª resposta), só impede que a conversa continue contando como
 * "aguardando agora" depois de encerrada.
 */
export async function closeConversation(companyId: number, conversationId: number): Promise<void> {
  const convo = await getConversation(companyId, conversationId);
  if (!convo) return;
  const at = nowIso();
  const open = await findOpenWaitEpisode(conversationId);
  if (open) {
    await db.run("UPDATE wait_episodes SET ended_at = ?, ended_reason = 'ENCERRADO_SEM_RESPOSTA' WHERE id = ?", at, open.id);
  }
  await setConversationStatus(conversationId, "ENCERRADO", at);
}

export interface AddMessageInput {
  companyId: number;
  conversationId: number;
  authorType: AuthorType;
  authorUserId?: number | null;
  body: string;
  sendStatus?: SendStatus;
  /**
   * Evidência explícita da ORIGEM (não inferida do texto) de que isto é um
   * pedido/evento de transferência para humano:
   * - "BOTAO_PLATAFORMA": cliente clicou num botão/opção da plataforma cujo
   *   id ou título corresponde a "falar com atendente" (gatilho B).
   * - "EVENTO_PLATAFORMA": a integração relatou um evento de transferência
   *   explícito (gatilho D) — nenhum fornecedor atual oferece isso; existe
   *   só para não precisar mudar o schema quando/se existir.
   */
  platformSignal?: "BOTAO_PLATAFORMA" | "EVENTO_PLATAFORMA";
  /**
   * Id da mensagem na origem externa (ex.: wamid do WhatsApp Cloud API).
   * Garante idempotência: webhooks podem reentregar o mesmo evento (a Meta
   * tenta de novo por até 7 dias em caso de falha) — com o mesmo external_id,
   * a mensagem já registrada é devolvida sem repetir nenhum efeito colateral
   * (não conta duas vezes, não reabre espera encerrada, etc).
   */
  externalId?: string | null;
  /**
   * Instante em que a mensagem aconteceu na origem (ex.: timestamp que a Meta
   * manda no webhook). Sem isso, usa o relógio do servidor. Importante quando
   * a entrega atrasa (reentrega, servidor "dormindo" em plano gratuito): o
   * cronômetro conta a partir do horário real, não do horário em que chegou.
   */
  occurredAt?: string | null;
}

/**
 * Registra uma mensagem com autoria e aplica os efeitos de estado/espera.
 *
 * Gatilhos que iniciam espera (ver WaitTriggerType):
 * A. Cliente responde exatamente "3" com o menu do robô ativo (pending_context).
 * B. platformSignal = "BOTAO_PLATAFORMA" (botão oficial da plataforma).
 * C. Robô/automação envia a frase fixa de transferência (looksLikeTransferMessage).
 * D. platformSignal = "EVENTO_PLATAFORMA" (nenhum fornecedor atual oferece isso).
 * Mais os gatilhos genéricos já existentes: texto livre com palavra-chave
 * (TEXTO_LIVRE) e modo manual (MODO_MANUAL).
 *
 * Regras de encerramento (inalteradas):
 * - Resposta automática (ROBO/AUTOMACAO) e autoria DESCONHECIDA nunca encerram a espera.
 * - Só uma mensagem HUMANO com send_status ENVIADA encerra a espera.
 * - Envio com falha não encerra nada.
 * - Pedido/aviso repetido não reinicia nem duplica (startWaitIfNeeded é idempotente).
 * - Com externalId repetido, toda a função é idempotente.
 */
export async function addMessage(input: AddMessageInput): Promise<Message> {
  const convo = await getConversation(input.companyId, input.conversationId);
  if (!convo) throw new Error("Conversa não encontrada.");

  if (input.externalId) {
    const existing = await db.get<Message>(
      "SELECT * FROM messages WHERE company_id = ? AND external_id = ?",
      input.companyId,
      input.externalId
    );
    if (existing) return existing;
  }

  const at = input.occurredAt && !Number.isNaN(new Date(input.occurredAt).getTime()) ? input.occurredAt : nowIso();
  const sendStatus: SendStatus = input.sendStatus ?? "ENVIADA";

  const inserted = await db.get<{ id: number }>(
    `INSERT INTO messages (company_id, conversation_id, author_type, author_user_id, body, send_status, created_at, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.companyId,
    input.conversationId,
    input.authorType,
    input.authorUserId ?? null,
    input.body,
    sendStatus,
    at,
    input.externalId ?? null
  );

  const notClosed = convo.status !== "ENCERRADO";

  // Gatilho D — evento explícito da plataforma. Vale para qualquer autoria
  // (é a integração relatando o evento, não uma inferência sobre o texto).
  if (input.platformSignal === "EVENTO_PLATAFORMA" && notClosed) {
    await startWaitIfNeeded(input.companyId, input.conversationId, "EVENTO_PLATAFORMA", input.body || "evento explícito da plataforma", at);
    await setConversationStatus(input.conversationId, "AGUARDANDO_HUMANO", at);
    await setPendingContext(input.conversationId, null);
  }

  if (input.authorType === "HUMANO") {
    if (sendStatus === "ENVIADA") {
      await endOpenWaitEpisode(input.conversationId, "RESPOSTA_HUMANA", input.authorUserId ?? null, at);
      await setConversationStatus(input.conversationId, "AGUARDANDO_CLIENTE", at);
    }
    // send_status FALHOU: nada muda além da mensagem registrada como falha.
  } else if ((input.authorType === "ROBO" || input.authorType === "AUTOMACAO") && notClosed) {
    // Gatilho C — frase fixa de transferência, em qualquer ponto da conversa.
    if (looksLikeTransferMessage(input.body)) {
      await startWaitIfNeeded(input.companyId, input.conversationId, "MENSAGEM_ROBO", input.body, at);
      await setConversationStatus(input.conversationId, "AGUARDANDO_HUMANO", at);
      await setPendingContext(input.conversationId, null);
    } else if (looksLikeMenuMessage(input.body)) {
      // Abre a janela de contexto para o gatilho A ("3" só conta com o menu ativo).
      await setPendingContext(input.conversationId, "MENU_PRINCIPAL");
    }
    // Outras mensagens do robô: sem efeito no estado/espera nem no contexto do menu.
  } else if (input.authorType === "CLIENTE") {
    const menuWasActive = convo.pending_context === "MENU_PRINCIPAL";
    // Um cliente copiando a frase do robô não comprova transferência por si só.
    const isCopyOfTransferPhrase = looksLikeTransferMessage(input.body);

    let nextStatus: ConversationStatus | null = null;
    if (convo.status === "ENCERRADO") nextStatus = "AUTO"; // nova mensagem reabre o atendimento
    else if (convo.status === "AGUARDANDO_CLIENTE") nextStatus = "HUMANO"; // cliente respondeu ao humano

    let trigger: { type: WaitTriggerType; evidence: string | null } | null = null;
    if (input.platformSignal === "BOTAO_PLATAFORMA") {
      trigger = { type: "BOTAO_PLATAFORMA", evidence: input.body };
    } else if (menuWasActive && isExactOptionThree(input.body)) {
      trigger = { type: "OPCAO_3", evidence: input.body };
    } else if (!isCopyOfTransferPhrase && detectHumanRequest(input.body)) {
      trigger = { type: "TEXTO_LIVRE", evidence: input.body };
    } else if (convo.mode === "MANUAL") {
      trigger = { type: "MODO_MANUAL", evidence: null };
    }

    if (trigger) {
      await startWaitIfNeeded(input.companyId, input.conversationId, trigger.type, trigger.evidence, at);
      nextStatus = "AGUARDANDO_HUMANO";
    }

    if (nextStatus) await setConversationStatus(input.conversationId, nextStatus, at);
    // O menu é uma janela de uma mensagem: a próxima resposta do cliente
    // sempre consome o contexto, seja "3" ou qualquer outra coisa.
    if (menuWasActive) await setPendingContext(input.conversationId, null);
  }
  // DESCONHECIDO (sem platformSignal): mensagem registrada, sem efeito no estado/espera.

  // Toda mensagem conta como atividade: mantém a caixa de entrada ordenada pela conversa mais recente.
  await db.run("UPDATE conversations SET updated_at = ? WHERE id = ?", at, input.conversationId);

  return (await db.get<Message>("SELECT * FROM messages WHERE id = ?", inserted!.id))!;
}
