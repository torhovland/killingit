import type { WeekSession } from "@killingit/shared";

/** The fields that decide whether a session shows the forecast. */
type SessionWeather = Pick<
  WeekSession,
  "type" | "canBeOutdoor" | "weather" | "forecasts"
>;

/**
 * Whether a session's row shows the forecast. Rest days never have one, and a
 * session tied to indoor equipment or a venue has nothing to show; plans stored
 * before weather planning leave `canBeOutdoor` unset, which counts as flexible.
 */
export function showsWeather(session: SessionWeather): boolean {
  return (
    session.type === "workout" &&
    session.canBeOutdoor !== false &&
    (session.weather != null || session.forecasts != null)
  );
}
