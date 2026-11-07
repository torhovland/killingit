# ADR 0019: Diet log with an opt-in and photo analysis

- **Status:** Accepted
- **Date:** 2026-11-07
- **Deciders:** torhovland

## Context

The coach already plans training from the athlete profile, recorded activities,
recovery data, weather and dated goals. Nutrition affects recovery and body
composition, but the app had no way to capture what the athlete ate. We want a
low-friction meal log: a short description, optionally a photo, and a meal time.
The coach should describe the meal, estimate carbs and macros, and say how it
fits the diet, and every coaching prompt should see the recent pattern.

Two design questions need a decision: how the athlete opts in, and where a photo
lives.

## Decision

### Opt in with an account setting

Add `users.diet_advice`, a boolean defaulting to false and controlled from
Settings. The dashboard food form and the food log prompt context are enabled
only while it is true. Free-text survey answers are not parsed for intent: an
explicit switch is predictable, reversible, and visible to the athlete.

### Store photos as a compressed data URL

The browser downscales the image to at most 1,280 px on its long edge and
re-encodes it as a JPEG data URL before upload. The server validates the
`data:image/(jpeg|png|webp);base64,...` form and stores it in
`food_entries.photo_data_url`. A separate authenticated endpoint
(`GET /api/diet/entries/:id/photo`) decodes the data URL and serves the bytes.
The list response only says whether a photo exists, and the web app fetches the
image with its bearer token into an object URL.

This keeps the server free of an image-processing dependency, keeps image bytes
out of list responses, and keeps photos as private as the rest of the account
data. The cost is base64 overhead in Postgres, which is acceptable for a
personal meal log after client-side compression.

## Consequences

- The coach can analyse a photo directly through the provider's vision input
  (`image_url` content parts). Models without vision are retried without the
  photo so a text-only analysis is still possible.
- Logging is append-only; there is no edit or delete path in this change.
- The prompt log records images as `[image attached]` rather than embedding
  megabytes of base64 in the admin view.
- Prompt context is bounded: seven days of meals plus at most 52 weekly
  summaries.
- Disabling diet advice stops both new logging and the food log in prompts;
  existing entries stay stored for when the athlete turns it back on.
