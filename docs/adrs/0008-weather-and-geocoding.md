# ADR 0008: Weather and geocoding via Open-Meteo

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** torhovland
- **Related:** `docs/specs/location-and-weather.md`

## Context

The coach needs a daily forecast for the athlete's location when it plans a
week or a day. The settings page also needs address search and a clickable map
so the athlete can set that location. AGENTS.md already names Open-Meteo as the
preferred weather source and requires a free/cheap provider behind a small
interface.

## Decision

- **Forecast:** Open-Meteo's forecast API. It is free for non-commercial use,
  needs no API key, supports wind speed in m/s, temperature in °C, and returns
  up to 16 daily forecast days, including sunrise and sunset in local time.
- **Geocoding:** Open-Meteo's geocoding API, so weather and address search share
  one provider and one usage policy.
- **Map:** OpenStreetMap raster tiles rendered directly in an SVG, reusing the
  dependency-free projection already used by `ActivityMap`. No map library or
  tile key is added.
- **Integration seam:** `apps/api/src/weather/openMeteo.ts` exposes
  `fetchWeatherForecast` and `searchLocations`. The plan trigger accepts an
  injectable forecast loader, and the geocode route accepts an injectable
  search function, so tests never touch the network.

## Consequences

- No new runtime dependency, no API key, and no billing setup.
- Open-Meteo's public usage policy applies. The app sends one forecast request
  per plan generation (not per session) and one geocode request per search.
- A forecast failure must never block planning; the plan is generated without
  weather instead.
- Sunrise and sunset come from the same daily forecast and are displayed with
  the weather on outdoor sessions. The coach uses them to prefer daylight and to
  keep weekday sessions inside the athlete's available light.
- If a paid provider is needed later, only the weather module and its loader
  seam change.

## Rejected alternatives

- **OpenWeatherMap / WeatherAPI:** require an API key, and their free tiers
  have tighter call limits without adding anything the app needs.
- **Leaflet / MapLibre:** adds a dependency and CSS for a single picker when the
  existing SVG tile approach already covers click-to-set and panning.
- **Nominatim for geocoding:** a separate usage policy and heavier rate limit;
  Open-Meteo keeps one provider.
- **Historical weather:** not needed yet; completed activities are described
  from their recorded data, not re-forecast.
