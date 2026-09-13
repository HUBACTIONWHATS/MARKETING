/**
 * OAuth 2.0 (Meta Marketing API e Google Ads API) — só a parte de segurança:
 * state anti-CSRF de uso único (tabela oauth_states, 15 min), PKCE (S256) para
 * o Google, montagem das URLs de autorização e leitura da configuração.
 *
 * O que NÃO acontece aqui: nenhuma chamada de rede (ver marketingProviders.ts)
 * e nenhum token guardado — quem recebe o callback cifra com credentialCrypto
 * antes de gravar em marketing_connections (ver server.ts).
 *
 * redirect_uri nunca vem do navegador: é sempre a configurada no servidor
 * (META_REDIRECT_URI / GOOGLE_REDIRECT_URI) ou derivada de PUBLIC_BASE_URL.
 * A Meta e o Google só redirecionam para URIs cadastradas no app deles.
 */
import crypto from "crypto";
import { db } from "./db";

export type MarketingProvider = "META" | "GOOGLE";

const STATE_TTL_MS = 15 * 60 * 1000;

export interface ProviderOAuthConfig {
  configured: boolean;
  clientId: string | undefined;
  redirectUri: string;
  /** Só nomes do que falta — nunca valores. */
  missing: string[];
}

export function metaGraphVersion(): string {
  return process.env.META_GRAPH_API_VERSION || process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
}

export function googleAdsApiVersion(): string {
  return process.env.GOOGLE_ADS_API_VERSION || "v25";
}

/** Permissões mínimas de LEITURA. Confirmadas na documentação da Meta em setembro/2026 (ads_read + read_insights). */
export function metaScopes(): string {
  return process.env.META_OAUTH_SCOPES || "ads_read,read_insights";
}

export function metaOAuthConfig(baseUrl: string): ProviderOAuthConfig {
  const clientId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  const missing = [!clientId && "META_APP_ID", !secret && "META_APP_SECRET"].filter(Boolean) as string[];
  return { configured: missing.length === 0, clientId, redirectUri: process.env.META_REDIRECT_URI || `${baseUrl}/admin/integracoes/meta/callback`, missing };
}

export function googleOAuthConfig(baseUrl: string): ProviderOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const missing = [!clientId && "GOOGLE_CLIENT_ID", !secret && "GOOGLE_CLIENT_SECRET"].filter(Boolean) as string[];
  return { configured: missing.length === 0, clientId, redirectUri: process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/admin/integracoes/google/callback`, missing };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Cria e persiste um state de uso único (+ PKCE verifier para o Google). Devolve o que vai na URL. */
export async function createOAuthState(provider: MarketingProvider, userId: number): Promise<{ state: string; codeChallenge: string | null }> {
  const state = base64url(crypto.randomBytes(24));
  const codeVerifier = provider === "GOOGLE" ? base64url(crypto.randomBytes(48)) : null;
  const codeChallenge = codeVerifier ? base64url(crypto.createHash("sha256").update(codeVerifier).digest()) : null;
  await db.run(
    "INSERT INTO oauth_states (state, provider, created_by_user_id, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?)",
    state,
    provider,
    userId,
    codeVerifier,
    new Date(Date.now() + STATE_TTL_MS).toISOString()
  );
  return { state, codeChallenge };
}

export interface ConsumedState {
  ok: boolean;
  error?: string;
  codeVerifier?: string | null;
  createdByUserId?: number | null;
}

/** Valida e consome o state (uso único, mesmo provider, não expirado, mesmo usuário que iniciou). */
export async function consumeOAuthState(provider: MarketingProvider, state: string | undefined, userId: number): Promise<ConsumedState> {
  if (!state || state.length < 16) return { ok: false, error: "state ausente" };
  const row = await db.get<{ provider: string; created_by_user_id: number | null; code_verifier: string | null; expires_at: string; used_at: string | null }>(
    "SELECT provider, created_by_user_id, code_verifier, expires_at, used_at FROM oauth_states WHERE state = ?",
    state
  );
  if (!row) return { ok: false, error: "state desconhecido" };
  if (row.used_at) return { ok: false, error: "state já usado" };
  if (row.provider !== provider) return { ok: false, error: "state de outro provedor" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "state expirado" };
  if (row.created_by_user_id !== userId) return { ok: false, error: "state iniciado por outro usuário" };
  await db.run("UPDATE oauth_states SET used_at = ? WHERE state = ?", new Date().toISOString(), state);
  return { ok: true, codeVerifier: row.code_verifier, createdByUserId: row.created_by_user_id };
}

export function buildMetaAuthorizeUrl(cfg: ProviderOAuthConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId ?? "",
    redirect_uri: cfg.redirectUri,
    state,
    scope: metaScopes(),
    response_type: "code",
  });
  return `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${p.toString()}`;
}

export function buildGoogleAuthorizeUrl(cfg: ProviderOAuthConfig, state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId ?? "",
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Limpeza de states vencidos (chamada oportunista, sem cron). */
export async function purgeExpiredOAuthStates(): Promise<void> {
  await db.run("DELETE FROM oauth_states WHERE expires_at < ?", new Date(Date.now() - STATE_TTL_MS).toISOString());
}
