# Web date formatting

- **Status:** Accepted (implemented)
- **Date:** 2026-11-15
- **Related:** issue #322, `docs/specs/calendar-page.md`,
  `docs/specs/shared-date-helpers.md`.

## Goal

Month names and the English date labels shown by the cost charts, chart axes,
calendar, plan and diet pages come from one module. A new label cannot drift
from the others, and no row or cell builds its own `Intl.DateTimeFormat`.

## Scope

`apps/web/src/dateFormat.ts` owns every month name and every date label the web
app renders from a stored `YYYY-MM` or `YYYY-MM-DD` key:

- `Intl.DateTimeFormat` instances for short months (`Jan`), short month and
  two-digit year (`Jan 26`), long month and year (`January 2026`), the
  weekday-first plan and diet labels, and the day-before-month chart label.
  Each formatter is created once at module load.
- The fixed `en-US` locale, because the interface is English and the cost chart
  and chart axis must keep the exact abbreviations and full names they already
  show.
- UTC parsing, so a January key never renders as 31 December on a device west
  of Greenwich. A month key is parsed from its year and month and built at the
  first day of that month in UTC; a full date is parsed as UTC midnight.

The call sites delegate to it instead of keeping a list or a
`toLocaleDateString` call:

- `apps/web/src/costChart.ts` uses the short, short-with-year and long month
  labels, and the day and day-with-year labels.
- `apps/web/src/charts/chartGeometry.ts` uses the chart axis label.
- `apps/web/src/calendar/calendarDates.ts` uses the long month heading.
- `apps/web/src/plan/formatPlanDate.ts` uses the weekday, day and month label.
- `apps/web/src/diet/DietView.tsx` uses the weekday, day, month and year label.

## Behaviour

The rendered output stays byte-for-byte the same as before:

- The cost chart's axis reads `Nov 25` for an all-time month, `Nov` for a
  twelve-month month, and its tooltip reads `November 2025`; a daily bar reads
  `4 Nov` and `4 Nov 2026`.
- The chart axis and the fitness tooltips read `22 Oct`.
- The calendar heading reads `October 2026`.
- The plan pages read `Mon, Oct 19`.
- The diet page reads `Sat, Nov 7, 2026`.

An unparseable key is returned unchanged rather than throwing or showing
`Invalid Date`.

## Acceptance criteria

- Exactly one module defines the web app's month names and
  `Intl.DateTimeFormat` instances; no second `MONTHS`/`MONTH_NAMES` array or
  `toLocaleDateString` call remains under `apps/web/src`.
- `apps/web/src/dateFormat.test.ts` covers a January and a December key, the
  day-, plan- and diet-style labels, and a run in a negative-offset device zone
  that must keep New Year's Day on 1 January.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run test:coverage`, `bun run check:unused` and `bun run test:e2e` pass.

## Data model and API impact

None. This is a web formatting module; no route, schema, prompt or stored date
changes.
