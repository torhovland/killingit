/** The display time zone picker; choosing a zone saves it immediately. */
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
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h3 className="text-2xl font-semibold">Time zone</h3>
      <p className="text-base text-muted-foreground">
        Activity times and generated timestamps use this zone. Leave it on your
        device's zone to follow your current location.
      </p>
      <label className="flex max-w-md flex-col gap-1 text-base">
        <span className="font-medium">Display time zone</span>
        <select
          className="rounded border bg-card px-2 py-1"
          value={selected}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Device time zone</option>
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-destructive">{error}</p>}
      {saving && (
        <p className="text-base text-muted-foreground">Saving time zone…</p>
      )}
    </section>
  );
}
