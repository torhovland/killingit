import { useEffect, useState } from "react";
import {
  currentUserSchema,
  geocodeResponseSchema,
  type AthleteLocation,
  type GeocodedLocation,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { Bullet } from "./Bullet";
import { requestParsed } from "./fetchAuthed";
import { LocationPickerMap } from "./LocationPickerMap";
import { reportError } from "./reportError";
import { Button } from "./components/Button";
import { Input } from "./components/Input";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function placeLabel(place: GeocodedLocation): string {
  return [...new Set([place.name, place.city, place.admin1, place.country])]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(", ");
}

function sameLocation(
  left: AthleteLocation | null,
  right: AthleteLocation | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.latitude === right.latitude &&
    left.longitude === right.longitude &&
    left.name === right.name
  );
}

/**
 * Location settings: search for an address or click the map, then save the
 * point used for the coach's weather and daylight forecast.
 */
export function LocationSection({
  location,
  onChanged,
}: {
  location: AthleteLocation | null;
  onChanged: (location: AthleteLocation | null) => void;
}) {
  const auth = useAuth();
  const [draft, setDraft] = useState<AthleteLocation | null>(location);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodedLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(location);
  }, [location]);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === "") {
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const response = await requestParsed(
        `${API_URL}/api/weather/geocode?q=${encodeURIComponent(trimmed)}`,
        auth,
        geocodeResponseSchema,
        "Searching for the address",
      );
      setResults(response.results);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSearching(false);
    }
  }

  function chooseResult(place: GeocodedLocation): void {
    setDraft({
      latitude: place.latitude,
      longitude: place.longitude,
      name: placeLabel(place),
    });
    setResults([]);
  }

  async function persist(next: AthleteLocation | null): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await requestParsed(
        `${API_URL}/api/me`,
        auth,
        currentUserSchema,
        "Saving the location",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location: next }),
        },
      );
      setDraft(response.location);
      onChanged(response.location);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  const label = draft?.name?.trim();

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => void search(event)}
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-base">
          <span className="font-medium">Find an address</span>
          <Input
            type="search"
            size="sm"
            placeholder="City, address, or place"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={searching}
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={searching || query.trim() === ""}
        >
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <ul
          className="flex flex-col gap-1 rounded border bg-inset p-2 text-base"
          data-testid="location-results"
        >
          {results.map((place) => (
            <li key={`${place.latitude},${place.longitude},${place.name}`}>
              <Button
                type="button"
                variant="ghost"
                size="menuSm"
                className="w-full"
                onClick={() => chooseResult(place)}
              >
                {placeLabel(place)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <LocationPickerMap
        value={draft}
        onSelect={(latitude, longitude) => {
          setDraft({ latitude, longitude, name: null });
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-base">
        <p className="text-muted-foreground" data-testid="location-summary">
          {draft === null ? (
            "No location set. Weather and daylight are not used in your plan."
          ) : (
            <>
              {label && (
                <>
                  {label}
                  <Bullet />
                </>
              )}
              {draft.latitude.toFixed(4)}, {draft.longitude.toFixed(4)}
            </>
          )}
        </p>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <p className="text-sm text-muted-foreground">
        The forecast is used the next time your plan is built or refreshed.
        Weather data by{" "}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          Open-Meteo
        </a>{" "}
        and{" "}
        <a
          href="https://www.yr.no/"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          Yr.no
        </a>
        .
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => void persist(draft)}
          disabled={saving || draft === null || sameLocation(draft, location)}
        >
          {saving ? "Saving…" : "Save location"}
        </Button>
        {location !== null && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void persist(null)}
            disabled={saving}
          >
            Clear location
          </Button>
        )}
      </div>
    </div>
  );
}
