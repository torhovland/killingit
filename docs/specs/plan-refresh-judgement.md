# Spec: Let the coach judge whether an input needs a plan refresh, and at what level

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Updated:** 2026-11-22 — the single `planChangeNeeded` boolean becomes a
  scope (`none | day | week | block | season`) decided by the analysis or reply
  that already read the input. A comment can now refresh the remaining season,
  not only the week and today; the boolean stays as a derived value. The scope
  is stored with the input, mapped into the revision flags alongside the
  structural pending levels, and fails open to the widest scope. The prompt
  right-sizing and reasoning-budget work this enables is a separate change.
- **Updated:** 2026-11-22 — the day-only part of that right-sizing is now
  implemented: a revision that changes only today, its week and tomorrow uses
  the daily prompt instead of the full plan update. See
  `docs/specs/daily-plan-refresh.md` and ADR 0062.
- **Related:** `docs/specs/coach-feedback-and-program-review.md`,
  `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-run-cancellation.md`, `docs/specs/period-reviews.md`,
  ADR 0029.

## Goal

Stop paying for a plan refresh when the coach has just read the athlete's input
and concluded the plan still fits, **and stop discarding a change the coach
judged to reach the season or block**. The analysis that already reads the
workout, comment, weekly note, manual activity or review comment decides how
far the change reaches; nothing extra is asked of the model.

The old boolean answered "does anything need to change?". It could not say
_where_. A comment such as "I have an important race in six weeks" set the
boolean, but the app then revised only the week and today, told the model to
keep the block and season unchanged, and dropped any season change it
volunteered. The scope makes the coach's judgement travel to the revision.

## Scope

### In scope

1. **One scoped decision per input.** The structured activity analysis and
   every coach reply carry `planChangeScope`, one of `none`, `day`, `week`,
   `block` or `season`. The existing completion already sees the plan and the
   input, so the decision costs no extra call, tokens or thinking time.
2. **The scope names the highest level the input changes.** `none` means the
   plan stands. `day` means today's session (and tomorrow's when it is wanted)
   changes, with today's outline in the week kept in step. `week` means the
   remaining sessions of the current week change while today's stored session
   is kept. `block` means the current block's remaining weeks and target loads
   change in place. `season` means the remaining season changes, keeping the
   completed blocks and the current block's start date.
3. **Context by default.** `none` is right for a workout that matched its
   prescription, praise, a thank-you, a feeling the plan already accounts for,
   a question, or context about a past session. `day` and `week` are right for
   a recovery signal, a short illness, a moved session or a new constraint on
   the next few days. `block` is right for a change inside the current block,
   such as a race a few weeks away. `season` is right for a newly stated goal
   or event beyond the current block, or a performance result that resets the
   targets for the rest of the season.
4. **The scope is stored, and the boolean is derived.** Every stored analysis
   and reply keeps the scope it answered with; `planChangeNeeded` remains in the
   stored and API shapes as `scope !== "none"`, so existing readers and rows
   keep working. A cached analysis is never regenerated to re-decide either
   value.
5. **The revision can widen, never narrow.** The scope is combined with the
   levels the stored plan is already missing or must revise. A `day`-scoped
   input cannot suppress a pending block or season revision, and a `season`
   scope always refreshes the season in place with the completed blocks kept.
6. **A full season refresh is allowed from any input.** An input scoped to the
   season takes the same path as a changed answer or a completed block review:
   `kind: "refresh"`, the stored season re-planned from the current block, the
   completed blocks and original season start kept, and pending coach questions
   cleared.
7. **Fail-open.** A missing or malformed scope on an input that needs a change
   is treated as `season`, never as `none`. When a scope is present it is
   authoritative: it decides the flag, even if the model also returned an
   inconsistent boolean. A legacy `planChangeNeeded: false` with no scope is
   `none`; a missing boolean with no scope is a change and therefore `season`.

### Out of scope

- **A separate judgement prompt.** The model that wrote the analysis or the
  reply makes the call, so a refresh never costs a second completion.
- **Meals.** A logged meal stays prompt context only; it does not request a
  plan refresh. See `docs/specs/diet-log.md`.
- **A model of every input's history for display.** The scope is plumbing, not
  a new athlete-facing state.
- **Deferring a refresh the plan demonstrably needs.** A missing level, a new
  survey answer, a generated period review, a significant forecast change, a
  moved day, an explicit regeneration and a deleted activity keep refreshing
  the plan as before.
- **Right-sizing the week, block and season prompts and capping their
  reasoning.** The scope is what made it safe to route a day-scoped refresh to
  the smaller daily prompt (`docs/specs/daily-plan-refresh.md`). The remaining
  revisions now ask the plan-update prompt only for the levels they change
  (ADR 0063); capping reasoning is still separate.

## Data model

- `activity_analyses.plan_change_scope` (text, not null, one of the five
  scopes, default `none`): the analysis's answer. The existing
  `plan_change_needed` column stays and is written as `scope !== 'none'`.
- `coach_replies.plan_change_scope` (text, not null, default `none`): the
  reply's answer for its input. `target` is the activity id, week start date,
  manual activity id or review start date, so the loader can match each input
  to its reply.
- The migration backfills existing rows from the boolean: `plan_change_needed`
  true becomes `season`, false becomes `none`. An old input that may have
  needed a season change is therefore never narrowed to the week.
- No `coach_plans` column changes. The plan keeps storing the newest input and
  analysis timestamps it has seen, which also records inputs whose scope was
  `none`.

## Prompt contracts

- `COACH_ANALYSIS_CONTRACT` gains `"planChangeScope"` with the five values; the
  `COACH_ANALYSIS_RESPONSE_RULES` sentence names them and gives the default.
- `COACH_REPLY_CONTRACT` becomes
  `{ "reply": string, "planChangeScope": "none | day | week | block | season" }`;
  the batched comment reply carries the same field per item.
- The shared plan-change rule in `apps/api/src/llm/promptRules.ts` owns the
  instruction for both prompts. It defines each level, requires the highest
  level the input changes, and says `none` when the plan stands. It no longer
  asks for a boolean; `planChangeNeeded` is derived by the API.
- The reply rule puts the decision in the athlete's words: a reply says which
  level it will adjust, and says the plan stands when the scope is `none`. The
  reply never promises an adjustment its own scope denies.
- A missing flag or scope fails open. A reply or analysis that ignores the JSON
  contract, or omits the field, is treated as `season` when it asks for a
  change, so an unparsed answer can never silently drop a needed refresh.
- The contract and the parser are held to each other by
  `apps/api/src/llm/promptContracts.test.ts`; both sides gain the field
  together.

## Refresh decision

The context carries the refresh-worthy events with their scopes, not just the
newest timestamp:

```
coachingInputsRefreshChanges: { updatedAt, planChangeScope }[]
activitiesRefreshChanges:    { updatedAt, planChangeScope }[]
```

Each source is compared with its own stored timestamp, as before. The input
scope is the widest scope among the events newer than the plan's stored
timestamp for that source:

```
unseenInputs      = coachingInputRefreshChanges.filter(newer than plan.coachingInputsUpdatedAt)
unseenActivities  = activityRefreshChanges.filter(newer than plan.activitiesUpdatedAt)
inputScope        = widest(unseenInputs.scope, unseenActivities.scope)
```

The widest scope across all unseen events is used, not the newest one: a
day-scoped comment that arrives before an older season-scoped note has been
planned must not hide the season change. Events the plan has already seen stay
out, so an old season scope cannot keep widening later runs.

The structural scope comes from the existing decision inputs:

| Source                                                          | Structural scope |
| --------------------------------------------------------------- | ---------------- |
| `mode: "updateSeason"`, stale answers, a completed block review | `season`         |
| a completed week review, or today outside the current block     | `block`          |
| a weather change, a missing or moved day                        | `week` or `day`  |
| nothing due                                                     | `none`           |

The effective scope is the wider of the structural scope and the input scope.
The scope can only add revision work, never remove it. The flags follow from
the effective scope and the existing `includeTomorrow` and pending next-period
rules:

| Effective scope | Flags                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `none`          | no input-driven revision; structural pending levels still apply            |
| `day`           | `week` and `day`; today's outline stays in step                            |
| `week`          | `week`; today's stored session is restored after the response              |
| `block`         | `block` with `blockInPlace` when today is inside it, plus `week` and `day` |
| `season`        | `season`, `block`, `week` and `day`; `clearNextPeriod`                     |

A `season` scope also sets `kind: "refresh"`, so the run uses the existing
season-refresh path. A `block` scope revises the current block in place instead
of starting the next one. A comment or manual activity about today sets
`keepToday`, which adds the day revision even when the scope is the week, so
today's completed summary keeps the latest comment; the stored session is only
restored when the input is not about today.

Sources of scope:

- An activity analysis, a comment, a weekly note and a manual activity carry
  the scope their own completion returned.
- A generated week review is `block`; a generated block review is `season`. A
  comment on a review follows its reply's scope.
- A deleted activity removes training data and is explicitly `week`, matching
  the old week-and-day behaviour instead of failing open to a season refresh.

`weekReviewPending` and `blockReviewPending` keep their meaning, with the scope
replacing the boolean when the event asks for a change.

When there are new inputs but none asks for a refresh, the run is idle. It
saves the stored plan with the current all-input timestamps, and applies the
local parts of a refresh first: today's completion status, the completed days in
the week, and the training-load snapshot. That is what keeps the Today tab and
the fitness numbers correct after an ordinary workout even though no plan
completion runs. If nothing new has arrived and no promotion is due, nothing is
written.

## API and UI

- `GET /api/coaching/plan` reports `stale` from the refresh-worthy
  coaching-input timestamp, unchanged; a `none` input does not make the
  dashboard start a run on every visit.
- `pending.block` follows the review scope: a generated or block-scoped week
  review makes the block pending, while a week- or day-scoped review comment
  does not.
- The wire shape carries an optional `planChangeScope` beside the derived
  `planChangeNeeded` on `CoachAnalysis`, so the plan loader can read the scope
  from the cached feed; the UI does not use it. The reply response shapes are
  unchanged.
- The generation progress shows "Refreshing your season" for a `season`-scoped
  input because the season flag drives the existing label.
- The reply response shapes are unchanged; the flag stays server-side.

## Acceptance criteria

1. A comment whose reply returns `planChangeScope: "season"` (for example "I
   have an important race in six weeks") refreshes the stored season: the
   completed blocks and original season start are kept, the remaining season is
   re-planned from the current block, and the current block start stays.
2. A reply or analysis with `"block"` revises the current block in place when
   today is inside it, not the next block.
3. A reply with `"week"` revises the remaining week and keeps today's stored
   session unless the input is about today; a reply with `"day"` revises today
   and the week outline.
4. A reply with `"none"` does not run the plan-update completion; the stored
   plan keeps its training content and records the input it has seen.
5. An activity analysis with `"season"` refreshes the season the same way as a
   reply; an analysis with `"none"` does not.
6. A missing or malformed scope fails open to `season` when the input needs a
   change. A scope present in the answer decides the boolean, even when the
   model returned an inconsistent `planChangeNeeded`.
7. A scope only widens the structural pending levels: a `day`-scoped input
   cannot suppress a pending block or season revision, and an old scope already
   seen by the plan does not widen a later run.
8. A generated week review is `block`; a generated block review is `season`; a
   commented review follows its reply. A deleted activity is `week`.
9. The stored analysis and reply keep their scope; a cached analysis is not
   regenerated to re-decide it.
10. The batched comment run answers every comment first and stores each scope
    before the plan phase reads it.
11. `CoachAnalysis` carries the optional scope beside the derived boolean, and
    the UI does not read it; the reply response shapes are unchanged.
12. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
    `bun run check:unused` and, for the migration, `bun run test:integration`
    pass.

## Testing

- Unit tests parse a scoped analysis and reply, derive the boolean, fail open
  to `season` when the scope is missing, and keep a malformed answer's text.
- The summarizer tests keep every refresh-worthy event's scope and the newest
  review event's scope, so a newer event replaces an older one.
- The revision tests map each scope onto the flags and prove the union with
  pending levels and the week-scope restoration of today.
- An end-to-end generation test starts from a season-scoped comment and asserts
  the refreshed season, the kept completed blocks and the "Refreshing your
  season" state.
- Database integration tests cover the new columns and the boolean backfill.
- The prompt-contract parity test and the benchmark snapshot are updated when
  the model-facing contract changes.
