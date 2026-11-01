# Spec: Coaching survey updates and plan adjustments

- **Status:** Accepted (implemented)
- **Date:** 2026-11-01
- **Related:** ADR 0005 (versioned questions), ADR 0007 (athlete answers),
  ADR 0011 (new season versus season update),
  `docs/specs/athlete-question-answers.md`.

## Goal

Let the athlete answer a newly added or revised coaching question, or edit an
existing answer, directly on the Coaching survey page. Show what changed and
keep the coach informed about survey changes that the stored plan has not seen
yet, so the next season refresh can adapt the whole plan.

## Scope

### In scope

1. **Survey sections.** The page shows, in order, "Updated questions" (the
   current version is unanswered but an earlier version has a response), "New
   questions" (no version has been answered), and "Answered questions". When
   nothing has been answered at all, "New questions" is titled "Coaching
   questions".
2. **Edit answers in place.** Every answer is a textarea with a save action; no
   separate "Edit answers" mode. Required questions cannot be saved blank, and
   blank optional answers are stored as explicit skips.
3. **Previous response.** An updated question shows the earlier wording, the
   athlete's earlier answer (or skip), and a button that copies the old answer
   into the new textarea.
4. **Automatic direction.** When a question has been added or revised, the app
   opens the Coaching survey page instead of the normal page.
5. **Survey adjustments.** Saving a new answer, an answer to a revised version,
   or an edit to an existing answer appends a snapshot to
   `coaching_survey_adjustments`. Unchanged resubmissions append nothing.
6. **Season refresh prompt.** When a stale season is refreshed, the prompt
   includes the pending adjustments and asks the coach to adjust the season,
   block, week, and day where needed. `coachQuestion` is a sparing last resort.
7. **Consume adjustments.** A successfully saved full plan or season refresh
   clears that athlete's pending adjustments. A failed generation keeps them.

### Out of scope

- Answer types other than free text.
- A UI history or audit view of earlier answers.
- Notifying the athlete outside the app when a question changes.

## Acceptance criteria

1. `GET /api/questions` returns each current question with `answer`, `skipped`,
   `answeredAt`, and a nullable `previous` object containing the newest earlier
   version the athlete responded to (`versionId`, `version`, `prompt`, `answer`,
   `skipped`, `answeredAt`).
2. The survey page renders the three sections in order, moves a question out of
   Updated/New after it is saved, and labels the first section "Coaching
   questions" when no question has any response.
3. Leaving the app with an unresolved active question opens the survey page.
   Saving the last unresolved answer returns the athlete to normal navigation.
4. `POST /api/questions/answers` records one adjustment for each new or changed
   answer in the same transaction as the answer upsert. The snapshot carries the
   current question, the new answer or skip, and the earlier wording/answer when
   there is one.
5. `GET /api/questions` and the answer save share the response shape and reject
   stale versions, duplicate questions, blank required answers, and oversized
   answers as before.
6. A stale season refresh includes the pending adjustments in the plan-update
   prompt. A plan update that is not a season refresh, or a refresh with no
   pending adjustments, does not include them.
7. After a successful plan save following a full build or season refresh, the
   athlete's adjustments are deleted. A failed model call or failed save leaves
   them for the next attempt.
8. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data model

### Table: `coaching_survey_adjustments`

- `id` serial primary key
- `user_id` integer not null references `users.id` on delete cascade
- `question` text not null: snapshot of the current wording
- `previous_question` text nullable: earlier wording, when the version changed or
  the answer was edited
- `answer` text nullable: the new answer; null is an explicit optional skip
- `previous_answer` text nullable: the earlier answer; null with a previous
  question means the earlier response was a skip
- `created_at` timestamptz not null default now()
- index `(user_id, created_at)`

Rows are append-only until a successful refresh consumes them. The wording is
snapshotted so a later question edit cannot change what the coach was told.

## API and prompt impact

- `athleteQuestionSchema` gains `previous`.
- `QuestionAnswerStore.listForUser` resolves earlier responses from all versions
  of each active question, not just the current version.
- `dbQuestionAnswerStore.saveAnswers` builds adjustments with a pure helper,
  then upserts answers and inserts adjustments in one transaction.
- `CoachingSurveyAdjustmentStore` loads and clears pending adjustments.
- `PlanGenerationContext` carries the pending adjustments; the plan-update
  prompt renders them only when `revision.season` is true. The shared
  `COACHING_SURVEY_ADJUSTMENT_RULES` fragment in `promptRules.ts` instructs the
  coach, including the sparing use of `coachQuestion`.

## Testing

- Shared schema tests cover the previous-response shape.
- API answer tests cover previous-response mapping and adjustment snapshots for
  new, revised, edited, and unchanged answers.
- Prompt tests cover inclusion on a season refresh and exclusion otherwise.
- Generation tests cover clearing on success and keeping on failure.
- Web tests cover the section split, previous answer, copy button, and the
  "Coaching questions" first-run label.
