# Spec: Skip Garmin's per-activity detail calls for stored activities

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Issue:** #340
- **Related:** ADR 0003, ADR 0057, ADR 0058,
  `docs/specs/garmin-activity-integration.md`,
  `docs/specs/garmin-sidecar-contract.md`, `docs/specs/activity-store.md`.

## Goal

A Garmin sync fetched the 42-day activity list and then called Garmin up to three
more times per activity (details, splits, exercise sets) for the whole window on
every visit, even though the API already stores those activities. That invited
`429`s and re-downloaded large sample payloads for nothing.

The sync must still return the **complete** activity list for the window,
because the API deletes the rows Garmin no longer reports and refreshes the
summary of every activity in it. Only the bulk per-activity payloads are worth
skipping for an activity the API already stores.

## Scope

### In scope

1. The API sends the ids of the activities it already stores in the `/sync`
   request body (`knownActivityIds`, a list of strings).
2. The sidecar returns the same list of activities for the window, but for a
   known id it does not call `get_activity_details`, `get_activity_splits` or
   `get_activity_exercise_sets`. The activity keeps its fresh summary (Garmin
   still reports a renamed or re-typed activity) with no samples, laps or sets.
3. The API keeps the stored sample preview, route, laps and strength sets for an
   activity whose sync returned none of them, both in the feed it answers and in
   the row it stores.
4. The `/sync` request body is pinned by a committed contract fixture, next to
   the existing response fixtures.
5. Every caller of the sidecar's activity sync passes the ids it already stores.

### Out of scope

- A `since` timestamp. A stored activity can still change on Garmin (the
  athlete renames it or fixes its type), and its summary must still refresh, so
  a time filter would either miss the change or re-download the details anyway.
- Skipping the one `get_activities_by_date` list call; it is the source of truth
  for which activities exist in the window and is what lets the API delete
  locally removed rows.
- Fetching the details of only the activities the analysis phase will re-analyse.
  That needs a second round trip and a second decision point; a re-analysis
  reads the stored preview instead (see below).
- Storing the full-resolution timeseries. Only the bounded preview is kept, as
  before.

## Behaviour

### Request and response

`POST /sync` accepts:

```json
{
  "username": "athlete@example.com",
  "password": "secret",
  "knownActivityIds": ["1", "3"]
}
```

`knownActivityIds` is optional. A missing field and an empty list both mean
"nothing is known", so an older API and an empty account behave exactly as
before: every activity in the window is fetched in full. The committed
`services/garmin/contract/sync-request.json` pins the field name for both
languages.

The response is unchanged in shape. Every activity in the window is present with
its summary; an activity whose id was in `knownActivityIds` carries
`samples: []` and no `laps`/`strengthSets`.

### Storing the sync

The API reads the stored feed before it calls Garmin, because it needs the known
ids. That read already existed in the feed's merge step; it now happens before
the sync instead of after it. A failed read still aborts the sync before Garmin
is contacted.

`summarizeActivity(activity, stored)` is the one rule that decides what a sync
does to the preview columns:

- A payload with samples is summarized normally (a new activity, or an activity
  whose details Garmin did return).
- A payload without samples keeps the stored sample count, preview, route, and
  the average/normalized power derived from the original samples.
- A payload without laps keeps the stored laps, and one without strength sets
  keeps the stored sets.

Both the row upsert (`saveStoredActivities`) and the feed entry merged from
stored history use that rule, so an empty payload can no longer blank a stored
activity.

The feed's `latest` list, which feeds the activity analysis, uses the stored
entry for a known activity. A cached analysis is therefore returned with its
stored preview, and a re-analysis (an athlete comment newer than the analysis)
reads the bounded preview rather than a full timeseries, which the app has never
stored anyway. The analysis prompt already downsamples to 90 points. An
activity's fresh summary is still taken from Garmin, so a rename or a corrected
type is reflected.

`GET /api/garmin/activities` also reads the stored feed and fills the stored
preview into the activities it returns, so its response keeps the samples the
feed shows while its sync costs one list call plus the new activities' details.

### Failure behaviour

None of the existing failure rules change: a rate limit from any call still
fails the sync with `429`, a failed detail/splits/sets fetch for a **new**
activity still yields no samples/laps/sets for that activity, and a failed
stored-history read still aborts the sync rather than blanking the history.

## Data model and API impact

- No database migration and no schema change. The preview, route, laps and
  strength sets already live on `activities`.
- `apps/api/src/garmin/client.ts`: `SyncTransport` and `syncGarminActivities`
  take the known ids; the `/sync` body is built by
  `garminSyncRequestBody`.
- `apps/api/src/coaching/activityStore.ts`: `summarizeActivity` accepts the
  stored preview, and `saveStoredActivities` accepts the stored previews so the
  row upsert applies the same rule as the feed.
- `apps/api/src/coaching/feed/sync.ts`: the stored feed is loaded before the
  sync and its ids are passed; `extendStoredFeed` accepts the already-loaded
  history instead of reading it twice.
- `apps/api/src/routes/garmin.ts`: `GET /activities` passes the stored ids and
  merges the stored preview into the response.
- `services/garmin/app.py`: the `/sync` route accepts `SyncRequest`.
- `services/garmin/activities.py`: `sync_activities` accepts the known ids and
  skips the three per-activity calls for them.
- `services/garmin/contract/sync-request.json`: new pinned request fixture.

## Acceptance criteria

1. A sync whose Garmin list contains an already-stored activity does not call
   the details, splits or exercise-set endpoints for it, and still returns it in
   the window's activity list with its fresh summary.
2. A new activity in the same window is fetched in full.
3. A missing or empty `knownActivityIds` fetches every activity in full.
4. A re-sync that returns a stored activity without samples, laps or sets keeps
   the stored sample preview, route, laps and sets, and the average/normalized
   power derived from them, both in the feed response and in `activities`.
5. `GET /api/garmin/activities` reflects the same rule.
6. A rename of the request field on either side fails
   `services/garmin/test_contract.py` or
   `apps/api/src/garmin/contract.test.ts`.
7. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
   `bun run check:unused`, `bun run check:garmin` and
   `bun run test:integration` pass.

## Testing

- Python: `test_activities.py` proves the skip for a known run (details and
  splits) and a known strength activity (sets), and that an unknown activity is
  still fetched in full. `test_contract.py` validates the request fixture
  through `SyncRequest` and asserts the known ids' payloads carry no bulk data.
- Bun: `client.test.ts` asserts the request body carries the known ids;
  `feed/sync.test.ts` proves the stored preview, laps and sets survive a sync
  that returns the activity without them; `routes/garmin.test.ts` proves the
  route passes the ids and merges the preview back.
- Database integration: a re-sync with no details keeps the stored preview
  columns on the row.
