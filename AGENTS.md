# AGENTS.md

## Project Overview

This repository contains an **AI coach app** that is currently under
development. The application uses AI to provide a dynamic training program
that reacts to the user's workouts and updates its advice based on that.

The project is in active development and its structure is still taking shape.
Treat unfamiliar files with care; they may be in-progress work by other
contributors. Investigate before modifying or deleting anything you did not
create.

## Definitions

- **AI coach app** — an application that uses AI to provide a dynamic training
  program.
- **Training block** — a segment of the season made up of a number of weeks
  with a given focus or composition. It may be a traditional block (base,
  build, specialization, taper, …) but does not have to be.
- **Athlete profile** — the structured input a user provides about themselves
  and their training (see "Product").

## Product

The app coaches **amateur athletes**. Onboarding prompts the user for input
describing what kind of coaching they want, their age and location, how much
they want to work out, their goals, their current performance, and similar.
This input forms the athlete profile.

The user can connect their training data from sources such as **Garmin**,
**Strava**, and **Wahoo**.

The app connects to an **LLM** that generates coaching based on the athlete
profile and connected training data. It produces a plan for:

- the season,
- the current training block,
- the current week, and
- today.

It also takes **weather data** and **daylight data** (for the athlete's
location) into account.

The user can revise their input at any time, and the app regenerates the
affected plans.

Most importantly, on each visit the user sees a **suggested workout (or rest)
for today**, possibly with some alternatives as well.

On each visit the user can also get coach analysis of the current season,
block, and week, as well as the last workout. They can provide additional input
about a past workout, or before a suggested workout, to steer the coach.

### LLM

- We use a model from **OpenRouter** by default.
- The user supplies their own API key for OpenRouter; another provider can be
  added later. The LLM integration sits behind a provider-agnostic interface so
  provider choice can be added without rework.
- The current implementation lives behind `LlmProvider`
  (`apps/api/src/llm/openrouter.ts`). Each account's API key is encrypted at
  rest and its chosen model stored in `llm_settings`. Activity analyses are
  cached per account in `activity_analyses`. The general analysis is the single
  plan-aware review: it includes plan fit when the activity is in the current
  week and otherwise reviews the workout on its own merits with the block focus
  as context. A stored analysis is reused regardless of the selected model or
  prompt version, so neither a model change nor a prompt edit re-bills the
  athlete, and a plan build does not add a second program-only review. Only a
  newer athlete comment makes a stored analysis stale; legacy `program` rows
  remain a display fallback. The analysis and every coach reply carry the
  coach's `planChangeNeeded` judgement: an input is context only unless it
  changes what the coach would prescribe, and the plan refreshes only when the
  flag is set. A missing or unparsable flag fails open. A new analysis is still
  picked up so today's completion and training load settle, but the plan
  completion is skipped when it judged the plan unchanged. See
  `docs/specs/coach-feedback-and-program-review.md` and
  `docs/specs/plan-refresh-judgement.md`. See ADR 0004 and ADR 0029.
- The model picker is backed by a graded catalog in `llm_models`, refreshed in
  the background at most once every 24 hours (`llm_model_sync`). The Settings
  page selects a season/block model and a separate day-to-day model; both IDs
  live in `llm_settings`. Retired selections are refused with a prompt to open
  Settings; a discouraged selection is allowed but shows a danger warning below
  the models table. Grades come from the prompts benchmark, which runs
  both the today prompt and a drastic season-revision prompt, sums their time
  and cost, and grades ability F when the revision omits Atlas, leaves block 1
  unchanged or moves block 1's start date. The catalog also stores each model's
  prompt and completion list price in USD per million tokens, refreshed with the
  model list, and an unbenchmarked model gets a price grade from those prices
  (variable pricing stays `?`). Grades are re-run for ungraded
  models with `PENDING_ONLY=1`, re-score models at or above a grade while
  keeping every ungraded model with `RESCORE_MIN_ABILITY`, or re-score only
  models with one exact cost grade with `RESCORE_COST_GRADE` (for example
  `RESCORE_COST_GRADE=A+`); benchmark calls use the dedicated
  `BENCHMARK_OPENROUTER_API_KEY`, and a model that reaches the speed-F limit is
  recorded as ungraded (`?`) rather than F; see
  `docs/specs/llm-model-catalog.md` and ADR 0016.
- Every completion attempt is stored in `llm_calls` with its full messages,
  response or error, model, usage, and request metadata. The admin settings
  page lists them under "LLM prompts" (`GET /api/admin/llm-calls`). Logging is
  admin-only and fail-open, so a log write can never break coaching. See
  `docs/specs/llm-call-log.md`. OpenRouter's reported `usage.cost` is stored
  per call, and the **AI costs** page (above Settings in the menu,
  `GET /api/llm/costs`) charts monthly and daily spend stacked either by model
  or by prompt type for the account; calls written before cost capture are
  estimated from token usage and the catalog's current list prices. See
  `docs/specs/ai-costs.md`. All reusable
  prompt fragments and JSON contracts live in
  `apps/api/src/llm/promptRules.ts`; the build, update,
  activity-review and manual-TSS prompts compose them so TSS, FTP, weather,
  bike-workout, body-metric and week-outline behaviour stays consistent across
  prompts. A parity test (`apps/api/src/llm/promptContracts.test.ts`) compares
  every contract with the Zod schema that parses the coach's answer, so a field
  that exists on one side only fails CI instead of leaving the model and the
  schema out of step. A shared personality rule gives every plan, review, reply and meal
  comment the voice of a human coach who is tough but warm, relaxed and
  good-humoured, uses humour sparingly, never calls itself an AI, may use the
  athlete's provided first name when it is a real name, and may show pride or a
  trace of disappointment without overdoing it. A race or an effort far above
  the athlete's ordinary training that is performed well earns an explicit
  "you are killing it", and one workout review in fifteen extends that praise to
  any well-executed workout; see `docs/specs/coach-praise.md`. A new season also
  carries the coach's `introduction`, a short greeting that is shown on the
  Season tab and preserved by later refreshes; see
  `docs/specs/coach-personality.md`. A shared judgement rule keeps the coach
  ambitious rather than over-cautious, accommodates a workout the athlete has
  committed to, and treats feedback about how they feel as evidence for the
  coach's decision rather than an instruction to change the plan; see
  `docs/specs/coach-judgement.md`. Every
  prompt that answers the athlete — a reply to a comment, a weekly
  note, a manual activity or a review, an answer to a coach question, and a
  one-off coaching question — carries the same athlete and training context as
  the plan prompts, built from the last synced activity feed and the stored
  coaching inputs, with the forecast stored on the plan; see
  `docs/specs/coach-reply-context.md`.
- Long coach text — a workout's description, a plan's rationale, a review, an
  activity analysis or a coach reply — uses a shared plain-text structure:
  paragraphs separated by blank lines, `- ` bullets and `1. ` numbered items.
  `TEXT_FORMATTING_RULES` owns the instruction in every plan, review and reply
  prompt, and the web app's `FormattedText` component renders the structure as
  HTML paragraphs and lists. See `docs/specs/llm-text-formatting.md`.
- The four-level plan is stored per user in `coach_plans`; generation progress
  is in `plan_generations`. Coach work is latest-wins: a new save claims the
  user's run id, aborts the previous in-process provider request, and every
  status write and plan save is fenced by that run id. A run first answers every
  unanswered activity comment in one batched completion, stores those replies,
  and then refreshes the plan when a reply asks for a change, so replies appear
  before the slower plan phase.
  See `docs/specs/coach-run-cancellation.md` and ADR 0014. After 18:00 the stored
  plan also carries tomorrow's session and, when tomorrow has crossed a week or
  block boundary, the next week and next block, so the Day, Week and Block tabs
  agree. The next period is promoted when today reaches it. Explicit
  regeneration can start a new season from today or update the remaining part of
  the stored season; stale answers update an existing season by default. See
  `docs/specs/season-regeneration.md` and ADR 0011. Every lazy update (a day,
  week, block or season refresh) sends all current levels to one prompt and
  applies the returned block, week, day, next week, next block and tomorrow that
  the update requested; the plan UI is documented in
  `docs/specs/coach-plan-lifecycle.md` and ADR 0013. Every path that saves a plan
  settles and post-processes it through one `finalizePlan` pipeline, so a fresh
  build, an update and a stored-plan re-save cannot order the completion, the
  outline, the forecast, the diet targets and the training load differently; see
  `docs/specs/plan-finalisation.md`. Every write checks that the
  season's blocks tile the season — each block starts the day after the previous
  one ends — and rejects an overlap or a gap with an error naming both blocks, so
  no update can store blocks that later refreshes would reproduce; the shared
  `SEASON_BLOCK_RULES` prompt fragment states the rule. See
  `docs/specs/season-block-boundaries.md`. Week and next-week plans
  are outlines: every session keeps a brief session type, focus, approximate
  duration and intensity, estimated TSS, and the week's estimated FTP, while
  only the `today` and `tomorrow` day objects are fully detailed. A completed or
  missed day keeps its outline and status instead of being replaced by an
  activity summary. See `docs/specs/week-outline.md`. Indoor bike workouts with
  power targets carry a structured `bikeWorkout` on the day plan and can be
  downloaded as ZWO files from the Day tab; see
  `docs/specs/coach-plan-lifecycle.md` and
  `docs/specs/bike-workout-export.md`.
- Plan completions use a 16,384-token output budget, with reasoning fallbacks up
  to 32,768, so reasoning models can think and still return the complete JSON.
  A completion tries at most four configurations and one plan level bills at
  most six completions, including its JSON repair turns, inside one 300 s
  wall-clock budget; only a truncated response and a 400 rejection are retried,
  and an invalid key, insufficient credits, an unknown model, a rate limit or a
  transport failure ends the call immediately. See
  `docs/specs/llm-completion-budget.md`.
  Model comparisons run through `bun run benchmark:llm` against the test
  athlete; the harness is the `@killingit/benchmark` workspace in
  `tools/benchmark`, and results and quality notes are kept under
  `benchmarks/llm-coach/`. The first model in a run is the benchmark. The
  two-prompt catalog benchmark runs from the same workspace through
  `bun run benchmark:prompts <stage>`, with `run`, `judge`, `finalize`,
  `shortlist`, `sync-db` and `report` stages; judging is optional and every
  model call goes through the app's `LlmProvider`. Its two prompts are built by
  the app's own prompt builders from the fixture athlete in
  `tools/benchmark/src/promptBenchmarkFixture.ts`, and a snapshot test pins the
  built text, so a prompt change fails the suite until the snapshot is
  deliberately updated. Its run directories and generated HTML/PDF reports are
  local output and ignored by git; see `benchmarks/README.md`. See
  `docs/specs/llm-benchmark.md` and ADR 0032.
- The athlete's home location is stored on `users` and set in the settings
  location picker. When a week or day is planned, the API loads Open-Meteo and
  Yr.no forecasts, including sunrise and sunset, builds an averaged combined
  forecast, gives the combined forecast to the coach, and attaches all three to
  sessions. The UI shows them on workouts that can be done outdoors, including
  flexible sessions the coach planned indoors, and hides them for indoor-only
  sessions and rest days. A significant change in the combined forecast marks
  the week pending and refreshes the week and day. See ADR 0008, ADR 0010, and
  `docs/specs/location-and-weather.md`.
- Threshold measurements and body weight/body-fat percentage are stored as
  daily time series, with a source of `user`, `garmin`, or `coach`. Thresholds
  live in `athlete_thresholds`, keyed by sport, measure, and date, with a display
  label, unit, and kind (`power`, `heart_rate`, `pace`, `speed`, `stress`, or
  `other`). A sport can have several measures, such as cycling FTP and cycling
  threshold heart rate. Body metrics stay in `athlete_metrics`.
  The athlete's stated thresholds, weight, and body fat are read by the coach,
  not by a phrase list: one dedicated `athlete_reading` call sends the profile,
  every dated piece of athlete text — comments, manual activities, weekly notes,
  review comments, and answered coach questions — and returns both dated
  statements and the dated goals and events described below. Sending the text
  once covers both readings.
  A threshold statement with no sport is not stored; the app asks which sport
  it belongs to first. A profile number with no date of its own is dated by the
  profile's last save. A successful read replaces the `user` points of the
  metrics it reports, so a value edited out of a comment disappears, while
  Garmin values and coach estimates are untouched. The reading runs before every
  plan generation and fails open.
  The coach's per-day `coach_plans` FTP estimates and the structured FTP
  estimate in each activity analysis are stored as `coach` threshold points; a
  newer estimate deletes later coach estimates but never an athlete
  measurement. Every plan and activity-analysis prompt receives the threshold
  and body-measurement history. Garmin weigh-ins and FTP supplement the
  athlete's values; on a conflict for the same date the athlete's own value
  wins, then Garmin, then a coach estimate. Activities are scored with the
  threshold for their sport: power
  first, then pace or speed, then heart rate, with a duration-based fallback
  when the sport has no usable threshold.
  The Fitness page charts one **Estimated threshold** line per measure, grouped
  by unit, and completed weeks before a revised FTP test are re-interpolated.
  Every plan response also carries a dated `bodyMetrics` array and
  an activity analysis carries `weightKg`/`bodyFatPercent` for its date, filled
  only from numbers the athlete stated in the profile, a note, or a comment.
  They are stored as `coach` points (a `user` or `garmin` value for the day
  wins) so the Fitness page charts a body trend before Garmin is connected.
  Sessions get a TSS from the sport's measured threshold data or a structured
  indoor bike workout when available, and from the coach's estimate otherwise;
  the API then calculates ATL, CTL, and TSB day by day and shows them in the
  Today, Tomorrow, and Week views and on the Activities page. Each recorded
  activity on the Activities page shows its own TSS with the day's fitness
  snapshot, so two workouts on one day do not repeat the day's total. TSB
  carries a coloured form label (Risk, Productive, Maintaining, Fresh,
  Detraining). Every plan prompt receives today's current form and each
  projected session's ATL, CTL, TSB, and form label, and a shared rule asks the
  coach to keep the planned week in Productive unless a recovery, taper, or
  deliberate overload is explained in the week's rationale; see
  `docs/specs/coach-form-awareness.md`.
  Garmin syncs the last 42 days of activities, body composition, and historic
  cycling FTP, and power metrics are stored on activity summaries so the raw
  timeseries is not needed. The weigh-in/FTP refresh and the daily-health
  backfill are one shared fail-open pass, `syncGarminSupplements`, in
  `apps/api/src/garmin/supplements.ts`, used by both the activity feed and
  `GET /api/garmin/activities`, and dated by the athlete's local day.
  Every sidecar call has a request timeout, and the
  `/sync` activities are validated against the shared `activitySchema`, so a
  hung or malformed sidecar fails with a typed error instead of entering the
  stored feed. Activity summaries also store average and maximum
  speed; the UI and prompts show pace for running, walking, hiking, swimming
  and rowing (per 100 m for swims and per 500 m for rows) and speed for cycling.
  Each synced activity is one row in `activities`, so history keeps every
  activity ever synced rather than replacing it on each sync, while only the
  newest 20 are analysed. The Calendar, fitness, manual-activity and prompt
  loaders read only the summary columns; the bounded sample preview and GPS
  route are JSONB columns that the activity feed and the calendar's route map
  select on demand. A sync writes only its 42-day window and deletes locally
  removed rows, and the coach's analysis and the athlete's feedback stay in
  their own tables instead of being duplicated on the activity. The feed loads
  in named phases — sync, inputs, analysis, assembly — so each failure path
  stays with the phase that can fail; a failed read of the stored history
  aborts the sync instead of reporting an empty one. The phases live in
  `apps/api/src/coaching/feed/` (`sync.ts`, `analysis.ts`, `presenter.ts`), with
  the feed's own credential errors in `feed/errors.ts`; `coaching/activities.ts`
  is only the orchestrator that runs them. See
  `docs/specs/activity-store.md`, `docs/specs/activity-feed-loading.md`,
  ADR 0034 and ADR 0037. One analysis pass runs per
  account at a time, shared by overlapping requests for the same athlete day;
  an explicit refresh, or a request for another day, waits for the running
  pass and then starts its own, so two passes never write the same analyses at
  once. See `docs/specs/activity-analysis-sharing.md`. Each activity in the
  feed also carries a bounded,
  downsampled sample preview, shown as a collapsible table on the Activities
  page. Running cadence is normalized to total steps per minute and cycling
  cadence to rpm, matching Garmin Connect. Strength activities also carry their
  recorded exercise sets, repetitions, weights and rest intervals, and the
  activity analysis uses them; see
  `docs/specs/garmin-strength-exercise-sets.md`. Activities also carry their
  recorded laps with per-lap duration, distance, average and maximum power,
  average and maximum heart rate, average speed, cadence and elevation, shown
  as a collapsible table and given to the activity analysis and plan prompts so
  the coach can judge interval structure. A single lap is
  treated as no laps, since it only restates the whole activity; see
  `docs/specs/garmin-activity-laps.md`. Further sport-specific Garmin
  metrics and their proposed data model are assessed in
  `docs/specs/garmin-activity-metrics.md`. An activity belongs to the athlete's
  local calendar day, read from its UTC `startDate` in the effective time zone
  (the request's zone, else `users.timezone`, else UTC), through the shared
  `activityLocalDate` helper; today's status, completed and missed sessions,
  TSS/ATL/CTL, the Fitness chart, the calendar and the coach prompts all use the
  same day. See `docs/specs/activity-local-date.md`.
  Daily health and recovery values (sleep, HRV, resting heart rate, stress,
  Body Battery, training readiness, recovery time, VO2max, SpO2, respiration,
  steps, calories and intensity minutes) are backfilled one day at a time after
  the activity sync, with a per-day watermark that lets a rate-limited backfill
  resume. A sleep window Garmin has not confirmed, or one whose total is still
  zero, is skipped so the last completed night stays in the series. Today's
  Body Battery high and low are running values, so the prompts and the Fitness
  page's Today panel use the last completed day until today is over. A curated
  14-day summary is given to the plan, reply, review and activity-analysis
  prompts, and the Fitness page's Today panel lists the newest Garmin value for
  each measure; see `docs/specs/garmin-daily-health-metrics.md`.
  Manual activities get a coach-estimated TSS read from their free text, stored
  in `manual_activities.estimated_tss`; without a model the entry stays
  unscored. Any manual
  edit or Garmin import rebuilds the full daily series, so every later
  activity's load is recalculated. The Fitness page charts that series with the
  TSB zone colours, the estimated thresholds, and interpolated body weight/body
  fat with a best-fit projection to the plan's last day (`GET /api/fitness`). See
  `docs/specs/training-load.md`, `docs/specs/fitness-page.md`,
  `docs/specs/body-metrics.md`, `docs/specs/threshold-metrics.md`, ADR 0012, and
  ADR 0015.
- Completed weeks and blocks get a coach summary, athlete comment, and coach
  reply in `period_reviews` / `coach_replies`; the dashboard and season review
  page are documented in `docs/specs/period-reviews.md`.
- Structured coach responses may ask the athlete one clarification question
  (`coachQuestion`) and report the model's own difficulties or objections
  (`modelsRemarks`). There is at most one pending question per account: a new
  question replaces it, and answering it leaves none behind. The pending
  question is shown on the dashboard, answered questions are kept for the
  season review, and recent non-null model remarks are listed in the admin
  settings page. A new season plan or season
  refresh clears unanswered questions first, so no stale question survives the
  plan it was about. See `docs/specs/coach-questions.md`.
- The Coaching survey page shows updated, new, and answered questions, with
  every answer editable in place and a copy-old-answer action for a revised
  question. Any new or changed answer is appended to
  `coaching_survey_adjustments`; the next season refresh receives those
  adjustments in its prompt and clears only the ones it loaded after a
  successful save, so an answer edited mid-run reaches the next refresh. See
  `docs/specs/coaching-survey-updates.md`.
- Dated goals and events the athlete states — a race, a sportive, a trip, or a
  dated target — are read from the same athlete text by the same
  `athlete_reading` call and stored in `athlete_events`. A successful read
  replaces the stored list, so an event edited out of a comment disappears, and
  a failed read keeps the previous list. The calendar shows a multi-day event on
  every day it covers, the Week and Day tabs list the events inside their
  period, and every plan prompt receives the list so the coach plans a taper, a
  race, or a trip around it. See `docs/specs/athlete-events.md`.
- A Calendar page shows a month of recorded activities, planned workouts and
  rest days, with block starts, the season end, and the athlete's dated goals
  and events. The page uses a wider content panel than the other pages so the
  month grid fits without a horizontal scroll on desktop. The box to the left
  of each Monday row gives the week's block, number, focus and target load plus
  its planned and completed time and TSS; the planned totals are recorded per
  week in `plan_week_totals` when a plan is saved, so a completed week keeps its
  planned record after the coach moves on, and a future week with nothing
  planned hides its statistics. Selecting an entry opens its full details,
  including the athlete comment, coach reply, and the route map for outdoor
  activities. See `docs/specs/calendar-page.md`.
- The athlete can opt in to diet advice in Settings (`users.diet_advice`), and
  that checkbox is the single switch for every diet feature. The dashboard then
  starts with a food log form: an optional description, an optional camera or
  gallery photo, and a meal time that defaults to now; a photo alone is enough.
  `POST /api/diet/entries` sends the full-resolution photo to the coach, derives
  the stored thumbnail from it with Jimp, and asks the coach to add what the
  photo confirms or shows beyond the athlete's own description, estimate carbs,
  protein, fat and calories, and comment on how it fits the diet. The result
  lives in `food_entries`, and a failed analysis keeps the meal with an
  `analysisError`. Thumbnails are served from the authenticated
  `GET /api/diet/entries/:id/photo` endpoint; the Diet page lists every meal
  with the thumbnail and the coach response, and lets the athlete edit a meal.
  Saving an edit (`PATCH /api/diet/entries/:id`) re-runs the analysis with the
  saved description, time and photo, or with the stored thumbnail when no new
  photo is attached; the prompt also carries the stored description and
  previous analysis so the coach adjusts that assessment rather than starting
  over. Every coach prompt sees the meals
  from the last seven days and a weekly nutrition summary for each completed
  week up to one year back. The plan carries the athlete's diet goal and the
  coach's weight-trend assessment in `coach_plans.diet`, and every week session
  and day plan carries the coach's per-day `estimatedCaloriesKcal` and a
  `calorieBreakdown` of base metabolism, workout requirement and diet deficit
  whose sum is the allocated intake; the Today card and the Diet page show that
  breakdown and say the parts start rough until meals and weigh-ins refine them
  (`docs/specs/calorie-breakdown.md`). A stated fat-loss goal keeps a
  best-effort deficit even when data is thin; only an explained taper, race,
  recovery or build hold may use 0. The goal defaults to maintenance when the
  athlete states none. `GET /api/diet/summary` groups meals under their local
  day and joins them to the stored target, and the Diet page shows the goal and
  assessment at the top, today's breakdown/logged/remaining calories, and each
  day's deficit or surplus. The Fitness page charts
  logged calories against the needed line. Saving a plan records each day's
  target in `plan_day_calories`, so the requirement survives the week leaving
  the stored plan. The coach judges the weight trend from the tracked weights
  and its earlier targets; the app never computes the deficit. When the athlete
  states a goal, the plan also carries the coach's `dietProgress` target on the
  season, each block, the block, each week, and the week: a weight, a body-fat
  percentage, or both, plus a short note, and it follows the training focus
  rather than a linear weekly change. A stated numeric weight or body-fat goal
  is the destination for its date: the target at the goal date (the first week
  or block end on or after it, or the season end when no date is given) must
  reach it, while a later muscle-building block or race may hold or gain. A goal
  date can be mid-season. A deliberate miss is allowed only with a specific
  `diet.goalMissReason`; the early and off-season blocks still carry most of the
  loss instead of holding at a high body-fat percentage. The coach re-plans the
  targets it returns on a plan refresh from the latest weigh-ins; a stated goal
  with a missing current or future target marks the plan pending and makes a
  progress-only refresh that changes only the targets. The Body chart can extend
  to the season end and draws those targets as a dotted line. A default goal
  makes the Diet page point the athlete to the Coaching Survey. See `docs/specs/diet-log.md`,
  `docs/specs/diet-coaching.md`, `docs/specs/diet-progress-targets.md`, and ADR
  0019/0020/0021.
- The Settings page ends with a Delete account section. After a warning modal is
  confirmed, `DELETE /api/me` deletes the account row, and the schema's cascades
  remove every plan, activity, connection, and coach message owned by it. The
  app then signs out so the still-valid token cannot recreate the account. See
  `docs/specs/account-deletion.md`.

## Stack

The stack below describes the current implementation. Anything not yet built is
marked **planned** here. See "Development Methodology" for how decisions are
made and recorded, and `docs/adrs/` for the accepted ones.

### Frontend

- **React** with **TypeScript**.
- Every top-level page has a canonical URL (`/coach`, `/diet`, `/fitness`,
  `/calendar`, `/activities`, `/season-review`, `/survey`, `/costs`,
  `/settings`, `/admin`). `apps/web/src/navigation.tsx` owns the page
  definitions and a minimal `useSyncExternalStore` History binding, and
  `apps/web/src/PageOutlet.tsx` maps each page to its component. `/` and
  unknown paths replace to `/coach`; the survey gate and the admin guard
  redirect with `replaceState`. See `docs/specs/web-routing.md` and ADR 0031.
- The web app is an installable **PWA**. A build-time service worker precaches
  the static app shell, serves the last shell offline, and leaves `/api/*`
  uncached because API responses are per-account. The build stamps one
  content-hash build id into `index.html` and the worker, so a worker for the
  shell a visit already loaded activates silently and only a genuinely stale
  page shows the reload banner. The manifest, icons, offline page, and install
  state live with the web app; see `docs/specs/pwa.md` and ADR 0018.
- Every API request carries the shared contract version
  (`x-killingit-api-version`). The API refuses an unsupported build with `426`,
  and the web reloads once and then shows its update banner instead of failing
  with a schema error on whichever request came first. Deploy the API before the
  web and keep the previous version supported for one release; see
  `docs/specs/api-versioning.md` and ADR 0028.
- Every failed API response uses the shared error contract
  `{ error: { code, message, details? } }` from
  `packages/shared/src/apiError.ts`, produced by the helpers in
  `apps/api/src/http/errors.ts` and the validating `zValidator` wrapper in
  `apps/api/src/http/validation.ts`. The web reads it in `fetchJson`, exposing
  `ApiError.code` and `ApiError.details` and showing the server's `message` as
  the error text. Only the last-resort `500` stays plain text; see
  `docs/specs/api-errors.md`. A failure from Garmin, the Garmin sidecar or
  OpenRouter extends `UpstreamError`, which owns the status (and, when it needs
  one, the code) it is reported with; a route answers its whole error path with
  `respondUpstreamError(c, err, label)` instead of matching provider classes.
  A third-party connection the athlete can fix is never `401`: only a request
  without a usable app session answers that. A missing Garmin connection is
  `409` `garmin_not_connected`, and a credential Garmin or OpenRouter rejects is
  `422` `garmin_auth_failed` or `llm_key_invalid`, so the web's renew-and-retry
  never fires for it. See ADR 0035 and ADR 0036.
- Authenticated API reads go through `requestParsed` in
  `apps/web/src/fetchAuthed.ts`: it fetches with `fetchJsonAuthed`, validates the
  body against the shared schema, and throws one `ResponseValidationError`
  whose message names the action and whose cause is the schema error. Call
  sites must not hand-write `safeParse` plus their own throw; see
  `docs/specs/web-api-request-parsing.md`. A page or hook that loads a resource
  uses `useApiResource` / `useApiResources` from
  `apps/web/src/useApiResource.ts` instead of hand-writing a loading/error
  effect: the hook owns the `AbortController` (so a superseded or unmounted
  load cancels its request and never surfaces as an error), the loading and
  error state, `reload`, and the optional app-status registration. The path is
  the effect key, and `RequestInit.signal` is threaded through `requestParsed`
  to the native fetch; see `docs/specs/web-api-resource-hook.md`.
- We build our own **component library** under `apps/web/src/components/`.
  `Button`, `Input`, `Textarea`, `Select`, `Card`, `HiddenFileInput`,
  `StatusBadge` and `Modal` are the primitives; page components stay flat in
  `apps/web/src/` beside their tests, while a page's own sections may move into
  a named directory (`plan/` holds the coach plan's tab sections). `Modal` owns
  the backdrop, focus trap, Escape close and focus restore for every dialog.
  Add a primitive when markup and styling are genuinely shared instead of
  repeating a class string in a page. See
  `docs/specs/web-component-library.md`, `docs/specs/modal-dialog.md` and
  ADR 0027.
- Web unit tests render components for real: `@testing-library/react` and
  `@testing-library/user-event` run against `happy-dom`, registered as a
  `bun:test` preload in `apps/web/bunfig.toml` with `src/testSetup.ts`. Effects,
  clicks, typing, focus, Escape and dialogs are exercised in-process, so a test
  that needs to observe state uses a render and a query instead of
  `renderToStaticMarkup`; the static renderer is only for assertions about the
  exact markup. Every `Modal` dialog, `useApiResource` load, race and abort has
  such a test. See `docs/specs/web-interaction-tests.md`.
- Every web hook is checked by `eslint-plugin-react-hooks`:
  `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` are errors in
  `eslint.config.js`. `useAuth` returns a stable session object, so an effect
  lists `auth` or `auth.getToken` instead of narrowing to
  `auth.isAuthenticated`; see `docs/specs/auth-integration.md`.
- **Tailwind CSS** (v4, through `@tailwindcss/vite`) is the styling foundation.
  The primitives compose utility classes through `cn()`, which combines `clsx`
  and `tailwind-merge` so a caller's `className` overrides a default. The
  approach follows shadcn/ui — component source is ours and lives in the repo —
  but there is no shadcn source and no Radix dependency.

#### CSS strategy

- **Global styling first.** Design tokens — colors, spacing, typography,
  radii, shadows — live as CSS variables in `apps/web/src/index.css`, with the
  Tailwind utilities generated by its `@theme inline` block. Global resets and
  base element styles live there too.
- **Component styling** is colocated in the component via Tailwind utility
  classes that reference the global tokens. Compose a primitive's `variant` and
  `size` first and pass `className` only for layout or a deliberate override;
  do not repeat a primitive's base string in a page.
- **Page styles** should go into the React page only when that is the only
  sensible place (e.g. page-specific layout). Keep pages thin; extract
  reusable layout/components instead.
- Use `cn()` (tailwind-merge + clsx) for predictable class merging. Avoid
  inline `style=` attributes and hard-coded colors; reference tokens.

### Backend

One TypeScript stack end-to-end keeps a single language and shared types
across frontend and backend:

- **Language/runtime:** TypeScript on **Bun** (monorepo via Bun workspaces).
- **API framework:** **Hono** — lightweight, TypeScript-first, runs on Node/Bun
  and edge runtimes, and pairs cleanly with Drizzle. (Fallback: **Fastify**.)
- **ORM:** **Drizzle ORM** — SQL-first and fully type-safe. (Fallback:
  **Prisma**.)
- **Validation:** **Zod** — shared between API handlers and frontend forms.
- **API contract:** shared Zod schemas validated on both sides — the API
  validates input with `zValidator`, and the web validates every response with
  `requestParsed` — rather than a generated client or tRPC.

### Monorepo layout

- Bun workspaces under `apps/*`, `packages/*` and `tools/*`:
  - `apps/web` — React + Vite + Tailwind frontend
  - `apps/api` — Hono + Drizzle backend
  - `packages/shared` — shared Zod schemas and TypeScript types
  - `tools/benchmark` — LLM benchmark harness and model-catalog grading
    queries, run by `bun run benchmark:llm` and `bun run benchmark:prompts`;
    it imports the real plan pipeline from `apps/api`. See ADR 0032.

### Database

- **PostgreSQL** on Neon in production and in Docker locally.

### Hosting

- **API:** Google Cloud Run (always-free tier, `us-central1`, scales to zero).
- **Database:** Neon Postgres free tier.
- **Web:** Cloudflare Pages.
- **CI/CD:** GitHub Actions; test deploys on `main`, production needs a manual
  approval.

See ADR 0001 and the deployment runbook in `README.md`.

### Auth (third-party login)

We need login via Strava, Garmin, Google, Apple, and others. Google and Apple
are standard "social" IdPs; **Strava and Garmin are the unusual cases** — they
are not built into most auth SaaS and must be configured as **custom
OAuth 2.0** connections.

- **Recommendation: Auth0 Free plan.** It includes 25k monthly active users,
  and (as of the 2024 plan refresh) unlimited social connections **and custom
  social connections**. Google and Apple are native; Strava and Garmin are set
  up as social connections (native where a Marketplace integration exists,
  custom OAuth 2.0 otherwise).
- **Decision / verification:** see ADR 0002. Auth0's own docs disagree on the
  Free plan's social-connection limit ("unlimited" on the pricing page vs "a
  maximum of two" in the Entity Limit Policy). All four of our connections are
  **social** (not enterprise), and the Free plan includes 1 Enterprise
  Connection, so no paid feature is required. The tenant dashboard was checked
  on 2026-10-13 and Free accepts the custom social connections, so the gate is
  closed; registering our own Strava and Garmin apps is still required, because
  Auth0's dev keys cannot request the data scopes. See ADR 0002.
- **Fallback ("build it ourselves"):** self-host **Better Auth** (open source,
  TypeScript, MIT) in our backend. It supports arbitrary OAuth2 providers
  (Google, Apple, Strava, Garmin) at no licensing cost; we own the operational
  responsibility.
- Rejected alternatives: **Kinde** (custom OAuth2 is Pro-only, not free) and
  **Clerk** (free tier limits social connections and custom providers).

Regardless of provider, the Strava/Garmin connections must also grant the data
scopes we need to pull training data — not just identity.

Application roles live in the `users` table, not in provider tokens. The admin
is provisioned explicitly: the account whose auth subject matches the API's
`ADMIN_AUTH_SUBJECT` environment variable is the admin when it signs in, and
every other account is a member. No account is promoted implicitly — not the
first sign-in, and not the earliest member after the admin deletes their
account. An environment with the variable unset has no admin. Only the admin can
manage athlete questions (see ADR 0006).

Authentication is default-on for `/api/*`: `createApp` runs `requireAuth` once
on the whole namespace and allows only the exact paths in `PUBLIC_API_PATHS`
(`/api/health`, `/api/greet`) through unauthenticated. A new route is therefore
protected without its own middleware, and making one public is a deliberate
allowlist entry. The same chain runs `requireUser`, which provisions the account
on first sight and stores it on the context; handlers read it with `getUser(c)`
and never call `ensureUser` themselves. `requireAdmin()` checks that account and
returns 403 for a member, while a failure to resolve the account is 503. See
`docs/specs/authenticated-user-middleware.md`, ADR 0024 and ADR 0026.

The API executable is `apps/api/src/server.ts`: it loads the local `.env`,
builds the app with `createApp`, and exports the Bun server configuration.
`apps/api/src/index.ts` only exports the side-effect-free app factory, so
importing it in a test never reads a developer's environment or initialises
Sentry; every dev, start and Docker entry point uses `server.ts`. See
`docs/specs/api-server-entry.md` and ADR 0030.

A visitor who is not signed in sees the landing page in
`apps/web/src/SignInPage.tsx`: a short explanation of the coach, what it covers,
and a single sign-in action. See `docs/specs/signed-out-landing.md`.

### Error monitoring

- **Sentry.io has a free plan** ("Developer"): 5,000 errors/month, 5M spans,
  50 session replays, 1 seat, 30-day retention. Sufficient to start; the Team
  plan ($26/mo) is the upgrade path.

### Weather and daylight data

- Weather from free/cheap APIs (Open-Meteo and Yr.no) and **daylight**
  (sunrise/sunset, from Open-Meteo) at the athlete's location. Treat these as
  providers behind a small interface so sources can be swapped. The app shows
  each source and an averaged combined forecast; the coach plans from the
  combined values. Address search uses OpenStreetMap's Nominatim geocoder,
  which indexes streets and house numbers that Open-Meteo's place geocoder does
  not; the map uses OpenStreetMap tiles. See ADR 0017.
- The coach prefers daylight for outdoor sessions. It honours any explicit
  statement the athlete makes about training in darkness and otherwise assumes
  a daylight preference. When a weekday window leaves only working-hour
  daylight, long outdoor sessions move to the weekend.
- An explicit request from the athlete about a specific day or activity outranks
  the forecast and their general weather preference: if they say they will run
  outdoors on Saturday, an outdoor run is planned on Saturday even when rain is
  forecast and they otherwise avoid outdoor workouts in rain. The general
  weather preference applies to the days they have not made a specific request
  about. See `docs/specs/location-and-weather.md`.

## Observability and agent access

- The API writes one JSON object per request to standard output (`requestLogger()`
  in `apps/api/src/instrumentation/requestLog.ts`): `severity`, `time`, `event`,
  `requestId`, `method`, `path`, `status` and `durationMs`, plus the error's
  name, message and stack when the handler throws. A 4xx is a warning and a 5xx
  is an error, which go to standard error. `severity` and `time` are Cloud
  Logging's own field names, so Cloud Run parses and filters the lines. An
  incoming `x-request-id` is reused when it is header-safe and generated
  otherwise, and it is echoed on the response. The query string, headers and
  body are never logged, so address searches, tokens and athlete text stay out.
  Module-level failure notices still use plain-text `console.error` prefixes and
  are not part of the request line. See `docs/specs/api-logging.md` and ADR 0033.
- The database and application logs are **accessible to the coding agent**
  through `scripts/agent.sh`, so the agent can inspect them during debugging and
  when discussing new features. Request lines are valid JSON, so the script's
  output can be filtered with `jq`.

## Development Methodology

The agent does the coding, but we minimize AI "slop" and unmaintainable code
through a disciplined process:

1. **Spec before code.** For anything non-trivial, write a short spec first:
   goal, scope, acceptance criteria, and data-model/API impact. The agent
   implements against the spec, not a vague prompt.
2. **Test-driven development.** Write failing tests, then implement to make
   them pass. New behavior is always accompanied by tests.
3. **Small, reviewable units of work.** One logical change per task/commit/PR.
   Keep diffs small and limited to a single concern.
4. **Human review gate.** The agent proposes; a human verifies before the
   change is merged.
5. **Static quality enforced everywhere.** TypeScript `strict` (plus the extra
   strictness flags in `tsconfig.base.json`), ESLint, Prettier, and the
   unused-export scan are all checked in CI (`bun run typecheck`,
   `bun run lint`, `bun run format`, `bun run check:unused`) and must pass.
6. **Full test coverage on every feature**, across every layer:
   - **Unit tests** (Vitest) for pure logic and components.
   - **Python sidecar tests** for `services/garmin`: `bun run check:garmin` runs
     `pytest` plus `ruff check`, `ruff format --check` and `mypy`, with the
     tools pinned in `services/garmin/requirements-dev.txt` and configured in
     its `pyproject.toml`. CI runs the same script in the `garmin` job; see
     `docs/specs/garmin-sidecar-checks.md`.
   - **Integration tests** against the API and a test database.
     Database-backed tests live in `apps/api/integration` and run with
     `bun run test:integration` against the docker-compose PostgreSQL. They
     apply every migration to an empty test database, truncate between tests,
     and cover the stores, constraints, run fencing, and account-deletion
     cascades. CI runs them in a separate `integration` job. See
     `docs/specs/database-integration-tests.md`.
   - **End-to-end tests** (Playwright) for critical user journeys.
     A focused suite in `apps/web/e2e` runs the real web app, API, database
     migrations and seeds in Chromium: sign-in from the landing page, the
     coaching survey gate, a weekly note and coach reply, a meal photo with its
     analysis, and account deletion. The API process uses a fixed test identity
     and a stub LLM, and the e2e Vite config replaces only the Auth0 adapter
     with a browser-local session. Run it with `bun run test:e2e` against the
     docker-compose PostgreSQL; see `docs/specs/e2e-tests.md`.
     Unit coverage is measured and enforced by `bun run test:coverage`, which
     holds each package to its recorded line and function baseline in CI; see
     `docs/specs/test-coverage.md`.
7. **CI pipeline** (GitHub Actions, `.github/workflows/ci.yml`): these checks
   must pass before merge: typecheck, lint, format, unused exports, unit tests,
   database integration tests, the e2e suite, the Garmin sidecar's Python
   checks, the contribution sign-off check, and the dependency-outdated check.
8. **Dependencies stay current.** CI fails the build when any dependency is
   outdated (`bun run outdated`). When that happens, update the outdated
   dependencies with `bun update`, verify typecheck/lint/format/tests still
   pass, and commit the regenerated `bun.lock` (and any `package.json` changes)
   in a separate new commit before pushing.
9. **Decoupled, clearly named code.** Single-responsibility modules, explicit
   dependencies, descriptive names. Don't over-abstract prematurely, but
   extract real duplication.
10. **Documents stay current.** Keep AGENTS.md accurate and write ADRs (a
    decision log) for significant architectural choices.
11. **Definition of done.** A change is done only when tests, types, lint and
    the unused-export check pass, including `bun run check:garmin` when the
    sidecar or its tooling changes.
12. **Clean, readable code first.** Readable, maintainable, clean code is as
    important as working features. If a small feature requires a lot of new
    lines, it is likely not worth it.
13. **Strict review.** When asked to review, be strict and thorough.
    Nitpicking is encouraged. Add your comments to the PR unless everything
    looks good.
14. **Implementation ends in a pull request.** Whenever the human asks you to
    implement something, finish by opening a pull request with the completed
    change. Do not stop at a local edit or an unpushed branch.

## Licensing

- The repository is **source-available, not open source**: PolyForm
  Noncommercial 1.0.0. Commercial use is forbidden, personal, hobby, study and
  non-commercial-organization use is allowed, and the licence is non-exclusive
  so the commercial licence, relicensing and assignment stay available. See
  `docs/adrs/0022-source-available-noncommercial-license.md`.
- Never describe the project as open source, and never add a second licence, an
  `SPDX-License-Identifier` header with other terms, or a permissive notice to
  new files. `LICENSE.md` covers every file in the repository.
- Keep the `Required Notice: Copyright (c) 2026 Tor Hovland` line intact. It is
  the attribution duty the licence enforces, and it must travel with every
  distribution.
- Contributions require the copyright assignment described in
  `CONTRIBUTING.md` before they are merged; without it the project can no
  longer be relicensed or sold.

## Working side effects

- **Verify CI before pushing.** When asked to push changes, first run
  `bun run typecheck`, `bun run lint`, `bun run format`, `bun run check:unused`,
  `bun run test` and `bun run check:garmin` locally (or verify the equivalent
  CI checks pass), and confirm they all succeed before pushing.
- **Make sure CI passes on PRs.** When asked to create or update a PR, make
  sure CI passes.

## Development Guidelines

- Keep changes consistent with the existing structure, naming, style, and
  patterns of the surrounding code.
- Treat unfamiliar files or changes as potential user work; do not overwrite or
  delete them without investigating first.
- **Never duplicate prompt fragments across prompts.** Put every reusable
  prompt fragment — a persona, rule, JSON contract, output instruction,
  response sentence or key list — in `apps/api/src/llm/promptRules.ts`, and
  compose every prompt from those exports. Every prompt starts with the single
  `GLOBAL_PROMPT_RULES` fragment, and fragments that every plan prompt uses are
  merged into `PLAN_PROMPT_RULES`. Before writing prompt text, check that
  module and extend it instead of adding a second copy. A duplicated fragment
  is a bug waiting to diverge.
- **Never leave production exports alive only for their tests.** Delete dead
  code, or wire it to a real caller. `bun run check:unused` runs Knip in
  production mode and fails on an export that only a test imports, on a
  `@killingit/shared` barrel export that no production consumer imports, and on
  an unreachable production file. A helper that only its own module uses must be
  un-exported by hand, since `ignoreExportsUsedInFile` still hides that case. Put
  intentional public API that has no in-repo consumer in `knip.json` with a
  comment. See `docs/specs/unused-exports.md`.
- **Wire API dependencies through the shared context.** The injectable surface
  for the plan, coaching, activity, fitness, calendar, diet and weather routes
  lives in `apps/api/src/dependencies.ts`; `createApp` resolves the account
  stores once and passes `ResolvedAppDependencies` to those factories, which
  apply their own `??` production default. Do not conditionally spread a
  dependency field — type it `T | undefined` and forward it. Every loader and
  writer a plan run uses is a `PlanTriggerDependencies` field, and the
  enrichment inputs are fail-open while the account's own state and the
  activity feed are required. The required preparation lives in
  `loadPlanGenerationContext` (`plans/generationContext.ts`), which checks the
  account's model before the Garmin sync so a missing key is reported without
  syncing. See `docs/specs/api-dependency-wiring.md`,
  `docs/specs/plan-input-loading.md` and ADR 0023.
- **Keep exported constants above exported functions.** Top-level `export const`
  declarations come before `export function` declarations in a module. The
  `local/consts-before-functions` ESLint rule enforces it, while preserving the
  semantic order within each group.
