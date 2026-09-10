-- Adapta o rastreamento de espera ao fluxo real do robô do usuário: menu
-- numerado (1/2/3) + frase fixa de transferência, além do botão de
-- plataforma e evento explícito (ainda sem fornecedor real).

-- Contexto de menu ativo na conversa (ex.: 'MENU_PRINCIPAL' logo após o robô
-- mandar o menu, até a próxima mensagem do cliente "consumir" a escolha).
ALTER TABLE conversations ADD COLUMN pending_context TEXT;

-- Diferencia mensagem ENVIADA (aceita pela Graph API) de ENTREGUE/LIDA
-- (confirmação assíncrona via webhook de status). NULL = desconhecido/não
-- aplicável (ex.: mensagens do cliente, ou canal simulado).
ALTER TABLE messages ADD COLUMN delivery_status TEXT CHECK (delivery_status IN ('ENTREGUE', 'LIDA'));

-- wait_episodes recriada (SQLite não altera CHECK existente) para registrar
-- o gatilho que iniciou cada episódio — exigido pelo painel ("origem e
-- confiabilidade da identificação").
CREATE TABLE wait_episodes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT CHECK (ended_reason IN ('RESPOSTA_HUMANA', 'ENCERRADO_SEM_RESPOSTA')),
  created_at TEXT NOT NULL,
  ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  trigger_type TEXT CHECK (trigger_type IN ('OPCAO_3', 'BOTAO_PLATAFORMA', 'MENSAGEM_ROBO', 'EVENTO_PLATAFORMA', 'TEXTO_LIVRE', 'MODO_MANUAL')),
  trigger_evidence TEXT
);

INSERT INTO wait_episodes_new (id, company_id, conversation_id, started_at, ended_at, ended_reason, created_at, ended_by_user_id)
SELECT id, company_id, conversation_id, started_at, ended_at, ended_reason, created_at, ended_by_user_id FROM wait_episodes;

DROP TABLE wait_episodes;
ALTER TABLE wait_episodes_new RENAME TO wait_episodes;
CREATE INDEX idx_wait_episodes_conversation ON wait_episodes(conversation_id);
