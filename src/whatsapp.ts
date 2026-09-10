/**
 * Integração oficial — WhatsApp Cloud API (Meta).
 *
 * Cobre exatamente o que a documentação oficial garante: receber mensagens de
 * clientes (webhook) e enviar respostas (Graph API). A Cloud API NÃO tem
 * nenhum campo nativo de "enviado por robô" vs "enviado por humano", nem
 * evento de "transferência" — isso só existe porque QUEM decide o conteúdo e
 * chama o envio é sempre o nosso próprio servidor (ver addMessage em
 * attendance.ts). Se um dia outro sistema (bot externo, outro atendimento)
 * também enviar mensagens por esse mesmo número, essa garantia se perde — ver
 * CONEXAO_WHATSAPP.md.
 *
 * Nada aqui é chamado automaticamente: sem as variáveis de ambiente
 * configuradas, o envio real recusa com um erro claro (ver sendWhatsAppMessage).
 */
import crypto from "crypto";
import { db } from "./db";

export interface WhatsappCredentials {
  verifyToken: string | undefined;
  appSecret: string | undefined;
  accessToken: string | undefined;
  graphApiVersion: string;
}

export function getWhatsappCredentials(): WhatsappCredentials {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
  };
}

// --- Mapeamento número -> empresa -------------------------------------------

export type WhatsappEnvironment = "TESTE" | "PRODUCAO";

export interface WhatsappConnection {
  id: number;
  company_id: number;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  active: number;
  created_at: string;
  environment: WhatsappEnvironment;
  last_verified_at: string | null;
  last_verified_ok: number | null; // 0 | 1 | null (nunca verificado)
  last_verified_detail: string | null;
}

export function findConnectionByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConnection | undefined> {
  return db.get<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE phone_number_id = ? AND active = 1", phoneNumberId);
}

export function listConnectionsForCompany(companyId: number): Promise<WhatsappConnection[]> {
  return db.all<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE company_id = ?", companyId);
}

/**
 * Cadastra (ou reativa) qual empresa é dona de um phone_number_id. Uso
 * administrativo — ver CONEXAO_WHATSAPP.md. `environment` é sempre declarado
 * explicitamente por quem conecta (nunca adivinhado pelo formato do número).
 */
export async function upsertConnection(
  companyId: number,
  phoneNumberId: string,
  wabaId: string | null,
  displayPhoneNumber: string | null,
  environment: WhatsappEnvironment = "TESTE"
): Promise<void> {
  const existing = await db.get<{ id: number }>("SELECT id FROM whatsapp_connections WHERE phone_number_id = ?", phoneNumberId);
  if (existing) {
    await db.run(
      "UPDATE whatsapp_connections SET company_id = ?, waba_id = ?, display_phone_number = ?, environment = ?, active = 1 WHERE id = ?",
      companyId,
      wabaId,
      displayPhoneNumber,
      environment,
      existing.id
    );
    return;
  }
  await db.run(
    "INSERT INTO whatsapp_connections (company_id, phone_number_id, waba_id, display_phone_number, environment, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    companyId,
    phoneNumberId,
    wabaId,
    displayPhoneNumber,
    environment,
    new Date().toISOString()
  );
}

/**
 * Verificação REAL contra a Meta — nunca inferida de "os campos estão
 * preenchidos". Faz uma leitura simples (GET, sem custo, não manda
 * mensagem) confirmando que o token de acesso realmente enxerga esse número.
 */
export interface VerifyResult {
  ok: boolean;
  detail: string;
}

export async function verifyPhoneNumberConnection(phoneNumberId: string): Promise<VerifyResult> {
  const { accessToken, graphApiVersion } = getWhatsappCredentials();
  if (!accessToken) {
    return { ok: false, detail: "WHATSAPP_ACCESS_TOKEN não configurado no servidor." };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      return { ok: false, detail: json?.error?.message || `A Meta recusou a verificação (HTTP ${res.status}).` };
    }
    const label = json?.display_phone_number ? String(json.display_phone_number) : phoneNumberId;
    return { ok: true, detail: `Confirmado pela Meta: ${label}${json?.verified_name ? ` (${json.verified_name})` : ""}.` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Falha de rede ao consultar a Meta." };
  }
}

export async function recordVerification(phoneNumberId: string, result: VerifyResult): Promise<void> {
  await db.run(
    "UPDATE whatsapp_connections SET last_verified_at = ?, last_verified_ok = ?, last_verified_detail = ? WHERE phone_number_id = ?",
    new Date().toISOString(),
    result.ok ? 1 : 0,
    result.detail,
    phoneNumberId
  );
}

export interface LastMessageInfo {
  createdAt: string;
  preview: string;
}

/** Última mensagem REAL recebida (do cliente, com wamid) por esta empresa — evidência concreta, não presunção. */
export async function getLastRealInboundMessage(companyId: number): Promise<LastMessageInfo | undefined> {
  const row = await db.get<{ created_at: string; body: string }>(
    `SELECT m.created_at, m.body FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.company_id = ? AND c.channel = 'WHATSAPP_OFICIAL' AND m.author_type = 'CLIENTE' AND m.external_id IS NOT NULL
     ORDER BY m.id DESC LIMIT 1`,
    companyId
  );
  return row ? { createdAt: row.created_at, preview: row.body } : undefined;
}

/** Última resposta REAL enviada (aceita pela Graph API) por esta empresa. */
export async function getLastRealOutboundMessage(companyId: number): Promise<LastMessageInfo | undefined> {
  const row = await db.get<{ created_at: string; body: string }>(
    `SELECT m.created_at, m.body FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.company_id = ? AND c.channel = 'WHATSAPP_OFICIAL' AND m.author_type = 'HUMANO' AND m.send_status = 'ENVIADA' AND m.external_id IS NOT NULL
     ORDER BY m.id DESC LIMIT 1`,
    companyId
  );
  return row ? { createdAt: row.created_at, preview: row.body } : undefined;
}

export type ConnectionMode = "DEMONSTRACAO" | "TESTE" | "PRODUCAO";

export interface ConnectionStatusReport {
  mode: ConnectionMode;
  /** Rótulo curto e honesto pra tela — nunca "Conectado" sem verificação real. */
  statusLabel: string;
  connection: WhatsappConnection | null;
  credentials: { verifyToken: boolean; appSecret: boolean; accessToken: boolean };
  lastInbound: LastMessageInfo | null;
  lastOutbound: LastMessageInfo | null;
  /** Cada item em linguagem simples — o que falta e por quê, sem prometer correção automática. */
  pendencies: string[];
}

/** Monta o status real da conexão de uma empresa — a fonte de verdade da tela "Conexão do WhatsApp". */
export async function buildConnectionStatusReport(companyId: number): Promise<ConnectionStatusReport> {
  const creds = getWhatsappCredentials();
  const credentials = { verifyToken: !!creds.verifyToken, appSecret: !!creds.appSecret, accessToken: !!creds.accessToken };
  const connection = (await listConnectionsForCompany(companyId)).find((c) => c.active === 1) ?? null;
  const allCredentialsPresent = credentials.verifyToken && credentials.appSecret && credentials.accessToken;

  const mode: ConnectionMode = connection ? connection.environment : "DEMONSTRACAO";
  const lastInbound = connection ? (await getLastRealInboundMessage(companyId)) ?? null : null;
  const lastOutbound = connection ? (await getLastRealOutboundMessage(companyId)) ?? null : null;

  const pendencies: string[] = [];
  if (!connection) {
    pendencies.push("Nenhum número foi associado a esta empresa ainda (feito por linha de comando — ver CONEXAO_WHATSAPP.md).");
  }
  if (!allCredentialsPresent) {
    const faltando = [
      !credentials.verifyToken && "token de verificação do webhook",
      !credentials.appSecret && "segredo do aplicativo",
      !credentials.accessToken && "token de acesso",
    ].filter(Boolean);
    pendencies.push(`Faltam credenciais no servidor (.env): ${faltando.join(", ")}.`);
  }
  if (connection) {
    if (connection.last_verified_ok === null) {
      pendencies.push('Esta conexão ainda não foi verificada — use "Verificar agora".');
    } else if (connection.last_verified_ok === 0) {
      pendencies.push(`A última verificação falhou: ${connection.last_verified_detail ?? "sem detalhes."}`);
    }
    if (!lastInbound) pendencies.push("Nenhuma mensagem real de cliente foi recebida por esta integração ainda.");
    if (!lastOutbound) pendencies.push("Nenhuma resposta real foi enviada com sucesso por esta integração ainda.");
  }
  pendencies.push(
    "A integração com o robô/atendimento atual (fora do Hub Action) ainda não foi comprovada — ver CONEXAO_WHATSAPP.md."
  );

  let statusLabel: string;
  if (!connection) statusLabel = "Modo demonstração";
  else if (!allCredentialsPresent) statusLabel = "Configuração incompleta";
  else if (connection.last_verified_ok === 1) statusLabel = "Verificado pela Meta";
  else if (connection.last_verified_ok === 0) statusLabel = "Falha na última verificação";
  else statusLabel = "Ainda não verificado";

  return { mode, statusLabel, connection, credentials, lastInbound, lastOutbound, pendencies };
}

// --- Validação de assinatura do webhook -------------------------------------

/**
 * Toda entrega de webhook da Meta traz o header X-Hub-Signature-256 =
 * "sha256=" + HMAC-SHA256(corpo bruto da requisição, App Secret). Precisa do
 * corpo BRUTO (antes do JSON.parse) — ver server.ts, que captura isso via
 * express.json({ verify }).
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(received, "hex");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// --- Payload do webhook (formato documentado pela Meta) ---------------------

export interface InboundTextMessage {
  waMessageId: string;
  fromPhone: string;
  contactName: string | null;
  timestamp: string;
  body: string;
  /** false para tipos ainda não suportados (imagem, áudio, localização, ...): o corpo vira um aviso, não o conteúdo real. */
  supported: boolean;
  /** true para clique em botão/lista oficial da plataforma (gatilho B — "se esse evento existir"). */
  isInteractiveReply: boolean;
}

export interface DeliveryStatusEvent {
  waMessageId: string;
  status: "delivered" | "read" | "sent" | "failed" | string;
  timestamp: string;
}

export interface ParsedWebhookEntry {
  phoneNumberId: string;
  messages: InboundTextMessage[];
  statuses: DeliveryStatusEvent[];
}

function extractMessageBody(message: any): { body: string; supported: boolean; isInteractiveReply: boolean } {
  switch (message.type) {
    case "text":
      return { body: message.text?.body ?? "", supported: true, isInteractiveReply: false };
    case "interactive": {
      const title = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
      if (title) return { body: title, supported: true, isInteractiveReply: true };
      return { body: "[mensagem interativa recebida — formato não reconhecido]", supported: false, isInteractiveReply: false };
    }
    case "button":
      return { body: message.button?.text ?? "[botão de template recebido]", supported: true, isInteractiveReply: true };
    default:
      return {
        body: `[mensagem do tipo "${message.type}" recebida — conteúdo ainda não suportado nesta integração]`,
        supported: false,
        isInteractiveReply: false,
      };
  }
}

/** Lê o payload já decodificado (JSON.parse do corpo) e devolve só o que sabemos processar. Não assume nada além do formato oficial documentado. */
export function parseWebhookPayload(body: any): ParsedWebhookEntry[] {
  const result: ParsedWebhookEntry[] = [];
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body?.entry)) return result;

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue; // outros campos (status de qualidade, etc.) não são tratados aqui
      const value = change.value;
      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const contactsByPhone = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.wa_id && c.profile?.name) contactsByPhone.set(c.wa_id, c.profile.name);
      }

      const messages: InboundTextMessage[] = [];
      for (const message of value.messages ?? []) {
        const { body: text, supported, isInteractiveReply } = extractMessageBody(message);
        messages.push({
          waMessageId: message.id,
          fromPhone: message.from,
          contactName: contactsByPhone.get(message.from) ?? null,
          timestamp: message.timestamp,
          body: text,
          supported,
          isInteractiveReply,
        });
      }

      // statuses = confirmação de entrega/leitura das mensagens que NÓS enviamos pela Cloud API.
      const statuses: DeliveryStatusEvent[] = [];
      for (const s of value.statuses ?? []) {
        if (s.id && s.status) statuses.push({ waMessageId: s.id, status: s.status, timestamp: s.timestamp });
      }

      if (messages.length > 0 || statuses.length > 0) result.push({ phoneNumberId, messages, statuses });
    }
  }
  return result;
}

// --- Envio (Graph API) -------------------------------------------------------

export interface SendResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

/**
 * Envia uma mensagem de texto livre pela Cloud API. Só funciona dentro da
 * janela de 24h aberta pela última mensagem do cliente (fora dela a Meta
 * rejeita e exige mensagem de template, que tem custo por envio — ver
 * CONEXAO_WHATSAPP.md). Sem credenciais configuradas, recusa com erro claro
 * em vez de tentar e falhar de forma confusa.
 */
export async function sendWhatsAppMessage(phoneNumberId: string, toPhone: string, body: string): Promise<SendResult> {
  const { accessToken, graphApiVersion } = getWhatsappCredentials();
  if (!accessToken) {
    return { ok: false, error: "WHATSAPP_ACCESS_TOKEN não configurado — envio real desativado." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body },
      }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `Falha HTTP ${res.status} ao enviar via WhatsApp.` };
    }
    return { ok: true, waMessageId: json?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha desconhecida ao chamar a Graph API." };
  }
}
