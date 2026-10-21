# Spec: Athlete question answers and onboarding gate

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** ADR 0007 (athlete answers), ADR 0005 (versioned questions),
  `docs/specs/versioned-athlete-questions.md`.

## Goal

Let the signed-in athlete answer the active athlete questions and persist those
answers against the exact question version they were shown. Until every active
question is resolved (answered, or explicitly skipped when optional), the app
presents the questions before it loads or shows any activities.

## Scope

### In scope

1. **Athlete question list** for the signed-in user: every active question with
   its current version, prompt, required flag, and the user's answer or skip for
   that version (if any).
2. **Submit answers** in one request, pinning each answer to the
   `question_versions.id` the athlete saw. Answers are upserted per user and
   version; optional questions left blank are recorded as explicit skips.
3. **Onboarding gate** in the coaching dashboard: while any active question is
   unresolved at its current version, the athlete sees the question form instead
   of integrations and activities. Saving the form reveals the dashboard without
   a reload.
4. **Review and edit** the athlete's current answers after onboarding from a
   "Your athlete profile" section. Editing pre-fills the form, saves through the
   same upsert route, and refreshes the summary without a page reload. Cancel
   leaves the stored answers unchanged.
5. Shared Zod schemas, a Drizzle table/migration, typed API routes, and the web
   form.

### Out of scope (deferred)

- Feeding answers into coach/LLM prompts.
- Version history or an audit view of earlier answers.
- Nagging for optional answers after they have been skipped. Optional questions
  are shown in the onboarding form and can be left blank to continue.
- Answer types other than free text.
- Admin views of athlete answers.

## Acceptance criteria

1. `GET /api/questions` returns only active questions, each with its current
   `versionId`, prompt, required flag, version metadata, the signed-in user's
   `answer`, `skipped`, and `answeredAt` for that version, and a `complete`
   flag. It returns `401` without a valid bearer token.
2. `POST /api/questions/answers` accepts an `answers` array whose entries carry
   `questionId`, `versionId`, and `answer`. It trims answers, rejects blank or
   oversized answers with `400`, and rejects duplicate questions with `400`. A
   null answer records a skip and is accepted only for optional questions.
3. A submission whose `versionId` is not the current version of its active
   question is rejected with `400` rather than silently attaching an answer to
   stale wording. Skipping a required question is also rejected with `400`.
4. Accepted answers are upserted keyed by `(user_id, question_version_id)`, so
   resubmitting updates the existing answer or skip, and the response is the
   same shape as `GET /api/questions`.
5. An edit to a question appends a new version and therefore makes the question
   unresolved again for every athlete; archived questions no longer count
   towards completion.
6. The signed-in athlete sees the question form, and no activities are loaded,
   while any active question is unresolved. Optional questions can be skipped by
   leaving them blank and submitting; required questions cannot. With no active
   questions the dashboard loads normally.
7. After a successful save that resolves the active set, the coaching dashboard
   appears without a page reload. API errors are surfaced inline.
8. Once complete, the dashboard shows a "Your athlete profile" section listing
   each prompt with the answer or "Skipped". "Edit answers" opens the form with
   current values, "Save changes" persists them and updates the summary in place,
   and "Cancel" closes the form without saving.
9. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

### Table: `question_answers`

- `id` serial primary key
- `user_id` integer not null references `users.id` on delete cascade
- `question_version_id` integer not null references `question_versions.id` on
  delete cascade
- `answer` text nullable: text is an answer, null is an explicit optional skip,
  with a check that a non-null answer is non-empty after trimming
- `created_at`, `updated_at` timestamptz not null default now()
- unique `(user_id, question_version_id)`

The version reference is the source of truth for the wording; the question id is
not duplicated on the answer. Answers and skips for archived questions and older
versions are retained.

### Routes (behind `requireAuth`)

- `GET /api/questions` → `{ questions: AthleteQuestion[], complete: boolean }`
- `POST /api/questions/answers` → same response body

### Shared types

- `questionAnswerInputSchema` — `questionId`, `versionId`, trimmed `answer` or
  null for an optional skip.
- `questionAnswersInputSchema` — `{ answers }`, at least one and no duplicate
  versions.
- `athleteQuestionSchema` — `questionSchema` plus nullable `answer`, `skipped`,
  and `answeredAt`.
- `athleteQuestionsResponseSchema` — `{ questions, complete }`.
- `isQuestionnaireComplete(questions)` — the shared gate rule: every question
  has an answer, or is an optional question marked skipped.

## Technical approach

### API (`apps/api/src/questions/answers.ts`)

- `toStoredAthleteQuestion` maps a stored question plus its answer row.
- `answersMatchCurrentQuestions` validates every submission against the active
  question set (question is active, version id matches `currentVersion`, no
  duplicate question ids, required questions are not skipped).
- `dbQuestionAnswerStore` implements `listForUser` (active questions plus the
  user's answers for their current versions) and `saveAnswers` (validate, then
  one upsert with per-row `excluded.answer`).
- `routes/questions.ts` injects the user and answer stores so it is testable
  without Postgres. `index.ts` mounts it under `/api/questions` behind
  `requireAuth`.

### Web (`apps/web/src/`)

- `AthleteQuestionsForm.tsx` renders all active questions, pre-filled with
  existing answers, marks optional questions, blocks submission until required
  fields are non-blank, posts blank optional answers as skips, and shows request
  errors inline. An edit variant changes the heading, submit label, and cancel
  action.
- `AthleteAnswersSection.tsx` shows the saved prompt/answer summary and toggles
  the edit variant of the form; saving reuses the parent's answer handler so the
  gate state and summary update from the same response.
- `CoachDashboard.tsx` first loads `/api/questions`. It renders the form while
  the response is incomplete and otherwise renders the existing coaching
  surface, so statuses and activities are only fetched after the gate opens. It
  passes the questions and save handler to the profile section.

## Testing

- **Shared unit tests:** answer trimming/validation, optional skips, duplicate
  rejection, athlete question/response parsing, completion rule.
- **API unit tests:** stored-question mapping, current-version and required-skip
  validation, and route authorization/validation/success with injected stores.
- **Web unit tests:** the form renders prompts, required/optional state,
  prefilled answers, the activity-gate explanation, the onboarding and edit
  variants, and the profile summary with its edit action.
- DB-backed route integration tests remain deferred until CI has a Postgres
  service, matching the existing repository pattern.
