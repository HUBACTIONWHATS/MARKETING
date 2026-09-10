-- Status real da conexão do WhatsApp por empresa — nunca "Conectado" só por
-- ter campo preenchido: a verificação precisa de uma checagem de verdade
-- contra a Meta (ver whatsapp.ts, verifyPhoneNumberConnection).

-- Quem cadastra o número (conectar-whatsapp.ts) declara explicitamente se é
-- o número de teste da Meta ou um número de produção — nunca adivinhado.
ALTER TABLE whatsapp_connections ADD COLUMN environment TEXT NOT NULL DEFAULT 'TESTE' CHECK (environment IN ('TESTE', 'PRODUCAO'));

ALTER TABLE whatsapp_connections ADD COLUMN last_verified_at TEXT;
ALTER TABLE whatsapp_connections ADD COLUMN last_verified_ok INTEGER;
ALTER TABLE whatsapp_connections ADD COLUMN last_verified_detail TEXT;
