import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { findCompanyById, findMembership, findUserById, type Membership, type Role, type User } from "./models";
import { appShell, emptyState, forbiddenPage } from "./views";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/** Exige sessão válida. Carrega o usuário em res.locals.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.redirect("/login");
    return;
  }
  const user = await findUserById(userId);
  if (!user || !user.active) {
    // Usuário removido ou desativado pela Hub Action/administrador: sessão deixa de valer.
    req.session.destroy(() => res.redirect("/login"));
    return;
  }
  res.locals.user = user;
  next();
}

/** Exige administrador da plataforma. */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
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
export async function requireCompanyAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    const companyId = Number(req.params.companyId);
    if (!Number.isInteger(companyId)) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const company = await findCompanyById(companyId);
    if (!company) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const membership = await findMembership(res.locals.user.id, companyId);
    if (!membership) {
      res.status(403).send(forbiddenPage());
      return;
    }
    if (company.suspended) {
      // Suspensão manual pela Hub Action (controle de plano): bloqueia no servidor, não só na tela.
      res.status(403).send(forbiddenPage("O acesso desta empresa está suspenso. Fale com a Hub Action."));
      return;
    }
    res.locals.company = company;
    res.locals.membership = membership;
    next();
  });
}

// --- Mídia paga (Marketing / Inteligência / Alertas) ----------------------------------------

/**
 * Regra ÚNICA de quem vê os relatórios de mídia paga de uma empresa:
 * - administrador geral da plataforma (users.is_platform_admin = 1): sempre, em qualquer empresa,
 *   mesmo sem vínculo ou com vínculo de atendente (o vínculo nunca rebaixa o privilégio geral);
 * - administrador da empresa: sempre, só na própria empresa;
 * - atendente: só com memberships.can_view_marketing = 1.
 * Um atendente comum nunca ganha privilégio geral por aqui.
 */
export function marketingAccessAllowed(user: Pick<User, "is_platform_admin">, membership: Pick<Membership, "role" | "can_view_marketing"> | null | undefined): boolean {
  if (Number(user.is_platform_admin) === 1) return true;
  if (!membership) return false;
  return membership.role === "COMPANY_ADMIN" || Number(membership.can_view_marketing) === 1;
}

/** Papel efetivo para a tela: o do vínculo. Administrador geral sem vínculo é só leitor (AGENT) nas ações de edição da empresa. */
export function effectiveRole(res: Response): Role {
  return (res.locals.membership as Membership | null | undefined)?.role ?? "AGENT";
}

/** Só quem tem vínculo de administrador da empresa pode editar metas/pedir sincronização — nunca inferido do privilégio geral. */
export function isCompanyAdmin(res: Response): boolean {
  return (res.locals.membership as Membership | null | undefined)?.role === "COMPANY_ADMIN";
}

/**
 * Acesso às rotas de mídia paga da empresa. Carrega res.locals.company e
 * res.locals.membership (pode ser null para o administrador geral sem vínculo).
 * Empresa suspensa continua bloqueada para quem depende do vínculo.
 */
export async function requireMarketingAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  // requireAuth chama o callback de forma síncrona: assim a promessa desta função só resolve depois de TODA a checagem
  // (importante para os testes que aguardam o middleware; o Express não depende disso).
  let authenticated = false;
  await requireAuth(req, res, () => {
    authenticated = true;
  });
  if (!authenticated) return;
  {
    const companyId = Number(req.params.companyId);
    if (!Number.isInteger(companyId)) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const company = await findCompanyById(companyId);
    if (!company) {
      res.status(404).send("Empresa não encontrada.");
      return;
    }
    const user: User = res.locals.user;
    const membership = (await findMembership(user.id, companyId)) ?? null;
    if (Number(user.is_platform_admin) !== 1) {
      if (!membership) {
        res.status(403).send(forbiddenPage());
        return;
      }
      if (company.suspended) {
        res.status(403).send(forbiddenPage("O acesso desta empresa está suspenso. Fale com a Hub Action."));
        return;
      }
      if (!marketingAccessAllowed(user, membership)) {
        res.status(403).send(
          appShell({
            company,
            user,
            role: membership.role,
            active: "",
            canViewMarketing: false,
            body: emptyState("Sem acesso aos relatórios de mídia paga", "Peça ao administrador da empresa para liberar o acesso."),
          })
        );
        return;
      }
    }
    res.locals.company = company;
    res.locals.membership = membership;
    next();
  }
}
