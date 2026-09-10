-- CRM: funil de oportunidades (separado de contatos) + infraestrutura para o
-- dashboard (autor da resposta que encerrou a espera; meta de SLA da empresa).

ALTER TABLE wait_episodes ADD COLUMN ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN sla_first_response_minutes INTEGER NOT NULL DEFAULT 15;

CREATE TABLE pipeline_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_won INTEGER NOT NULL DEFAULT 0,
  is_lost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Oportunidade é separada de contato: um contato pode ter várias oportunidades
-- ao longo do tempo. Responsável, valor, agendamento e motivo da perda ficam
-- na oportunidade, nunca no contato ou na conversa.
CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  value_cents INTEGER NOT NULL DEFAULT 0,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE INDEX idx_pipeline_stages_company ON pipeline_stages(company_id);
CREATE INDEX idx_opportunities_company ON opportunities(company_id);
CREATE INDEX idx_opportunities_stage ON opportunities(stage_id);

-- Etapas padrão do funil, para as empresas que já existem no banco.
-- Empresas futuras recebem isso via ensureDefaultPipelineStages() (src/crm.ts).
INSERT INTO pipeline_stages (company_id, name, position, is_won, is_lost, created_at)
SELECT id, 'Novo contato', 1, 0, 0, datetime('now') FROM companies
UNION ALL
SELECT id, 'Em atendimento', 2, 0, 0, datetime('now') FROM companies
UNION ALL
SELECT id, 'Qualificado', 3, 0, 0, datetime('now') FROM companies
UNION ALL
SELECT id, 'Agendado', 4, 0, 0, datetime('now') FROM companies
UNION ALL
SELECT id, 'Venda concluída', 5, 1, 0, datetime('now') FROM companies
UNION ALL
SELECT id, 'Perdido', 6, 0, 1, datetime('now') FROM companies;
