/**
 * Limite de tentativas genérico, em memória, para ações administrativas que
 * chamam uma API externa (hoje: "Testar conexão" e "Assinar aplicativo no
 * WABA" da tela /admin/whatsapp — ver server.ts). Mesmo padrão de
 * loginThrottle.ts (Map em memória, varredura periódica, sem dependência
 * nova); um arquivo separado porque a chave e a mensagem são genéricas por
 * ação, não específicas de e-mail de login.
 *
 * Mesma ressalva de loginThrottle.ts: vale para uma única instância (o plano
 * gratuito do Render não permite mais de uma) — se escalar, precisa virar
 * armazenamento compartilhado.
 */
const WINDOW_MS = 60 * 60 * 1000; // acumula tentativas nesta janela

interface Entry {
  count: number;
  windowStartedAt: number;
}

const entries = new Map<string, Entry>();

function key(action: string, ip: string, scopeId: string | number): string {
  return `${action}::${ip}::${scopeId}`;
}

export interface ActionThrottleStatus {
  allowed: boolean;
  retryAfterMinutes?: number;
}

/** Chame antes de executar a ação. Se allowed=false, recuse sem chamar a API externa. */
export function checkActionThrottle(action: string, ip: string, scopeId: string | number, maxPerWindow: number): ActionThrottleStatus {
  const k = key(action, ip, scopeId);
  const now = Date.now();
  const entry = entries.get(k);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    return { allowed: true };
  }
  if (entry.count >= maxPerWindow) {
    return { allowed: false, retryAfterMinutes: Math.ceil((entry.windowStartedAt + WINDOW_MS - now) / 60000) };
  }
  return { allowed: true };
}

/** Chame depois de executar a ação (sucesso ou falha — o limite é sobre tentativas, não sobre resultado). */
export function recordAction(action: string, ip: string, scopeId: string | number): void {
  const k = key(action, ip, scopeId);
  const now = Date.now();
  const entry = entries.get(k);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    entries.set(k, { count: 1, windowStartedAt: now });
    return;
  }
  entry.count += 1;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [k, entry] of entries) {
      if (now - entry.windowStartedAt > WINDOW_MS) entries.delete(k);
    }
  },
  30 * 60 * 1000
).unref();
