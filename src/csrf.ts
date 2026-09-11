/**
 * Proteção CSRF (padrão "synchronizer token"), sem dependência nova.
 *
 * Estratégia: um middleware garante um token por sessão e o injeta
 * automaticamente em toda resposta HTML que contenha um `<form method="post"`
 * (via um pequeno monkey-patch de res.send) — não precisa editar nenhuma das
 * views existentes nem lembrar de adicionar o campo em views novas. Outro
 * middleware valida o token em todo POST/PUT/PATCH/DELETE.
 *
 * O webhook do WhatsApp (/webhooks/whatsapp) é a única rota isenta: não é uma
 * requisição de navegador com sessão — a proteção dela é a assinatura HMAC
 * (ver whatsapp.ts), que é o mecanismo certo para esse caso.
 */
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATHS = new Set(["/webhooks/whatsapp"]);

function ensureToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  return req.session.csrfToken;
}

/** Garante o token da sessão e injeta o campo oculto em toda página com formulário POST. */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = ensureToken(req);

  const originalSend = res.send.bind(res);
  res.send = ((body?: unknown) => {
    if (typeof body === "string" && body.includes('<form method="post"')) {
      body = body.replace(
        /<form method="post"([^>]*)>/g,
        (match) => `${match}<input type="hidden" name="_csrf" value="${token}" />`
      );
    }
    return originalSend(body as never);
  }) as typeof res.send;

  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const sent = (req.body as { _csrf?: string } | undefined)?._csrf;
  if (!sent || sent !== token) {
    res.status(403).send("Formulário expirado ou inválido (proteção contra CSRF). Volte, recarregue a página e tente de novo.");
    return;
  }
  next();
}
