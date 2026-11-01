# ADR 0017: Street address search via Nominatim

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** torhovland
- **Related:** ADR 0008, `docs/specs/location-and-weather.md`

## Context

ADR 0008 chose Open-Meteo's geocoding API so weather and address search shared
one provider. That geocoder is built from place data and does not index streets
or house numbers: searching for a street such as "Sigrid Undsets veg" returns no
results, so the athlete cannot find their home address in the location picker.
The map already uses OpenStreetMap tiles.

## Decision

- **Address search:** OpenStreetMap's Nominatim search API. It indexes streets,
  house numbers, and places, so the picker can find a home address.
- **Weather:** unchanged. Open-Meteo and Yr.no still supply the forecast and
  daylight; Nominatim is used only for geocoding.
- **Usage:** the API proxy sends one request per submitted search, with an
  identifying `User-Agent`, and does not autocomplete. Nominatim's public usage
  policy applies.
- **Result shape:** Nominatim results are mapped to the existing
  `GeocodedLocation` contract. A `city` field is added so several streets with
  the same name in one county remain distinguishable. The label is built from
  the road and house number, city, county, and country.
- **Integration seam:** the existing `GET /api/weather/geocode` proxy and its
  injectable search function are kept, so route tests never touch the network.

## Consequences

- Street and house-number searches work, including "Sigrid Undsets veg".
- Address search and the map share OpenStreetMap data; weather remains on
  Open-Meteo and Yr.no.
- Nominatim's public instance is rate-limited and not an SLA. If it fails, search
  returns a readable `502` while saved locations and weather still work.
- A separate provider adds one more usage policy and failure mode to operate.

## Rejected alternatives

- **Keep Open-Meteo geocoding:** no street or house-number coverage; the address
  search cannot find most home addresses.
- **Photon:** also handles addresses, but Nominatim is the canonical OpenStreetMap
  geocoder and matches the map's data and attribution.
- **Self-hosted Nominatim:** the operational cost is not justified at this scale.
- **A commercial geocoder:** adds an API key and billing for a settings-page
  lookup.
