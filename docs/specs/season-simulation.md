# Spec: Season simulation harness

- **Status:** Accepted (implemented)
- **Date:** 2026-11-22
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/daily-plan-refresh.md`, `docs/specs/season-regeneration.md`,
  `docs/specs/llm-benchmark.md`, `docs/specs/activity-store.md`,
  `docs/specs/training-load.md`.

## Goal

Answer one question with evidence: does the coach's plan get a realistic
athlete to a stated season goal? The harness runs a full season through the
app's real plan pipeline, records the activities a compliant athlete would
produce, and compares the resulting fitness with independent race predictions.

It is a **local analysis tool**, not a production feature. It never writes to the
development or production database.

## Scope

### In scope

1. A Bun workspace at `tools/season-simulation` with a CLI
   (`bun run simulate:season`) and pure, tested simulation models.
2. Two scenarios for the same athlete and season:
   - **full**: every prescribed workout is completed on its planned day;
   - **reduced**: a prescribed workout is completed only every second calendar
     day, so roughly half the sessions are missed.
3. A real `newSeason` plan build, then one real plan refresh every Sunday at
   21:00 with `includeTomorrow: true`, until the season ends.
4. Imported activities with concrete duration, distance, elevation, average and
   normalized power, average heart rate and pace. Measured power and pace drive
   TSS, so the activity is scored the way the app scores a real imported one.
5. The modelled FTP and threshold pace are written to the account as Garmin-style
   dated estimates before each training day and before each refresh, so the
   coach's prompt and the activity TSS see the same values.
6. A positive weekly note from the athlete ("every workout this week felt easy")
   so the coach receives the subjective feedback a real compliant athlete would
   give, through the app's normal weekly-note input.
7. An independent race check beside the coach's own words: a Riegel-style
   half-marathon prediction from threshold pace and a steady-state speed/power
   model for the gravel course, reported both solo and in a group.
8. Per-session feasibility checks: duration-adjusted intensity cap and a report
   flag when a prescribed session looks beyond the athlete.
9. Saved state after every week and around every refresh, so a failed model run
   can be retried with `--resume` instead of replaying the season.
10. A JSON result per scenario and a PDF report (`report.pdf`) with the weekly
    progression, race checks, coach excerpts, comparison and findings.

### Out of scope

- A scheduled CI job. A full run costs money and takes about half an hour per
  scenario.
- Automatic judging of plan quality. The report states explicit numbers and
  quotes the coach; a human decides whether the plan is good.
- A physiological model of the athlete. The progression curve is a documented
  assumption, not app logic.
- Live weather. Open-Meteo and Yr.no only serve a short horizon, so the harness
  supplies a deterministic seasonal approximation for Trondheim.

## Acceptance criteria

1. `bun run simulate:season -- --scenario full` builds a season from
   2026-11-22, simulates every week, and writes
   `benchmarks/season-simulation/results-full.json`.
2. `--scenario reduced` runs the alternate-day scenario and writes
   `results-reduced.json`.
3. `--report-only` rebuilds `report.html` and `report.pdf` from the two result
   files without calling a model.
4. `--weeks <n>` stops after `n` weeks for a cheap smoke run; `--suffix` keeps a
   smoke run from overwriting the real results.
5. `--resume` continues a saved run from `state-<scenario>.json` and retries the
   refresh that failed.
6. The harness refuses a database whose name does not end in `_season_sim`, and
   rebuilds that database before every fresh scenario.
7. Every prompt goes through the real `runPlanForUser` path with the real
   OpenRouter provider and the configured model; the recorded call list carries
   tokens, cost and latency.
8. The PDF reports, for each scenario: goal outcome, race-week coach text,
   weekly planned and completed TSS, CTL, FTP, threshold pace, race predictions,
   and any session flags. A comparison section and a findings list follow.
9. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run check:unused` pass.

## Athlete and season

| Field                   | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| Profile                 | Male, 50, 85 kg, 187 cm, Trondheim (Europe/Oslo)       |
| Starting FTP            | 180 W                                                  |
| Starting threshold pace | 6:00 /km                                               |
| Resting / maximum HR    | 55 / 185 bpm                                           |
| Prior peak              | FTP about 285 W, and the gravel race in 3:20 at HR 163 |
| Half marathon           | 2027-05-23, target under 2:00                          |
| Gravel race             | 2027-08-22, 100 km, 1,170 m, target 3:10               |
| Season                  | 2026-11-22 to 2027-08-29                               |

The profile is stored as one free-text onboarding answer, because the app's
athlete profile is free text. The two races are also stored as race events.

## How a run works

```text
fresh: rebuild dedicated DB → seed athlete/profile/events/thresholds
       → newSeason refresh at 2026-11-22 21:00
loop:  read plan.nextWeek
       for each day: advance the athlete model, record an activity if the
                     session is trained, update CTL
       at Sunday 21:00: write thresholds, write the week's positive note,
                     then auto refresh with tomorrow
       stop at 2027-08-29
```

`includeTomorrow` is always explicit, so the server's real clock never decides
whether tomorrow is planned. The simulated `today` is passed to every plan
refresh and to the forecast loader. The weekly note is the athlete's subjective
feedback for the completed week ("every workout this week felt easy"); the coach
reads it through the normal weekly-note input.

The first build and every refresh use `runPlanForUser` with the production
database stores. The harness injects only `loadActivities`, `loadLlm`,
`loadForecast`, `syncAthleteReading` (a no-op, because the harness seeds the
metrics) and `latestActivityAnalysisSince` (a no-op, because activities carry
deterministic analyses). The real prompts, JSON repair, validation, period
reviews, promotion and storage run unchanged.

## Simulation models

### Progression

The athlete's ability follows chronic training load (CTL, 42-day EWMA):

```text
fraction = min(1, (CTL / 55) ^ 0.8)
FTP      = 180 + (285 - 180) × fraction
pace     = 360 - (360 - 315) × fraction
```

The athlete regains the gap to the prior peak with diminishing returns and never
exceeds it. This is deliberately conservative: a real 50-year-old may respond
better or worse.

### Activity generation

- The prescribed session's own `estimatedTss` is the target; without one, an
  easy/moderate/hard rate of 45/65/85 TSS per hour is used.
- Cycling power is `IF × current FTP`; running pace is `threshold pace / IF`;
  both are chosen so the app's measured TSS equals the target.
- `canBeOutdoor: false` or an indoor/trainer title records a trainer session with
  no distance.
- A race day is simulated from the athlete's ability that morning, using the
  race models below.

### Race models

- **Half marathon**: `21.0975 km × threshold pace × 1.04 / 1.01`.
- **Gravel**: steady-state power on the course (93 kg system mass, CdA 0.385,
  Crr 0.0055, 1.2 kg/m³, 97% drivetrain, average grade 1.17%). The race is
  ridden at 97% of FTP with a 1% taper. A group case applies a 10% effective
  power gain. Both cases are reported.
- A target is treated as met within a 1% modelling tolerance.

### Feasibility

Each recorded session is checked against a duration-adjusted intensity cap
(1.05 up to 60 minutes, 0.95 to 120, 0.88 to 180, 0.82 beyond). A session above
the cap is flagged in the report; the activity is still recorded because the
scenario assumes compliance.

## Outputs

`benchmarks/season-simulation/` holds:

- `results-full.json` and `results-reduced.json` — every week, session,
  activity, race result, call and cost;
- `report.html` and `report.pdf` — the printable analysis;
- `state-<scenario>.json` — only while a run is resumable.

Smoke outputs and state files are ignored by git. The two real result files and
the report are committed.

## Safety

- The default database is `killingit_season_sim`; the harness drops and rebuilds
  that schema. It refuses any database name that does not end in `_season_sim`.
- The model key comes from `BENCHMARK_OPENROUTER_API_KEY`; no account key is
  stored for the simulated athlete.
- The harness never calls the Garmin sidecar. Activities are injected through
  the same loader seam the app already exposes for tests and benchmarks.
