# Spec: Credential encryption at rest

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** ADR 0060, `docs/specs/garmin-activity-integration.md`,
  `docs/specs/openrouter-llm-integration.md`, issue #303

## Goal

Store the per-account secrets the app needs to call other services — the Garmin
username and password in `garmin_connections` and the OpenRouter API key in
`llm_settings` — so that a ciphertext read from the database is only useful for
the account that wrote it. A ciphertext copied into another account's row must
fail to decrypt instead of exposing the original secret.

## Scope

- `apps/api/src/crypto/credentials.ts` owns key derivation, the ciphertext
  format and decryption. It is shared by both integrations.
- `apps/api/src/garmin/crypto.ts` names `GARMIN_CREDENTIALS_KEY` and
  `apps/api/src/llm/credentials.ts` names `LLM_CREDENTIALS_KEY`; they stay
  separate so either secret can be rotated on its own.
- Every `encrypt`/`decrypt` call site passes the owning account's `userId`
  (`routes/garmin.ts`, `garmin/credentials.ts`, `routes/llm.ts`,
  `llm/client.ts`, and the benchmark fixture reader).
- The database columns and their types do not change, so no database migration
  is required.

## Ciphertext format

The current format is:

```
v2:<base64(12-byte IV || ciphertext || 16-byte GCM auth tag)>
```

- **Cipher:** AES-256-GCM with a random 12-byte IV per encryption.
- **Key:** HKDF-SHA-256 over the UTF-8 environment secret, with the fixed salt
  `killingit-credentials-salt` and the info
  `killingit-credentials:<ENV_VAR_NAME>`. The env-var name in the info keeps
  two integrations that share a passphrase on different keys.
- **Additional authenticated data:** the UTF-8 bytes of `user:<userId>`. Moving
  a `v2:` ciphertext to another account's row makes the auth-tag check fail.
- **Caching:** the derived keys are cached in memory per env var and re-derived
  when the environment value changes, so a request does not repeat the KDF.

## Migration path

Ciphertexts written before this format are bare base64
(`base64(IV || ciphertext || tag)`) with no prefix. `decrypt` recognises them
and reads them with the original derivation — the AES key is the SHA-256 digest
of the raw secret — and no additional data. `encrypt` always writes `v2:`, so a
row is upgraded the next time the credential is written:

- Garmin credentials are rewritten on every `POST /api/garmin/credentials`.
- An OpenRouter key is rewritten when the athlete saves a key. A model-only save,
  or a key-only save that keeps the stored ciphertext, leaves it in the legacy
  format until the key is set again.

A legacy ciphertext carries no account binding, so the binding guarantee starts
with the first `v2:` write to that row; the fallback exists only to read old
data and can be deleted once every row has been written once.

## Acceptance criteria

1. `encrypt` emits a `v2:` ciphertext that `decrypt` round-trips for the same
   account.
2. A `v2:` ciphertext fails to decrypt for a different account id, including
   when the same key is used.
3. A ciphertext in the legacy format still decrypts with the original env
   secret, and fails under a different one.
4. A tampered ciphertext, an unknown prefix-free value that is not valid base64,
   and an empty plaintext all raise `CredentialCryptoError`.
5. The Garmin credential route and the LLM settings route store ciphertext bound
   to the signed-in account, proven by tests.
6. Derived keys are cached per environment value and re-derived after rotation.
7. Unit tests cover the format, the account binding, the legacy fallback and
   the key cache; all quality gates pass.
