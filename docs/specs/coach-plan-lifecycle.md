# Spec: Coach plan storage, lifecycle, and UI

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** `docs/specs/coach-plan-prompts.md`, ADR 0004 (OpenRouter),
  ADR 0009 (next-period planning), ADR 0011 (new season vs update),
  `docs/specs/season-regeneration.md`,
  `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/athlete-question-answers.md`,
  `docs/specs/coach-feedback-and-program-review.md`.

## Goal

Show the athlete a four-level coach plan (season, block, week, today), make the
coach's thinking visible while it is generated, and keep the plan current as
answers change and as days, weeks, and blocks roll over.

## Scope

### In scope

1. Persist the current plan per user in `coach_plans`, including the answer
   timestamp it was generated from.
2. Persist generation progress per user in `plan_generations` so the UI can
   poll and show a real step and percentage while the coach is thinking.
3. Generate the initial plan from the athlete's answers and recent analysed
   Garmin activities when the plan is missing or the answers are stale.
4. Advance the plan lazily when the athlete opens the app:
   - day missing → generate today, then revise the week from what was actually
     done or missed;
   - week missing → generate the new week, then revise the block;
   - block missing → generate the next block, then revise the season.
5. Plan the next period when tomorrow has crossed into it (after 18:00):
   - tomorrow in the next week → generate the next week, leaving the current
     week untouched;
   - tomorrow in the next block → generate the next block and its first week,
     leaving the current block untouched;
   - generate tomorrow's session against that next week and block so the Day
     tab agrees with the Week and Block tabs.
6. Promote the next week and block when today enters them, dropping the ended
   period after its review has been captured.
7. Refresh the remaining season when answers are saved and a season exists, and
   offer explicit "Plan a new season" and "Update season plan" actions on the
   coaching survey and settings pages (not on the dashboard). See
   `docs/specs/season-regeneration.md`.
8. A plan section in the coaching dashboard showing:
   - generation progress (step + bar) while the coach is working;
   - today's workout/rest with alternatives and a note on whether it can be
     skipped (the same note is shown for tomorrow after 18:00);
   - a workout-file download for indoor bike sessions with structured power
     targets, in both the Today and Tomorrow cards (see
     `docs/specs/bike-workout-export.md`);
   - the current week and, after 18:00 when it is planned, the next week;
   - the current block and, after 18:00 when it is planned, the next block;
   - the season;
   - a stale-plan banner and retry/error states;
   - a setup message until Garmin and OpenRouter are configured.
9. Shared Zod schemas for the plan, generation status, pending flags, and
   generation request.

### Out of scope (deferred)

- Cron-driven generation while the athlete is away. The cascade runs when the
  dashboard loads.
- Background workers; generation runs inside the POST request and the UI polls
  a separate status endpoint.
- Plan history/versioning. The previous plan is overwritten once the new one is
  saved.
- Daylight/sunrise/sunset inputs. Implemented separately in
  `docs/specs/location-and-weather.md`; the lifecycle only reacts to a
  significant forecast change.

## Acceptance criteria

1. With Garmin and OpenRouter configured, an athlete with completed onboarding
   sees a progress panel while the initial plan is generated, then the four
   levels. The old plan remains visible during a regeneration.
2. The progress panel shows the current step and a determinate bar, and the plan
   appears without a page reload when generation finishes.
3. Saving changed answers marks the plan stale and starts a regeneration. When
   a season containing today is stored, that regeneration re-plans the rest of
   the season and keeps completed blocks. The survey and settings pages offer
   "Plan a new season" (a fresh season from today) and "Update season plan"
   (refresh the existing season); the update action appears only when a season
   containing today exists. The dashboard offers only "Update plan" on the
   stale banner.
4. On a new day, the first visit generates today's session and revises the rest
   of the week around what the athlete actually did. While that generation runs,
   the out-of-date Today and Tomorrow cards are dimmed behind a spinner labelled
   "Updating today's/tomorrow's plan", so stale content is never presented as
   current. A newly analysed activity also revises the remaining week even when
   the stored day is still current, including past activities imported days
   later (for example a Monday workout first synced on Thursday).
5. On a new week, the first visit generates the new week and revises the block.
6. When the block has ended, the first visit generates the next block and revises
   the season, then cascades down to the week and today.
7. After 18:00, when tomorrow falls in the next week, the plan section generates
   that week and tomorrow's session without changing the current week. When
   tomorrow also falls in the next block, it generates the next block first and
   then that week. The current block and week stay as stored until they end.
8. On the first visit after the current week or block ends, the stored next week
   or next block becomes current, the previous period is summarised, and the
   dashboard shows a single current week and block again.
9. A failed generation leaves the previous plan visible, records the error, and
   offers a retry (regenerate).
10. Generation is not started twice concurrently for the same user.
11. `GET /api/coaching/plan` reports the stored plan, generation status, stale
    flag, and pending day/week/block/next-week/next-block/tomorrow/initial flags
    for the supplied date. The returned plan is normalised so a stored next week
    or block that contains today is shown as current.
12. An explicit update keeps the stored blocks that ended before today and the
    original season start date, refreshes the partially completed current block
    in place with its stored start date, and re-plans the blocks after it. A
    refreshed season that moves the current block's start date is rejected and
    the previous plan stays in place.
13. All four quality gates pass.

## Data model

### `coach_plans`

One row per user (`unique (user_id)`):

- `season`, `block`, `week`, `today` — the current season, block, week and day.
- `next_block`, `next_week` — optional plans for the block and week that contain
  tomorrow when tomorrow has left the current ones (for example Sunday evening).
  They are generated together with tomorrow so the day, week and block agree,
  and are promoted when the date reaches them.
- `tomorrow` — optional `tomorrow` day plan so the UI can show the next day
  without another generation (migration `0009`).
- `day_date`, `week_start_date`, `block_start_date`, `block_end_date`,
  `season_start_date`, `season_end_date` — duplicated calendar dates for
  pending/staleness checks.
- `answers_updated_at` — newest answer timestamp included in the plan.
- `coaching_inputs_updated_at` — newest comment/manual-activity/weekly-note
  timestamp included in the plan.
- `activities_updated_at` — newest activity analysis included in the plan. It is
  deliberately not `generated_at`: an import or analysis can finish while a
  generation is already running, so a plan can be saved later without the new
  activity. Comparing against the included analysis makes the next visit revise
  the plan.
- `generated_at`, `updated_at`.

### `plan_generations`

One row per user (`unique (user_id)`):

- `status` — `idle | running | done | error`.
- `step` — human-readable current step.
- `step_id` — stable key used to learn how long the step takes.
- `progress` — the percentage reached when the current step started.
- `progress_end` — the percentage the current step moves towards.
- `step_started_at` — when the current step began (heartbeats only touch
  `updated_at`).
- `step_expected_ms` — expected duration of the current step, copied from its
  learned average.
- `error` — failure detail, null on success.
- `started_at`, `updated_at`.

While a step runs, `GET` reports `progress` interpolated from the value reached
when the step started towards `progress_end` over `step_expected_ms`. Durations
are learned in `plan_generation_step_durations`, one row per `step_id` with an
exponentially weighted average; a step that has never run uses its default. This
keeps the bar moving during a long LLM call instead of waiting for the next
checkpoint. See `docs/specs/plan-generation-progress.md`.

`begin` inserts the row if needed and flips it to `running` only when it is not
already `running`, so concurrent requests cannot start two generations. A live
generation refreshes `updated_at` every 15 seconds. A `running` row that has not
been refreshed for two minutes is considered abandoned (for example by a server
restart); `GET` records it as an error so the client stops polling and offers
`Try again`, and `begin` may take over the stale claim.

## API

Both routes are behind `requireAuth`.

- `GET /api/coaching/plan?today=YYYY-MM-DD`
  → `{ plan, generatedAt, generation, stale, pending }`.
- `POST /api/coaching/plan/generate` with
  `{ today, timezone?, mode?, force?, includeTomorrow? }`
  → the same response body after generation completes; `202` if a generation is
  already running. `mode` is `auto` (default), `newSeason`, or `updateSeason`;
  `force: true` behaves like `newSeason`.

`stale` is true when the newest current answer is newer than
`coach_plans.answers_updated_at`. `pending.day` is true when the stored day is
not for `today`; `pending.week` is true when `today` is not one of the stored
week's sessions, or when the latest forecast differs significantly from the
weather stored on the current or planned next week (see
`docs/specs/location-and-weather.md`); `pending.block` is true when `today`
falls outside the stored block's dates. After 18:00, `pending.tomorrow` is true
when tomorrow's day plan is missing, is not covered by a stored week, or falls
outside a stored block; `pending.nextWeek` and `pending.nextBlock` are true when
tomorrow has crossed into a period that has not been generated yet.

The `plan` in the response is normalised for `today`: if a stored `next_week` or
`next_block` contains today, it is promoted in the returned plan (and the day
plan for today is taken from `tomorrow` when it matches). Pending flags are
computed from the stored plan, so the first visit after a rollover still starts
a generation that persists the promotion and captures the ended period's
review.

## Generation flow

1. `POST` calls `plan_generations.begin`. If already running, return `202`.
2. Load the stored plan, current answers, recent analysed activities, and the
   LLM client. Fail the generation with a readable error if Garmin or OpenRouter
   is not configured.
3. If there is no plan, the request asks for a new season, or `force` is set,
   build a fresh season in four smaller completions: the season, the block
   containing today, the week containing today (with a block revision), then
   today (with a week revision). If the request asks to update the season, or
   the answers are stale and the stored season contains today, refresh the
   remaining season instead: one completion returns the rest of the season and
   the detailed current block, then the week and today are rebuilt. The stored
   blocks that ended before today and the original season start date are
   restored, and the current block must keep its stored start date, before the
   result is validated. A later weekly revision may not move that start date.
4. Otherwise, treat a coach analysis that was not included in the saved plan as
   a revision trigger too: the new knowledge from the activity must reach the
   remaining week (and, through the weekly prompt, the block). This includes an
   activity imported days later, and an import that finished while an earlier
   generation was still running. Advance the current period first:
   - if `pending.block`, call the block prompt (new block + revised season);
   - if the block changed, coaching inputs or activity analyses changed, or
     `pending.week`, call the weekly prompt (new week + revised block);
   - if the block/week changed, inputs or analyses changed, `pending.day`, or
     tomorrow is missing from the current week, call the daily prompt (today +
     revised week + tomorrow).
5. After 18:00, ensure tomorrow is covered by a week and a block. These steps
   never revise the current week or block when tomorrow has left them:
   - if tomorrow falls outside the current block, call the block prompt to
     create `next_block` (with a revised season);
   - if tomorrow falls outside the current week, call the weekly prompt for
     `startOfWeek(tomorrow)` and store it as `next_week`;
   - call the daily prompt with tomorrow as its day and the target week and
     block, store the returned day as `tomorrow`, and mirror it into that
     week's matching session. The returned week replaces `next_week` (or, for a
     mid-week block transition, the current week's remaining days).
6. Save the plan with the current answer timestamp. When today has entered a
   stored `next_week` or `next_block`, promote it to the current level first.
   After a full build, review recent activities against the finished plan (see
   `docs/specs/coach-feedback-and-program-review.md`), then mark the status
   `done` and return the refreshed response.
7. On any failure, mark the status `error` and leave the previous plan in place.

All LLM responses are parsed defensively (`parsePlanJson`) so markdown fences or
a short prose wrapper do not break the flow, and the shared Zod schemas reject
malformed plans. When a response is valid JSON but has the wrong shape, the
completion gets one repair attempt with the rejected response and the validation
problems; the error names the offending fields if the repair also fails. See
`docs/specs/plan-json-repair.md`.

## UI

- `CoachPlanSection` owns fetching, generation, polling, and the progress
  panel. It polls every 1.5s for up to 10 minutes.
- `CoachPlanView` is the pure presentation of the plan, so it can be tested
  without auth or network. The Day tab shows today and, after 18:00, tomorrow.
  The Week tab shows today's week and, when one has been planned for tomorrow,
  the next week, with each session's description, planned duration, intensity,
  and whether the coach set it indoors or outdoors. The Block tab does the same
  for blocks. If a stored
  plan has today's `completed`/`partial` result missing from today's week
  session, `pending.week` becomes true and the normal weekly + daily cascade
  refreshes the week.
- `CoachDashboard` increments a refresh key after answers are saved, which
  makes the plan section refetch, spot the stale plan, and start the
  regeneration. With a stored season that contains today, that regeneration is
  an update, so completed blocks survive.
- `PlanRegenerationButtons` on the survey and settings pages reads plan
  availability from `GET /api/coaching/plan`, then offers "Plan a new season"
  and, when a season contains today, "Update season plan".
- The plan section is rendered before the profile/integrations so the plan is
  the main surface on each visit.
- The stale banner's "Update plan" is a fallback: the plan section already
  starts an automatic generation when it sees stale answers or a pending level,
  refreshing an existing season. The banner stays available if that automatic
  run failed or the plan is still stale after it finishes.
- A failed generation is surfaced with its error and a "Try again" button. The
  section deliberately does not retry on every page load, so a persistent
  failure cannot turn into an endless run.

## Testing

- Shared schema tests for the plan contract, seven-session weeks, date format,
  alternatives default, optionality defaults, empty responses, and the daily
  update shape.
- API unit tests for pending/staleness, date helpers, JSON parsing, prompt
  contents, the full/day/week/block cascade with in-memory stores and a fake
  provider, new-season and season-update modes, next-week/next-block
  generation, and promotion after the date moves on.
- API route tests for auth, valid/invalid dates, the empty state, full
  generation, the already-running `202` case, and a normalised next period.
- Web render tests for the four-level view (today, week, next week, block, next
  block, season, alternatives, and the goal-linked skip guidance on workouts).
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.

## Risks / open questions

- **Cost:** an initial plan is four smaller completions (season, current block,
  current week, today). A cascade can be up to three. After 18:00, a crossing
  into a new week or block adds up to three more completions (next block, next
  week, tomorrow), and the next period is reused on later visits. Each
  generation first syncs/analyses recent Garmin activities (cached analyses are
  reused). The plan is lazily generated only when needed.
- **Long requests:** generation runs inside the POST. The API already sets a
  255s Bun idle timeout; the UI polls a separate status endpoint so it can show
  progress without waiting for the POST to resolve.
- **Reasoning models:** reasoning tokens count against the output budget. Plan
  calls request `reasoning.effort: "minimal"`; if a model still stops at the
  token limit, `completePlan` retries with reasoning disabled and a doubled
  budget before falling back to the normal budget without reasoning control.
- **Cloud Run:** if the process is terminated mid-generation, its heartbeat
  stops. After two minutes without a refresh, `GET` marks the run as failed and
  the UI offers `Try again`; `begin` can take over the stale claim. A background
  worker is the future fix.
- **Date trust:** the client supplies `today` and its timezone. A personal app
  accepts this; a multi-tenant version should derive the athlete's timezone from
  their profile and validate the date server-side.
- **Plan quality:** the prompts require state of the art training science, but
  the plan is only as good as the profile and activity data. The revision
  cascade keeps it responsive rather than perfect.
