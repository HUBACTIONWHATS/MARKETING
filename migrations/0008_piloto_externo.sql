-- Preparação do piloto externo: planos manuais (sem preço), suspensão,
-- convites/redefinição de senha por link, log de auditoria e sessões
-- persistentes (a sessão em memória do express-session não serve para produção).

-- Plano é só um rótulo controlado manualmente pela Hub Action — nenhuma
-- cobrança automática e nenhum valor em dinheiro é registrado aqui.
ALTER TABLE companies ADD COLUMN plan TEXT NOT NULL DEFAULT 'DEMONSTRACAO' CHECK (plan IN ('DEMONSTRACAO', 'PILOTO', 'ATIVO'));
ALTER TABLE companies ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN plan_notes TEXT;

ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

-- Convite (cria conta) e redefinição de senha (conta existente). O token só
-- existe em claro no link entregue ao destinatário; aqui fica o hash SHA-256.
CREATE TABLE access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('CONVITE', 'REDEFINICAO')),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('COMPANY_ADMIN', 'AGENT')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_log_company ON audit_log(company_id, id);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
