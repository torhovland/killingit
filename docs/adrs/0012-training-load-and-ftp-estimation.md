# ADR 0012: Coach-estimated FTP and deterministic training load

- **Status:** Accepted
- **Date:** 2026-10-27
- **Deciders:** torhovland
- **Related:** `docs/specs/training-load.md`,
  `docs/specs/coach-plan-lifecycle.md`, ADR 0004

## Context

The plan already has durations and intensities, and indoor bike sessions carry
relative power targets. The athlete cannot see how hard a day is relative to
their current fitness, how that fitness is trending, or what FTP the coach
assumes this week. The data needed for a proper answer is split: power lives in
Garmin's activity timeseries, the FTP lives in free-text profile answers, and
the plan is model-generated JSON.

Asking the model to do all of the arithmetic would make the Day, Week, and Block
tabs disagree and would make the numbers hard to test. Calculating everything
deterministically would lose the model's judgement for sessions without power.

## Decision

- **FTP is read deterministically from the profile and newer athlete inputs.**
  The first plausible FTP stated in the answers is the baseline. A later
  activity comment, manual activity, weekly note, or review comment that
  mentions an FTP test/revised estimate replaces it, unless the survey answers
  were saved after that mention. With no FTP source the feature stays off.
- **The coach estimates the weekly progression and per-session TSS.** The week
  prompt (and the block prompt) receives the completed training and the stated
  FTP and returns `estimatedFtpWatts` for each week and `estimatedTss` for each
  session. The API clamps the weekly FTP to 70–150% of the stated value.
- **The API resolves TSS deterministically where measurement exists.** Recorded
  power is scored from normalized power and the week's estimated FTP; structured
  indoor workouts are scored from their intervals. The coach's estimate is used
  only for sessions without either.
- **ATL/CTL/TSB are calculated by the API**, with 7-day and 42-day
  exponentially weighted averages seeded from the last 42 days of activities.
  The resolved load is copied into the day plans so every tab agrees.

## Alternatives considered

- **Ask the model for ATL/CTL/TSB directly.** It cannot keep the levels
  consistent across generated responses and it cannot see the full history.
- **Calculate TSS for every session from duration and intensity only.** Simple,
  but wrong for measured rides and ignores the coach's knowledge of non-power
  sessions.
- **Store raw power in the plan and calculate TSS in the browser.** Moves a
  server concern into the UI, exposes large timeseries to the client, and makes
  the values depend on the device.
- **A dedicated per-activity TSS model call.** Extra cost and latency per
  activity for a number the existing plan prompt can estimate.

## Consequences

- The plan JSON grows slightly (`estimatedTss`, `trainingLoad`,
  `estimatedFtpWatts`) and old plans remain readable because every new field is
  optional.
- Synced activities now carry `averagePower` and `normalizedPower`, computed
  once while the timeseries is still available. The Garmin sync window is 42
  days, matching the chronic-load window.
- A revised FTP mentioned in a later athlete input replaces the profile value
  and floors the current week's estimate, so a test result is not undercut by an
  older projection. FTP anchors form a timeline; completed weeks before a new
  test are re-interpolated and their TSS/ATL/CTL/TSB are recomputed.
- TSB is labelled and coloured in the UI using TSB as a percentage of CTL:
  Maintaining in the middle, Productive under training load, Risk below −30%,
  Fresh as form rises above +5%, and Detraining above +20%. This makes the
  number read as form rather than an unexplained statistic.
- ATL/CTL from before the 42-day feed window are unknown, so a new account
  starts at zero and settles over a few weeks. This follows from not adding a
  separate load-history store.
- A coach that omits TSS still produces a complete plan: the API falls back to
  duration and intensity. A coach that omits the weekly FTP falls back to the
  stated value.
- The feature is gated on the athlete stating an FTP. Without one, the plan
  still shows coach-estimated TSS and the load numbers; only the FTP-derived
  pieces are hidden.
