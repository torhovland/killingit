import type { ChangeEvent } from "react";
import { getToday, setTodayOverride } from "./useToday";

/**
 * Development-only date picker. Selecting a date stores it as an override and
 * reloads the app, so the visit behaves exactly like a fresh visit on that day.
 * It renders nothing outside development.
 */
export function DevDatePicker() {
  const { today, isOverridden } = getToday();

  if (!import.meta.env.DEV) {
    return null;
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
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
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-lg"
      data-testid="dev-date-picker"
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">Dev: Override today</span>
        <input
          type="date"
          className="rounded border bg-background px-2 py-1"
          value={today}
          onChange={handleChange}
        />
      </label>
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
    </div>
  );
}
