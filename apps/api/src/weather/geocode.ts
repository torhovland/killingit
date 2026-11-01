import type { GeocodedLocation } from "@killingit/shared";
import type { FetchLike } from "./openMeteo.js";

const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 8_000;
const GEOCODE_RESULTS = 5;
const USER_AGENT = "killingit/0.1 (https://github.com/torhovland/killingit)";

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function firstTextField(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textField(value);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

function coordinate(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function geocodedLocation(value: unknown): GeocodedLocation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const latitude = coordinate(entry.lat);
  const longitude = coordinate(entry.lon);
  if (
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const address =
    typeof entry.address === "object" && entry.address !== null
      ? (entry.address as Record<string, unknown>)
      : {};
  const road = firstTextField(
    address.road,
    address.pedestrian,
    address.footway,
    address.cycleway,
    address.path,
  );
  const houseNumber = textField(address.house_number);
  const street =
    road === null
      ? null
      : houseNumber === null
        ? road
        : `${road} ${houseNumber}`;
  const name = firstTextField(
    entry.name,
    street,
    address.neighbourhood,
    address.suburb,
    address.village,
    address.town,
    address.city,
    address.municipality,
  );
  if (name === null) {
    return null;
  }

  return {
    name,
    latitude,
    longitude,
    country: textField(address.country),
    admin1: firstTextField(address.state, address.county, address.region),
    city: firstTextField(
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.suburb,
    ),
  };
}

/** Parses Nominatim's search response, ignoring malformed suggestions. */
export function parseGeocodeResponse(body: unknown): GeocodedLocation[] {
  if (!Array.isArray(body)) {
    return [];
  }
  return body
    .map(geocodedLocation)
    .filter((entry): entry is GeocodedLocation => entry !== null);
}

/** Looks up street addresses and places with OpenStreetMap's Nominatim. */
export async function searchLocations(
  query: string,
  fetcher: FetchLike = fetch,
): Promise<GeocodedLocation[]> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(GEOCODE_RESULTS));
  url.searchParams.set("accept-language", "en");

  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Geocoding service returned ${response.status}`);
  }
  return parseGeocodeResponse(await response.json());
}
