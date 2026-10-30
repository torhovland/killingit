# Spec: Athlete location, weather, and daylight-aware planning

- **Status:** Accepted (implemented)
- **Date:** 2026-10-25
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0008 (Open-Meteo), ADR 0010
  (Yr.no and the averaged forecast).

## Goal

Let the athlete set a home location and use its weather forecast and daylight
times when the coach plans a week or a day. Show the forecast and the sunrise
and sunset next to workouts so the athlete can see why the coach placed a
session on a particular day, whether it is planned for outdoors, and whether it
would be sensible to take it outside.

## Scope

### In scope

1. One optional location per account: latitude, longitude, and a human-readable
   name. Stored on `users`.
2. A settings-page location picker with:
   - an OpenStreetMap map that sets the location when clicked;
   - address search (Open-Meteo geocoding) that recenters the map and selects a
     result;
   - save and clear actions that persist the location through `PATCH /api/me`.
3. When a location is set, the API fetches the daily forecast, including
   sunrise and sunset, from Open-Meteo and Yr.no whenever a week or day plan is
   generated or revised. It also builds an averaged forecast from the two.
4. The weekly and daily prompts receive the combined forecast and its daylight
   times and:
   - respect explicit weather preferences in the athlete's survey answers, such
     as "no outdoor riding in rain" or "not below 10 °C";
   - treat an explicit request for a specific day or activity as outranking the
     forecast and the general weather preference, so an athlete who says they
     will run outdoors on Saturday gets an outdoor run on Saturday even when
     rain is forecast and they otherwise avoid outdoor workouts in the rain;
   - follow the athlete's stated daylight or darkness preference, defaulting to
     a preference for daylight when they have not said anything;
   - move long outdoor sessions to the weekend when the athlete can only train
     before or after work on weekdays and the available daylight falls inside
     working hours;
   - otherwise use common sense, moving longer or more demanding outdoor
     sessions to the best-weather days.
5. The generated plan stores the combined forecast and both provider forecasts
   for each session date. Workouts that can be done outdoors show three labelled
   rows — Open-Meteo, Yr.no, and Combined — with a weather icon (sun, partly
   cloudy, very cloudy, rain, or snow), temperature in °C, wind and gusts in
   m/s, and the local daylight window. Each row reads like
   `Very cloudy · 8–11 °C · wind 10 m/s (18 m/s) · daylight 07:35 - 16:28`.
6. Sessions are marked with two independent flags: `outdoor` says where this
   instance is planned, and `canBeOutdoor` says whether the activity could
   reasonably be done outdoors. The forecast and daylight are shown for every
   workout that is not indoor-only, including flexible sessions that the coach
   planned indoors, so the athlete can see the conditions and judge whether to
   take the session outside. Sessions tied to indoor equipment or a venue
   (trainer, treadmill, gym, pool) and rest days show no forecast. Missing flags
   in older stored plans are treated as outdoor and can-be-outdoor.
7. On each plan read, compare the stored forecast with the latest forecast for
   upcoming days in the current week and, when planned, the next week. A
   significant change, including daylight appearing for the first time, updates
   the week pending so the client starts the usual week revision.

### Out of scope

- Historical weather for completed activities from Garmin/Strava.
- Hourly forecasts or choosing a time of day based on the forecast.
- Automatic location detection from GPS or the browser.
- Multiple saved locations.
- A structured daylight-preference setting; the coach reads the athlete's
  free-text answers and notes.

## Behaviour

- An unset location changes nothing: plans generate as before and no weather is
  shown.
- A forecast is best-effort. Open-Meteo and Yr.no are loaded independently. If
  one is unavailable the other still supplies a forecast and the combined row
  falls back to it; if both fail, plan generation continues without weather
  rather than failing.
- The two providers are asked for the same location and the athlete's time
  zone, so their daily dates line up. Yr.no is bucketed by the athlete's local
  calendar day; the account time zone is used, with UTC as the fallback.
- The combined row averages temperature, wind, gusts, and precipitation from
  both providers. It uses Open-Meteo's daylight times because Yr.no does not
  publish them. When the weather types differ, it takes the more severe icon
  (sun, partly cloudy, very cloudy, rain, snow); ties keep Open-Meteo's type.
  A date covered by only one provider is copied from that provider unchanged.
- The combined forecast is the only forecast given to the coach for planning
  and weather-change checks. The provider rows are for the athlete to compare.
- Address search results are suggestions only; nothing is saved until the
  athlete presses Save.
- A map click clears any searched name and sets the marker to the clicked
  coordinates.
- The location uses decimal degrees (WGS 84), matching activity GPS points.
- Weather and daylight are attached by the server after the model response, so
  icons, numbers, and times come from the forecast rather than model invention.
- Sunrise and sunset are local clock times at the athlete's location. Open-Meteo
  returns null when the sun neither rises nor sets (polar day or polar night),
  and the UI then omits that time. Yr.no rows show no daylight because the
  provider does not supply it.
- The UI shows the forecast on workouts that are not indoor-only: flexible
  sessions keep the forecast even when the coach plans this instance indoors,
  because the athlete may choose to move them outside. Sessions tied to indoor
  equipment or a venue use `canBeOutdoor: false` and show no forecast. Rest days
  show none either.
- The coach respects the athlete's stated weather preferences, but an explicit
  request for a specific day or activity outranks both the forecast and those
  preferences: if the athlete says they will run outdoors on Saturday, the coach
  plans an outdoor run on Saturday even when rain is forecast and the athlete
  otherwise avoids outdoor workouts in rain. The general weather preference
  applies only to days the athlete has not made a specific request about.
- The coach places outdoor sessions in daylight by default. It follows any
  explicit darkness preference in the athlete's answers, weekly notes, or
  activity comments, and does not invent one. If the athlete can only train
  before or after work on weekdays and the available daylight falls inside
  working hours, long outdoor sessions move to the weekend.
- A forecast change is significant when a dry day becomes wet (rain or snow) or
  the reverse, rain becomes snow, the daylight times appear for the first time,
  or the daily maximum temperature, maximum wind, maximum gust, or precipitation
  moves by at least 5 °C, 5 m/s, 8 m/s, or 5 mm. Ordinary day-to-day shifts in
  sunrise and sunset and cloud-only icon changes do not trigger a refresh. Past
  days are ignored, but rest days and indoor sessions are still compared: the
  coach may have chosen them because the weather was bad, and improved weather
  can turn them back into outdoor training.
- Checking the forecast is best effort. If it cannot be loaded, the plan's
  pending state is unchanged.

## Data model / API

### `users`

- `latitude double precision` (nullable)
- `longitude double precision` (nullable)
- `location_name text` (nullable)
- A check constraint keeps latitude and longitude both set or both null.

`StoredUser` and `currentUserSchema` gain
`location: { latitude, longitude, name } | null`.

`PATCH /api/me` body:

```json
{
  "timezone": "Europe/Oslo",
  "location": { "latitude": 59.91, "longitude": 10.75, "name": "Oslo, Norway" }
}
```

Each field is optional, but at least one must be present. `location: null`
clears the location. `timezone` keeps its existing behaviour.

### `GET /api/weather/geocode?q=<address>`

Behind `requireAuth`. Proxies Open-Meteo's geocoding API (no key) and returns:

```json
{
  "results": [
    {
      "name": "Oslo",
      "latitude": 59.91,
      "longitude": 10.75,
      "country": "Norway",
      "admin1": "Oslo"
    }
  ]
}
```

A blank query is a `400`; an upstream failure is a `502` with a readable
message.

### Plan JSON

`weekSessionSchema` and `dayPlanSchema` gain:

- `outdoor?: boolean` — false when this instance is planned indoors; missing
  means outdoor.
- `canBeOutdoor?: boolean` — false for sessions tied to indoor equipment or a
  venue (trainer, treadmill, gym, pool); missing means the session can be done
  outdoors.
- `weather?: DailyWeather | null` — the combined forecast for that date.
- `forecasts?: DailyForecasts | null` — the same date from each source.

`DailyWeather` contains `date`, `icon`, `temperatureMaxC`, `temperatureMinC`,
`windMaxMs`, `gustMaxMs`, `precipitationMm`, and optional `sunrise`/`sunset`
local `HH:MM` times that may be `null` on polar days. Icons are one of `sun`,
`partly_cloudy`, `very_cloudy`, `rain`, `snow`.

`DailyForecasts` has `openMeteo`, `yr`, and `combined` fields, each a
`DailyWeather` or `null`. Older plans without `forecasts` still parse and show
their single `weather` line.

## Generation flow

1. The plan trigger loads the account, including its location and time zone.
2. If a location exists, it loads the daily forecast from Open-Meteo and Yr.no
   in parallel and builds the averaged forecast. Weather failures are logged and
   ignored.
3. The weekly and daily prompts include the combined forecast and the
   weather/daylight planning rules. The season and block prompts do not need a
   daily forecast.
4. After the model response, the server attaches the combined day and both
   provider days to each week session, today, and tomorrow before saving the
   plan.
5. The UI renders all three labelled forecast rows and the daylight on workouts
   that can be done outdoors. Indoor-only sessions and rest days do not show
   them.
6. `GET /api/coaching/plan` loads the forecast for the athlete's location (when
   one is set) unless a generation is already running. A significant difference
   from the weather attached to the stored current or next week sets
   `pending.week`; the next generation revises the week and day with the new
   forecast. The saved plan then carries that forecast, so the same change does
   not trigger another refresh.

## Weather code mapping

Open-Meteo returns WMO weather codes, and Yr.no returns MET Norway symbol
codes. The API maps both to the five display icons:

| Codes         | Icon          |
| ------------- | ------------- |
| 0–1           | sun           |
| 2             | partly_cloudy |
| 3, 45, 48     | very_cloudy   |
| 51–67, 80–82  | rain          |
| 71–77, 85, 86 | snow          |
| 95–99         | rain          |

Yr.no symbol codes map by family: `clearsky*` → sun, `fair*` and
`partlycloudy*` → partly cloudy, `cloudy*` and `fog*` → very cloudy, a code
containing `snow` or `sleet` → snow, and a code containing `rain` → rain.

## Testing

- Shared schema tests for location validation, weather icons, optional daylight
  times, and plan fields.
- API unit tests for WMO and MET Norway symbol mapping, Open-Meteo and Yr.no
  response parsing (including local-day grouping, daylight and incomplete
  values), the averaged forecast, provider failure fallback, geocoding,
  forecast attachment, prompt rendering, and weather/daylight rules.
- API route tests for location save/clear, geocode auth/validation/errors, and a
  plan generation that receives an injected forecast.
- Web tests for map projection/click conversion, the weather and daylight
  summary, and the Day/Week plan rendering (flexible workouts show the forecast;
  indoor-only sessions and rest days do not), plus the Week view's session
  descriptions and indoor/outdoor intent.
- API tests for significant/non-significant forecast comparisons, newly
  available daylight, current and next week coverage, the plan-read pending
  flag, and weather-service failure handling.
- All four quality gates pass: typecheck, lint, format, test.
