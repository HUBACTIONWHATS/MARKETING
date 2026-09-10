-- Integração oficial (WhatsApp Cloud API, Meta): mapeamento de número por
-- empresa e deduplicação de mensagens recebidas por webhook.

-- Um número de WhatsApp (phone_number_id da Cloud API) pertence a uma única
-- empresa. É por esse campo que o webhook (compartilhado entre todas as
-- empresas do Hub Action) descobre de qual empresa é a mensagem recebida.
CREATE TABLE whatsapp_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL UNIQUE,
  waba_id TEXT,
  display_phone_number TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_whatsapp_connections_company ON whatsapp_connections(company_id);

-- external_id = wamid da mensagem (id que a Meta atribui). A Cloud API pode
-- reenviar o mesmo evento de webhook (reentrega em caso de falha, até 7 dias);
-- o índice único é a prevenção de duplicidade.
ALTER TABLE messages ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL;
