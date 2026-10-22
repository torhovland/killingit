# Spec: Coach feedback on athlete input and program-aware activity reviews

- **Status:** Accepted (implemented)
- **Date:** 2026-10-22
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/garmin-activity-integration.md`, ADR 0004 (OpenRouter).

## Goal

Make the coach feel like it is listening. After a full plan is built, review
recent activities against the plan. After the athlete comments on an activity,
writes a weekly note, or records/edits a manual activity, reply briefly and
refresh the week around the new input without overwriting a workout that has
already happened (or that the athlete is reporting today).

## Scope

### In scope

1. **Program review after a full plan build.** When the plan is created,
   regenerated because answers changed, or rebuilt with `force`, re-analyse each
   recent synced activity against the finished plan. The review says how well
   the activity fit the plan (intent, load, timing, progression) and what could
   have been done better. It is stored separately from the general activity
   analysis and shown in the activity card.
2. **Coach reply to coaching inputs.** Saving an activity comment, a weekly note,
   or a manual activity (create or edit) generates a short plain-text coach
   reply. The reply is persisted and returned from the save endpoint so the UI
   can show it immediately and after a reload.
3. **Refresh around the input.** Every coaching-input save keeps triggering the
   existing weekly + daily revision. The revision now also refreshes tomorrow.
4. **Do not overwrite today's session** when the new input describes today: a
   comment on today's activity, or a manual activity dated today. The stored
   day plan and today's week session are preserved while the rest of the week
   and tomorrow are revised.

### Out of scope

- A chat thread. There is one latest coach reply per input.
- Program reviews for manual activities (they have no synced timeseries).
- Background workers for replies. Replies are generated synchronously; plan
  generation stays in the background.
- Re-running program reviews when nothing about the plan changed.

## Data model

### `activity_analyses`

Add `kind` (`general | program`, default `general`). The unique constraint moves
from `activity_id` to `(activity_id, kind)` so both analyses can coexist.

### `coach_replies`

One latest reply per athlete input:

- `user_id`, `kind` (`activity_comment | weekly_note | manual_activity`),
  `target` (activity id, week start date, or manual activity id), `reply`,
  `model`, `created_at`, `updated_at`.
- Unique `(user_id, kind, target)`; saving a new reply upserts the row.

## API

- `GET /api/coaching/activities` now includes, per activity:
  - `programAnalysis` (or null until the next full plan build),
  - `comment` (the athlete's saved comment, or null),
  - `coachReply` (the latest coach reply, or null).
- `POST /api/coaching/activities/:id/comments` accepts `activityDate` and returns
  `{ message, reply }`. `keepToday` is set when `activityDate === today`.
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

- **Program review** (`programAnalysisPrompt`): system prompt asks for 3–5
  sentences on fit with the program and what could have been done better, citing
  the activity data. The user prompt contains the season goal and rationale, the
  block focus, the week focus and sessions, the session planned for the
  activity's date, the activity summary, its general analysis, and the athlete's
  comment when present. Versioned with `PROGRAM_ANALYSIS_PROMPT_VERSION`.
- **Coach reply** (`coachReplyPrompt`): system prompt asks for a 1–2 sentence
  plain-text reply that acknowledges the input, explains the effect on the plan,
  and states what the coach will adjust. The user prompt contains the current
  plan and the specific input. No JSON and no markdown.

## Generation flow

1. A coaching-input route saves the input and generates the reply.
2. It then starts the normal plan trigger. `keepToday` is true when the input is
   about today.
3. `runPlanGeneration` rebuilds/reviews as before. In the cascade, when
   `keepToday` is set and the stored plan is for today, the generated plan takes
   the stored `today` day plan and the stored week session for today; everything
   else (week, tomorrow) comes from the new completion.
4. A full build calls an injected `reviewActivities(plan)` after saving the plan
   and before marking the generation done. The implementation runs the program
   reviews with bounded concurrency and saves them as `kind = "program"`. Review
   failures are logged and do not fail the plan.

## UI

- `ActivityCard` shows the program review (when present), the athlete's saved
  comment, and the coach reply. Saving a comment renders the returned reply
  immediately.
- The coaching-inputs section shows the coach reply under the weekly note and
  under each saved manual activity.

## Acceptance criteria

1. A full plan build (initial, stale answers, or force) produces a program
   review for recent activities; a day/week cascade alone does not.
2. Commenting on an activity returns and persists a brief coach reply, triggers a
   week/day/tomorrow revision, and does not change today's session when the
   commented activity is today's.
3. Saving a weekly note returns and persists a reply and keeps triggering the
   revision.
4. Creating or editing a manual activity returns and persists a reply; when its
   date is today, today's session is preserved while week and tomorrow change.
5. Replies and program reviews survive a page reload.
6. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.
