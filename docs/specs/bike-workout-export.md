# Spec: Indoor bike workout export (ZWO)

- **Status:** Accepted (implemented)
- **Date:** 2026-10-27
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`,
  `docs/specs/location-and-weather.md`.

## Goal

Let an athlete take an indoor bike workout that the coach prescribed with power
targets and load it into a trainer app without retyping the session. The workout
details in the Today and Tomorrow views offer a file download.

## Scope

### In scope

1. A structured `bikeWorkout` on day plans and week sessions:
   - `ftpWatts`: the FTP the coach used for the targets;
   - `intervals`: ordered blocks with `durationSeconds` and `powerPercent`.
2. The coach prompt asks for `bikeWorkout` only on indoor bike workouts with
   power targets, sets `outdoor` to false for those sessions, and sets
   `bikeWorkout` to null everywhere else.
3. The existing week context given to a regeneration prompt includes the
   structured targets, so a revised week keeps or updates them.
4. ZWO generation from a structured workout, with four-decimal power values, an
   ASCII-only filename, and XML escaping.
5. `GET /api/coaching/plan/workouts/:date` returns the ZWO file as an
   attachment.
6. A "Download workout file (.zwo)" button on the Today and Tomorrow cards when
   the session is an indoor bike workout with power targets.
7. The estimated FTP is shown on bike workouts in the Today and Tomorrow cards,
   so the athlete can set the same FTP in the trainer app that the relative
   zones were built from.

### Out of scope (deferred)

- FIT workout or FIT Course export. ZWO is the trainer-native format and avoids
  a binary encoder dependency.
- Uploading straight to Zwift, Garmin, or another service.
- Parsing power targets from the coach's free-text description.
- Showing the download in the Week view. The day plan is the place where the
  user acts on a workout.
- A user-configurable FTP. The coach records the FTP it used for each workout.

## Data model

`bikeWorkout` is optional on both `dayPlanSchema` and `weekSessionSchema`, so
plans stored before this feature remain valid.

```ts
{
  ftpWatts: 220,
  intervals: [
    { durationSeconds: 600, powerPercent: 55 },
    { durationSeconds: 480, powerPercent: 90 },
    { durationSeconds: 300, powerPercent: 45 },
  ],
}
```

`powerPercent` is a percentage of FTP: 90 means 90%. The helper
`hasExportableBikeWorkout` is the single rule used by the API and the UI:

- `type` is `"workout"`;
- `outdoor` is `false`;
- `bikeWorkout` is present.

## API

`GET /api/coaching/plan/workouts/YYYY-MM-DD`

- Requires the same bearer auth as the rest of the coaching routes.
- Today and tomorrow are read from the day plans so the file matches the Day
  tab. Other dates fall back to the stored week, including next week after
  18:00.
- `200` with `Content-Type: application/xml; charset=utf-8` and
  `Content-Disposition: attachment; filename="<date>-<slug>.zwo"`.
- `400` for an invalid date.
- `404` when there is no plan or no exportable workout for the date.

## ZWO mapping

Each interval becomes a `<SteadyState Duration="..." Power="..."/>` step. ZWO
stores power as a fraction of FTP, so 90% is written as `0.9000`. Four decimal
places are kept so fractional percentages are not rounded into a coarser zone.
The file includes the session title, description, and
`<sportType>bike</sportType>`.

ZWO has no standard metadata field that carries the athlete's FTP. It also has
a reverse-engineered `<ftpOverride>` element that pins the rider's FTP for a
fixed-power workout, but support varies between trainer apps, so this generator
does not write it. The estimated FTP is surfaced in the app and appended to the
ZWO description as a human-readable note, and the athlete sets it in the trainer
app to get the intended absolute watts.

## UI

`CoachPlanView` accepts an optional `onDownloadWorkout(date)` callback and the
date currently being prepared. `CoachPlanSection` owns the authenticated fetch,
the browser save, and the error message. The button appears only when
`hasExportableBikeWorkout` is true for a Today or Tomorrow card. A bike session
with `bikeWorkout` also shows "Estimated FTP: N W" and tells the athlete to set
that value in the trainer app; this line is shown whether the session is indoor
or outdoor.

## Acceptance criteria

1. A plan generated after this change can contain an indoor bike session with
   `bikeWorkout`, and the prompt tells the coach when to supply it.
2. Opening that session in the Today or Tomorrow view shows a download button;
   outdoor sessions, runs, rest days, and sessions without power targets do not.
   The same cards show the estimated FTP whenever `bikeWorkout` is present.
3. Downloading returns a valid ZWO file whose steps match the structured
   intervals, whose power fractions use four decimals, whose title is
   XML-escaped, and whose description states the estimated FTP.
4. The download works after the access token has expired (one silent refresh and
   retry, like the JSON routes).
5. Existing stored plans without `bikeWorkout` continue to load and render.
