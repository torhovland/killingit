# ADR 0010: Show Open-Meteo, Yr.no, and an averaged forecast

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** torhovland
- **Related:** `docs/specs/location-and-weather.md`, ADR 0008

## Context

Open-Meteo has been the only forecast provider. It is easy to use and supplies
the daylight times the coach needs, but a single provider can be wrong. The
athlete should be able to compare a second forecast and see an averaged value,
while the coach continues to plan from one consistent input.

Yr.no is MET Norway's public weather service. Its Locationforecast API needs no
key but requires a descriptive `User-Agent`, returns about ten days of hourly
and six-hourly data in UTC, and does not publish sunrise or sunset.

## Decision

- **Providers:** load Open-Meteo and Yr.no for the same location and time zone.
  Open-Meteo's existing daily request stays the source of sunrise and sunset.
  Yr uses the Locationforecast 2.0 `complete` endpoint with a descriptive
  `User-Agent` (the compact response omits wind gusts).
- **Aggregation:** for each day both providers cover, average temperature,
  wind, gusts, and precipitation. Use Open-Meteo's sunrise and sunset. When the
  icons disagree, use the more severe one (sun < partly cloudy < very cloudy <
  rain < snow); the alternative would be to show a type neither provider
  actually forecast. When only one provider covers a date, copy that provider's
  values unchanged.
- **Storage:** every session keeps the combined forecast in its existing
  `weather` field and all three rows in a new optional `forecasts` object. Old
  stored plans keep working and render the single combined line. The UI shows
  the forecast for indoor workouts as well as outdoor ones; only rest days hide
  it.
- **Analysis:** the plan prompts and weather-change checks receive only the
  combined forecast. The three rows exist for comparison in the Day and Week
  tabs, not to give the model conflicting inputs.
- **Resilience:** the providers are loaded independently. If one fails the
  other is still used and the combined row falls back to it; a total failure
  continues to generate the plan without weather. The two requests happen in
  parallel.
- **Presentation:** each provider row names its source and uses one line such
  as `Very cloudy · 8–11 °C · wind 10 m/s (18 m/s) · daylight 07:35 - 16:28`.

## Consequences

- Two forecast requests are sent per plan generation instead of one. Both are
  free and keyless, and the requests run concurrently.
- MET Norway's terms require the identifying `User-Agent`; it is a constant in
  `apps/api/src/weather/yr.ts`.
- Forecasts from Yr are bucketed into the athlete's local calendar day. The
  caller passes the account's time zone (falling back to UTC), so the provider
  dates line up with Open-Meteo's.
- Yr covers fewer days than Open-Meteo. The last days of the plan have only the
  Open-Meteo row and a combined row equal to it.
- A disagreement between providers is visible to the athlete, and the average
  gives the coach a less extreme input than trusting either provider alone.

## Rejected alternatives

- **Replace Open-Meteo with Yr:** loses the longer range and daylight times,
  and removes the comparison the athlete asked for.
- **Average icons:** there is no meaningful average of `sun` and `rain`.
- **Give all three forecasts to the model:** conflicting inputs make the
  planning prompt unstable and harder to test; the combined forecast is the
  single planning input.
