# ADR 0008: Weather and geocoding via Open-Meteo

- **Status:** Accepted; amended by ADR 0010 (Yr.no and an averaged forecast) and
  ADR 0017 (street address search via Nominatim)
- **Date:** 2026-10-25
- **Deciders:** torhovland
- **Related:** `docs/specs/location-and-weather.md`, ADR 0010, ADR 0017

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
  one provider and one usage policy. Superseded by ADR 0017: Open-Meteo's
  geocoder only covers place names, so address search now uses OpenStreetMap's
  Nominatim.
- **Map:** OpenStreetMap raster tiles rendered directly in an SVG, reusing the
  dependency-free projection already used by `ActivityMap`. No map library or
  tile key is added.
- **Integration seam:** `apps/api/src/weather/openMeteo.ts` exposes
  `fetchWeatherForecast` and `searchLocations`. The plan trigger accepts an
  injectable forecast loader, and the geocode route accepts an injectable
  search function, so tests never touch the network.

## Consequences

- No new runtime dependency, no API key, and no billing setup.
- Open-Meteo's public usage policy applies to forecasts: the app sends one
  forecast request per plan generation, not per session. Address search follows
  Nominatim's separate policy (ADR 0017).
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
  Open-Meteo keeps one provider. Reconsidered in ADR 0017 once street-level
  address search became a requirement.
- **Historical weather:** not needed yet; completed activities are described
  from their recorded data, not re-forecast.
