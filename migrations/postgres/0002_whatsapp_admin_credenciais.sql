-- Área administrativa exclusiva (Hub Action) para gerenciar a conexão oficial
-- de cada empresa: reaproveita whatsapp_connections (não cria tabela nova) e
-- acrescenta o que faltava — token criptografado, dados confirmados pela
-- Meta e um status de ciclo de vida explícito. Ver whatsapp.ts
-- (createCompanyConnection, testCompanyConnection, activateConnection,
-- deactivateConnection, computeConnectionStatus) e a tela /admin/whatsapp.

-- Nunca texto puro: cifrado com AES-256-GCM (src/credentialCrypto.ts) usando
-- CREDENTIAL_ENCRYPTION_KEY (segredo do servidor, fora do banco).
ALTER TABLE whatsapp_connections ADD COLUMN access_token_encrypted TEXT;

-- Só dados que a Meta confirmou de verdade numa chamada real (nunca digitados
-- livremente) — ver testCompanyConnection.
ALTER TABLE whatsapp_connections ADD COLUMN verified_name TEXT;
ALTER TABLE whatsapp_connections ADD COLUMN quality_rating TEXT;

-- Pendente: conexão incompleta (falta token/WABA/phone_number_id) ou recém-
--   criada. Em validação: dados completos, aguardando "Testar conexão" ter
--   sucesso pela primeira vez. Conectado: última validação teve sucesso E foi
--   ativada explicitamente. Erro: última validação falhou. Desativado:
--   desligada manualmente (sempre reversível). Nunca setado à mão como
--   "Conectado" — sempre recalculado a partir de fatos reais (ver
--   computeConnectionStatus).
ALTER TABLE whatsapp_connections ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'EM_VALIDACAO', 'CONECTADO', 'ERRO', 'DESATIVADO'));
