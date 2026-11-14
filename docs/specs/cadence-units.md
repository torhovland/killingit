# Cadence units

## Goal

Show every recorded cadence in the unit the athlete expects, and make the
number agree with the label: total steps per minute for step-counted sports,
strokes per minute for rowing and swimming, and pedal revolutions per minute
for cycling.

## Rule

- A step-counted sport (run, jog, walk, hike) reports cadence per leg in
  Garmin's detail channel `directCadence` and in the legacy lap key
  `avgCadence`. The sidecar doubles those values to total steps per minute.
  `directDoubleCadence`, and a lap's `averageRunCadence`, already hold the total
  Garmin Connect displays, so they are used as-is.
- Rowing and swimming report strokes per minute through
  `directStrokeCadence`, already a total; they are never doubled.
- Cycling reports pedalling rpm (`directBikeCadence`, or `directCadence` /
  `avgCadence` as a fallback); it is never doubled.
- `cadenceUnit(type)` in `packages/shared/src/activity.ts` is the single
  statement of the display unit. The sample table, the lap table, the activity
  card and the prompts append it; nothing else hard-codes `spm` or `rpm` for
  cadence.
- `STEP_CADENCE_PATTERN` lists the sports labelled steps or strokes per minute.
  It includes row and swim in addition to the step-counted markers because
  their stroke rate shares the spm unit. The sidecar's `STEP_CADENCE_MARKERS`
  is the step-counted subset without row and swim, and
  `test_step_cadence_rule_matches_the_shared_display_unit` pins the two
  together, so adding a sport to one side without the other fails
  `bun run check:garmin`.

## Scope

- Sample, lap and activity-summary normalization in
  `services/garmin/activities.py`.
- The shared unit helper and the web and prompt renderers that use it.
- No database migration. Stored activities are re-derived by the next sync
  inside Garmin's 42-day window; an older stored walk keeps its old number until
  it is synced again.

## Acceptance criteria

1. A walking or hiking activity whose detail payload only reports per-leg
   cadence stores total steps per minute in its samples.
2. A walking or hiking lap with `averageRunCadence` keeps that total, while one
   with only `avgCadence` is doubled; a ride's lap cadence is unchanged.
3. A walk's cadence is labelled `spm` in the sample table, the lap table and the
   prompts, so the displayed number and unit agree.
4. `bun run check:garmin`, `bun run typecheck`, `bun run lint`,
   `bun run format` and `bun run test` pass.

## Related

- `docs/specs/garmin-activity-integration.md`
- `docs/specs/garmin-activity-laps.md`
- ADR 0056
