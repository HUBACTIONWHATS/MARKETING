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
 * Credenciais — o que é global (servidor) e o que é por empresa (banco):
 * - Globais (variáveis de ambiente, nunca no banco): WHATSAPP_APP_SECRET
 *   (assinatura do webhook), WHATSAPP_VERIFY_TOKEN (handshake do webhook) e
 *   WHATSAPP_GRAPH_API_VERSION. Um único webhook atende todas as empresas.
 * - Por empresa (tabela whatsapp_connections, gerenciada só pelo
 *   administrador geral em /admin/whatsapp — ver server.ts): WABA ID,
 *   Phone Number ID e o Access Token, este sempre cifrado
 *   (src/credentialCrypto.ts) com a chave CREDENTIAL_ENCRYPTION_KEY. Nunca
 *   gravado nem devolvido em texto puro — ver toAdminViewModel.
 *
 * Nada aqui é chamado automaticamente: sem as credenciais configuradas, o
 * envio e a verificação recusam com um erro claro em vez de tentar e falhar
 * de forma confusa.
 */
import crypto from "crypto";
import { decryptSecret, encryptSecret } from "./credentialCrypto";
import { db } from "./db";

export interface WhatsappServerCredentials {
  verifyToken: string | undefined;
  appSecret: string | undefined;
  graphApiVersion: string;
}

/** Credenciais globais do servidor — únicas para todas as empresas. O Access Token NÃO está aqui: é por empresa, ver WhatsappConnection. */
export function getWhatsappCredentials(): WhatsappServerCredentials {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
  };
}

// --- Conexão por empresa ------------------------------------------------------

export type WhatsappEnvironment = "TESTE" | "PRODUCAO";
export type ConnectionStatus = "PENDENTE" | "EM_VALIDACAO" | "CONECTADO" | "ERRO" | "DESATIVADO";

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
  /** Cifrado (src/credentialCrypto.ts) — nunca decifrado fora de testCompanyConnection/sendWhatsAppMessage, nunca exposto à view. */
  access_token_encrypted: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  status: ConnectionStatus;
}

/**
 * Recalcula o status a partir de fatos reais — nunca "Conectado" só por campo
 * preenchido ou só por ter clicado em "Ativar" (exige last_verified_ok=1 E
 * active=1 ao mesmo tempo). "Desativado" NÃO sai daqui: é um estado só de
 * deactivateConnection (ação explícita do administrador) — cadastrar,
 * substituir token ou testar uma conexão nunca produzem "Desativado" sozinhos,
 * mesmo com active=0 (senão toda conexão recém-criada, ainda não ativada,
 * apareceria como "desativada" em vez de "em validação").
 */
export function computeConnectionStatus(row: {
  access_token_encrypted: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  active: number;
  last_verified_ok: number | null;
}): ConnectionStatus {
  if (!row.access_token_encrypted || !row.waba_id || !row.phone_number_id) return "PENDENTE";
  if (row.last_verified_ok === 1 && row.active === 1) return "CONECTADO";
  if (row.last_verified_ok === 0) return "ERRO";
  return "EM_VALIDACAO";
}

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  PENDENTE: "Pendente",
  EM_VALIDACAO: "Em validação",
  CONECTADO: "Conectado",
  ERRO: "Erro",
  DESATIVADO: "Desativado",
};

export function findConnectionByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConnection | undefined> {
  return db.get<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE phone_number_id = ? AND active = 1", phoneNumberId);
}

/** Uma empresa tem no máximo uma conexão gerenciada pela tela administrativa (ver createCompanyConnection). */
export function findConnectionByCompanyId(companyId: number): Promise<WhatsappConnection | undefined> {
  return db.get<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE company_id = ? ORDER BY id DESC LIMIT 1", companyId);
}

export function listConnectionsForCompany(companyId: number): Promise<WhatsappConnection[]> {
  return db.all<WhatsappConnection>("SELECT * FROM whatsapp_connections WHERE company_id = ?", companyId);
}

/**
 * Cadastra (ou reativa) qual empresa é dona de um phone_number_id — uso do
 * script de linha de comando (conectar-whatsapp.ts), sem token, para
 * demonstração/desenvolvimento local. A tela administrativa segura
 * (createCompanyConnection, abaixo) é o caminho para credenciais reais.
 * `environment` é sempre declarado explicitamente — nunca adivinhado.
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

// --- Área administrativa exclusiva (Hub Action) — CRUD seguro da conexão ----
// Todas as funções abaixo são chamadas só por rotas protegidas com
// requirePlatformAdmin (ver server.ts, seção /admin/whatsapp) e sempre
// auditadas (access.ts::audit) pelo chamador — sem o segredo, nunca com ele.

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

/** O que a view pode receber — nunca o token cifrado. Use sempre isto (nunca a row crua) ao montar a tela. */
export type ConnectionAdminView = Omit<WhatsappConnection, "access_token_encrypted"> & { hasAccessToken: boolean };

export function toAdminViewModel(row: WhatsappConnection): ConnectionAdminView {
  const { access_token_encrypted, ...rest } = row;
  return { ...rest, hasAccessToken: !!access_token_encrypted };
}

function isBlank(v: string | null | undefined): boolean {
  return !v || !v.trim();
}

/** Cadastra a conexão de uma empresa (uma por empresa). Rejeita phone_number_id já usado por outra empresa ativa — nunca reatribui silenciosamente. */
export async function createCompanyConnection(
  companyId: number,
  input: { phoneNumberId: string; wabaId: string; accessToken: string; environment: WhatsappEnvironment }
): Promise<AdminActionResult> {
  if (isBlank(input.phoneNumberId) || isBlank(input.wabaId) || isBlank(input.accessToken)) {
    return { ok: false, error: "Preencha WABA ID, Phone Number ID e o Access Token." };
  }
  const existingForCompany = await findConnectionByCompanyId(companyId);
  if (existingForCompany) {
    return { ok: false, error: "Esta empresa já tem uma conexão cadastrada. Use \"Substituir credencial\" para trocar o token." };
  }
  const phoneInUse = await db.get<{ id: number; company_id: number }>(
    "SELECT id, company_id FROM whatsapp_connections WHERE phone_number_id = ?",
    input.phoneNumberId.trim()
  );
  if (phoneInUse && phoneInUse.company_id !== companyId) {
    return { ok: false, error: "Este Phone Number ID já está cadastrado para outra empresa." };
  }
  let encrypted: string;
  try {
    encrypted = encryptSecret(input.accessToken.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao cifrar a credencial." };
  }
  const status = computeConnectionStatus({
    access_token_encrypted: encrypted,
    waba_id: input.wabaId.trim(),
    phone_number_id: input.phoneNumberId.trim(),
    active: 0,
    last_verified_ok: null,
  });
  await db.run(
    `INSERT INTO whatsapp_connections
      (company_id, phone_number_id, waba_id, environment, active, created_at, access_token_encrypted, status)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    companyId,
    input.phoneNumberId.trim(),
    input.wabaId.trim(),
    input.environment,
    new Date().toISOString(),
    encrypted,
    status
  );
  return { ok: true };
}

/**
 * Troca só o token (nunca precisa reenviar WABA ID/Phone Number ID). Invalida
 * a última validação e desativa a conexão — o token novo ainda não foi
 * testado, então não pode continuar valendo para enviar mensagens reais até
 * um novo "Testar conexão" + "Ativar".
 */
export async function replaceConnectionToken(companyId: number, newAccessToken: string): Promise<AdminActionResult> {
  if (isBlank(newAccessToken)) return { ok: false, error: "Informe o novo Access Token." };
  const connection = await findConnectionByCompanyId(companyId);
  if (!connection) return { ok: false, error: "Esta empresa ainda não tem conexão cadastrada." };
  let encrypted: string;
  try {
    encrypted = encryptSecret(newAccessToken.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao cifrar a credencial." };
  }
  const status = computeConnectionStatus({
    access_token_encrypted: encrypted,
    waba_id: connection.waba_id,
    phone_number_id: connection.phone_number_id,
    active: 0,
    last_verified_ok: null,
  });
  await db.run(
    "UPDATE whatsapp_connections SET access_token_encrypted = ?, active = 0, last_verified_ok = NULL, last_verified_at = NULL, last_verified_detail = NULL, status = ? WHERE company_id = ?",
    encrypted,
    status,
    companyId
  );
  return { ok: true };
}

/** Só desliga (sempre permitido, sempre reversível). Não apaga nada. */
export async function deactivateConnection(companyId: number): Promise<AdminActionResult> {
  const connection = await findConnectionByCompanyId(companyId);
  if (!connection) return { ok: false, error: "Esta empresa ainda não tem conexão cadastrada." };
  await db.run("UPDATE whatsapp_connections SET active = 0, status = 'DESATIVADO' WHERE company_id = ?", companyId);
  return { ok: true };
}

/** Só liga depois de uma validação com sucesso — nunca "Conectado" só por ter clicado no botão. */
export async function activateConnection(companyId: number): Promise<AdminActionResult> {
  const connection = await findConnectionByCompanyId(companyId);
  if (!connection) return { ok: false, error: "Esta empresa ainda não tem conexão cadastrada." };
  if (connection.last_verified_ok !== 1) {
    return { ok: false, error: 'Teste a conexão com sucesso ("Testar conexão") antes de ativar.' };
  }
  await db.run("UPDATE whatsapp_connections SET active = 1, status = 'CONECTADO' WHERE company_id = ?", companyId);
  return { ok: true };
}

// --- Validação real contra a Meta -------------------------------------------

export interface VerifyResult {
  ok: boolean;
  detail: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
}

/** Extrai uma mensagem de erro segura da resposta da Meta — nunca inclui token nem cabeçalhos. */
function sanitizeMetaError(json: any, fallback: string): string {
  const msg = json?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

/**
 * Verificação REAL contra a Meta — nunca inferida de "os campos estão
 * preenchidos". Uma única chamada de leitura (GET, sem custo, não manda
 * mensagem) na lista de números do PRÓPRIO WABA: confirma ao mesmo tempo que
 * o token é válido, que o Phone Number ID pertence a esse WABA ID (compatível
 * — não só "existe") e traz o número formatado, nome verificado e qualidade
 * confirmados pela Meta.
 */
export async function verifyPhoneNumberConnection(
  accessToken: string | null | undefined,
  wabaId: string | null | undefined,
  phoneNumberId: string,
  graphApiVersion: string
): Promise<VerifyResult> {
  if (!accessToken) return { ok: false, detail: "Access Token não configurado para esta conexão." };
  if (!wabaId) return { ok: false, detail: "WABA ID não configurado para esta conexão." };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      return { ok: false, detail: sanitizeMetaError(json, `A Meta recusou a verificação (HTTP ${res.status}).`) };
    }
    const match = (json?.data ?? []).find((p: any) => p?.id === phoneNumberId);
    if (!match) {
      return { ok: false, detail: "O Phone Number ID informado não pertence a este WABA ID (ou o token não tem acesso a ele)." };
    }
    return {
      ok: true,
      detail: `Confirmado pela Meta: ${match.display_phone_number}${match.verified_name ? ` (${match.verified_name})` : ""}.`,
      displayPhoneNumber: match.display_phone_number,
      verifiedName: match.verified_name ?? undefined,
      qualityRating: match.quality_rating ?? undefined,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Falha de rede ao consultar a Meta." };
  }
}

/** Testa a conexão de uma empresa (decifra o token, chama a Meta) e grava o resultado — só dados confirmados pela Meta são salvos. */
export async function testCompanyConnection(companyId: number, graphApiVersion: string): Promise<VerifyResult> {
  const connection = await findConnectionByCompanyId(companyId);
  if (!connection) return { ok: false, detail: "Esta empresa ainda não tem conexão cadastrada." };

  let accessToken: string | undefined;
  try {
    accessToken = connection.access_token_encrypted ? decryptSecret(connection.access_token_encrypted) : undefined;
  } catch {
    return { ok: false, detail: "Não foi possível decifrar a credencial salva — substitua o token." };
  }

  const result = await verifyPhoneNumberConnection(accessToken, connection.waba_id, connection.phone_number_id, graphApiVersion);
  const status = computeConnectionStatus({
    access_token_encrypted: connection.access_token_encrypted,
    waba_id: connection.waba_id,
    phone_number_id: connection.phone_number_id,
    active: connection.active,
    last_verified_ok: result.ok ? 1 : 0,
  });
  await db.run(
    `UPDATE whatsapp_connections SET
       last_verified_at = ?, last_verified_ok = ?, last_verified_detail = ?,
       display_phone_number = COALESCE(?, display_phone_number),
       verified_name = COALESCE(?, verified_name),
       quality_rating = COALESCE(?, quality_rating),
       status = ?
     WHERE company_id = ?`,
    new Date().toISOString(),
    result.ok ? 1 : 0,
    result.detail,
    result.displayPhoneNumber ?? null,
    result.verifiedName ?? null,
    result.qualityRating ?? null,
    status,
    companyId
  );
  return result;
}

/**
 * Ação separada e explícita (nunca automática): assina o app no WABA para o
 * campo `messages`, para que a Meta comece a chamar nosso webhook para os
 * números desse WABA. Chamador (server.ts) exige confirmação explícita do
 * administrador e sempre audita, com sucesso ou falha.
 */
export async function subscribeAppToWaba(companyId: number, graphApiVersion: string): Promise<{ ok: boolean; detail: string }> {
  const connection = await findConnectionByCompanyId(companyId);
  if (!connection) return { ok: false, detail: "Esta empresa ainda não tem conexão cadastrada." };
  if (!connection.waba_id) return { ok: false, detail: "WABA ID não configurado para esta conexão." };

  let accessToken: string | undefined;
  try {
    accessToken = connection.access_token_encrypted ? decryptSecret(connection.access_token_encrypted) : undefined;
  } catch {
    return { ok: false, detail: "Não foi possível decifrar a credencial salva — substitua o token." };
  }
  if (!accessToken) return { ok: false, detail: "Access Token não configurado para esta conexão." };

  try {
    const res = await fetch(`https://graph.facebook.com/${graphApiVersion}/${connection.waba_id}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) return { ok: false, detail: sanitizeMetaError(json, `A Meta recusou a assinatura (HTTP ${res.status}).`) };
    return { ok: true, detail: "Aplicativo assinado no WABA — a Meta passa a chamar o webhook para os números deste WABA." };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Falha de rede ao chamar a Meta." };
  }
}

// --- Evidências reais e relatório de status (tela da empresa, só leitura) --

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
  connection: ConnectionAdminView | null;
  /** Credenciais globais do servidor (webhook) — não incluem o Access Token, que é por empresa. */
  serverCredentials: { verifyToken: boolean; appSecret: boolean };
  lastInbound: LastMessageInfo | null;
  lastOutbound: LastMessageInfo | null;
  /** Cada item em linguagem simples — o que falta e por quê, sem prometer correção automática. */
  pendencies: string[];
}

/**
 * Monta o status real da conexão de uma empresa — usado pela tela
 * (só leitura) do administrador da empresa em Configurações. A validação em
 * si (chamar a Meta) é exclusiva do administrador geral — ver
 * testCompanyConnection e /admin/whatsapp em server.ts.
 */
export async function buildConnectionStatusReport(companyId: number): Promise<ConnectionStatusReport> {
  const creds = getWhatsappCredentials();
  const serverCredentials = { verifyToken: !!creds.verifyToken, appSecret: !!creds.appSecret };
  const row = await findConnectionByCompanyId(companyId);
  const connection = row ? toAdminViewModel(row) : null;

  const mode: ConnectionMode = connection ? connection.environment : "DEMONSTRACAO";
  const lastInbound = connection ? (await getLastRealInboundMessage(companyId)) ?? null : null;
  const lastOutbound = connection ? (await getLastRealOutboundMessage(companyId)) ?? null : null;

  const pendencies: string[] = [];
  if (!connection) {
    pendencies.push("Nenhuma conexão foi cadastrada para esta empresa ainda — peça à Hub Action.");
  }
  if (!serverCredentials.verifyToken || !serverCredentials.appSecret) {
    const faltando = [!serverCredentials.verifyToken && "token de verificação do webhook", !serverCredentials.appSecret && "segredo do aplicativo"].filter(
      Boolean
    );
    pendencies.push(`Faltam credenciais globais no servidor (.env): ${faltando.join(", ")}.`);
  }
  if (connection) {
    if (!connection.hasAccessToken) {
      pendencies.push("O Access Token desta conexão ainda não foi configurado — peça à Hub Action.");
    } else if (connection.last_verified_ok === null) {
      pendencies.push("Esta conexão ainda não foi testada pela Hub Action.");
    } else if (connection.last_verified_ok === 0) {
      pendencies.push(`A última verificação falhou: ${connection.last_verified_detail ?? "sem detalhes."}`);
    }
    if (connection.status !== "CONECTADO") pendencies.push("A conexão ainda não foi ativada pela Hub Action.");
    if (!lastInbound) pendencies.push("Nenhuma mensagem real de cliente foi recebida por esta integração ainda.");
    if (!lastOutbound) pendencies.push("Nenhuma resposta real foi enviada com sucesso por esta integração ainda.");
  }
  pendencies.push(
    "A integração com o robô/atendimento atual (fora do Hub Action) ainda não foi comprovada — ver CONEXAO_WHATSAPP.md."
  );

  const statusLabel = connection ? STATUS_LABELS[connection.status] : "Modo demonstração";

  return { mode, statusLabel, connection, serverCredentials, lastInbound, lastOutbound, pendencies };
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
  /** Objeto `referral` oficial (anúncio "Clique para o WhatsApp"): fonte de atribuição CONFIRMADA — ver attribution.ts. */
  referral: unknown | null;
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
          referral: message.referral ?? null,
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
 * Envia uma mensagem de texto livre pela Cloud API, usando o Access Token
 * cifrado já decifrado pelo chamador (ver server.ts, rota "responder") — este
 * módulo nunca decide sozinho de onde vem o token. Só funciona dentro da
 * janela de 24h aberta pela última mensagem do cliente (fora dela a Meta
 * rejeita e exige mensagem de template, que tem custo por envio — ver
 * CONEXAO_WHATSAPP.md).
 */
export async function sendWhatsAppMessage(
  accessToken: string | null | undefined,
  phoneNumberId: string,
  toPhone: string,
  body: string,
  graphApiVersion: string
): Promise<SendResult> {
  if (!accessToken) {
    return { ok: false, error: "Access Token não configurado para esta conexão — envio real desativado." };
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
      return { ok: false, error: sanitizeMetaError(json, `Falha HTTP ${res.status} ao enviar via WhatsApp.`) };
    }
    return { ok: true, waMessageId: json?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha desconhecida ao chamar a Graph API." };
  }
}
