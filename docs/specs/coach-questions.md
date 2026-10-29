# Spec: Coach questions and model remarks

- **Status:** Accepted (implemented)
- **Date:** 2026-10-29
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/period-reviews.md`, `docs/specs/admin-settings.md`,
  `docs/specs/llm-call-log.md`.

## Goal

Let the coach ask the athlete important clarification questions from any
structured response, and let the athlete answer them on the main page. Keep the
answer and the coach's reply for the season review. Let the model record its own
remarks about difficulties or objections, and show those remarks to the admin.

## Scope

### In scope

1. Every strictly JSON coach response may carry `coachQuestions` (an array of
   question strings) and `modelsRemarks` (a string or null). The prompt asks for
   at most one question per response, never one per activity, day, week, block
   or season level, and requires the question to name the activity, date, week
   or metric it is about so the athlete knows the context. The prompt asks for
   `modelsRemarks` to be null when the task had no problems.
2. Persist new clarification questions in `coach_questions`. Repeated pending
   questions are skipped.
3. Show only the newest pending question at the top of the main dashboard, with
   an answer input, a coach reply, and a plan refresh after the answer. The
   answer and reply are stored with the question.
4. Show answered coach questions, with the question, answer and coach reply, on
   the Season review page.
5. Add an admin-only "Model remarks" list of the most recent non-null
   `modelsRemarks` values from `llm_calls`.

### Out of scope

- A chat thread for a coach question; the athlete answers once and the coach
  replies once.
- Re-opening or editing an answered question.
- Filtering the admin remarks list by user or prompt kind.

## Data model

### `coach_questions`

- `id` serial primary key
- `user_id` integer not null references `users.id` on delete cascade
- `question` text not null, non-blank
- `source_kind` text not null (the prompt kind that produced it)
- `model` text not null
- `answer` text nullable, non-blank when present
- `reply` text nullable, non-blank when present
- `reply_model` text nullable
- `created_at`, `updated_at` timestamptz not null
- `answered_at` timestamptz nullable
- index on `(user_id, created_at)`

### API

- `GET /api/coaching/coach-questions` → `{ pending, answered }`, where `pending`
  is the newest unanswered question or null and `answered` is newest first.
- `POST /api/coaching/coach-questions/:id/answer` with
  `{ today, timezone?, answer }` → `{ message, reply }`. Generates the coach
  reply and triggers a plan revision.
- `GET /api/admin/llm-calls/remarks?limit=` → `{ remarks }`, newest first, from
  recent prompt responses whose `modelsRemarks` is non-null.

## Acceptance criteria

1. Plan, activity-review, athlete-metric and manual-TSS JSON contracts include
   `coachQuestions` and `modelsRemarks`.
2. A fresh structured response saves its questions without making a logging
   failure break the plan or analysis.
3. The dashboard shows at most one coach question (the newest pending one).
4. Answering saves the answer, shows the coach reply, and triggers a plan
   revision.
5. Answered questions appear on the Season review page with the question,
   answer and coach reply.
6. The admin settings page shows a separate list of recent non-null model
   remarks.
7. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
