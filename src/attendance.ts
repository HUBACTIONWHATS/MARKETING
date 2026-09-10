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

export function createConversation(
  companyId: number,
  contactId: number,
  mode: ConversationMode,
  channel: string = "SIMULADO"
): Conversation {
  const at = nowIso();
  const info = db
    .prepare(
      `INSERT INTO conversations (company_id, contact_id, channel, mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'AUTO', ?, ?)`
    )
    .run(companyId, contactId, channel, mode, at, at);
  return getConversation(companyId, Number(info.lastInsertRowid))!;
}

export function getContact(companyId: number, contactId: number): Contact | undefined {
  return db.prepare("SELECT * FROM contacts WHERE id = ? AND company_id = ?").get(contactId, companyId) as
    | Contact
    | undefined;
}

/** Última conversa ainda não encerrada desse contato (qualquer canal) — evita criar uma conversa nova a cada mensagem recebida. */
export function findOpenConversationForContact(companyId: number, contactId: number): Conversation | undefined {
  return db
    .prepare(
      `SELECT * FROM conversations
       WHERE company_id = ? AND contact_id = ? AND status != 'ENCERRADO'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(companyId, contactId) as Conversation | undefined;
}

export function findOrCreateOpenConversation(
  companyId: number,
  contactId: number,
  mode: ConversationMode,
  channel: string
): Conversation {
  return findOpenConversationForContact(companyId, contactId) ?? createConversation(companyId, contactId, mode, channel);
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

export interface MessageWithAuthor extends Message {
  /** Nome do atendente autenticado, só para author_type = HUMANO. */
  author_name: string | null;
}

export function listMessages(conversationId: number): MessageWithAuthor[] {
  return db
    .prepare(
      `SELECT m.*, u.name AS author_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.conversation_id = ?
       ORDER BY m.id`
    )
    .all(conversationId) as MessageWithAuthor[];
}

function setConversationStatus(conversationId: number, status: ConversationStatus, at: string): void {
  db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?").run(status, at, conversationId);
}

/** Contexto de menu ativo (ex.: robô acabou de mandar o menu 1/2/3 e aguarda a escolha do cliente). */
function setPendingContext(conversationId: number, context: PendingContext | null): void {
  db.prepare("UPDATE conversations SET pending_context = ? WHERE id = ?").run(context, conversationId);
}

/** Atualiza o status de entrega (ENTREGUE/LIDA) de uma mensagem já enviada, a partir do webhook de status da Meta. */
export function updateMessageDeliveryStatus(companyId: number, externalId: string, status: DeliveryStatus): void {
  db.prepare("UPDATE messages SET delivery_status = ? WHERE company_id = ? AND external_id = ?").run(
    status,
    companyId,
    externalId
  );
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

/**
 * Pedido repetido não reinicia: se já existe episódio aberto, não faz nada —
 * exceto quando o novo gatilho é cronologicamente ANTERIOR ao que abriu o
 * episódio (evento atrasado/fora de ordem): nesse caso ele é o "primeiro
 * gatilho válido" de verdade, e passa a valer (started_at, tipo e evidência).
 */
export function startWaitIfNeeded(
  companyId: number,
  conversationId: number,
  triggerType: WaitTriggerType,
  triggerEvidence: string | null,
  at: string = nowIso()
): void {
  const evidence = triggerEvidence ? triggerEvidence.slice(0, 300) : null;
  const open = findOpenWaitEpisode(conversationId);

  if (!open) {
    db.prepare(
      "INSERT INTO wait_episodes (company_id, conversation_id, started_at, created_at, trigger_type, trigger_evidence) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(companyId, conversationId, at, at, triggerType, evidence);
    return;
  }

  if (new Date(at).getTime() < new Date(open.started_at).getTime()) {
    db.prepare("UPDATE wait_episodes SET started_at = ?, trigger_type = ?, trigger_evidence = ? WHERE id = ?").run(
      at,
      triggerType,
      evidence,
      open.id
    );
  }
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
export function addMessage(input: AddMessageInput): Message {
  const convo = getConversation(input.companyId, input.conversationId);
  if (!convo) throw new Error("Conversa não encontrada.");

  if (input.externalId) {
    const existing = db
      .prepare("SELECT * FROM messages WHERE company_id = ? AND external_id = ?")
      .get(input.companyId, input.externalId) as Message | undefined;
    if (existing) return existing;
  }

  const at = nowIso();
  const sendStatus: SendStatus = input.sendStatus ?? "ENVIADA";

  const info = db
    .prepare(
      `INSERT INTO messages (company_id, conversation_id, author_type, author_user_id, body, send_status, created_at, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
    startWaitIfNeeded(input.companyId, input.conversationId, "EVENTO_PLATAFORMA", input.body || "evento explícito da plataforma", at);
    setConversationStatus(input.conversationId, "AGUARDANDO_HUMANO", at);
    setPendingContext(input.conversationId, null);
  }

  if (input.authorType === "HUMANO") {
    if (sendStatus === "ENVIADA") {
      endOpenWaitEpisode(input.conversationId, "RESPOSTA_HUMANA", input.authorUserId ?? null, at);
      setConversationStatus(input.conversationId, "AGUARDANDO_CLIENTE", at);
    }
    // send_status FALHOU: nada muda além da mensagem registrada como falha.
  } else if ((input.authorType === "ROBO" || input.authorType === "AUTOMACAO") && notClosed) {
    // Gatilho C — frase fixa de transferência, em qualquer ponto da conversa.
    if (looksLikeTransferMessage(input.body)) {
      startWaitIfNeeded(input.companyId, input.conversationId, "MENSAGEM_ROBO", input.body, at);
      setConversationStatus(input.conversationId, "AGUARDANDO_HUMANO", at);
      setPendingContext(input.conversationId, null);
    } else if (looksLikeMenuMessage(input.body)) {
      // Abre a janela de contexto para o gatilho A ("3" só conta com o menu ativo).
      setPendingContext(input.conversationId, "MENU_PRINCIPAL");
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
      startWaitIfNeeded(input.companyId, input.conversationId, trigger.type, trigger.evidence, at);
      nextStatus = "AGUARDANDO_HUMANO";
    }

    if (nextStatus) setConversationStatus(input.conversationId, nextStatus, at);
    // O menu é uma janela de uma mensagem: a próxima resposta do cliente
    // sempre consome o contexto, seja "3" ou qualquer outra coisa.
    if (menuWasActive) setPendingContext(input.conversationId, null);
  }
  // DESCONHECIDO (sem platformSignal): mensagem registrada, sem efeito no estado/espera.

  // Toda mensagem conta como atividade: mantém a caixa de entrada ordenada pela conversa mais recente.
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, input.conversationId);

  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid) as Message;
}
