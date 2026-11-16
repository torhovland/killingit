import { Hono } from "hono";
import { getUser } from "../auth/middleware.js";
import { buildCalendar } from "../calendar/buildCalendar.js";
import { loadStoredActivityFeed } from "../coaching/activityStore.js";
import {
  loadUserActivityTrainingLoads,
  withActivityLoad,
} from "../coaching/feed/presenter.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { loadAthleteEvents } from "../events/store.js";
import { serviceUnavailable } from "../http/errors.js";
import { todayWithTimezoneQuerySchema } from "../http/query.js";
import { zValidator } from "../http/validation.js";
import { loadManualActivities } from "../plans/inputs.js";
import { promoteNextPeriod } from "../plans/periods.js";
import { loadManualActivityReplies } from "../plans/replies.js";
import { loadValidatedPlan } from "../plans/store.js";
import {
  loadPlanWeekTotals,
  type WeekPlanTotals,
} from "../plans/weekTotals.js";

/**
 * The calendar page's data: activities, manual entries, planned sessions, block
 * starts, the season end, and the athlete's dated goals and events over the
 * range the athlete has data for.
 */
export function createCalendarRoute(deps: ResolvedAppDependencies): Hono {
  const loadFeed = deps.loadStoredFeed ?? loadStoredActivityFeed;
  const loadLoads =
    deps.loadActivityTrainingLoads ?? loadUserActivityTrainingLoads;
  const loadManual = deps.loadManualActivities ?? loadManualActivities;
  const loadReplies =
    deps.loadManualActivityReplies ?? loadManualActivityReplies;
  const loadEvents = deps.loadEvents ?? loadAthleteEvents;
  const loadWeekTotals = deps.loadWeekTotals ?? loadPlanWeekTotals;

  return new Hono().get(
    "/",
    zValidator("query", todayWithTimezoneQuerySchema),
    async (c) => {
      const { today, timezone } = c.req.valid("query");

      try {
        const user = getUser(c);
        const [
          feed,
          manualActivities,
          manualReplies,
          stored,
          events,
          weekTotals,
        ] = await Promise.all([
          loadFeed(user.id, "route"),
          loadManual(user.id),
          loadReplies(user.id),
          loadValidatedPlan(deps.planStore, user.id),
          loadEvents(user.id).catch((err: unknown) => {
            // Events are advisory. A read failure must not empty the calendar.
            console.error(
              "[calendar] could not load the athlete's events:",
              err,
            );
            return [];
          }),
          loadWeekTotals(user.id).catch((err: unknown) => {
            // The planned record is advisory. A read failure still shows the
            // live plan's weeks and the completed work.
            console.error(
              "[calendar] could not load the stored week totals:",
              err,
            );
            return new Map<string, WeekPlanTotals>();
          }),
        ]);
        const plan =
          stored === null ? null : promoteNextPeriod(stored.plan, today);
        const timeZone = timezone ?? user.timezone;
        let activities = feed;
        try {
          const loads = await loadLoads(
            user.id,
            feed.activities,
            stored?.plan,
            today,
            timeZone,
          );
          activities = {
            ...feed,
            activities: feed.activities.map((activity) =>
              withActivityLoad(activity, loads, timeZone),
            ),
          };
        } catch (err) {
          // The day's fitness snapshot is supplementary; the calendar still
          // shows the recorded work without it.
          console.error(
            "[training-load] could not score the calendar activities:",
            err,
          );
        }

        return c.json(
          buildCalendar({
            today,
            timeZone,
            plan,
            feed: activities,
            manualActivities,
            manualReplies,
            events,
            weekTotals,
          }),
        );
      } catch (err) {
        console.error("[calendar] could not build the calendar:", err);
        return serviceUnavailable(c);
      }
    },
  );
}
