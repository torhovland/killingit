# Spec: Training context for coach replies

- **Status:** Accepted (implemented)
- **Date:** 2026-10-30
- **Related:** `docs/specs/coach-plan-prompts.md`,
  `docs/specs/coach-questions.md`, `docs/specs/period-reviews.md`,
  `docs/specs/location-and-weather.md`, `docs/specs/coach-feedback-and-program-review.md`.

## Goal

Every prompt that answers the athlete — a comment on an activity, a note for
the week, a manual activity, a review comment, an answer to a coach question, or
a one-off coaching question — must see the same training context the plan
prompts see. Today the reply prompt carries only the athlete profile, the plan
levels, and today's and tomorrow's sessions, so the coach answers a coaching
question without knowing what the athlete has recently done.

## Scope

### In scope

1. The reply and coaching-question prompts render the shared athlete and
   training context (`formatPlanContext`): today's date, the athlete profile
   with its save date, FTP and body-metric histories, recent activities with
   their coach analyses and the athlete's comments, manual activities, this
   week's note and its reply, and completed week and block reviews.
2. A reply context loader assembles that context from the last synced activity
   feed and the stored coaching inputs, FTP history, and body history. It does
   not sync Garmin; a reply must stay quick, and the plan revision that follows
   every reply already syncs.
3. The reply prompt also shows the forecast stored on today's and tomorrow's
   plan sessions, so a weather question can be answered without a new forecast
   fetch.
4. Each context source fails open: one unavailable source (an unconnected
   Garmin account, a metrics outage) leaves the rest of the context intact, and
   the reply is still generated.

### Out of scope

- Fetching a fresh Open-Meteo/Yr.no forecast for a reply. The plan revision that
  follows a reply refreshes the forecast.
- A Garmin sync for a reply; the cached feed is used.
- New context for the activity analysis and program review prompts. They run
  once per activity and already carry the activity itself, the plan and the FTP
  history; adding the whole feed to each call would multiply the cost of a
  batch for little gain.
- The athlete-metrics reading prompt, which deliberately reads only the
  athlete's own words (it reports statements, not training).

## Acceptance criteria

1. A one-off coaching question prompt contains the recent activities with their
   coach analyses, the athlete's comments on them, manual activities, this
   week's note, completed period reviews, the FTP history, the body-metric
   history, and the stored forecast for today.
2. The same context is present when replying to an activity comment, a weekly
   note, a manual activity, a review comment, and an answer to a coach question.
3. When the activity feed or coaching inputs cannot be read, the reply is still
   generated from the remaining context.
4. The athlete profile in a reply is dated by the newest answer, like the plan
   prompts.
5. `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`
   pass.

## Data-model / API impact

None. No schema, route, or stored-shape change; the reply prompt input changes
internally from profile answers to a `PlanContextInput`.

## Technical approach

- `apps/api/src/llm/coachReplyPrompt.ts` takes `{ plan, context, request }` and
  renders `formatPlanContext(context)` instead of the bare profile, followed by
  the plan levels, today's and tomorrow's sessions, the stored forecast, and the
  athlete's input. `context.today` replaces the separate `today` field so the
  two can never disagree.
- `apps/api/src/coaching/replyContext.ts` exports `loadReplyContext`, which
  reads the cached activity feed (`loadCachedActivityFeed`), the coaching inputs
  (`loadCoachingInputs`), the FTP history, and the body history, each through a
  fail-open wrapper, and returns a `PlanContextInput`. Its loaders are injectable
  so the assembly is unit tested without a database.
- `apps/api/src/coaching/replies.ts` gains an injectable `loadContext`
  dependency (default `loadReplyContext`) and passes the context to
  `generateCoachReply`. The three reply paths share it.
- The reply and quick-question system prompts say the athlete profile, the plan
  and the recent training are all available, so the answer uses them.

## Testing

- `coachReplyPrompt.test.ts` asserts the recent activities, their analyses, the
  athlete's comment, the weekly note, the FTP history, and the stored weather
  appear in a coaching-question prompt.
- `replyContext.test.ts` asserts the assembled context and that a failing source
  does not drop the others.
- `replies.test.ts` asserts a reply prompt carries the recent activities and that
  a failing context loader still produces a reply.
- Run `bun run typecheck`, `bun run lint`, `bun run format`, and `bun run test`.
