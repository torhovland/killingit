import { useEffect, useRef, useState } from "react";
import {
  buildMonthGrid,
  dayNumber,
  monthOf,
  shiftMonth,
} from "./calendarDates";
import { formatDate, formatMonth } from "./dates";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** The month to open for a value, falling back to the current month. */
function monthFor(value: string): string {
  const month = monthOf(value);
  return /^\d{4}-\d{2}$/.test(month)
    ? month
    : monthOf(new Date().toISOString());
}

/**
 * A date field that shows the chosen date day-first (`d. MMM YYYY`) and opens a
 * month grid to pick another. The native date input cannot be used because it
 * follows the browser's locale and renders MM/DD/YYYY regardless of the page.
 */
export function DatePicker({
  id,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  id?: string;
  /** The date in `YYYY-MM-DD` form. */
  value: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthFor(value));
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent): void {
      if (
        container.current !== null &&
        !container.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        close();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function close(): void {
    setOpen(false);
    trigger.current?.focus();
  }

  function openPicker(): void {
    setMonth(monthFor(value));
    setOpen(true);
  }

  function select(date: string): void {
    onChange(date);
    close();
  }

  return (
    <div className="relative w-fit" ref={container}>
      <button
        id={id}
        ref={trigger}
        type="button"
        className="flex w-fit items-center gap-2 rounded border bg-card px-2 py-1 text-left text-sm enabled:hover:bg-muted disabled:opacity-50"
        onClick={() => (open ? close() : openPicker())}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid="date-picker"
      >
        <span>{value === "" ? "Choose a date" : formatDate(value)}</span>
        <span aria-hidden className="text-xs text-muted-foreground">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border bg-card p-2 shadow-lg"
          data-testid="date-picker-dialog"
        >
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              className="rounded border bg-card px-2 py-0.5 text-sm enabled:hover:bg-muted"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <p className="text-sm font-medium" data-testid="date-picker-month">
              {formatMonth(month)}
            </p>
            <button
              type="button"
              className="rounded border bg-card px-2 py-0.5 text-sm enabled:hover:bg-muted"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 pt-2 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 pt-1">
            {buildMonthGrid(month).map((cell) => {
              const selected = cell.date === value;
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={`rounded py-1 text-xs ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : cell.inMonth
                        ? "enabled:hover:bg-muted"
                        : "text-muted-foreground/50 enabled:hover:bg-muted"
                  }`}
                  onClick={() => select(cell.date)}
                  aria-label={formatDate(cell.date)}
                  aria-pressed={selected}
                >
                  {dayNumber(cell.date)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
