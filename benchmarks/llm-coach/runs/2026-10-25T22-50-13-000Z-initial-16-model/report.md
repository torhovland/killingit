# LLM coach benchmark

- **Run:** `2026-10-25T22-50-13-000Z-initial-16-model`
- **Run at:** 2026-10-25T22:50:13.268Z
- **Benchmark:** `anthropic/claude-opus-5.5` (first model in the list)
- **Athlete:** user 1
- **Full build:** 2026-10-26
- **Week + day refresh:** 2026-11-02
- **Plan output budget:** 4,096 tokens per attempt
- **Git commit:** `92f07c0`

Cost is the OpenRouter-reported cost, including retries and JSON repairs. Time is wall-clock for the whole chain. Quality is a manual assessment; it is not produced by the script.

| Model | Quality | Full plan | Refresh | Total | Calls | Cost vs benchmark | Time vs benchmark |
|---|---:|---|---|---|---:|---:|---:|
| `anthropic/claude-opus-5.5` **benchmark** | 9.5/10 | 108.1 s / $0.3763 | 125.2 s / $0.4451 | 233.3 s / $0.8213 | 4 calls / 5 calls, 1 truncated | 1.00× | 1.00× |
| `anthropic/claude-sonnet-5.5` | 7.0/10 | 55.8 s / $0.1587 | 39.1 s / $0.1450 | 94.8 s / $0.3037 | 4 calls / 3 calls, 1 repaired | 0.37× | 0.41× |
| `anthropic/claude-haiku-5.5` | 7.5/10 | 114.7 s / $0.0224 | 70.0 s / $0.0154 | 184.6 s / $0.0378 | 8 calls, 3 truncated, 1 repaired / 5 calls, 2 truncated, 1 repaired | 0.05× | 0.79× |
| `deepseek/deepseek-v4.1-flash-1017` | 5.5/10 | 78.9 s / $0.0427 | 37.3 s / $0.0186 | 116.1 s / $0.0613 | 8 calls, 3 truncated, 1 repaired / 3 calls, 1 truncated | 0.07× | 0.50× |
| `deepseek/deepseek-v4-pro-0813` | 4.5/10 | 152.4 s / $0.1212 | 93.6 s / $0.0769 | 246.0 s / $0.1981 | 9 calls, 4 truncated, 1 repaired / 5 calls, 2 truncated, 1 repaired | 0.24× | 1.05× |
| `qwen/qwen3.8-flash` | 5.0/10 | 425.6 s / $0.0221 | 291.9 s / $0.0135 | 717.5 s / $0.0355 | 10 calls, 5 truncated, 2 repaired / 6 calls, 3 truncated, 2 repaired | 0.04× | 3.08× |
| `qwen/qwen3.7-plus` | 8.0/10 | 440.2 s / $0.0518 | 296.3 s / $0.0376 | 736.5 s / $0.0894 | 9 calls, 4 truncated, 2 repaired / 6 calls, 3 truncated, 2 repaired | 0.11× | 3.16× |
| `qwen/qwen3.6-plus` | 4.0/10 | 387.8 s / $0.0600 | 210.9 s / $0.0335 | 598.8 s / $0.0935 | 8 calls, 4 truncated / 4 calls, 2 truncated | 0.11× | 2.57× |
| `inception/mercury-3` | 7.0/10 | 51.7 s / $0.0120 | 18.4 s / $0.0051 | 70.1 s / $0.0171 | 9 calls, 4 truncated, 1 repaired / 3 calls, 1 truncated | 0.02× | 0.30× |
| `moonshotai/kimi-k3.1-pro` | 9.0/10 | 267.9 s / $0.1757 | 171.1 s / $0.1230 | 439.0 s / $0.2987 | 4 calls / 3 calls, 1 repaired | 0.36× | 1.88× |
| `recursive/flint-v1.0:free` | 0.0/10 | failed (193.8 s / $0.0000) | — | 193.8 s / $0.0000 | 10 calls, 4 truncated / — | 0.00× | 0.83× |
| `minimax/minimax-m3.1-flash` | 6.5/10 | 28.8 s / $0.0107 | 17.5 s / $0.0069 | 46.3 s / $0.0176 | 5 calls, 1 repaired / 3 calls, 1 repaired | 0.02× | 0.20× |
| `google/gemini-4-argon` | 9.5/10 | 143.1 s / $0.1653 | 82.8 s / $0.1034 | 225.9 s / $0.2688 | 4 calls / 2 calls | 0.33× | 0.97× |
| `openai/gpt-6.1-sol-pro` | 8.5/10 | 222.8 s / $0.4945 | 102.5 s / $0.2712 | 325.3 s / $0.7658 | 6 calls, 2 repaired / 3 calls, 1 repaired | 0.93× | 1.39× |
| `openai/gpt-6.1-sol` | 8.5/10 | 210.3 s / $0.2051 | 101.8 s / $0.1278 | 312.1 s / $0.3330 | 6 calls, 2 repaired / 3 calls, 1 repaired | 0.41× | 1.34× |
| `z-ai/glm-5.3-prime` | 7.5/10 | 69.1 s / $0.1374 | 55.0 s / $0.1068 | 124.1 s / $0.2442 | 4 calls / 3 calls, 1 repaired | 0.30× | 0.53× |

## Quality scores

The benchmark is the reference point. Scores are relative judgments from reading the season, block, week and day levels.

- **9.5/10 — `anthropic/claude-opus-5.5`:** Benchmark. Best grounding, safety and week/day coaching; season ends 19 Aug, before PBP.
- **7.0/10 — `anthropic/claude-sonnet-5.5`:** Detailed and fast, but dismisses the pole-vault event, ends before PBP and starts RDLs at 20–30 kg.
- **7.5/10 — `anthropic/claude-haiku-5.5`:** Includes a vault block and is very cheap; hallucinates a completed week 1 and uses 20 kg RDLs twice.
- **5.5/10 — `deepseek/deepseek-v4.1-flash-1017`:** First run failed schema; retry is cheap and detailed but has a PBP typo, aggressive vault work and factual slips.
- **4.5/10 — `deepseek/deepseek-v4-pro-0813`:** Final plan omits PBP and the 300/400/600 series; the first truncated attempt did include them.
- **5.0/10 — `qwen/qwen3.8-flash`:** 12-minute run; 200 km block is after April, no 600, shortens the athlete's 5 h hike.
- **8.0/10 — `qwen/qwen3.7-plus`:** Good season and conservative strength, but 12 minutes, no nutrition detail and no explicit 600.
- **4.0/10 — `qwen/qwen3.6-plus`:** Over-prioritises the vault, puts the 200 km brevet after April and adds early intensity in refresh.
- **7.0/10 — `inception/mercury-3`:** Very fast and cheap with a good 200 km taper; vault timing is inconsistent and it invents a temperature.
- **9.0/10 — `moonshotai/kimi-k3.1-pro`:** Close to Opus: safe, complete and well reasoned; race week ends on the PBP start date.
- **0.0/10 — `recursive/flint-v1.0:free`:** Failed with LlmTokenLimitError after 10 calls; no plan.
- **6.5/10 — `minimax/minimax-m3.1-flash`:** Fast and cheap with good week 1; no brevet series and early plyometrics.
- **9.5/10 — `google/gemini-4-argon`:** Matches Opus: PBP through 29 Aug, full brevet series, honest refresh; verbose.
- **8.5/10 — `openai/gpt-6.1-sol-pro`:** Complete and safe, but over-conservative and shortens the requested 5 h hike to 85 min.
- **8.5/10 — `openai/gpt-6.1-sol`:** Complete and honest, but week 1 is 3–4 h and the 5 h hike becomes 80 min.
- **7.5/10 — `z-ai/glm-5.3-prime`:** Good season and full brevets; week totals are wrong and the vault block is aggressive.

## Plans

### `anthropic/claude-opus-5.5`

**Full build:**

  Season 2026-10-26 → 2027-08-19 (8 blocks)
  Block: Rebuild & Habit Foundation (2026-10-26 → 2026-11-22)
  Week: 2026-10-26 — Mon Rest + hip mobility; Tue Gym session: back-safe strength 2; Wed Beginner row intro + mobility; Thu Run/walk 30 min; Fri Z2 ERG ride 60 min; Sat Rest + hip mobility; Sun Long easy mountain hike
  Day: 2026-10-26 — Rest + hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Z2 ERG ride + hip mobility; Tue Gym A: goblet squat progression + RDL intro; Wed Run/walk 3 min jogs + technique row; Thu Run/walk 3.5 min jogs + Z2 ride; Fri Gym B: hinge, hip thrust, pull/push, carries; Sat Easy hike or fatbike, 2 h; Sun Rest + 15 min hip mobility
  Day 2026-11-02: Z2 ERG ride + hip mobility (70 min)

Raw plan: [`plans/anthropic_claude-opus-5.5.json`](plans/anthropic_claude-opus-5.5.json)

### `anthropic/claude-sonnet-5.5`

**Full build:**

  Season 2026-10-26 → 2027-08-15 (7 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Steady trainer ride (ERG); Wed Gym session 2: technique-first strength; Thu Rest and mobility; Fri Easy ride outdoors or on the trainer; Sat Gym session 3: light strength, core and mobility; Sun 5-hour easy mountain hike
  Day: 2026-10-26 — Rest and hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest and hip mobility; Tue Easy steady ride; Wed Gym session A: technique and posterior chain; Thu First run/walk; Fri Intro row and gym session B; Sat Long easy ride; Sun Easy hike
  Day 2026-11-02: Rest and hip mobility (15 min)

Raw plan: [`plans/anthropic_claude-sonnet-5.5.json`](plans/anthropic_claude-sonnet-5.5.json)

### `anthropic/claude-haiku-5.5`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (6 blocks)
  Block: Rebuild and Fat Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Gym session A: full-body with hip-hinge focus; Wed Easy run/walk, 30 min; Thu Gym session B: squat and RDL progression; Fri Indoor steady ride, 55 min; Sat Rest and hip mobility; Sun 5-hour mountain hike
  Day: 2026-10-26 — Rest and hip mobility (10 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Gym: Full body strength (lower focus); Tue Indoor steady ride (trainer, ERG); Wed Rest and hip mobility; Thu Gym: Full body strength (upper and core); Fri Outdoor road or gravel easy ride (dry conditions); Sat Easy walk on flat or rolling terrain; Sun Run/walk: beginner running (easy)
  Day 2026-11-02: Gym: Full body strength (lower focus) (55 min)

Raw plan: [`plans/anthropic_claude-haiku-5.5.json`](plans/anthropic_claude-haiku-5.5.json)

### `deepseek/deepseek-v4.1-flash-1017`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (5 blocks)
  Block: Rebuild and Vault Preparation (2026-10-26 → 2027-01-10)
  Week: 2026-10-26 — Mon Rest and hip mobility; Tue Easy indoor trainer ride; Wed Gym: technique-first full-body strength; Thu Rest and hip mobility; Fri Easy indoor trainer ride; Sat Rest and hip mobility; Sun 5-hour mountain hike
  Day: 2026-10-26 — Rest and hip mobility (20 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Full rest and hip mobility; Tue Easy steady indoor ride; Wed Gym strength A: squat, hinge, pull, core; Thu Easy run/walk; Fri Gym strength B: hinge emphasis and trunk; Sat Fatbike endurance ride; Sun Easy indoor row and hip mobility
  Day 2026-11-02: Full rest and hip mobility (20 min)

Raw plan: [`plans/deepseek_deepseek-v4.1-flash-1017.json`](plans/deepseek_deepseek-v4.1-flash-1017.json)

### `deepseek/deepseek-v4-pro-0813`

**Full build:**

  Season 2026-10-26 → 2027-04-30 (4 blocks)
  Block: Foundation & Fat Loss (2026-10-26 → 2026-11-22)
  Week: 2026-10-26 — Mon Rest with hip mobility; Tue Easy indoor cycling; Wed Gym strength session; Thu Rest with hip mobility; Fri Easy indoor cycling; Sat Easy run/walk; Sun Long mountain hike
  Day: 2026-10-26 — Rest with hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest and Hip Mobility; Tue Gym Session 1: Lower Body and Core; Wed Easy Run/Walk; Thu Easy Indoor Ride; Fri Gym Session 2: Upper Body and Core; Sat Easy Indoor Ride; Sun Outdoor Ride or Hike
  Day 2026-11-02: Rest and Hip Mobility (15 min)

Raw plan: [`plans/deepseek_deepseek-v4-pro-0813.json`](plans/deepseek_deepseek-v4-pro-0813.json)

### `qwen/qwen3.8-flash`

**Full build:**

  Season 2026-10-26 → 2027-08-31 (7 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Full Rest & Hip Mobility; Tue Indoor Cycling - Steady State; Wed Beginner Rowing Technique; Thu Strength Session 2 - Posterior Chain; Fri Rest Day; Sat Easy Run/Walk Introduction; Sun Long Hike Prep - Moderate Walk
  Day: 2026-10-26 — Full Rest & Hip Mobility Focus (30 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Indoor Cycling - Steady State Re-entry; Tue Gym Session - Posterior Chain Introduction; Wed Rest Day; Thu Run/Walk Progression; Fri Indoor Cycling - Endurance Base; Sat Long Hike - Aerobic Volume; Sun Active Recovery & Mobility
  Day 2026-11-02: Indoor Cycling - Steady State Re-entry (45 min)

Raw plan: [`plans/qwen_qwen3.8-flash.json`](plans/qwen_qwen3.8-flash.json)

### `qwen/qwen3.7-plus`

**Full build:**

  Season 2026-10-26 → 2027-08-31 (8 blocks)
  Block: Rebuild & Mobility Foundation (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest & Hip Mobility; Tue Easy Indoor Spin; Wed Gym: Strength & Mobility; Thu Easy Indoor Row; Fri Easy Indoor Spin; Sat Pre-Hike Mobility Walk; Sun Long Mountain Hike
  Day: 2026-10-26 — Rest & Hip Mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest & Hip Mobility; Tue Indoor Easy Spin; Wed Gym Strength & Mobility; Thu Indoor Rowing Easy; Fri Indoor Cycling Steady; Sat Outdoor Hike or Fatbike Ride; Sun Long Endurance Ride/Hike
  Day 2026-11-02: Rest & Hip Mobility (15 min)

Raw plan: [`plans/qwen_qwen3.7-plus.json`](plans/qwen_qwen3.7-plus.json)

### `qwen/qwen3.6-plus`

**Full build:**

  Season 2026-10-26 → 2027-08-31 (6 blocks)
  Block: Pole Vault Peak & Rehab (2026-10-26 → 2027-01-07)
  Week: 2026-10-26 — Mon Hip Mobility & Core Activation; Tue Easy Indoor Cycle; Wed Vault Technique & Plyo Intro; Thu Easy Run/Walk; Fri Rest & Mobility; Sat Pre-Hike Activation; Sun Long Mountain Hike
  Day: 2026-10-26 — Hip Mobility & Core Activation (45 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Easy Indoor Spin & Hip Mobility; Tue Gym: Posterior Chain & Core; Wed Indoor Rowing Intervals; Thu Rest & Recovery; Fri Indoor Cycling Sweet Spot; Sat Outdoor Fatbike Ride; Sun Long Walk/Hike & Mobility
  Day 2026-11-02: Easy Indoor Spin & Hip Mobility (55 min)

Raw plan: [`plans/qwen_qwen3.6-plus.json`](plans/qwen_qwen3.6-plus.json)

### `inception/mercury-3`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (8 blocks)
  Block: Rebuild & Fat Loss Foundation (2026-10-26 → 2027-01-03)
  Week: 2026-10-26 — Mon Rest & Hip Mobility; Tue Easy Flat Walk; Wed Easy Indoor Cycling (Steady); Thu Gym Strength — Technique & Posterior Chain; Fri Rest & Hip Mobility; Sat Very Easy Indoor Ride; Sun Long Easy Hike (5h)
  Day: 2026-10-26 — Rest & Hip Mobility (20 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest & Mobility; Tue Easy Indoor Ride (Steady); Wed Rest & Mobility; Thu Gym Strength Session 2; Fri Short Easy Run/Walk; Sat Moderate Fatbike Ride; Sun Easy Hike or Long Walk
  Day 2026-11-02: Rest & Mobility (15 min)

Raw plan: [`plans/inception_mercury-3.json`](plans/inception_mercury-3.json)

### `moonshotai/kimi-k3.1-pro`

**Full build:**

  Season 2026-10-26 → 2027-08-22 (9 blocks)
  Block: Rebuild and Fat-Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Recovery and hip mobility; Tue Very easy steady trainer ride; Wed Back-safe full-body strength A; Thu Rest and movement reset; Fri Back-safe full-body strength B; Sat Short steady ride before the hike; Sun Five-hour easy endurance hike
  Day: 2026-10-26 — Recovery and hip mobility (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Recovery and mobility; Tue Steady indoor aerobic ride; Wed Gym strength and beginner rowing; Thu Conditional easy run/walk; Fri Back-safe full-body gym session; Sat Short steady outdoor ride; Sun Easy weekend hike
  Day 2026-11-02: Recovery and mobility (0 min)

Raw plan: [`plans/moonshotai_kimi-k3.1-pro.json`](plans/moonshotai_kimi-k3.1-pro.json)

### `recursive/flint-v1.0:free`

**Full build:**

  Failed: LlmTokenLimitError: OpenRouter stopped the response at the token limit; try again or choose a model with a larger output budget

**Error:** LlmTokenLimitError: OpenRouter stopped the response at the token limit; try again or choose a model with a larger output budget

Raw plan: [`plans/recursive_flint-v1.0_free.json`](plans/recursive_flint-v1.0_free.json)

### `minimax/minimax-m3.1-flash`

**Full build:**

  Season 2026-10-26 → 2027-08-15 (8 blocks)
  Block: Rebuild and Fat-Loss Foundation (2026-10-26 → 2026-11-29)
  Week: 2026-10-26 — Mon Recovery and hip mobility; Tue Easy indoor aerobic ride; Wed Short easy run-walk; Thu Technique-focused gym session; Fri Steady indoor aerobic ride; Sat Rest, walking, and mobility; Sun Controlled 5-hour hike
  Day: 2026-10-26 — Recovery and hip mobility (20 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Recovery and hip mobility; Tue Steady indoor aerobic ride; Wed Easy run-walk; Thu Back-safe strength and first vault exposure; Fri Rest and easy walking; Sat Easy fatbike endurance ride; Sun Run-walk and easy rowing
  Day 2026-11-02: Recovery and hip mobility (20 min)

Raw plan: [`plans/minimax_minimax-m3.1-flash.json`](plans/minimax_minimax-m3.1-flash.json)

### `google/gemini-4-argon`

**Full build:**

  Season 2026-10-26 → 2027-08-29 (7 blocks)
  Block: Rebuild, Hip Mobility & Vault Conditioning Base (2026-10-26 → 2026-12-06)
  Week: 2026-10-26 — Mon Rest Day & Hip Mobility Reset; Tue Easy Run/Walk Tendon Conditioning & Hip Mobility; Wed Gym Strength Session 1: Goblet Squat Progression & RDL Intro; Thu Steady Zone 2 Indoor Cycling (140–150 W); Fri Gym Strength Session 2: Hinge Technique, Anti-Extension Core & Mobility; Sat Pre-Hike Rest & Mobility Day; Sun Long Endurance Mountain Hike (5 Hours)
  Day: 2026-10-26 — Rest Day & Hip Mobility Reset (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest Day & Evening Nutrition Reset; Tue Gym Strength A: Hinge Introduction, Squat Progression & Hip Mobility; Wed Steady Zone 2 Indoor Cycling (Power Control); Thu Beginner Run/Walk Progression & Tendon Prep; Fri Beginner Indoor Rowing Session 1 & Hip Mobility; Sat Gym Strength B & Technical Pole Vault Play; Sun Weekend Aerobic Endurance: Mountain Hike or Fatbike Ride
  Day 2026-11-02: Rest Day & Evening Nutrition Reset (0 min)

Raw plan: [`plans/google_gemini-4-argon.json`](plans/google_gemini-4-argon.json)

### `openai/gpt-6.1-sol-pro`

**Full build:**

  Season 2026-10-26 → 2027-08-26 (10 blocks)
  Block: Recovery and sustainable re-entry (2026-10-26 → 2026-11-08)
  Week: 2026-10-26 — Mon Recover from Sunday's mountain hike; Tue Gentle recovery walk and hip mobility; Wed Easy cycling re-entry; Thu Back-tolerant introductory gym strength; Fri Steady easy cycling; Sat Conditional light gym rehearsal; Sun Short, easy endurance hike
  Day: 2026-10-26 — Recover from Sunday's mountain hike (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest and recovery check; Tue Easy cycling and hip mobility; Wed Gym A: supported strength; Thu Steady easy cycling; Fri Gym B: repeat tolerated strength; Sat Gentle daylight hike; Sun Rest and review readiness
  Day 2026-11-02: Rest and recovery check (0 min)

Raw plan: [`plans/openai_gpt-6.1-sol-pro.json`](plans/openai_gpt-6.1-sol-pro.json)

### `openai/gpt-6.1-sol`

**Full build:**

  Season 2026-10-26 → 2027-08-26 (13 blocks)
  Block: Recovery and sustainable re-entry (2026-10-26 → 2026-11-15)
  Week: 2026-10-26 — Mon Recover from Sunday's mountain hike; Tue Gentle recovery walk and hip mobility; Wed Gym A: conservative full-body re-entry; Thu Easy steady cycling and mobility; Fri Gym B: consolidate technique without progression; Sat Rest and assess readiness for hiking; Sun Shortened conversational hike
  Day: 2026-10-26 — Recover from Sunday's mountain hike (0 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Recovery and readiness check; Tue Back-tolerant gym and rowing introduction; Wed Steady easy cycling; Thu Consolidate full-body strength and trunk control; Fri Easy cycling without surges; Sat Daylight easy hike and hip mobility; Sun Conditional beginner run/walk
  Day 2026-11-02: Recovery and readiness check (0 min)

Raw plan: [`plans/openai_gpt-6.1-sol.json`](plans/openai_gpt-6.1-sol.json)

### `z-ai/glm-5.3-prime`

**Full build:**

  Season 2026-10-26 → 2027-08-23 (7 blocks)
  Block: Rebuild, Fat Loss & Vault Foundation (2026-10-26 → 2026-12-20)
  Week: 2026-10-26 — Mon Rest day with hip mobility; Tue Easy trainer ride, steady 140-150 W; Wed Gym session 2: goblet squats + RDL introduction; Thu Rest day with hip mobility; Fri Easy trainer ride, steady 140-150 W; Sat Rest day with short flat walk; Sun 5-hour endurance hike
  Day: 2026-10-26 — Rest day with hip mobility (15 min)

**Week + day refresh:**

  Week 2026-11-02: Mon Rest and hip mobility; Tue Easy trainer ride; Wed Gym session 3; Thu Easy walk; Fri Easy trainer ride; Sat Run/walk session; Sun Easy hike or walk
  Day 2026-11-02: Rest and hip mobility (15 min)

Raw plan: [`plans/z-ai_glm-5.3-prime.json`](plans/z-ai_glm-5.3-prime.json)

## Notes

- Initial ad-hoc run, before the reusable benchmark runner; this run used 4,096 output tokens, which truncated reasoning models.
- The DeepSeek V4.1 Flash row is the successful retry; its first full run failed schema validation after 95.2 s and $0.0455.
- Weather/daylight, the completed-week summary and post-build activity-review calls are excluded.

