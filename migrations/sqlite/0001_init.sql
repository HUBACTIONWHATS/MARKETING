-- Estrutura inicial: empresas, usuários e associação usuário-empresa (multi-tenant)

CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Associa um usuário a uma empresa autorizada, com o perfil dele nessa empresa.
-- Administrador da plataforma não precisa de linha aqui (acesso é global, mas
-- restrito ao painel da plataforma — não herda acesso às páginas de uma empresa).
CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('COMPANY_ADMIN', 'AGENT')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, company_id)
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_company ON memberships(company_id);
