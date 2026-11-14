# ADR 0056: One cadence rule — total steps per minute for step-counted sports

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/cadence-units.md`, issue #337

## Context

Garmin exposes cadence in several channels with different units. In the detail
timeseries, `directDoubleCadence` and `directStrokeCadence` are already totals,
while `directCadence` counts one leg for a step-counted sport. The sidecar
doubled `directCadence` only for activity types containing `run`, so a walk or a
hike kept its per-leg value while the shared app labelled it `spm` through
`STEP_CADENCE_PATTERN`. Walking cadence therefore appeared at half its real
value. The shared comment claimed Garmin's running and hiking channels were
already totals, which is not true of `directCadence`.

The lap payload has its own two families. `averageRunCadence` is the value
Garmin Connect displays and is already total steps per minute for runs, jogs,
walks and hikes. `avgCadence` is the older per-leg value for those sports and
rpm for a ride. A blanket multiplier on the lap path would double a number that
is already total.

## Decision

The app stores one unit per sport and labels it in one place:

- A step-counted sport — run, jog, walk, hike — is stored as total steps per
  minute. The sidecar doubles the per-leg channels (`directCadence`,
  `avgCadence`) and uses the already-total channels as they are
  (`directDoubleCadence`, `averageRunCadence`).
- Rowing and swimming keep strokes per minute, already total.
- Cycling keeps pedalling rpm.

`STEP_CADENCE_MARKERS` in `services/garmin/activities.py` is the step-counted subset
and `STEP_CADENCE_PATTERN` in `packages/shared/src/activity.ts` is the display
rule. The shared pattern also covers row and swim because they share the `spm`
label. A sidecar test reads the shared pattern and asserts the two sets match
apart from row and swim, so the rule cannot drift on one side alone.

`cadenceUnit(type)` remains the single statement of the display unit. The
prompt channel definitions no longer carry their own `rpm` default; the label
and unit always come from `cadenceUnit`.

## Alternatives considered

- **Send the unit with every cadence value.** It would remove the shared
  pattern, but every consumer would still need the number normalized, and the
  sidecar alone knows which Garmin channel a value came from. A label alone
  would have left the walk at half its value. Rejected.
- **Double every sport the shared pattern labels `spm`, including row and
  swim.** Their stroke rates are already per minute, so this would double
  correct values. Rejected.
- **Double every lap cadence.** `averageRunCadence` is already total, so a
  walk's lap would become twice the correct number. Rejected.
- **Label step-counted sports `rpm`.** A label change cannot fix a halved
  number, and `spm` is what Garmin Connect and the athlete expect. Rejected.

## Consequences

- Walks and hikes show the same number Garmin Connect shows, and every cadence
  label agrees with the stored value.
- The distinction between Garmin's per-leg and already-total channels is
  explicit in the sidecar and covered by tests for samples, laps and the sync
  wiring.
- Stored activities from before the change keep their old number until the next
  sync re-reads them inside the 42-day window.
- Adding a step-counted sport means updating both the Python markers and the
  shared pattern; the pinning test fails until they agree.
