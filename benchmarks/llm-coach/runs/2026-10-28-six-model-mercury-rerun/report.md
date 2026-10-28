# LLM coach benchmark

- **Run:** `2026-10-28-six-model-mercury-rerun`
- **Run at:** 2026-10-28T06:00:18.796Z
- **Benchmark:** `google/gemini-4-argon` (first model in the list)
- **Athlete:** user 1
- **Full build:** 2026-10-26
- **Week + day refresh:** 2026-11-02
- **Plan output budget:** 16,384 tokens per attempt
- **Git commit:** `beaea772315552f8ead11ed2a8b5b78b6c142958`

Cost is the OpenRouter-reported cost, including retries and JSON repairs. Time is wall-clock for the whole chain. Quality is a manual assessment; it is not produced by the script.

| Model | Quality | Full plan | Refresh | Total | Calls | Cost vs benchmark | Time vs benchmark |
|---|---:|---|---|---|---:|---:|---:|
| `google/gemini-4-argon` **benchmark** | — | 135.3 s / $0.1865 | 105.3 s / $0.1362 | 240.6 s / $0.3227 | 4 calls / 2 calls | 1.00× | 1.00× |
| `anthropic/claude-haiku-5.5` | — | 87.5 s / $0.0159 | 58.4 s / $0.0107 | 145.9 s / $0.0266 | 4 calls / 2 calls | 0.08× | 0.61× |
| `deepseek/deepseek-v4.1-flash-1017` | — | 122.2 s / $0.0133 | 89.2 s / $0.0135 | 211.4 s / $0.0269 | 4 calls / 2 calls | 0.08× | 0.88× |
| `inception/mercury-3` | — | 112.5 s / $0.0239 | 47.6 s / $0.0109 | 160.1 s / $0.0348 | 7 calls, 2 truncated, 1 repaired / 4 calls, 1 truncated, 1 repaired | 0.11× | 0.67× |
| `minimax/minimax-m3.1-flash` | — | 82.1 s / $0.0102 | 51.3 s / $0.0129 | 133.4 s / $0.0231 | 4 calls / 3 calls, 1 repaired | 0.07× | 0.55× |
| `z-ai/glm-5.3` | — | 68.3 s / $0.0307 | 68.8 s / $0.0393 | 137.1 s / $0.0701 | 5 calls, 1 repaired / 4 calls, 2 repaired | 0.22× | 0.57× |

## Plans

### `google/gemini-4-argon`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (7 blocks)
  Block: Autumn Rebuild, Fat Loss & Structural Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest & Post-Hike Recovery; Tue Steady Zone 2 ERG Ride; Wed Back-Safe Gym Strength & Extended Hip Mobility; Thu Beginner Run/Walk Progression (HR Capped); Fri Rest & Evening Routine Focus; Sat Hip Mobility, Core Activation & Pre-Hike Prep; Sun 5-Hour Mountain Hike Durability Anchor
  Day: 2026-10-26 — Rest & Post-Hike Recovery (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest Day & Evening Nutrition Focus; Tue Back-Safe Gym Strength, Beginner Rowing & Hip Mobility; Wed Steady Zone 2 Indoor ERG Ride; Thu Beginner Run/Walk Progression (HR Capped); Fri Back-Safe Gym Strength, Beginner Rowing & Hip Mobility B; Sat Steady Zone 2 ERG Ride (or Dry Outdoor Spin); Sun Weekend Mountain Hike (Stop-Capped Endurance)
  Day 2026-11-02: Rest Day & Evening Nutrition Focus (0 min)

Raw plan: [`plans/google_gemini-4-argon.json`](plans/google_gemini-4-argon.json)

### `anthropic/claude-haiku-5.5`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (8 blocks)
  Block: Rebuild and Fat Loss Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Indoor ERG endurance ride, 60 min at 145 W; Tue Rest and hip mobility; Wed Back-safe gym strength A; Thu Run/walk restart, 40 min; Fri Back-safe gym strength B, lighter; Sat Indoor ERG endurance ride, 60 min at 145 W; Sun Mountain hike anchor, 4 hours
  Day: 2026-10-26 — Indoor ERG endurance ride, 60 min at 145 W (60 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Indoor ERG steady endurance; Tue Back-safe gym A with RDL introduction; Wed Run/walk build; Thu Rest day; Fri Back-safe gym B; Sat Fatbike steady ride with studded tyres; Sun 4.5-hour hike anchor
  Day 2026-11-02: Indoor ERG steady endurance (65 min)

Raw plan: [`plans/anthropic_claude-haiku-5.5.json`](plans/anthropic_claude-haiku-5.5.json)

### `deepseek/deepseek-v4.1-flash-1017`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (7 blocks)
  Block: Rebuild & Fat-Loss Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Easy indoor trainer spin; Tue Back-safe full-body gym (recorded); Wed Hip mobility and core reset; Thu Beginner run/walk restart; Fri Rest; Sat Rest; Sun 5-hour hiking anchor
  Day: 2026-10-26 — Easy indoor trainer spin (30 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Hip mobility and easy recovery walk; Tue Steady indoor ERG endurance ride; Wed Back-safe full-body gym strength; Thu Beginner run/walk; Fri Beginner rowing plus hip mobility; Sat Back-safe strength B; Sun Easy aerobic hike
  Day 2026-11-02: Hip mobility and easy recovery walk (30 min)

Raw plan: [`plans/deepseek_deepseek-v4.1-flash-1017.json`](plans/deepseek_deepseek-v4.1-flash-1017.json)

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

### `minimax/minimax-m3.1-flash`

**Full build:**

  Season 2026-10-26 → 2027-08-15 (5 blocks)
  Block: Rebuild & Habit Base (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest and gentle mobility; Tue Back-safe strength and mobility; Wed Steady ERG aerobic ride; Thu Easy run-walk restart; Fri Rest and mobility; Sat Rest before the durability anchor; Sun Five-hour low-intensity hike
  Day: 2026-10-26 — Rest and gentle mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Easy flat ERG endurance ride (60 min); Tue Easy run-walk restart (40 min); Wed Back-safe gym strength (45 min); Thu Rest day - mobility only; Fri Easy flat ERG endurance ride (70 min); Sat Long winter durability anchor - snowshoe hike / fatbike (4 h); Sun Indoor rowing (45 min) + mobility (15 min)
  Day 2026-11-02: Easy flat ERG endurance ride (60 min) (60 min)

Raw plan: [`plans/minimax_minimax-m3.1-flash.json`](plans/minimax_minimax-m3.1-flash.json)

### `z-ai/glm-5.3`

**Full build:**

  Season 2026-10-26 → 2027-08-21 (7 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest day; Tue Back-safe gym strength; Wed Easy ERG ride + hip mobility; Thu Easy run/walk; Fri Short easy ERG ride; Sat Rest and hike prep; Sun 5-hour endurance hike (week anchor)
  Day: 2026-10-26 — Rest day (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest day + optional hip mobility; Tue Easy ERG ride — flat 150 W; Wed Back-safe gym strength + hip mobility; Thu Easy run/walk — 40 min restart; Fri Easy ERG ride — flat 155 W; Sat Rest day + hip mobility; Sun Long hike — 2.5-3 h durability anchor
  Day 2026-11-02: Rest day + optional hip mobility (10 min)

Raw plan: [`plans/z-ai_glm-5.3.json`](plans/z-ai_glm-5.3.json)

## Notes

- Weather and daylight are not loaded; the benchmark does not depend on a saved location.
- The completed-week summary and post-build activity-review calls are excluded; they do not change the four plan levels.
- Plans are generated in memory and are never written to the athlete's stored plan.
- Mercury 3 was rerun on 2026-10-28 after the 2026-10-27 attempt failed schema validation; the other five plans are from the 2026-10-27 run.

