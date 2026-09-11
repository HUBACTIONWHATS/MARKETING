/**
 * Criptografia simétrica para credenciais sensíveis guardadas no banco (hoje:
 * o Access Token do WhatsApp Cloud API por empresa — ver whatsapp.ts). Usa só
 * o módulo nativo `crypto` do Node (AES-256-GCM), sem dependência nova — o
 * mesmo módulo já usado em csrf.ts, access.ts e whatsapp.ts.
 *
 * A chave (CREDENTIAL_ENCRYPTION_KEY) é um segredo do servidor, nunca do
 * banco: sem ela, nada gravado antes fica legível, mesmo com acesso direto ao
 * Postgres. Formato aceito: 64 caracteres hex OU base64 — ambos precisam
 * representar exatamente 32 bytes (AES-256). Gere uma com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Formato do valor guardado: "<iv base64>:<authTag base64>:<texto cifrado base64>".
 * GCM inclui autenticação: qualquer adulteração do valor guardado (ou uso da
 * chave errada) faz decryptSecret falhar, nunca devolve lixo em silêncio.
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM

function loadKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY não configurada no servidor — não é possível ler nem gravar credenciais.");
  }
  const trimmed = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY precisa representar exatamente 32 bytes (64 caracteres hex, ou base64 equivalente a 32 bytes)."
    );
  }
  return buf;
}

/** true se a chave está presente e no formato certo (sem lançar) — usado só para mostrar "configurado/não configurado" na tela. */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Cifra um segredo (ex.: access token) para guardar no banco. Lança se a chave estiver ausente/inválida. */
export function encryptSecret(plainText: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decifra um valor gravado por encryptSecret. Lança em qualquer adulteração, chave errada ou formato inválido — nunca devolve texto incorreto sem avisar. */
export function decryptSecret(stored: string): string {
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Formato de credencial criptografada inválido.");
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
