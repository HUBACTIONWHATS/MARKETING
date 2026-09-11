import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptSecret, encryptSecret, isCredentialEncryptionConfigured } from "./credentialCrypto";

const REAL_KEY = crypto.randomBytes(32).toString("hex");

function withKey<T>(key: string | undefined, fn: () => T): T {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  }
}

test("encryptSecret/decryptSecret: ida e volta preserva o valor original", () => {
  withKey(REAL_KEY, () => {
    const plain = "meu-access-token-de-verdade-123";
    const encrypted = encryptSecret(plain);
    assert.notEqual(encrypted, plain);
    assert.ok(!encrypted.includes(plain), "o valor cifrado não pode conter o texto original");
    assert.equal(decryptSecret(encrypted), plain);
  });
});

test("aceita chave em base64 (32 bytes) além de hex", () => {
  const base64Key = crypto.randomBytes(32).toString("base64");
  withKey(base64Key, () => {
    const encrypted = encryptSecret("outro-valor");
    assert.equal(decryptSecret(encrypted), "outro-valor");
  });
});

test("cada chamada gera um IV diferente — o mesmo texto cifra para valores diferentes", () => {
  withKey(REAL_KEY, () => {
    const a = encryptSecret("mesmo-valor");
    const b = encryptSecret("mesmo-valor");
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), "mesmo-valor");
    assert.equal(decryptSecret(b), "mesmo-valor");
  });
});

test("decifrar com a chave errada falha (nunca devolve lixo em silêncio)", () => {
  const encrypted = withKey(REAL_KEY, () => encryptSecret("valor-sensivel"));
  const wrongKey = crypto.randomBytes(32).toString("hex");
  withKey(wrongKey, () => {
    assert.throws(() => decryptSecret(encrypted));
  });
});

test("valor adulterado (texto cifrado alterado) falha na decifragem — GCM detecta a violação", () => {
  withKey(REAL_KEY, () => {
    const encrypted = encryptSecret("valor-original");
    const [iv, tag, data] = encrypted.split(":");
    const tampered = [iv, tag, Buffer.from("lixo-adulterado").toString("base64")].join(":");
    assert.notEqual(tampered, encrypted);
    assert.throws(() => decryptSecret(tampered));
  });
});

test("sem CREDENTIAL_ENCRYPTION_KEY configurada: encryptSecret e decryptSecret lançam erro claro; isCredentialEncryptionConfigured é false", () => {
  withKey(undefined, () => {
    assert.equal(isCredentialEncryptionConfigured(), false);
    assert.throws(() => encryptSecret("qualquer"), /CREDENTIAL_ENCRYPTION_KEY/);
  });
});

test("chave com tamanho errado é rejeitada", () => {
  withKey("chave-curta-demais", () => {
    assert.equal(isCredentialEncryptionConfigured(), false);
    assert.throws(() => encryptSecret("qualquer"), /32 bytes/);
  });
});

test("isCredentialEncryptionConfigured é true com uma chave válida", () => {
  withKey(REAL_KEY, () => {
    assert.equal(isCredentialEncryptionConfigured(), true);
  });
});
