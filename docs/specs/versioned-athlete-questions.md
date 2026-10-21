# Spec: Versioned athlete questions

- **Status:** Accepted (implemented)
- **Date:** 2026-10-20
- **Related:** ADR 0005 (versioned questions), AGENTS.md ("athlete profile",
  "LLM").

## Goal

Give the operator an admin surface for defining the free-text questions athletes
are asked during onboarding and later check-ins. Questions change over time, so
every edit creates a new immutable version in the database. Answers can later be
recorded against a specific version, which keeps them interpretable after the
question wording changes.

## Scope

### In scope

1. **Admin list** of active questions behind sign-in, showing the current prompt,
   whether the question is required, and its current/total version.
2. **Create a question** (prompt + required flag), stored as version 1.
3. **Edit a question** by appending a new version (never mutating older
   versions) and marking it current.
4. **Delete (archive) a question**: remove it from the active list while keeping
   all of its versions for future answer/audit references.
5. Shared Zod schemas, typed API routes, Drizzle tables/migration, and an admin
   UI section on the coaching dashboard.

### Out of scope (deferred)

- Athlete-facing question display and answer capture. A future `answers` table
  should reference `question_versions.id`, not only `questions.id`.
- Feeding questions/answers into coach prompts (the next integration step).
- Answer types other than free text (choice, numeric, scale, …). A new type is
  an additive column/field on the version row.
- Reordering questions, restoring archived questions, or a version-history UI.
- Admin roles. The current phase is single-operator, so any authenticated user
  may manage questions (mirroring Garmin and OpenRouter configuration).

## Acceptance criteria

1. `GET /api/admin/questions` returns only active questions, each with the
   current version's `versionId`, prompt, `required`, `version`, `versionCount`,
   and timestamps.
2. `POST /api/admin/questions` validates and trims the prompt, creates the
   question and version 1, and returns `201` with the question.
3. `POST /api/admin/questions/:id/versions` inserts version `n + 1`, updates the
   question's current version, and returns the updated question. Earlier version
   rows are untouched. An unknown or archived question returns `404`.
4. `DELETE /api/admin/questions/:id` archives the question, returns `{ id }`,
   and removes it from the list; all version rows remain. A second delete is
   idempotent; an unknown id returns `404`.
5. Blank or too-long prompts are rejected with `400`. All endpoints require a
   signed-in user (`401` without a valid bearer token).
6. The dashboard admin section can list, add, edit, and delete questions without
   a page reload, and surfaces API errors inline.
7. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

### Tables

- **`questions`** — stable question identity:
  - `id` serial primary key
  - `current_version` integer not null default 1
  - `created_at`, `updated_at` timestamptz not null default now()
  - `archived_at` timestamptz nullable
- **`question_versions`** — append-only content:
  - `id` serial primary key
  - `question_id` integer not null references `questions.id` on delete cascade
  - `version` integer not null
  - `prompt` text not null
  - `required` boolean not null default true
  - `created_at` timestamptz not null default now()
  - unique `(question_id, version)`

Invariants: a version row for `questions.current_version` always exists; versions
are never updated or deleted by the API; archiving does not touch versions.

### Routes (all behind `requireAuth`)

- `GET /api/admin/questions` → `{ questions: Question[] }`
- `POST /api/admin/questions` → `Question` (201)
- `POST /api/admin/questions/:id/versions` → `Question`
- `DELETE /api/admin/questions/:id` → `{ id }`

### Shared types

`questionInputSchema` (`prompt`, `required`), `questionSchema` (including the
current `versionId`), `questionsResponseSchema`, and
`questionArchivedResponseSchema` in `packages/shared/src/questions.ts`,
re-exported from the package index.

## Technical approach

### API (`apps/api/src/questions/`)

- `store.ts` — `listActiveQuestions`, `createQuestion`, `addQuestionVersion`,
  `archiveQuestion`, plus a pure `toStoredQuestion` mapper.
  - New versions are allocated under a `SELECT … FOR UPDATE` row lock on the
    question, so concurrent edits produce sequential version numbers instead of
    unique-constraint races.
  - Listing loads active questions and their versions in two queries and maps
    the current version plus total count in memory (the admin set is small).
- `routes/adminQuestions.ts` — Zod validation for params and bodies, 404 for
  unknown/archived questions, and response schema parsing before serialization.
- `db/schema.ts` — Drizzle tables and inferred types.
- `index.ts` — mount `/api/admin/questions` behind `requireAuth`.

### Web (`apps/web/src/`)

- `AdminQuestionsSection.tsx` — loads the list, owns create/edit/delete
  requests, and updates state from validated API responses.
- `QuestionRow.tsx` — renders one question and toggles an inline editor; delete
  asks for confirmation and explains that history is preserved.
- `QuestionForm.tsx` — shared create/edit form (prompt + required).
- `CoachDashboard.tsx` — renders the admin section after the LLM configuration.

## Testing

- **Shared unit tests:** prompt trimming, required default, blank/oversized
  prompt rejection, question/response schema parsing.
- **API unit tests:** the stored-row mapper and route authorization (401 without
  a token), which also proves the route is mounted.
- **Web unit tests:** static rendering of a question row (prompt, version,
  required, actions) and the shared form.
- DB-backed route integration tests are deferred until CI has a Postgres
  service; the existing repository tests follow the same pattern and CI has no
  database today.

## Risks / open questions

- **No role separation yet.** Every signed-in user is an operator in this phase;
  `requireAdmin`/roles belong with multi-user auth.
- **Archived questions are hidden.** There is no restore UI in v1; restoring is a
  direct database update until the admin view supports archived entries.
- **Immutability is enforced by the API, not by database grants.** Future code
  must not update or delete `question_versions` rows that may have answers.
- **Question ordering** is creation order. If onboarding needs explicit order,
  add a `position` column and reordering endpoint as a separate change.

## Definition of done

- Migration adds both tables and applies cleanly.
- Admin UI can create, version, and archive free-text questions.
- Shared/API/web tests cover the new behavior, and all four quality gates pass.
