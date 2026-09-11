import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    /** Token de proteção CSRF desta sessão — ver src/csrf.ts. */
    csrfToken?: string;
  }
}
