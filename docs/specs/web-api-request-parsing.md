# Typed request helper for web API calls

## Goal

Replace the hand-written `fetchJsonAuthed<unknown>` → `schema.safeParse` →
`throw new Error("… returned an unexpected response")` sequence repeated across
the web app with one helper. Every validated API call then has the same error
type, the same message shape, and carries the schema's issues as the cause.

## Scope

- Add `requestParsed(url, auth, schema, label, init?)` next to
  `fetchJsonAuthed` in `apps/web/src/fetchAuthed.ts`.
- Add `ResponseValidationError`, thrown when a successful response does not
  match its schema.
- Migrate every web call site that fetched JSON only to validate it, including
  the `parseCoachingSaveResponse` and `parseQuestion` wrappers, and remove those
  one-off parsers.
- Leave calls that do not validate a response body (the catalog refresh and the
  account deletion) on `fetchJsonAuthed`.

## Design

`requestParsed` fetches through `fetchJsonAuthed`, so bearer-token attachment,
the one-shot 401 refresh, Sentry breadcrumbs, JSON parsing and `ApiError` for
non-2xx responses stay in one place. It then validates the body against a
schema-shaped contract:

```ts
interface ResponseSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}
```

The structural type keeps the web app free of a direct `zod` dependency while
still inferring the parsed type from the shared zod schemas. A failure throws:

```ts
export class ResponseValidationError extends Error {
  name = "ResponseValidationError";
  message = `${label} returned an unexpected response`;
  cause = parsed.error;
}
```

The label is a short verb phrase for the action, for example
`"Loading your plan"`, `"Saving your note"` or `"Deleting the manual activity"`.
The full message keeps the wording the pages already show, and `reportError`
still reports the error to Sentry because it is neither an `ApiError` nor an
expected session failure.

## Acceptance criteria

- One implementation of response parsing in the web app.
- Every migrated call site is a single `requestParsed` call with no inline
  `safeParse` or ad-hoc error construction.
- The thrown error is a `ResponseValidationError` whose message names the
  action and whose `cause` is the schema's validation error.
- Existing behaviour is preserved: successful responses return the parsed,
  typed body, and non-2xx responses still surface as `ApiError`.
- Unit tests cover a successful parse, a validation failure, and a passed
  `RequestInit`.

## Data model and API impact

None. The helper is web-only; the API contract and database schema are
unchanged.
