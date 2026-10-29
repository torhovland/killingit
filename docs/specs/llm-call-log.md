# Spec: LLM prompt log

- **Status:** Accepted (implemented)
- **Date:** 2026-10-28
- **Related:** ADR 0004 (LLM provider), `docs/specs/llm-benchmark.md`.

## Goal

Make every prompt sent to the coaching LLM inspectable after the fact, so a
wrong plan or a surprising analysis can be debugged from the exact input and
output rather than from a reproduction.

## Scope

### In scope

1. Persist one row for every completion attempt, including retries and JSON
   repair turns: the full messages, the response or error, the model, the
   provider, and request metadata.
2. Wrap the real provider seam so call sites cannot forget to log, including
   Garmin activity analyses, plan generation, coach replies, period reviews,
   and manual-activity TSS estimates.
3. Admin-only API endpoints to list recent calls and fetch one call in full.
4. An admin section listing datetime, user, prompt type, model, duration, and
   status, with a click-through detail view showing the full prompt, response,
   token usage, and metadata.

### Out of scope (deferred)

- Retention pruning or a download/export action.
- Filtering by user, type, or date range in the UI; the list shows the newest
  50 calls and refreshes on demand.
- Logging the benchmark CLI. It runs without an account and is not part of the
  product path.
- Storing the API key. It is never part of a log row.

## Behaviour

### Recording

`withPromptLogging` decorates the account's provider in `loadLlmClient` (plan
generation, replies, reviews, program analysis, manual TSS) and in the default
activity-analysis provider. Each `complete` call writes a row after the
provider settles:

- success: response text, usage, routed model, finish reason, duration;
- failure: the error message, duration, and the prompt that caused it.

`completeWithFallbacks` adds `attempt` and `ofAttempts` to the row metadata so
a retry chain is readable. The JSON repair turn is marked `repair: true`.
Logging is fail-open: a database error is logged to the console and the
completion is still returned.

### Status markers in the list

The list response carries the retry and failure state so the admin does not
have to open every row:

- `repair` — the completion was the JSON repair turn of a plan request.
- `attempt` and `ofAttempts` — the provider attempt that produced the row, when
  the call went through the fallback chain.
- `planFailed` — the plan generation this prompt belongs to ended in failure.

A plan generation can fail after a prompt succeeds (for example when the
repaired JSON still breaks a season invariant). When the run fails,
`markPlanPromptsFailed` adds `planFailed: true` and `planError` to the metadata
of every plan-generation prompt logged since that run started. The marker is
fail-open, like prompt logging itself. The rows therefore keep showing the
failure after a later run succeeds.

The list shows a `Retry` badge for a repair turn or a later fallback attempt,
the attempt as `2/3` beside it, `Plan failed` for a prompt from a failed plan
run, and a `Failed` badge for a completion that returned an error. The detail
view repeats the retry and plan-failure badges and shows the plan error.

### Storage

`llm_calls` holds the account, prompt kind, provider, requested model, messages
(jsonb), response, error, usage, metadata (jsonb), duration, and creation time.
Rows are deleted with the account (`on delete cascade`). Prompt text can contain
health and training details, so the table is read only through admin routes.

### API

- `GET /api/admin/llm-calls?limit=50&offset=0` returns the newest calls without
  the prompt and response bodies.
- `GET /api/admin/llm-calls/:id` returns one call with its messages, response,
  error, usage, and metadata.

Both routes sit behind the existing `/api/admin/*` auth and admin-role guard.

### UI

The Admin settings page gains an "LLM prompts" section. Each row is a button
showing the prompt type, model, datetime, user auth subject, duration, and
succeeded/failed status. Selecting a row fetches the full call and shows the
metadata, each message by role, and the response or error. A refresh button
reloads the newest 50.

On wide screens the log is a list/detail split: the list keeps its own scroll
area in a left column and the selected call is rendered beside it, so reading a
prompt never means scrolling past the remaining list entries. Below the `lg`
breakpoint the list and the detail stack, and an empty pane invites the admin to
pick a call.

The Admin settings page uses the full width of the content panel for every
section, and its development date override comes first, above the athlete
questions and the prompt log.

## Acceptance criteria

- Every production completion attempt produces exactly one `llm_calls` row,
  including failed attempts and repair turns.
- A row contains the exact messages sent, the response or error, the model, and
  the prompt kind.
- The list and detail endpoints reject unauthenticated users with 401 and
  non-admins with 403.
- The admin UI lists recent calls and shows the complete prompt and response
  for a selected call.
- The list identifies a JSON repair or fallback retry, and a prompt from a plan
  run that failed, without opening the row.
- A logging failure does not fail the coaching request.
