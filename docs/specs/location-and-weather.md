# Spec: Athlete location and weather-aware planning

- **Status:** Accepted (implemented)
- **Date:** 2026-10-25
- **Related:** `docs/specs/coach-plan-lifecycle.md`,
  `docs/specs/coach-plan-prompts.md`, ADR 0008 (Open-Meteo).

## Goal

Let the athlete set a home location and use its weather forecast when the coach
plans a week or a day. Show the forecast next to outdoor workouts so the athlete
can see why the coach placed a session on a particular day.

## Scope

### In scope

1. One optional location per account: latitude, longitude, and a human-readable
   name. Stored on `users`.
2. A settings-page location picker with:
   - an OpenStreetMap map that sets the location when clicked;
   - address search (Open-Meteo geocoding) that recenters the map and selects a
     result;
   - save and clear actions that persist the location through `PATCH /api/me`.
3. When a location is set, the API fetches the daily forecast from Open-Meteo
   whenever a week or day plan is generated or revised.
4. The weekly and daily prompts receive the forecast and instructions to:
   - respect explicit weather preferences in the athlete's survey answers, such
     as "no outdoor riding in rain" or "not below 10 °C";
   - otherwise use common sense, moving longer or more demanding outdoor
     sessions to the best-weather days.
5. The generated plan stores the forecast for each session date. Outdoor
   workouts in the Day and Week plan views show a weather icon (sun, partly
   cloudy, very cloudy, rain, or snow), temperature in °C, and wind and gusts in
   m/s.
6. Sessions are marked indoor or outdoor by the coach so weather is shown only
   for outdoor activities. Missing `outdoor` (older stored plans) is treated as
   outdoor.

### Out of scope

- Historical weather for completed activities from Garmin/Strava.
- Hourly forecasts or choosing a time of day based on the forecast.
- Automatic location detection from GPS or the browser.
- Multiple saved locations.
- Daylight/sunrise/sunset input (still deferred).

## Behaviour

- An unset location changes nothing: plans generate as before and no weather is
  shown.
- A forecast is best-effort. If Open-Meteo is unavailable, plan generation
  continues without weather rather than failing.
- Address search results are suggestions only; nothing is saved until the
  athlete presses Save.
- A map click clears any searched name and sets the marker to the clicked
  coordinates.
- The location uses decimal degrees (WGS 84), matching activity GPS points.
- Weather is attached by the server after the model response, so icons and
  numbers come from the forecast rather than model invention.

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

- `outdoor?: boolean` — false for indoor sessions; missing means outdoor.
- `weather?: DailyWeather | null` — the forecast for that date.

`DailyWeather` contains `date`, `icon`, `temperatureMaxC`, `temperatureMinC`,
`windMaxMs`, `gustMaxMs`, and `precipitationMm`. Icons are one of `sun`,
`partly_cloudy`, `very_cloudy`, `rain`, `snow`.

## Generation flow

1. The plan trigger loads the account, including its location.
2. If a location exists, it loads up to 16 days of daily forecast from
   Open-Meteo. Weather failures are logged and ignored.
3. The weekly and daily prompts include the forecast and the weather planning
   rules. The season and block prompts do not need a daily forecast.
4. After the model response, the server attaches the matching forecast day to
   each week session, today, and tomorrow before saving the plan.
5. The UI renders the weather on outdoor workouts. Rest days and indoor
   sessions do not show it.

## Academic / weather code mapping

Open-Meteo returns WMO weather codes. The API maps them to the five display
icons:

| Codes         | Icon          |
| ------------- | ------------- |
| 0–1           | sun           |
| 2             | partly_cloudy |
| 3, 45, 48     | very_cloudy   |
| 51–67, 80–82  | rain          |
| 71–77, 85, 86 | snow          |
| 95–99         | rain          |

## Testing

- Shared schema tests for location validation, weather icons, and plan fields.
- API unit tests for WMO mapping, Open-Meteo response parsing, geocoding,
  forecast attachment, prompt rendering, and weather rules.
- API route tests for location save/clear, geocode auth/validation/errors, and a
  plan generation that receives an injected forecast.
- Web tests for map projection/click conversion, the weather summary, and the
  Day/Week plan rendering (outdoor only, indoor/rest hidden).
- All four quality gates pass: typecheck, lint, format, test.
