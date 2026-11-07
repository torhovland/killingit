# Diet log

## Goal

Let an athlete who wants diet advice log a meal by describing it in their own
words, optionally attaching a photo, and get a coach response that describes the
meal, estimates its carbohydrate and macronutrient content, and comments on how
the meal fits the athlete's diet and training goals. The athlete can also give
the meal time; by default it is the current local date and time.

Every coach prompt sees the meals from the last seven days and a weekly
nutrition summary of completed weeks going back at most one year.

## Scope

- A new `food_entries` table stores one logged meal per row: the athlete's
  description, the meal instant in the athlete's local day and clock time, the
  optional photo, and the coach's structured analysis.
- The main dashboard shows a food log form at the top, but only when the athlete
  has enabled diet advice in Settings.
- A new **Diet** page lists every logged meal with its coach response and a
  thumbnail of the photo when one was provided.
- The plan, reply, review, activity-analysis and program-analysis prompts
  receive the food log context.
- Every prompt that receives the food log also receives the shared diet rule so
  a meal is never treated as training load.

## Out of scope

- A separate diet plan, calorie targets, or macro targets. The coach comments
  against the athlete's stated goals and training, not a prescription.
- Editing a logged meal. Logging is append-only in this change.
- Nutrition data from Garmin or another provider.
- Photo storage outside the account's database row.

## Data model

`food_entries`:

| Column                     | Notes                                               |
| -------------------------- | --------------------------------------------------- |
| `id`                       | Primary key.                                        |
| `user_id`                  | Account owner, cascades on account deletion.        |
| `eaten_at`                 | The meal instant, `timestamptz`.                    |
| `eaten_date`               | The athlete's local calendar date, `YYYY-MM-DD`.    |
| `eaten_time`               | The athlete's local clock time, `HH:MM`.            |
| `description`              | The athlete's own description (1–2,000 characters). |
| `photo_data_url`           | Optional JPEG/PNG/WebP data URL.                    |
| `analysis`                 | The coach's structured analysis, or null.           |
| `model`                    | The model that produced the analysis.               |
| `analysis_error`           | Why the analysis could not be produced, or null.    |
| `created_at`, `updated_at` | Timestamps.                                         |

The local date and time are stored at write time so prompt summaries and the
review page do not depend on the server's time zone, and because the athlete's
display zone can change later.

## Coach analysis contract

```json
{
  "meal": "string",
  "carbsGrams": 0,
  "proteinGrams": 0,
  "fatGrams": 0,
  "caloriesKcal": 0,
  "dietFit": "string"
}
```

- `meal` describes what the coach understands the athlete ate.
- The four numbers are totals for the whole meal. Estimates are approximate and
  the prompt says so.
- `dietFit` is one short paragraph on how the meal fits the athlete's goal,
  training load and recent food log.

The analysis runs synchronously when the meal is saved. A failed analysis is
kept as `analysisError` and the meal is still logged.

## Prompt context

`formatDietContext` renders two sections into `PlanContextInput`:

1. **Recent meals** — every meal whose local date is within the last seven days,
   most recent first, with the athlete's description, the coach's description,
   macros and diet-fit note.
2. **Weekly nutrition summary** — each completed week with at least one meal in
   the last year, newest first, up to 52 weeks. A line gives the number of
   meals, the number of logged days, and the average carbs, protein, fat and
   calories per logged day.

Only analysed meals contribute numbers. Meals without an analysis still appear
in the recent list with their description and an "analysis unavailable" note.
The context is empty when diet advice is disabled or nothing has been logged.

## Data availability rule

Meals are nutrition context, never training sessions and never training load.
The shared `DIET_RULES` fragment states this in every prompt that can see the
food log.

## Notes

- The opt-in is the `users.diet_advice` setting, saved from Settings. It is the
  only reliable signal; free-text survey answers are not parsed for intent.
- Photos are compressed in the browser before upload and fetched with the
  bearer token from a separate endpoint, so the list response never carries
  image bytes and the images are not publicly readable.
- A model without vision support is retried once without the photo, so a text
  description still gets an analysis.
