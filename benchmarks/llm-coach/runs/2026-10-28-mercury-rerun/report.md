# LLM coach benchmark

- **Run:** `2026-10-28-mercury-rerun`
- **Run at:** 2026-10-28T05:57:29.180Z
- **Benchmark:** `inception/mercury-3` (first model in the list)
- **Athlete:** user 1
- **Full build:** 2026-10-26
- **Week + day refresh:** 2026-11-02
- **Plan output budget:** 16,384 tokens per attempt
- **Git commit:** `beaea772315552f8ead11ed2a8b5b78b6c142958`

Cost is the OpenRouter-reported cost, including retries and JSON repairs. Time is wall-clock for the whole chain. Quality is a manual assessment; it is not produced by the script.

| Model | Quality | Full plan | Refresh | Total | Calls | Cost vs benchmark | Time vs benchmark |
|---|---:|---|---|---|---:|---:|---:|
| `inception/mercury-3` **benchmark** | — | 112.5 s / $0.0239 | 47.6 s / $0.0109 | 160.1 s / $0.0348 | 7 calls, 2 truncated, 1 repaired / 4 calls, 1 truncated, 1 repaired | 1.00× | 1.00× |

## Plans

### `inception/mercury-3`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (5 blocks)
  Block: Rebuild & Foundation (2026-10-26 → 2026-12-27)
  Week: 2026-10-26 — Mon Rest; Tue Back-Safe Strength (Recorded); Wed Easy ERG Ride; Thu Easy Run/Walk; Fri Easy ERG Ride; Sat Rest / Light Mobility; Sun Long Hike Anchor
  Day: 2026-10-26 — Rest (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest / active recovery; Tue Indoor ERG endurance ride; Wed Back-safe strength + mobility; Thu Beginner run/walk; Fri Indoor ERG endurance ride; Sat Long easy outdoor ride; Sun Beginner rowing + hip mobility
  Day 2026-11-02: Rest / active recovery (0 min)

Raw plan: [`plans/inception_mercury-3.json`](plans/inception_mercury-3.json)

## Notes

- Weather and daylight are not loaded; the benchmark does not depend on a saved location.
- The completed-week summary and post-build activity-review calls are excluded; they do not change the four plan levels.
- Plans are generated in memory and are never written to the athlete's stored plan.

