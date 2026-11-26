# Spec: Parse the coach reply text

- **Status:** Accepted (implemented)
- **Date:** 2026-11-26
- **Related:** `docs/specs/coach-answer-voice.md`,
  `docs/specs/plan-refresh-judgement.md`, `docs/specs/plan-json-repair.md`.

## Goal

The athlete reads the coach's words, never the structured envelope around them.
A model occasionally writes the reply as prose and then appends the JSON object,
for example `Good work. {"planChangeScope":"day"}`. That object failed schema
validation, and the old fallback returned the whole response, so the athlete saw
`{"planChangeScope":"day"}` at the end of the answer.

## Scope

### In scope

1. Read the visible reply from one completion before it is stored or returned,
   for both a stored coach reply and a one-off question.
2. Keep the plan-change decision from the appended envelope, so the refresh
   still reaches the level the coach chose.
3. Leave plain prose unchanged, and keep a JSON-looking snippet that is not a
   reply envelope inside the answer.
4. Keep the existing fail-open rule: a response with no usable decision asks for
   a change and defaults to the season.

### Out of scope

- Repairing the model's JSON with another completion. The reply is brief and
  the visible text is what matters here.
- Changing the batch reply path, which already rejects a whole malformed batch
  before storing anything.

## Technical approach

`apps/api/src/llm/coachReplyText.ts` exports `readCoachReplyText`:

- Try the last JSON object in the response against `coachReplyResultSchema`.
- On success, use its `reply` and its plan-change fields.
- On failure, strip the object from the visible text and keep its
  `planChangeScope` and legacy `planChangeNeeded` when they are valid.
- Otherwise return the trimmed text untouched.

`generateCoachReply` uses the result for both kinds. A one-off question still
forces `planChangeScope: "none"`, and a stored reply passes the recovered fields
through `resolvePlanChange`, which fails open to the season.

## Acceptance criteria

1. A response of prose followed by `{"planChangeScope":"day"}` shows only the
   prose and stores the `day` scope.
2. A one-off question answer never shows an appended envelope.
3. A complete reply JSON object still shows its `reply`.
4. Plain prose is unchanged, and a stored reply without a decision fails open
   to the season as before.
5. A JSON-looking snippet that is not a reply envelope stays in the answer.
6. `bun run typecheck`, `bun run lint`, `bun run format`,
   `bun run check:unused` and `bun run test` pass.

## Testing

`apps/api/src/llm/coachReply.test.ts` covers the parser and both generation
paths, including the reported prose-plus-envelope response.
