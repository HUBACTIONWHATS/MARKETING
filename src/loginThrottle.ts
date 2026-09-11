/**
 * Limite de tentativas de login — em memória, sem dependência nova.
 *
 * Válido para uma única instância (o plano gratuito do Render, o alvo desta
 * etapa, nem permite mais de uma instância — ver PUBLICACAO.md). Se um dia a
 * aplicação escalar para múltiplas instâncias, isso precisa virar uma tabela
 * no banco ou um store compartilhado (ex.: Redis) — documentado, não feito
 * aqui por não ser necessário agora.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // acumula falhas nesta janela
const LOCKOUT_MS = 15 * 60 * 1000; // bloqueado por esse tempo ao estourar o limite
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

interface Attempt {
  count: number;
  windowStartedAt: number;
  lockedUntil: number | null;
}

const attempts = new Map<string, Attempt>();

function key(ip: string, email: string): string {
  return `${ip}::${email.trim().toLowerCase()}`;
}

export interface ThrottleStatus {
  locked: boolean;
  retryAfterMinutes?: number;
}

/** Chame antes de verificar a senha. Se locked=true, recuse o login sem nem checar a senha. */
export function checkLoginThrottle(ip: string, email: string): ThrottleStatus {
  const entry = attempts.get(key(ip, email));
  if (!entry || !entry.lockedUntil) return { locked: false };
  if (Date.now() >= entry.lockedUntil) {
    attempts.delete(key(ip, email));
    return { locked: false };
  }
  return { locked: true, retryAfterMinutes: Math.ceil((entry.lockedUntil - Date.now()) / 60000) };
}

export function recordLoginFailure(ip: string, email: string): void {
  const k = key(ip, email);
  const now = Date.now();
  const entry = attempts.get(k);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    attempts.set(k, { count: 1, windowStartedAt: now, lockedUntil: null });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

export function clearLoginThrottle(ip: string, email: string): void {
  attempts.delete(key(ip, email));
}

setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of attempts) {
    const expired = entry.lockedUntil ? now >= entry.lockedUntil : now - entry.windowStartedAt > WINDOW_MS;
    if (expired) attempts.delete(k);
  }
}, SWEEP_INTERVAL_MS).unref();
