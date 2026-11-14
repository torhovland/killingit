import { useState } from "react";
import type { CalendarResponse } from "@killingit/shared";
import { clampMonth, monthOf } from "./calendarDates";
import { CalendarEntryDialog } from "./CalendarEntryDialog";
import { CalendarGrid } from "./CalendarGrid";
import type { CalendarSelection } from "./selection";
import { formatPlanDate } from "../plan/formatPlanDate";

/**
 * The calendar page content: one month of recorded activities, planned
 * workouts and rest days, block starts, and the season end. Presentational so
 * it can be rendered without auth or network. It owns the month bounds and the
 * selected entry; the grid, its days and the detail dialog live in `calendar/`.
 */
export function CalendarView({
  data,
  month,
  onMonthChange,
  today,
  loading = false,
  error = null,
}: {
  /** Null while the first load is in flight. */
  data: CalendarResponse | null;
  /** The visible month in `YYYY-MM` form. */
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  loading?: boolean;
  error?: string | null;
}) {
  const [selection, setSelection] = useState<CalendarSelection | null>(null);

  if (data === null) {
    return (
      <section className="flex w-full flex-col gap-4 text-left">
        <CalendarHeading />
        {error ? (
          <p className="text-destructive">Error: {error}</p>
        ) : (
          <p className="text-base text-muted-foreground">Loading…</p>
        )}
      </section>
    );
  }

  const minMonth = monthOf(data.earliestDate);
  const maxMonth = monthOf(data.latestDate);
  const shownMonth = clampMonth(month, minMonth, maxMonth);

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <CalendarHeading goal={data.season?.goal ?? null} />

      {error && <p className="text-destructive">Error: {error}</p>}

      <CalendarGrid
        data={data}
        shownMonth={shownMonth}
        minMonth={minMonth}
        maxMonth={maxMonth}
        today={today}
        loading={loading}
        onMonthChange={onMonthChange}
        onSelect={setSelection}
      />

      <p className="text-sm text-muted-foreground">
        Showing {formatPlanDate(data.earliestDate)} –{" "}
        {formatPlanDate(data.latestDate)}. Future workouts appear as the coach
        plans each week.
      </p>

      <CalendarEntryDialog
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </section>
  );
}

function CalendarHeading({ goal }: { goal?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-semibold">Calendar</h2>
      {goal && (
        <p className="text-base" data-testid="calendar-season">
          <span className="font-medium">Goal: </span>
          <span className="text-muted-foreground">{goal}</span>
        </p>
      )}
    </div>
  );
}
