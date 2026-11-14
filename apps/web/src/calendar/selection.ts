import type { CalendarActivity, WeekSession } from "@killingit/shared";

/** The calendar entry whose details the dialog shows. */
export type CalendarSelection =
  | { kind: "activity"; activity: CalendarActivity }
  | { kind: "session"; session: WeekSession };
