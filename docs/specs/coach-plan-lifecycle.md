# Spec: Coach plan storage, lifecycle, and UI

- **Status:** Accepted (implemented)
- **Date:** 2026-10-21
- **Related:** `docs/specs/coach-plan-prompts.md`, ADR 0004 (OpenRouter),
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
5. Trigger a fresh full plan when answers are saved, and offer an explicit
   "Regenerate plan" action on the coaching survey and settings pages (not on
   the dashboard).
6. A plan section in the coaching dashboard showing:
   - generation progress (step + bar) while the coach is working;
   - today's workout/rest with alternatives and a note on whether it can be
     skipped (the same note is shown for tomorrow after 18:00);
   - the current week, block, and season;
   - a stale-plan banner and retry/error states;
   - a setup message until Garmin and OpenRouter are configured.
7. Shared Zod schemas for the plan, generation status, pending flags, and
   generation request.

### Out of scope (deferred)

- Cron-driven generation while the athlete is away. The cascade runs when the
  dashboard loads.
- Background workers; generation runs inside the POST request and the UI polls
  a separate status endpoint.
- Plan history/versioning. The previous plan is overwritten once the new one is
  saved.
- Weather/daylight inputs in the prompts (the provider seam is ready for it).
- Per-user Garmin/LLM credentials (the single-operator phase continues).

## Acceptance criteria

1. With Garmin and OpenRouter configured, an athlete with completed onboarding
   sees a progress panel while the initial plan is generated, then the four
   levels. The old plan remains visible during a regeneration.
2. The progress panel shows the current step and a determinate bar, and the plan
   appears without a page reload when generation finishes.
3. Saving changed answers marks the plan stale and starts a regeneration; the
   "Regenerate plan" button on the survey and settings pages forces a full
   rebuild. The dashboard offers only "Update plan" on the stale banner.
4. On a new day, the first visit generates today's session and revises the rest
   of the week around what the athlete actually did. A newly analysed activity
   also revises the remaining week even when the stored day is still current,
   including past activities imported days later (for example a Monday workout
   first synced on Thursday).
5. On a new week, the first visit generates the new week and revises the block.
6. When the block has ended, the first visit generates the next block and revises
   the season, then cascades down to the week and today.
7. A failed generation leaves the previous plan visible, records the error, and
   offers a retry (regenerate).
8. Generation is not started twice concurrently for the same user.
9. `GET /api/coaching/plan` reports the stored plan, generation status, stale
   flag, and pending day/week/block/initial flags for the supplied date.
10. All four quality gates pass.

## Data model

### `coach_plans`

One row per user (`unique (user_id)`):

- `season`, `block`, `week`, `today` — `jsonb` copies of the four levels.
- `tomorrow` — optional `jsonb` day plan so the UI can offer tomorrow's session
  after 18:00 without another generation (migration `0009`).
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
- `progress` — integer 0–100.
- `error` — failure detail, null on success.
- `started_at`, `updated_at`.

`begin` inserts the row if needed and flips it to `running` only when it is not
already `running`, so concurrent requests cannot start two generations.

## API

Both routes are behind `requireAuth`.

- `GET /api/coaching/plan?today=YYYY-MM-DD`
  → `{ plan, generatedAt, generation, stale, pending }`.
- `POST /api/coaching/plan/generate` with `{ today, timezone?, force? }`
  → the same response body after generation completes; `202` if a generation is
  already running.

`stale` is true when the newest current answer is newer than
`coach_plans.answers_updated_at`. `pending.day` is true when the stored day is
not for `today`; `pending.week` is true when `today` is not one of the stored
week's sessions; `pending.block` is true when `today` falls outside the stored
block's dates.

## Generation flow

1. `POST` calls `plan_generations.begin`. If already running, return `202`.
2. Load the stored plan, current answers, recent analysed activities, and the
   LLM client. Fail the generation with a readable error if Garmin or OpenRouter
   is not configured.
3. If there is no plan, the answers are stale, or `force` is set, build the plan
   in four smaller completions: the season, the block containing today, the week
   containing today (with a block revision), then today (with a week revision).
   Splitting keeps
   every response comfortably below the model's output budget and gives the
   progress panel real steps.
4. Otherwise, treat a coach analysis that was not included in the saved plan as
   a revision trigger too: the new knowledge from the activity must reach the
   remaining week (and, through the weekly prompt, the block). This includes an
   activity imported days later, and an import that finished while an earlier
   generation was still running.
   - if `pending.block`, call the block prompt (new block + revised season);
   - if the block changed, coaching inputs or activity analyses changed, or
     `pending.week`, call the weekly prompt (new week + revised block);
   - if the block/week changed, inputs or analyses changed, or `pending.day`,
     call the daily prompt (today + revised week).
5. Save the plan with the current answer timestamp. After a full build, review
   recent activities against the finished plan (see
   `docs/specs/coach-feedback-and-program-review.md`), then mark the status
   `done` and return the refreshed response.
6. On any failure, mark the status `error` and leave the previous plan in place.

All LLM responses are parsed defensively (`parsePlanJson`) so markdown fences or
a short prose wrapper do not break the flow, and the shared Zod schemas reject
malformed plans. When a response is valid JSON but has the wrong shape, the
completion gets one repair attempt with the rejected response and the validation
problems; the error names the offending fields if the repair also fails. See
`docs/specs/plan-json-repair.md`.

## UI

- `CoachPlanSection` owns fetching, generation, polling, and the progress
  panel. It polls every 1.5s for up to 10 minutes.
- `CoachPlanView` is the presentational four-level plan, so it can be tested
  without auth or network. If a stored plan has today's `completed`/`partial`
  result missing from today's week session, `pending.week` becomes true and the
  normal weekly + daily cascade refreshes the week.
- `CoachDashboard` increments a refresh key after answers are saved, which
  makes the plan section refetch, spot the stale plan, and start the
  regeneration.
- The plan section is rendered before the profile/integrations so the plan is
  the main surface on each visit.
- The stale banner's "Update plan" is a fallback: the plan section already
  starts a non-forced generation automatically when it sees stale answers or a
  pending level. The banner stays available if that automatic run failed or the
  plan is still stale after it finishes.

## Testing

- Shared schema tests for the plan contract, seven-session weeks, date format,
  alternatives default, optionality defaults, empty responses, and the daily
  update shape.
- API unit tests for pending/staleness, date helpers, JSON parsing, prompt
  contents, and the full/day/week/block cascade with in-memory stores and a fake
  provider.
- API route tests for auth, valid/invalid dates, the empty state, full
  generation, and the already-running `202` case.
- Web render tests for the four-level view (today, week, block, season,
  alternatives, optionality).
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.

## Risks / open questions

- **Cost:** an initial plan is four smaller completions (season, current block,
  current week, today); a cascade can be up to three. Each generation first
  syncs/analyses recent Garmin activities (cached analyses are reused). The
  plan is lazily generated only when needed.
- **Long requests:** generation runs inside the POST. The API already sets a
  255s Bun idle timeout; the UI polls a separate status endpoint so it can show
  progress without waiting for the POST to resolve.
- **Reasoning models:** reasoning tokens count against the output budget. Plan
  calls request `reasoning.effort: "minimal"`; if a model still stops at the
  token limit, `completePlan` retries with reasoning disabled and a doubled
  budget before falling back to the normal budget without reasoning control.
- **Cloud Run:** if the request is terminated mid-generation, the status stays
  `running` until the timeout and the UI reports the delay. A background worker
  is the future fix.
- **Date trust:** the client supplies `today` and its timezone. A personal app
  accepts this; a multi-tenant version should derive the athlete's timezone from
  their profile and validate the date server-side.
- **Plan quality:** the prompts require state of the art training science, but
  the plan is only as good as the profile and activity data. The revision
  cascade keeps it responsive rather than perfect.
