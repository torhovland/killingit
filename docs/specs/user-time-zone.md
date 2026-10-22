# Spec: Athlete time zone

- **Status:** Accepted (implemented)
- **Date:** 2026-10-22
- **Related:** `docs/specs/dashboard-layout.md`, ADR 0006.

## Goal

Let each athlete choose the time zone used to display activity times, plan
generation times, and to describe their local day to the coach. An unset value
follows the device's zone, so a travelling athlete does not have to change a
setting to see the right local time.

## Scope

### In scope

1. A nullable `users.timezone` column holding an IANA zone name.
2. `GET /api/me` includes `timezone`; `PATCH /api/me` saves or clears it.
3. A time-zone selector in the athlete settings page, listing the runtime's
   supported IANA zones plus a "Device time zone" option.
4. Activity timestamps and the plan's "Generated at" timestamp are formatted in
   the selected zone, without appending a zone identifier such as `CEST`.
5. The effective "today" date and the after-18:00 check use the selected zone.
6. Coaching requests send the selected zone instead of always reading the
   browser zone.

### Out of scope

- Changing stored plan dates or activity dates: those are calendar dates and
  stay in their original `YYYY-MM-DD` form.
- Automatic time-zone detection beyond the device default.
- Per-user zones in multi-athlete/admin views.

## Behaviour

- `timezone` is `string | null`; null means the device zone.
- The API rejects values that `Intl.DateTimeFormat` cannot resolve with `400`.
- The web app falls back to the device zone if a stored value is unknown.
- The setting applies immediately after saving; the app keeps the returned
  `CurrentUser` in state.

## Data model / API

- `users.timezone text` (nullable). Migration adds the column without a
  backfill, so existing accounts follow the device zone.
- `currentUserSchema` gains `timezone: string | null` (default null).
- `userSettingsUpdateSchema` is `{ timezone: string | null }`.
- `PATCH /api/me` requires auth, validates the zone, and returns `CurrentUser`.

## Testing

- Shared unit tests cover zone validation and clearing the setting.
- API tests cover saving a valid zone and rejecting an unknown one.
- Web unit tests cover resolving a valid/unknown zone and formatting an ISO
  timestamp in the selected zone.
