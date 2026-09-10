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

export interface WhatsappConnection {
  id: number;
  company_id: number;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  active: number;
  created_at: string;
}

export function findConnectionByPhoneNumberId(phoneNumberId: string): WhatsappConnection | undefined {
  return db
    .prepare("SELECT * FROM whatsapp_connections WHERE phone_number_id = ? AND active = 1")
    .get(phoneNumberId) as WhatsappConnection | undefined;
}

export function listConnectionsForCompany(companyId: number): WhatsappConnection[] {
  return db.prepare("SELECT * FROM whatsapp_connections WHERE company_id = ?").all(companyId) as WhatsappConnection[];
}

/** Cadastra (ou reativa) qual empresa é dona de um phone_number_id. Uso administrativo — ver CONEXAO_WHATSAPP.md. */
export function upsertConnection(companyId: number, phoneNumberId: string, wabaId: string | null, displayPhoneNumber: string | null): void {
  const existing = db.prepare("SELECT id FROM whatsapp_connections WHERE phone_number_id = ?").get(phoneNumberId) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      "UPDATE whatsapp_connections SET company_id = ?, waba_id = ?, display_phone_number = ?, active = 1 WHERE id = ?"
    ).run(companyId, wabaId, displayPhoneNumber, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO whatsapp_connections (company_id, phone_number_id, waba_id, display_phone_number, active, created_at) VALUES (?, ?, ?, ?, 1, ?)"
  ).run(companyId, phoneNumberId, wabaId, displayPhoneNumber, new Date().toISOString());
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
}

export interface ParsedWebhookEntry {
  phoneNumberId: string;
  messages: InboundTextMessage[];
}

function extractMessageBody(message: any): { body: string; supported: boolean } {
  switch (message.type) {
    case "text":
      return { body: message.text?.body ?? "", supported: true };
    case "interactive": {
      const title = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title;
      if (title) return { body: title, supported: true };
      return { body: "[mensagem interativa recebida — formato não reconhecido]", supported: false };
    }
    case "button":
      return { body: message.button?.text ?? "[botão de template recebido]", supported: true };
    default:
      return { body: `[mensagem do tipo "${message.type}" recebida — conteúdo ainda não suportado nesta integração]`, supported: false };
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
        const { body: text, supported } = extractMessageBody(message);
        messages.push({
          waMessageId: message.id,
          fromPhone: message.from,
          contactName: contactsByPhone.get(message.from) ?? null,
          timestamp: message.timestamp,
          body: text,
          supported,
        });
      }
      if (messages.length > 0) result.push({ phoneNumberId, messages });
      // change.value.statuses (confirmação de entrega/leitura de mensagens que NÓS enviamos) fica para uma etapa futura.
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
