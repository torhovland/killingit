import { useEffect, useMemo, useState } from "react";

/** Split an IANA zone such as `Europe/Oslo` into its continent and city. A
 * zone without a slash, such as `UTC`, belongs to a continent of its own. */
export function splitTimeZone(zone: string): { region: string; city: string } {
  const slash = zone.indexOf("/");
  return slash === -1
    ? { region: zone, city: zone }
    : { region: zone.slice(0, slash), city: zone.slice(slash + 1) };
}

/** Reassemble the zone stored by the API from its two picker values. */
function joinTimeZone(region: string, city: string): string {
  return region === city ? region : `${region}/${city}`;
}

/** Group zones by continent, keeping the order they are given in. */
export function groupTimeZones(options: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const zone of options) {
    const { region, city } = splitTimeZone(zone);
    const cities = groups.get(region);
    if (cities === undefined) {
      groups.set(region, [city]);
    } else if (!cities.includes(city)) {
      cities.push(city);
    }
  }
  return groups;
}

/**
 * The display time zone picker. The continent and city are separate dropdowns;
 * choosing a city saves the zone immediately.
 */
export function TimeZoneSection({
  selected,
  options,
  saving,
  error,
  onChange,
}: {
  selected: string;
  options: string[];
  saving: boolean;
  error: string | null;
  onChange: (timeZone: string) => void;
}) {
  const groups = useMemo(() => groupTimeZones(options), [options]);
  const initial = selected === "" ? null : splitTimeZone(selected);
  const [region, setRegion] = useState(initial?.region ?? "");
  const [city, setCity] = useState(initial?.city ?? "");

  useEffect(() => {
    if (selected === "") {
      setRegion("");
      setCity("");
      return;
    }
    const parts = splitTimeZone(selected);
    setRegion(parts.region);
    setCity(parts.city);
  }, [selected]);

  const cities = groups.get(region) ?? [];

  function changeRegion(nextRegion: string): void {
    setRegion(nextRegion);
    if (nextRegion === "") {
      setCity("");
      onChange("");
      return;
    }
    const nextCities = groups.get(nextRegion) ?? [];
    if (nextCities.includes(city)) {
      onChange(joinTimeZone(nextRegion, city));
      return;
    }
    setCity("");
  }

  function changeCity(nextCity: string): void {
    setCity(nextCity);
    onChange(joinTimeZone(region, nextCity));
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h3 className="text-2xl font-semibold">Time zone</h3>
      <p className="text-base text-muted-foreground">
        Activity times and generated timestamps use this zone. Leave it on your
        device's zone to follow your current location.
      </p>
      <div className="flex flex-wrap gap-3 text-base">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="font-medium">Continent</span>
          <select
            className="rounded border bg-card px-2 py-1"
            value={region}
            onChange={(event) => changeRegion(event.target.value)}
          >
            <option value="">Device time zone</option>
            {[...groups.keys()].map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="font-medium">City</span>
          <select
            className="rounded border bg-card px-2 py-1 disabled:opacity-50"
            value={city}
            disabled={region === ""}
            onChange={(event) => changeCity(event.target.value)}
          >
            {region === "" ? (
              <option value="">Choose a continent</option>
            ) : city === "" ? (
              <option value="">Choose a city</option>
            ) : (
              !cities.includes(city) && <option value={city}>{city}</option>
            )}
            {cities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {saving && (
        <p className="text-base text-muted-foreground">Saving time zone…</p>
      )}
    </section>
  );
}
