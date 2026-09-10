-- Correção (revisão do fluxo): encerrar um atendimento com espera aberta deixava
-- o episódio aberto para sempre, inflando "aguardando humano" e "maior espera"
-- no dashboard. Passa a existir o motivo ENCERRADO_SEM_RESPOSTA, que NÃO conta
-- como resposta humana (as métricas de 1ª resposta só usam RESPOSTA_HUMANA).
-- SQLite não altera CHECK; a tabela é recriada preservando os dados.

CREATE TABLE wait_episodes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT CHECK (ended_reason IN ('RESPOSTA_HUMANA', 'ENCERRADO_SEM_RESPOSTA')),
  created_at TEXT NOT NULL,
  ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO wait_episodes_new (id, company_id, conversation_id, started_at, ended_at, ended_reason, created_at, ended_by_user_id)
SELECT id, company_id, conversation_id, started_at, ended_at, ended_reason, created_at, ended_by_user_id FROM wait_episodes;

DROP TABLE wait_episodes;
ALTER TABLE wait_episodes_new RENAME TO wait_episodes;
CREATE INDEX idx_wait_episodes_conversation ON wait_episodes(conversation_id);

-- Fecha episódios já órfãos em conversas encerradas antes desta correção.
UPDATE wait_episodes SET ended_at = (
  SELECT updated_at FROM conversations c WHERE c.id = wait_episodes.conversation_id
), ended_reason = 'ENCERRADO_SEM_RESPOSTA'
WHERE ended_at IS NULL
  AND conversation_id IN (SELECT id FROM conversations WHERE status = 'ENCERRADO');
