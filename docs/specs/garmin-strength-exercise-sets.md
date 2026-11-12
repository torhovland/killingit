# Spec: Garmin strength exercise sets

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** `docs/specs/garmin-activity-integration.md`, ADR 0003,
  `docs/specs/llm-call-log.md`.

## Goal

Include the exercises, sets, repetitions and weights recorded in a Garmin
strength-training activity, and give them to the LLM when it analyses that
workout.

## Why

Today a strength activity syncs only its summary and heart-rate timeseries.
The coach can see that a 35-minute strength session happened, but not that it
was three sets of goblet squats at 12 kg followed by RDLs and planks. Without
the sets the analysis can only talk about duration and heart rate, which is the
least useful part of a strength session.

`python-garminconnect` exposes the missing data through
`get_activity_exercise_sets(activity_id)`, the same activity-details endpoint
the sidecar already calls for every activity.

## Scope

### In scope

1. The sidecar fetches exercise sets for activities whose type is strength
   training, maps them into a stable shape, and includes them on the synced
   activity as `strengthSets`.
2. The shared `Activity` type carries the optional `strengthSets` array; the
   analyzed activity feed keeps it so the activity analysis can use it.
3. The activity analysis renders the recorded sets into the prompt.
4. A recorded set list is authoritative: the coach must not invent exercises,
   reps or loads when the list is empty, and must use the recorded values when
   it is present.
5. Failures are fail-open per activity: a failed exercise-set fetch leaves the
   activity with no sets and does not fail the sync. Garmin rate limiting is
   still surfaced as `429`.

### Out of scope

- A dedicated strength UI or exercise charts.
- Editing sets or writing them back to Garmin.
- Deriving TSS from tonnage. The existing duration-based strength estimate
  remains the fallback.
- Structured Garmin workouts (the plan attached to an activity), only the
  exercise sets that were actually performed.

## Data shape

One set:

```ts
{
  setType?: string;          // "active" or "rest"
  startTime?: string;        // ISO-8601 UTC
  durationSeconds?: number;
  repetitions?: number;
  weightKg?: number;
  exercises: Array<{
    category: string;        // Garmin FIT category, e.g. "SQUAT"
    name?: string | null;    // Garmin FIT sub-category, when present
  }>;
}
```

`weight` from Garmin is in grams and is normalized to kilograms. Absent
channels are omitted rather than set to zero. The sidecar caps the list at 200
sets to bound the sync payload and prompt size.

## Acceptance criteria

1. A strength activity with recorded sets returns them from `/sync`; a
   non-strength activity does not gain a `strengthSets` field.
2. A failed set fetch yields no sets for that activity and the sync continues;
   a `429` still fails the sync with `429`.
3. The general activity analysis prompt contains the recorded sets (exercise,
   sets, reps, weight), and the system prompt tells the model not to invent
   missing sets.
4. New analyses record the bumped prompt version; existing cached analyses are
   reused.
5. Unit tests cover normalization, prompt rendering, and the fail-open/`429`
   split. Quality gates pass.

## Data-model / API impact

- `packages/shared/src/activity.ts`: new `strengthSetSchema` and an optional
  `strengthSets` field on the activity summary, so `Activity` and
  `AnalyzedActivity` carry it.
- `services/garmin/app.py`: fetch and normalize sets in `_sync`; add
  `_exercise_sets_for` and `_to_strength_sets`.
- `apps/api/src/llm/activityPrompt.ts`: render sets and include the shared rule.
- `apps/api/src/llm/strengthContext.ts`: render a compact set list in the
  shared activity summary used by the reviews.
- No database schema change.

## Risks / open questions

- Only activities recorded with the Garmin strength profile have sets; many
  athletes log the activity without sets. The prompt must handle an empty list.
- Exercise names are Garmin FIT enum values. The raw category is more reliable
  than a translated name and is kept as-is.
- One extra Garmin request per strength activity, subject to the existing
  rate-limit handling.
