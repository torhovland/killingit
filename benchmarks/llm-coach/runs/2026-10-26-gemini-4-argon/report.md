# LLM coach benchmark

- **Run:** `2026-10-26-gemini-4-argon`
- **Run at:** 2026-10-26T06:44:49.133Z
- **Benchmark:** `google/gemini-4-argon` (first model in the list)
- **Athlete:** user 1
- **Full build:** 2026-10-26
- **Week + day refresh:** 2026-11-02
- **Plan output budget:** 16,384 tokens per attempt
- **Git commit:** `65161b4`

Cost is the OpenRouter-reported cost, including retries and JSON repairs. Time is wall-clock for the whole chain. Quality is a manual assessment; it is not produced by the script.

| Model | Quality | Full plan | Refresh | Total | Calls | Cost vs benchmark | Time vs benchmark |
|---|---:|---|---|---|---:|---:|---:|
| `google/gemini-4-argon` **benchmark** | 9.5/10 | 145.2 s / $0.1586 | 89.5 s / $0.1027 | 234.7 s / $0.2613 | 4 calls / 2 calls | 1.00× | 1.00× |
| `anthropic/claude-opus-5.5` | 9.5/10 | 122.5 s / $0.4021 | 63.0 s / $0.2409 | 185.5 s / $0.6430 | 4 calls / 2 calls | 2.46× | 0.79× |
| `z-ai/glm-5.3` | 7.5/10 | 29.6 s / $0.1298 | 15.5 s / $0.0643 | 45.1 s / $0.1941 | 5 calls, 1 repaired / 2 calls | 0.74× | 0.19× |
| `z-ai/glm-5.3-prime` | 7.0/10 | 71.6 s / $0.1574 | 62.4 s / $0.1299 | 133.9 s / $0.2873 | 5 calls, 1 repaired / 4 calls, 2 repaired | 1.10× | 0.57× |
| `deepseek/deepseek-v4.1-flash-1017` | 8.0/10 | 54.1 s / $0.0342 | 25.1 s / $0.0158 | 79.2 s / $0.0500 | 4 calls / 2 calls | 0.19× | 0.34× |
| `recursive/flint-v1.0:free` | 5.0/10 | 726.0 s / $0.0000 | 548.8 s / $0.0000 | 1274.9 s / $0.0000 | 10 calls, 2 truncated / 8 calls, 2 truncated | 0.00× | 5.43× |
| `deepseek/deepseek-v4-pro-0813` | 7.0/10 | 87.2 s / $0.0940 | 38.0 s / $0.0523 | 125.1 s / $0.1463 | 4 calls / 2 calls | 0.56× | 0.53× |

## Quality scores

The benchmark is the reference point. Scores are relative judgments from reading the season, block, week and day levels.

- **9.5/10 — `google/gemini-4-argon`:** Benchmark. Full 200/300/400/600, PBP through the 22 Aug start, strong grounding and an honest refresh that does not assume the 1 Nov hike happened. Slightly verbose; this sample omits the mid-summer reset.
- **9.5/10 — `anthropic/claude-opus-5.5`:** Matches the benchmark: full brevet series, a short vault block, a 10-block season and the most polished week/day coaching. Ends 19 Aug, before PBP, and is the most expensive paid model.
- **7.5/10 — `z-ai/glm-5.3`:** Fast and cheap with a coherent season and 300/400 brevets, but no 600 km qualifier, week totals understate the 5 h hike, and the refresh assumes the hike happened.
- **7.0/10 — `z-ai/glm-5.3-prime`:** Detailed vault and PBP prose, but only plans the April 200 km: no 300/400/600 qualifiers. RDL 20 kg in week 1; refresh needs two repairs.
- **8.0/10 — `deepseek/deepseek-v4.1-flash-1017`:** The budget fix restored the full season: PBP through 29 Aug and an explicit 300/400/600 series. Still has a 20 kg RDL, generic nutrition and assumes the 5 h hike in refresh.
- **5.0/10 — `recursive/flint-v1.0:free`:** Succeeded only after 10 + 8 calls and 21 minutes. The plan is vague, ends 15 Aug before PBP, omits the 300/400/600 series, and calls the 25 Oct hike 5 h 20 (it was 2 h 45 moving / 3 h 20 elapsed).
- **7.0/10 — `deepseek/deepseek-v4-pro-0813`:** The budget fix restored PBP through 29 Aug and the full four-call build, but the season still has no 300/400/600 qualifiers; it is a detailed foundation plan, not a complete PBP campaign.

## Plans

### `google/gemini-4-argon`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (7 blocks)
  Block: Aerobic Rebuild, Mobility & Strength Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Rest & Evening Hip Mobility; Tue Gym Strength, Hip Mobility #2 & Light Vault Tech; Wed Beginner Run/Walk Progression (Flat Terrain); Thu Steady Aerobic Indoor Ride (140-150 W); Fri Gym Strength & Hip Mobility #3 (Pre-Hike Cap); Sat Full Rest Day Ahead of 5-Hour Hike; Sun Long Endurance Mountain Hike
  Day: 2026-10-26 — Rest & Evening Hip Mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest Day & Evening Nutrition Reset; Tue Gym Strength, Hip Mobility & Vault Tech 1; Wed Beginner Run/Walk Progression; Thu Beginner Indoor Rowing & Hip Mobility; Fri Steady Zone 2 Indoor Cycling; Sat Gym Strength, Posterior Chain & Vault Tech 2; Sun Controlled Aerobic Mountain Hike (or Studded/Fatbike Ride)
  Day 2026-11-02: Rest Day & Evening Nutrition Reset (0 min)

Raw plan: [`plans/google_gemini-4-argon.json`](plans/google_gemini-4-argon.json)

### `anthropic/claude-opus-5.5`

**Full build:**

  Season 2026-10-26 → 2027-08-19 (10 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Recovery walk + hip mobility; Tue Gym session 2: squat + RDL intro; Wed First run/walk + rowing intro; Thu Steady ERG endurance ride; Fri Gym session 3; Sat Rest + mobility; Sun 5-hour easy mountain hike
  Day: 2026-10-26 — Recovery walk + hip mobility (42 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Recovery + hip mobility; Tue Gym A: squat/hinge + core; Wed ERG endurance ride + run/walk; Thu Rowing intro + vault drills; Fri Gym B: strength + mobility; Sat ERG endurance ride + run/walk; Sun Long easy hike or fatbike ride
  Day 2026-11-02: Recovery + hip mobility (20 min)

Raw plan: [`plans/anthropic_claude-opus-5.5.json`](plans/anthropic_claude-opus-5.5.json)

### `z-ai/glm-5.3`

**Full build:**

  Season 2026-10-26 → 2027-08-21 (8 blocks)
  Block: Re-entry & Fat Loss Foundation (2026-10-26 → 2026-11-15)
  Week: 2026-10-26 — Mon Rest day with hip mobility; Tue Easy indoor ride; Wed Short easy flat walk; Thu Gym strength session 2; Fri Rest day with hip mobility; Sat Pre-hike shakeout walk; Sun 5-hour hike
  Day: 2026-10-26 — Rest day with hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Recovery walk + hip mobility; Tue Easy indoor ride — steady 140-160 W; Wed Gym strength — session 2 with RDL introduction; Thu Rest day; Fri Easy indoor ride — steady 140-160 W; Sat Run/walk — 30 minutes; Sun Weekend endurance — easy fatbike ride or hike (1.5-2 hours)
  Day 2026-11-02: Recovery walk + hip mobility (45 min)

Raw plan: [`plans/z-ai_glm-5.3.json`](plans/z-ai_glm-5.3.json)

### `z-ai/glm-5.3-prime`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (8 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-11-15)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Gym strength session 2; Wed Easy indoor ride; Thu Rest and extended hip mobility; Fri Short easy indoor ride or flat walk; Sat Full rest before the long hike; Sun 5-hour anchor hike
  Day: 2026-10-26 — Rest and hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Full rest + hip mobility; Tue Gym strength session 1; Wed Easy indoor ride; Thu Run/walk (if legs are fresh); Fri Rest + hip mobility; Sat Gym strength session 2; Sun 2-hour easy hike or fatbike ride
  Day 2026-11-02: Full rest + hip mobility (15 min)

Raw plan: [`plans/z-ai_glm-5.3-prime.json`](plans/z-ai_glm-5.3-prime.json)

### `deepseek/deepseek-v4.1-flash-1017`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (6 blocks)
  Block: Rebuild, Fat-Loss Foundation & Vault Prep (2026-10-26 → 2027-01-10)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Easy aerobic trainer ride; Wed Full-body strength technique; Thu Rest and mobility; Fri Steady easy trainer ride; Sat Pre-hike rest and mobility; Sun 5-hour easy mountain hike
  Day: 2026-10-26 — Rest and hip mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest and hip mobility; Tue Easy indoor cycling — aerobic rebuild; Wed Gym strength A — technique and hip hinge; Thu Beginner run/walk; Fri Easy indoor cycling — steady aerobic; Sat Easy flat walk — recovery volume; Sun Gym strength B — controlled full body
  Day 2026-11-02: Rest and hip mobility (20 min)

Raw plan: [`plans/deepseek_deepseek-v4.1-flash-1017.json`](plans/deepseek_deepseek-v4.1-flash-1017.json)

### `recursive/flint-v1.0:free`

**Full build:**

  Season 2026-10-26 → 2027-08-15 (5 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-12-20)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Optional easy flat walk; Wed Rest and mobility; Thu Back-safe strength technique; Fri Rest and mobility; Sat Rest and mobility; Sun 5-hour easy mountain hike
  Day: 2026-10-26 — Rest and hip mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Post-Hike Recovery and Hip Mobility; Tue Easy Recovery Ride; Wed Light Back-Safe Strength; Thu Post-Hike Recovery and Mobility; Fri Recovery and Mobility; Sat Easy Flat Walk; Sun Recovery
  Day 2026-11-02: Post-Hike Recovery and Hip Mobility (0 min)

Raw plan: [`plans/recursive_flint-v1.0_free.json`](plans/recursive_flint-v1.0_free.json)

### `deepseek/deepseek-v4-pro-0813`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (6 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Short flat walk; Wed Easy indoor cycling; Thu Gym strength session; Fri Easy indoor cycling; Sat Rest and hip mobility; Sun 5-hour easy hike
  Day: 2026-10-26 — Rest and hip mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest / hip mobility; Tue Easy indoor cycling; Wed Strength session; Thu Beginner row; Fri Easy indoor cycling; Sat Run/walk; Sun Strength session
  Day 2026-11-02: Rest / hip mobility (0 min)

Raw plan: [`plans/deepseek_deepseek-v4-pro-0813.json`](plans/deepseek_deepseek-v4-pro-0813.json)

## Notes

- Weather and daylight are not loaded; the benchmark does not depend on a saved location.
- The completed-week summary and post-build activity-review calls are excluded; they do not change the four plan levels.
- Plans are generated in memory and are never written to the athlete's stored plan.

