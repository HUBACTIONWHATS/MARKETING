-- Contatos, conversas, mensagens e episódios de espera por atendimento humano.
-- Expediente/fuso ficam na própria empresa (configuráveis por ela).

ALTER TABLE companies ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
-- business_hours: JSON { "mon": {"start":"09:00","end":"18:00"} | null, "tue": ..., ... "sun": ... }
ALTER TABLE companies ADD COLUMN business_hours TEXT NOT NULL DEFAULT '{"mon":{"start":"09:00","end":"18:00"},"tue":{"start":"09:00","end":"18:00"},"wed":{"start":"09:00","end":"18:00"},"thu":{"start":"09:00","end":"18:00"},"fri":{"start":"09:00","end":"18:00"},"sat":null,"sun":null}';

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, phone)
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'SIMULADO',
  mode TEXT NOT NULL DEFAULT 'AUTOMATICO' CHECK (mode IN ('AUTOMATICO', 'MANUAL')),
  status TEXT NOT NULL DEFAULT 'AUTO' CHECK (status IN ('AUTO', 'AGUARDANDO_HUMANO', 'HUMANO', 'AGUARDANDO_CLIENTE', 'ENCERRADO')),
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Autoria nunca pode ser omitida; DESCONHECIDA existe para eventos de origem
-- não identificável e nunca deve ser tratada como HUMANO.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('CLIENTE', 'ROBO', 'HUMANO', 'AUTOMACAO', 'DESCONHECIDO')),
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  send_status TEXT NOT NULL DEFAULT 'ENVIADA' CHECK (send_status IN ('ENVIADA', 'FALHOU')),
  created_at TEXT NOT NULL
);

-- Um episódio = um período de espera por atendimento humano. Só é encerrado
-- por uma resposta HUMANO com send_status = 'ENVIADA'. Repetição de pedido
-- não cria novo episódio enquanto o atual estiver aberto (ended_at NULL).
CREATE TABLE wait_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT CHECK (ended_reason IN ('RESPOSTA_HUMANA')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_conversations_company ON conversations(company_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_wait_episodes_conversation ON wait_episodes(conversation_id);
