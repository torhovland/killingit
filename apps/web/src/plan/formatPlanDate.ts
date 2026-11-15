import { formatWeekdayDayMonth } from "../dateFormat";

/**
 * Formats a stored `YYYY-MM-DD` plan date as a short weekday and day, such as
 * `Mon, Oct 21`. Parsing and display happen in UTC so a date never shifts by a
 * day for an athlete west of Greenwich.
 */
export function formatPlanDate(date: string): string {
  return formatWeekdayDayMonth(date);
}
