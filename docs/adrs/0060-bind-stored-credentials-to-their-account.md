# ADR 0060: Bind stored credentials to their account with a versioned ciphertext

- **Status:** Accepted
- **Date:** 2026-11-15
- **Deciders:** torhovland
- **Related:** `docs/specs/credential-encryption.md`, ADR 0003, ADR 0004,
  issue #303

## Context

The app stores two secrets at rest: the Garmin username and password in
`garmin_connections`, and the OpenRouter API key in `llm_settings`. Both used
`apps/api/src/crypto/credentials.ts`, which derived the AES-256-GCM key with a
bare SHA-256 of the environment passphrase and encrypted without additional
authenticated data.

The auth tag therefore proved only that the ciphertext was written with that
env secret. It did not say which account owned the ciphertext, so a ciphertext
moved between rows — by a bug, a bad restore, or an operator mistake — decrypted
to the other account's secret. The format also had no version marker, so any
change to the derivation would strand every stored ciphertext at once.

## Decision

Keep the ciphertext in the same text columns, but make the format versioned and
account-bound.

- Derive the AES key with HKDF-SHA-256 using a fixed salt and an info string
  that names the integration's env var. A bare SHA-256 is not a key-derivation
  function, and the env-var name keeps two integrations on different keys even
  when an operator pastes the same passphrase into both.
- Pass `user:<userId>` as AES-GCM additional authenticated data on every
  encryption and decryption, so a ciphertext moved to another account's row
  fails the auth-tag check.
- Prefix new ciphertexts with `v2:`. A value without the prefix is read with
  the original SHA-256 key and no additional data. Writes always produce `v2:`,
  so rows migrate as they are next saved.
- Cache the derived keys in memory per env var, re-deriving when the
  environment value changes.
- Make every encrypt/decrypt call site pass the owning `userId` in its
  signature, so a new caller cannot omit the binding silently.
- No database migration: the columns keep their `text` type and the format
  change lives entirely in the stored value.

## Alternatives considered

- **Add a data migration that rewrites every ciphertext.** It needs the
  encryption keys inside a migration job, couples the migration to deployment
  secrets, and cannot run in the local/CI database that has no production
  ciphertext. Rejected in favour of the read-time fallback.
- **Bind the column name as well as the account.** It would also stop a
  username ciphertext from being swapped into the password column, but the
  issue is row ownership, and a per-field AAD would add a second parameter to
  every call for a swap that is already inside the same account. Deferred.
- **Use the raw env secret as the AES key (the previous design) and only add
  AAD.** It would fix row swapping with a smaller diff, but a passphrase is not
  a 32-byte key and the issue asks for a derived key. HKDF is the standard
  choice and the version prefix makes the change safe.
- **Re-encrypt legacy rows on read.** Decryption has no store and no write
  permission, and doing it on a GET would add a database write to a read path.
  The next credential save already does the upgrade.
- **Retire the legacy fallback immediately by discarding old ciphertexts.**
  That would log every athlete out of Garmin and OpenRouter and force them to
  re-enter secrets. Rejected.

## Consequences

- A `v2:` ciphertext copied to another account's row fails with
  `CredentialCryptoError` instead of returning the secret.
- Existing rows keep working without a migration. A legacy ciphertext is not
  account-bound until its row is written again; the fallback disappears once
  every row has been touched.
- Rotating an env secret still invalidates its ciphertexts, but the prefix
  makes a future format change detectable rather than ambiguous.
- The derived keys are cached, so the HKDF cost is paid once per env value per
  process; a changed environment value invalidates the cache.
- A ciphertext cannot be swapped between accounts, but the username and password
  columns of one Garmin row share the same AAD, so a swap between those two
  fields is still not detected. That is out of scope for the account binding.
