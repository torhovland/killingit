/**
 * Formats a stored `YYYY-MM-DD` plan date as a short weekday and day, such as
 * `Mon 21 Oct`. Parsing and display happen in UTC so a date never shifts by a
 * day for an athlete west of Greenwich.
 */
export function formatPlanDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
