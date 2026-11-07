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
Settings. It is the single switch for every diet feature: the dashboard food
form, the Diet page, meal logging, and the food log in prompts. A survey
question may still capture diet goals and a current measurement, which reaches
the coach as ordinary profile context, but it never enables the diet features.
An explicit switch is predictable, reversible, and visible to the athlete.

### Send the full photo, derive the thumbnail on the API

The browser sends one `photoDataUrl`: the full-size analysis image, re-encoded
at up to 4096 px on its long edge so normal phone photos keep their detail and
EXIF metadata is stripped. The API sends that image to the vision model and uses
Jimp to derive a 320 px JPEG thumbnail from the same bytes. Only the thumbnail
is stored, in the existing `food_entries.photo_data_url` column. A
separate authenticated endpoint (`GET /api/diet/entries/:id/photo`) decodes the
thumbnail and serves the bytes. The list response only says whether a photo
exists, and the web app fetches the thumbnail with its bearer token into an
object URL.

This gives the model the detail it needs without keeping large photos in the
database, and it makes the API the source of truth for the stored image: the
thumbnail is always derived from the photo the coach saw, and the API enforces
the thumbnail size itself. Jimp is pure JavaScript, so the API keeps its
single-file Bun bundle and needs no native image binary. It keeps image bytes
out of list responses and keeps the thumbnail as private as the rest of the
account data.

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
