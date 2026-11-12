# Spec: Coach feedback on athlete input and plan-aware activity reviews

- **Status:** Accepted (implemented)
- **Date:** 2026-10-22
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/garmin-activity-integration.md`, ADR 0004 (OpenRouter).

## Goal

Make the coach feel like it is listening. Each activity gets one plan-aware
review: when the activity falls inside the current week, the review includes how
well it fit the planned session; otherwise it reviews the workout on its own
merits and may relate it to the current block's focus. After the athlete
comments on an activity, writes a weekly note, or records/edits a manual
activity, reply briefly and refresh the week around the new input without
replacing a workout that has already happened with a new suggestion, while
keeping today's completed summary in sync with the athlete's latest comment.

## Scope

### In scope

1. **One activity review.** The general activity analysis is the single review.
   It sees the current season, block and week. When the activity date has a
   session in the current week, it matches the workout to that session and says
   how well it fit the plan (intent, load, timing, progression). Outside the
   current week it reviews the workout on its own merits and may relate it to
   the current block's focus, without pretending a past session was planned.
   There is no separate program-review call, so an activity is never reviewed
   twice. Stored legacy `program` reviews from before this change remain a
   display fallback when an activity has no general analysis.
2. **Coach reply to coaching inputs.** Saving an activity comment, a weekly note,
   or a manual activity (create or edit) generates a short coach reply. The
   reply is persisted and returned from the save endpoint so the UI can show it
   immediately and after a reload.
3. **Refresh around the input, when it needs one.** Every coaching-input save asks
   the coach, in the reply it already writes, whether the input changes the plan.
   A reply that judges the input context only still runs the cheap preparation
   and athlete reading but pays for no plan completion; a reply that asks for a
   change keeps triggering the existing weekly + daily revision. The revision now
   also refreshes tomorrow. A newly generated activity analysis carries the same
   judgement; only an analysis that asks for a change runs the plan completion,
   while the run still settles today's completion and training load. Completed
   week and block summaries, athlete comments, and coach replies are included in
   the same prompt context (see `docs/specs/period-reviews.md`) and
   `docs/specs/plan-refresh-judgement.md`.
4. **Refresh today's completed session** when the new input describes today: a
   comment on today's activity, or a manual activity dated today. Today's plan
   is regenerated from the recorded activity and its latest comment so the
   completed summary stays accurate, but the coach must describe what happened
   rather than propose a second workout. Other inputs preserve the stored day
   plan. A completed session is marked `completed` on both today and the week;
   a session that only did a meaningful part is marked `partial`. Both prompts
   allow slack for a slightly shorter session and small power/pace-zone misses.

### Out of scope

- A chat thread. There is one latest coach reply per input.
- A second, program-only review of the same activity. Plan fit belongs to the
  single review.
- Background workers for replies. Replies are generated synchronously; plan
  generation stays in the background.
- Re-running a stored analysis because the model or prompt version changed, or
  because a plan was rebuilt. Only a newer athlete comment makes it stale.

## Data model

### `activity_comments`

One comment per `(user_id, activity_id)` at most. Adding a comment when one
already exists is rejected; editing updates the existing row and its
`updated_at`.

### `activity_analyses`

`kind` (`general | program`, default `general`). The unique constraint is
`(user_id, activity_id, kind)`. New reviews use `general`; `program` remains only
for rows written before the single-review change so the UI can still show them
as a fallback.

### `coach_replies`

One latest reply per athlete input:

- `user_id`, `kind` (`activity_comment | weekly_note | manual_activity`),
  `target` (activity id, week start date, or manual activity id), `reply`,
  `model`, `created_at`, `updated_at`.
- Unique `(user_id, kind, target)`; saving a new reply upserts the row.

## API

- `GET /api/coaching/activities` now includes, per activity:
  - `analysis` (the single plan-aware review),
  - `programAnalysis` (a legacy review, or null; shown only when `analysis` is
    missing),
  - `comment` (the athlete's saved comment, or null),
  - `coachReply` (the latest coach reply, or null).
- `POST /api/coaching/activities/:id/comments` accepts `activityDate` and returns
  `{ message, reply }`. `keepToday` is set when `activityDate === today`; because
  the activity is already recorded, generation refreshes today's completed plan
  instead of preserving a stale summary. It creates the activity's comment and
  returns `409` if one already exists.
- `PUT /api/coaching/activities/:id/comments` accepts the same body. It edits the
  existing comment, regenerates the single coach reply, and returns
  `{ message, reply }`; it returns `404` when the activity has no comment.
- `GET /api/coaching/weekly/notes` returns `{ note, reply }`;
  `POST` returns `{ message, reply }`.
- `GET /api/coaching/activities/manual` returns each activity with its
  `coachReply`. `POST` and `PUT` return `{ message, reply }`.
- `POST /api/coaching/plan/generate` is unchanged; the trigger gains an internal
  `keepToday` option used by the coaching-input routes.

A reply is `{ text, model, generatedAt }` (the existing `CoachAnalysis` shape).
If the LLM is not configured or the reply call fails, the input is still saved
and the reply is null; the failure is logged.

## Prompts

- **Activity analysis** (`activityPrompt`): the prompt contains the activity
  summary, its time series, the athlete's comment when present, and the current
  season, block and week. Within the current week it matches the workout to the
  session planned for its date (or another session that week if the data fits)
  and includes how well it fit. Outside the current week it says no planned
  session is available and asks for a review on the workout's own merits,
  optionally related to the current block's focus. The coach treats the comment
  as authoritative when it explains what the session actually was, so it does
  not ask the athlete to describe an activity again. A comment saved after the
  cached analysis makes that analysis stale; it is regenerated with the comment,
  and any pending question the old analysis asked about the activity is cleared.
  Versioned with `ANALYSIS_PROMPT_VERSION`.
- **Duration tolerance** (`DURATION_TOLERANCE_RULES`): both activity reviews and
  the plan prompts share one rule that a session within a few minutes of its
  planned duration matched the plan, whether a little short or a little long, so
  the coach does not criticise a two-hour hike recorded as 2:05 or suggest a
  shorter route to make up for it.
- **Coach reply** (`coachReplyPrompt`): system prompt asks for a 1–2 sentence
  reply that acknowledges the input, explains the effect on the plan, and states
  what the coach will adjust. The user prompt contains the shared athlete and
  training context every plan prompt gets (profile, recent activities with their
  analyses and comments, manual activities, the weekly note, completed reviews,
  FTP and body histories), the current plan, the forecast stored on today's and
  tomorrow's sessions, and the specific input. The reply is one JSON object:
  `{ "reply": string, "planChangeNeeded": boolean }`. The batched comment reply
  carries the same fields per item. The shared
  `TEXT_FORMATTING_RULES` fragment lets a longer reply use paragraphs and lists
  inside the string. A plain-text answer from a model that ignores the contract
  is kept as the reply and fails open with `planChangeNeeded: true`.
  See `docs/specs/coach-reply-context.md` and
  `docs/specs/llm-text-formatting.md`.
- **Plan generation** (`activityContext`): each activity comment is rendered
  inline under the activity it references, together with an explicit rule that
  the comment describes that same activity and is never additional training.
  Comments for activities outside the recent list stay in a separate section
  with the same rule.

## Generation flow

1. A coaching-input route saves the input and generates the reply, which carries
   `planChangeNeeded`.
2. It then starts the normal plan trigger. The run reads the athlete's text and
   settles today's completion, and pays for the plan-update completion only when
   the reply asks for a change. `keepToday` is true when the input is about
   today.
3. `runPlanGeneration` rebuilds as before. In a plan update, when `keepToday` is
   set and the stored plan is for today, the stored `today` day plan and today's
   week session are preserved **unless an activity was recorded today**. In that
   case the generated today plan keeps the planned prescription and adds a short
   completion note from the latest comment. Everything else (week, tomorrow)
   comes from the new completion.
4. A full build does not run a second activity review. The activity analyses
   already contain the plan-aware summary.

## UI

- `ActivityCard` shows the general analysis, falling back to a legacy program
  review only when the general analysis is missing. It also shows the athlete's
  saved comment and the coach reply. Saving a comment renders the returned reply
  immediately. An activity without a comment shows the comment form; once a
  comment exists the form is replaced by an `Edit comment` action that opens it
  prefilled. Editing regenerates the coach reply and refreshes the plan.
- The main coaching page only lists activities without a response. Commenting on
  an activity leaves it in place for the rest of the visit, even when a plan
  refresh reloads the feed; the next page load drops it now that it has a
  comment. The activities page lists all activities and offers the edit action
  for every existing comment.
- An analysis-driven plan revision starts from the activity feed route itself,
  reusing the feed that was just analysed rather than syncing Garmin twice.
- The coaching-inputs section shows the coach reply under the weekly note and
  under each saved manual activity.

## Acceptance criteria

1. Each recent activity has at most one active review. The general analysis
   includes plan fit when the activity is in the current week, and reviews the
   workout on its own merits otherwise. A plan build, model change or
   prompt-version change does not regenerate a stored review; only a newer
   athlete comment does. A legacy program review is shown only when the general
   analysis is missing.
2. Commenting on or editing an activity returns and persists a brief coach
   reply. The reply's flag decides whether the run pays for a week/day/tomorrow
   revision. When the commented activity is today's, today's completed summary
   is refreshed from the latest comment and no second workout is proposed; this
   still holds when no plan completion runs.
3. Saving a weekly note returns and persists a reply and pays for the revision
   only when the reply judges the note changes the plan.
4. Creating or editing a manual activity returns and persists a reply and pays
   for a revision only when the reply judges the activity changes the plan;
   when its date is today, today's completed summary reflects the manual
   activity while week and tomorrow change.
5. Replies and stored analyses survive a page reload.
6. An activity has at most one comment. A second add is rejected, and editing
   the comment replaces the coach's existing reply and asks for a refresh again.
7. A newly analysed activity that asks for a change revises the remaining week
   and block even when no coaching input changed; an analysis that judges the
   plan unchanged records itself without a plan completion.
8. Today's activity is marked completed (with duration slack) or partial on both
   the day plan and the week plan.
9. A commented activity stays on the main page for the rest of the visit, even
   after a plan refresh.
10. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
    pass.
