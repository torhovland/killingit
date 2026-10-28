import { DatePicker } from "./DatePicker";
import { useTimeZone } from "./TimeZoneContext";
import { getToday, isDateOverrideAllowed, setTodayOverride } from "./useToday";

/**
 * Date picker for development and test environments. Selecting a date stores it
 * as an override and reloads the app, so the visit behaves exactly like a fresh
 * visit on that day. It renders nothing in production.
 */
export function DevDatePicker() {
  const timeZone = useTimeZone();
  const { today, isOverridden } = getToday(timeZone);

  if (!isDateOverrideAllowed()) {
    return null;
  }

  const handleChange = (value: string): void => {
    if (!value) {
      return;
    }
    setTodayOverride(value);
    window.location.reload();
  };

  const clearOverride = (): void => {
    setTodayOverride(null);
    window.location.reload();
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
      data-testid="dev-date-picker"
    >
      <h3 className="text-xl font-semibold">Development</h3>
      <p className="text-muted-foreground">
        Simulate a visit on another date. This panel only appears in development
        and test environments.
      </p>
      <div className="flex flex-col gap-1">
        <span className="font-medium">Override today</span>
        <DatePicker
          value={today}
          onChange={handleChange}
          ariaLabel="Override today"
        />
      </div>
      {isOverridden && (
        <button
          type="button"
          className="rounded border bg-muted px-2 py-1 text-xs enabled:hover:bg-card"
          onClick={clearOverride}
        >
          Clear override
        </button>
      )}
      <p className="text-xs text-muted-foreground">
        {isOverridden
          ? "Simulating a visit on the selected date."
          : "Using the real date."}
      </p>
    </section>
  );
}
