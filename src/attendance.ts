import type { BusinessHours } from "./businessHours";
import { businessMinutesBetween } from "./businessHours";
import { db } from "./db";

export type ConversationStatus = "AUTO" | "AGUARDANDO_HUMANO" | "HUMANO" | "AGUARDANDO_CLIENTE" | "ENCERRADO";
export type ConversationMode = "AUTOMATICO" | "MANUAL";
export type AuthorType = "CLIENTE" | "ROBO" | "HUMANO" | "AUTOMACAO" | "DESCONHECIDO";
export type SendStatus = "ENVIADA" | "FALHOU";

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

// --- Contatos e conversas ---------------------------------------------------

export function findOrCreateContact(companyId: number, name: string, phone: string): Contact {
  const existing = db
    .prepare("SELECT * FROM contacts WHERE company_id = ? AND phone = ?")
    .get(companyId, phone) as Contact | undefined;
  if (existing) return existing;
  const info = db
    .prepare("INSERT INTO contacts (company_id, name, phone, created_at) VALUES (?, ?, ?, ?)")
    .run(companyId, name, phone, nowIso());
  return db.prepare("SELECT * FROM contacts WHERE id = ?").get(info.lastInsertRowid) as Contact;
}

export function createConversation(companyId: number, contactId: number, mode: ConversationMode): Conversation {
  const at = nowIso();
  const info = db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, 'SIMULADO', ?, 'AUTO', ?, ?)`
    )
    .run(companyId, contactId, mode, at, at);
  return getConversation(companyId, Number(info.lastInsertRowid))!;
}

export function getContact(companyId: number, contactId: number): Contact | undefined {
  return db.prepare("SELECT * FROM contacts WHERE id = ? AND company_id = ?").get(contactId, companyId) as
    | Contact
    | undefined;
}

export function getConversation(companyId: number, conversationId: number): Conversation | undefined {
  return db
    .prepare("SELECT * FROM conversations WHERE id = ? AND company_id = ?")
    .get(conversationId, companyId) as Conversation | undefined;
}

export interface ConversationListItem extends Conversation {
  contact_name: string;
  contact_phone: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  /** started_at do episódio de espera aberto, se houver — mesmo dado que o dashboard usa. */
  open_wait_started_at: string | null;
}

export function listConversations(companyId: number): ConversationListItem[] {
  return db
    .prepare(
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
       ORDER BY co.updated_at DESC`
    )
    .all(companyId) as ConversationListItem[];
}

export function listMessages(conversationId: number): Message[] {
  return db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as Message[];
}

function setConversationStatus(conversationId: number, status: ConversationStatus, at: string): void {
  db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?").run(status, at, conversationId);
}

// --- Episódios de espera por atendimento humano -----------------------------

export function findOpenWaitEpisode(conversationId: number): WaitEpisode | undefined {
  return db
    .prepare("SELECT * FROM wait_episodes WHERE conversation_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
    .get(conversationId) as WaitEpisode | undefined;
}

export function listWaitEpisodes(conversationId: number): WaitEpisode[] {
  return db
    .prepare("SELECT * FROM wait_episodes WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as WaitEpisode[];
}

/** Pedido repetido não reinicia: se já existe episódio aberto, não faz nada. */
export function startWaitIfNeeded(companyId: number, conversationId: number, at: string = nowIso()): void {
  if (findOpenWaitEpisode(conversationId)) return;
  db.prepare(
    "INSERT INTO wait_episodes (company_id, conversation_id, started_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(companyId, conversationId, at, at);
}

/** Só uma resposta humana enviada com sucesso deve chamar isto (ver addMessage). */
export function endOpenWaitEpisode(
  conversationId: number,
  reason: "RESPOSTA_HUMANA",
  endedByUserId: number | null,
  at: string = nowIso()
): void {
  const open = findOpenWaitEpisode(conversationId);
  if (!open) return;
  db.prepare("UPDATE wait_episodes SET ended_at = ?, ended_reason = ?, ended_by_user_id = ? WHERE id = ?").run(
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

export function summarizeWait(conversationId: number, timeZone: string, businessHours: BusinessHours): WaitSummary {
  const episodes = listWaitEpisodes(conversationId);
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
export function assumeConversation(companyId: number, conversationId: number, userId: number): void {
  const convo = getConversation(companyId, conversationId);
  if (!convo || convo.status === "ENCERRADO") return;
  db.prepare("UPDATE conversations SET assigned_user_id = ?, status = 'HUMANO', updated_at = ? WHERE id = ?").run(
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
export function closeConversation(companyId: number, conversationId: number): void {
  const convo = getConversation(companyId, conversationId);
  if (!convo) return;
  const at = nowIso();
  const open = findOpenWaitEpisode(conversationId);
  if (open) {
    db.prepare("UPDATE wait_episodes SET ended_at = ?, ended_reason = 'ENCERRADO_SEM_RESPOSTA' WHERE id = ?").run(at, open.id);
  }
  setConversationStatus(conversationId, "ENCERRADO", at);
}

export interface AddMessageInput {
  companyId: number;
  conversationId: number;
  authorType: AuthorType;
  authorUserId?: number | null;
  body: string;
  sendStatus?: SendStatus;
  /** true quando a mensagem representa o cliente clicando em "Falar com atendente". */
  humanRequestButton?: boolean;
}

/**
 * Registra uma mensagem com autoria e aplica os efeitos de estado/espera.
 * Regras (briefing):
 * - Resposta automática (ROBO/AUTOMACAO) e autoria DESCONHECIDA nunca encerram a espera.
 * - Só uma mensagem HUMANO com send_status ENVIADA encerra a espera.
 * - Envio com falha não encerra nada.
 * - Pedido repetido não reinicia (garantido por startWaitIfNeeded).
 * - Modo manual: qualquer mensagem do cliente inicia/mantém a espera (sem robô).
 */
export function addMessage(input: AddMessageInput): Message {
  const convo = getConversation(input.companyId, input.conversationId);
  if (!convo) throw new Error("Conversa não encontrada.");

  const at = nowIso();
  const sendStatus: SendStatus = input.sendStatus ?? "ENVIADA";

  const info = db
    .prepare(
      `INSERT INTO messages (company_id, conversation_id, author_type, author_user_id, body, send_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.companyId, input.conversationId, input.authorType, input.authorUserId ?? null, input.body, sendStatus, at);

  if (input.authorType === "HUMANO") {
    if (sendStatus === "ENVIADA") {
      endOpenWaitEpisode(input.conversationId, "RESPOSTA_HUMANA", input.authorUserId ?? null, at);
      setConversationStatus(input.conversationId, "AGUARDANDO_CLIENTE", at);
    }
    // send_status FALHOU: nada muda além da mensagem registrada como falha.
  } else if (input.authorType === "CLIENTE") {
    const wantsHuman = input.humanRequestButton === true || detectHumanRequest(input.body);
    let nextStatus: ConversationStatus | null = null;

    if (convo.status === "ENCERRADO") nextStatus = "AUTO"; // nova mensagem reabre o atendimento
    else if (convo.status === "AGUARDANDO_CLIENTE") nextStatus = "HUMANO"; // cliente respondeu ao humano

    if (wantsHuman || convo.mode === "MANUAL") {
      startWaitIfNeeded(input.companyId, input.conversationId, at);
      nextStatus = "AGUARDANDO_HUMANO";
    }

    if (nextStatus) setConversationStatus(input.conversationId, nextStatus, at);
  }
  // ROBO, AUTOMACAO, DESCONHECIDO: mensagem registrada, sem efeito no estado/espera.

  // Toda mensagem conta como atividade: mantém a caixa de entrada ordenada pela conversa mais recente.
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, input.conversationId);

  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as Message;
}
