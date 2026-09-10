import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { findCompanyById, findMembership, findUserById } from "./models";
import { forbiddenPage } from "./views";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/** Exige sessão válida. Carrega o usuário em res.locals.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session.userId;
  if (!userId) {
    res.redirect("/login");
    return;
  }
  const user = findUserById(userId);
  if (!user) {
    req.session.destroy(() => res.redirect("/login"));
    return;
  }
  res.locals.user = user;
  next();
}

/** Exige administrador da plataforma. */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!res.locals.user.is_platform_admin) {
      res.status(403).send(forbiddenPage());
      return;
    }
    next();
  });
}

/**
 * Isolamento entre empresas aplicado no servidor: só segue adiante se existir
 * uma associação (membership) do usuário logado com a empresa da rota.
 * Administrador da plataforma NÃO herda acesso automático às páginas da
 * empresa — o painel dele é separado (/admin) e não expõe dados operacionais.
 */
export function requireCompanyAccess(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    const companyId = Number(req.params.companyId);
    if (!Number.isInteger(companyId)) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const company = findCompanyById(companyId);
    if (!company) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const membership = findMembership(res.locals.user.id, companyId);
    if (!membership) {
      res.status(403).send(forbiddenPage());
      return;
    }
    res.locals.company = company;
    res.locals.membership = membership;
    next();
  });
}
