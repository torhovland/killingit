# Spec: Week and block reviews

- **Status:** Accepted (implemented)
- **Date:** 2026-10-23
- **Related:** `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-plan-lifecycle.md`, ADR 0004 (OpenRouter).

## Goal

Give the athlete the same review loop for completed weeks and blocks that
activities already have: a coach summary, a place to comment, a coach reply, and
a plan refresh that uses all of it.

## Scope

### In scope

1. Summarise the stored week and block once they have ended, before the lazy
   cascade replaces them. Store the summary in `period_reviews`.
2. Show completed-week and completed-block reviews on the dashboard, but only
   those the athlete has not answered. Answering means saving a comment or
   choosing "No comment".
3. Keep an answered review on the dashboard for the rest of the visit. The next
   visit or reload omits it.
4. Let the athlete comment on a week or block, generate a short coach reply, and
   start a plan revision.
5. Feed the coach summary, the athlete's comment, and the coach reply into every
   later plan generation for all three review levels: workout, week, and block.
6. Add a **Season review** page listing every week and block review, with an
   edit action that regenerates the reply and refreshes the plan.

### Out of scope

- Summarising weeks or blocks that were never stored in detail (for example a
  long absence across several weeks).
- A chat thread per review; there is one latest comment and reply.
- Background workers. Summaries run inside the existing background plan
  generation; comments use the existing synchronously generated reply.

## Data model

### `period_reviews`

One row per `(user_id, kind, start_date)`:

- `kind` — `week | block`.
- `start_date`, `end_date`, `title` — the period and a display label.
- `summary`, `model`, `prompt_version` — the coach's summary and how it was made.
- `comment` — the athlete's single comment, nullable.
- `reviewed` — the athlete dismissed the review with "No comment".
- `created_at`, `updated_at`.

### `coach_replies`

The `kind` enum gains `week_review` and `block_review`. `target` is the review's
`start_date`. This reuses the existing one-reply-per-input storage and upsert.

## API

- `GET /api/coaching/reviews` → `{ reviews }`, most recent first. Each review
  includes its summary, comment, coach reply, and reviewed flag. A week review
  also carries the week's saved note and the coach's reply to that note, for
  reference.
- `POST /api/coaching/reviews/:kind/:startDate/comments` → `{ message, reply }`.
  Creates the single comment; `409` when one already exists.
- `PUT /api/coaching/reviews/:kind/:startDate/comments` → `{ message, reply }`.
  Edits the comment; `404` when it does not exist.
- `POST /api/coaching/reviews/:kind/:startDate/reviewed` → acknowledges the
  review without influencing the plan.

A comment save also triggers the normal plan generation. The trigger loads the
new comment and the review summaries, so the plan revision is built on them.

## Generation flow

1. During plan generation, before the cascade replaces the stored week/block,
   detect a week whose end date is before today and a block whose end date is
   before today.
2. For each, skip when a review already exists; otherwise ask the coach for a
   3–5 sentence summary of the completed period using the period plan, the
   season/block context, the recent activities and analyses, and the athlete's
   profile and feedback.
3. Store the summary. A failure is logged and never fails the plan.
4. On later plan generations, `formatPlanContext` includes every period review
   with its summary, athlete comment, and coach reply. Recent activities also
   carry their program review and coach reply.

## Prompts

- **Period review** (`periodReviewPrompt`): a plain-text 3–5 sentence summary of
  the completed week or block, including consistency, fit with the plan, what
  worked, and what should change. Versioned with
  `PERIOD_REVIEW_PROMPT_VERSION`.
- **Coach reply** (`coachReplyPrompt`): the `week_review` and `block_review`
  targets include the stored summary and the athlete's comment. Replies stay
  1–2 sentences of plain text.

## UI

- `PeriodReviewCard` renders one summary, its comment and reply, and the comment
  form / edit and "No comment" actions. On the season review page a week review
  also shows the weekly note saved for that week and the coach's reply to it.
- `CoachDashboard` loads reviews, filters with `selectPendingReviews`, and keeps
  answered reviews visible for the visit.
- `SeasonReviewPage` lists every review and offers the edit action. It is
  reachable from the account menu as **Season review**.
- The dashboard no longer has a regeneration button. The new-season and
  season-update actions remain on the coaching survey and settings pages.

## Testing

- Shared schema tests for the review contract and defaults.
- API unit tests for the review prompt, period capture (completed vs current,
  duplicate suppression), and the plan-context rendering of all review levels.
- API route tests for listing, creating/editing comments, duplicate rejection,
  acknowledging, and triggering a plan revision.
- Web render tests for `PeriodReviewCard` and the pending-review filter.
- `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.

## Acceptance criteria

1. A completed week/block receives one coach summary and keeps it after the plan
   advances.
2. Dashboard shows only unanswered week and block reviews; an answered review
   stays until the next visit.
3. A comment gets a coach reply and starts a plan refresh.
4. Workout, week, and block summaries, comments, and replies are all present in
   the prompt for a plan refresh.
5. Season review lists all reviews and supports editing a comment, which
   regenerates the reply and refreshes the plan.
6. The dashboard has no regeneration button; the survey and settings pages have
   the new-season and season-update actions.
7. All four quality gates pass.
