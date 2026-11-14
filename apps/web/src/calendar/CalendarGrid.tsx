import type { CalendarResponse } from "@killingit/shared";
import {
  buildMonthGrid,
  clampMonth,
  formatMonth,
  monthOf,
  shiftMonth,
} from "../calendarDates";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { CalendarCell } from "./CalendarCell";
import { WeekOverview } from "./WeekOverview";
import type { CalendarSelection } from "./selection";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The month view: its navigation, the weekday headings, and six Monday-start
 * weeks, each with the plan overview box and its seven days.
 */
export function CalendarGrid({
  data,
  shownMonth,
  minMonth,
  maxMonth,
  today,
  loading,
  onMonthChange,
  onSelect,
}: {
  data: CalendarResponse;
  /** The visible month after clamping it to the data's range. */
  shownMonth: string;
  minMonth: string;
  maxMonth: string;
  today: string;
  loading: boolean;
  onMonthChange: (month: string) => void;
  onSelect: (selection: CalendarSelection) => void;
}) {
  const daysByDate = new Map(data.days.map((day) => [day.date, day]));
  const cells = buildMonthGrid(shownMonth);
  const weeksByStart = new Map(
    data.weeks.map((week) => [week.startDate, week]),
  );
  const rows = Array.from({ length: 6 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );

  function moveMonth(delta: number): void {
    onMonthChange(
      clampMonth(shiftMonth(shownMonth, delta), minMonth, maxMonth),
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="disabled:opacity-40"
            onClick={() => moveMonth(-1)}
            disabled={shownMonth <= minMonth}
            aria-label="Previous month"
          >
            <MonthArrow direction="previous" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="disabled:opacity-40"
            onClick={() => moveMonth(1)}
            disabled={shownMonth >= maxMonth}
            aria-label="Next month"
          >
            <MonthArrow direction="next" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="inline-flex h-9 items-center justify-center py-0 leading-none"
            onClick={() =>
              onMonthChange(clampMonth(monthOf(today), minMonth, maxMonth))
            }
          >
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span
              className="text-base text-muted-foreground"
              aria-live="polite"
            >
              Updating…
            </span>
          )}
          <label className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">Month</span>
            <Input
              type="month"
              size="sm"
              value={shownMonth}
              min={minMonth}
              max={maxMonth}
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{4}-\d{2}$/.test(value)) {
                  onMonthChange(clampMonth(value, minMonth, maxMonth));
                }
              }}
              aria-label="Choose a month"
            />
          </label>
        </div>
      </div>

      <h3 className="text-xl font-semibold" data-testid="calendar-month">
        {formatMonth(shownMonth)}
      </h3>

      <div className="overflow-x-auto">
        {/* The today ring is painted outside its cell, so the grid keeps
            padding; the scroll container would otherwise clip it, hiding the
            ring's right side on Sunday. */}
        <div className="min-w-[66rem] p-1" data-testid="calendar-grid">
          <div className="grid grid-cols-[minmax(14rem,18rem)_repeat(7,minmax(0,1fr))] gap-1 pb-1 text-center text-sm font-medium text-muted-foreground">
            <span />
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(14rem,18rem)_repeat(7,minmax(0,1fr))] gap-1">
            {rows.map((row) => {
              const weekStart = row[0]?.date ?? "";
              const weekDays = row.map((cell) => daysByDate.get(cell.date));
              return (
                <div key={weekStart} className="contents">
                  <WeekOverview
                    weekStart={weekStart}
                    week={weeksByStart.get(weekStart)}
                    days={weekDays}
                    today={today}
                  />
                  {row.map((cell, index) => (
                    <CalendarCell
                      key={cell.date}
                      date={cell.date}
                      inMonth={cell.inMonth}
                      isToday={cell.date === today}
                      today={today}
                      day={weekDays[index]}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/** A crisp chevron for the month navigation, centred in its button. */
function MonthArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={direction === "previous" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
      />
    </svg>
  );
}
