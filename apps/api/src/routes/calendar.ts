import {
  calendarResponseSchema,
  EMPTY_WEEK_STATS,
  eventEndDate,
  planDateSchema,
  type AnalyzedActivitiesResponse,
  type AthleteEvent,
  type CalendarActivity,
  type CalendarDay,
  type CalendarResponse,
  type CalendarWeek,
  type CalendarWeekStats,
  type CoachPlan,
  type WeekSession,
} from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import { loadAthleteEvents } from "../events/store.js";
import type { ManualActivityContext } from "../llm/planContext.js";
import { addDays, startOfWeek } from "@killingit/shared";
import {
  loadManualActivityReplies,
  toCoachAnalysis,
} from "../plans/replies.js";
import { loadManualActivities } from "../plans/inputs.js";
import { promoteNextPeriod } from "../plans/periods.js";
import { loadValidatedPlan } from "../plans/store.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import {
  loadPlanWeekTotals,
  type WeekPlanTotals,
} from "../plans/weekTotals.js";

/** A `YYYY-MM-DD` date, from an activity timestamp or a plan date. */
function dateOf(value: string): string {
  return value.slice(0, 10);
}

function earliest(dates: readonly string[], fallback: string): string {
  return dates.reduce(
    (min, date) => (date < min ? date : min),
    dates[0] ?? fallback,
  );
}

function latest(dates: readonly string[], fallback: string): string {
  return dates.reduce(
    (max, date) => (date > max ? date : max),
    dates[0] ?? fallback,
  );
}

/** The plan's sessions for the dates it describes (today through next week). */
function plannedSessions(plan: CoachPlan): Map<string, WeekSession> {
  const sessions = [...plan.week.sessions, ...(plan.nextWeek?.sessions ?? [])];
  return new Map(sessions.map((session) => [session.date, session]));
}

/**
 * One outline per Monday-start week the stored plan can describe. Season blocks
 * name the block and number its weeks, so a week the coach has not detailed yet
 * still says where it falls; the active and next block's week plans then add the
 * specific focus, target load and week number, and the current and next week win
 * where they overlap.
 */
function weekOutlines(
  plan: CoachPlan,
  earliestDate: string,
  latestDate: string,
): CalendarWeek[] {
  const weeks = new Map<string, CalendarWeek>();
  const setWeek = (
    date: string,
    fields: Pick<
      CalendarWeek,
      "focus" | "targetLoad" | "weekNumber" | "blockName"
    >,
  ): void => {
    const startDate = startOfWeek(date);
    const existing = weeks.get(startDate);
    weeks.set(startDate, {
      startDate,
      endDate: addDays(startDate, 6),
      focus: fields.focus ?? existing?.focus ?? null,
      targetLoad: fields.targetLoad ?? existing?.targetLoad ?? null,
      weekNumber: fields.weekNumber ?? existing?.weekNumber ?? null,
      blockName: fields.blockName ?? existing?.blockName ?? null,
      stats: existing?.stats ?? EMPTY_WEEK_STATS,
    });
  };

  for (const block of plan.season.blocks) {
    let weekNumber = 1;
    for (
      let startDate = startOfWeek(block.startDate);
      startDate <= block.endDate;
      startDate = addDays(startDate, 7)
    ) {
      setWeek(startDate, {
        focus: null,
        targetLoad: null,
        weekNumber,
        blockName: block.name,
      });
      weekNumber += 1;
    }
  }

  for (const block of [plan.block, plan.nextBlock]) {
    if (block === null) {
      continue;
    }
    for (const week of block.weeks) {
      setWeek(week.startDate, {
        focus: week.focus,
        targetLoad: week.targetLoad,
        // The block plan's number is what the Block tab shows, so it wins over
        // the number derived from the block's start date.
        weekNumber: week.number,
        blockName: block.name,
      });
    }
  }

  for (const week of [plan.week, plan.nextWeek]) {
    if (week !== null) {
      setWeek(week.startDate, {
        focus: week.focus,
        targetLoad: null,
        weekNumber: null,
        blockName: null,
      });
    }
  }

  return [...weeks.values()]
    .filter(
      (week) => week.endDate >= earliestDate && week.startDate <= latestDate,
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * The time and training stress a week's plan asked for and the athlete actually
 * recorded. Planned totals come from the workout sessions; completed time is the
 * recorded elapsed time, and completed TSS is each imported activity's own score
 * plus a manual entry's estimate. On an older cached payload without per-activity
 * scores, the day's fitness snapshot is counted once.
 */
function weekStats(
  startDate: string,
  endDate: string,
  days: ReadonlyMap<string, CalendarDay>,
  plan: CoachPlan | null,
  stored: WeekPlanTotals | undefined,
): CalendarWeekStats {
  const coveredByPlan =
    plan !== null &&
    (plan.week.startDate === startDate ||
      plan.nextWeek?.startDate === startDate);
  const sessions =
    plan === null
      ? []
      : [...plan.week.sessions, ...(plan.nextWeek?.sessions ?? [])].filter(
          (session) =>
            session.type === "workout" &&
            session.date >= startDate &&
            session.date <= endDate,
        );
  // Once a week leaves the stored plan, the record written when it was saved
  // keeps its planned totals instead of showing zero for the work that was done.
  const plannedMinutes = coveredByPlan
    ? sessions.reduce((total, session) => total + session.durationMinutes, 0)
    : (stored?.plannedMinutes ?? 0);
  const plannedTss = coveredByPlan
    ? Math.round(
        sessions.reduce(
          (total, session) =>
            total + (session.estimatedTss ?? session.trainingLoad?.tss ?? 0),
          0,
        ),
      )
    : (stored?.plannedTss ?? 0);

  let completedSeconds = 0;
  let completedTss = 0;
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const day = days.get(date);
    if (day === undefined) {
      continue;
    }
    let measured = false;
    for (const activity of day.activities) {
      if (activity.source === "manual") {
        if (activity.estimatedTss != null) {
          completedTss += activity.estimatedTss;
          measured = true;
        }
        continue;
      }
      completedSeconds += activity.elapsedTime;
      if (activity.activityTss != null) {
        completedTss += activity.activityTss;
        measured = true;
      }
    }
    if (!measured) {
      // Older payloads carry only the day's snapshot. Count it once for the day
      // rather than repeating it for every activity recorded that day.
      const garmin = day.activities.find(
        (activity) => activity.source === "garmin" && activity.trainingLoad,
      );
      if (
        garmin !== undefined &&
        garmin.source === "garmin" &&
        garmin.trainingLoad != null
      ) {
        completedTss += garmin.trainingLoad.tss;
      }
    }
  }

  return {
    plannedMinutes,
    completedMinutes: Math.round(completedSeconds / 60),
    plannedTss: Math.round(plannedTss),
    completedTss: Math.round(completedTss),
  };
}

/**
 * Builds the calendar from the stored activity feed, manual entries, plan, and
 * the athlete's dated goals and events. Days are sparse: only days with
 * something to show are returned.
 */
export function buildCalendar(input: {
  today: string;
  plan: CoachPlan | null;
  feed: AnalyzedActivitiesResponse | null;
  manualActivities: readonly ManualActivityContext[];
  manualReplies: ReadonlyMap<
    number,
    { text: string; model: string; generatedAt: Date }
  >;
  events?: readonly AthleteEvent[];
  /** Stored planned totals for weeks that have left the live plan. */
  weekTotals?: ReadonlyMap<string, WeekPlanTotals>;
}): CalendarResponse {
  const events = input.events ?? [];
  const activityDates = (input.feed?.activities ?? []).map((activity) =>
    dateOf(activity.startDate),
  );
  const manualDates = input.manualActivities.map((activity) =>
    dateOf(activity.startDate),
  );
  const seasonDates =
    input.plan === null
      ? []
      : [input.plan.season.startDate, input.plan.season.endDate];
  const eventDates = events.flatMap((event) => [
    event.startDate,
    eventEndDate(event),
  ]);
  const earliestDate = earliest(
    [...activityDates, ...manualDates, ...seasonDates, ...eventDates],
    input.today,
  );
  const latestDate = latest(
    [
      ...seasonDates,
      ...eventDates,
      ...(input.plan === null ? [] : [...plannedSessions(input.plan).keys()]),
    ],
    input.today,
  );
  // Keep the bounds ordered even if malformed data puts the first record after
  // the season end; the page needs a valid, non-empty month range.
  const boundedEarliest =
    earliestDate <= latestDate ? earliestDate : latestDate;

  const days = new Map<string, CalendarDay>();
  const day = (date: string): CalendarDay => {
    const existing = days.get(date);
    if (existing !== undefined) {
      return existing;
    }
    const created: CalendarDay = {
      date,
      activities: [],
      session: null,
      blockStart: null,
      seasonEnd: false,
      events: [],
    };
    days.set(date, created);
    return created;
  };

  const imported: CalendarActivity[] = (input.feed?.activities ?? []).map(
    (activity) => ({ ...activity, source: "garmin" }),
  );
  const manual: CalendarActivity[] = input.manualActivities.map((activity) => {
    const reply = input.manualReplies.get(activity.id);
    return {
      source: "manual",
      id: activity.id,
      name: activity.details.trim(),
      details: activity.details,
      startDate: activity.startDate,
      coachReply: reply === undefined ? null : toCoachAnalysis(reply),
      estimatedTss: activity.estimatedTss,
    };
  });

  for (const activity of [...imported, ...manual]) {
    const date =
      activity.source === "garmin"
        ? dateOf(activity.startDate)
        : activity.startDate;
    day(date).activities.push(activity);
  }

  // A multi-day event is shown on every day it covers, so a trip is visible
  // across the calendar. The bound keeps a mistyped far-future end date from
  // creating thousands of cells.
  for (const event of events) {
    const endDate = eventEndDate(event);
    let date =
      event.startDate < boundedEarliest ? boundedEarliest : event.startDate;
    for (let index = 0; index < 60 && date <= endDate; index += 1) {
      if (date <= latestDate) {
        day(date).events.push(event);
      }
      date = addDays(date, 1);
    }
  }

  if (input.plan !== null) {
    for (const session of plannedSessions(input.plan).values()) {
      day(session.date).session = session;
    }
    for (const block of input.plan.season.blocks) {
      day(block.startDate).blockStart = block;
    }
    day(input.plan.season.endDate).seasonEnd = true;
  }

  // Every Monday row gets a box, so a week outside the season still shows the
  // work the athlete recorded. The plan-derived outline supplies the block,
  // number, focus and target load where they exist.
  const weeks = new Map<string, CalendarWeek>(
    (input.plan === null
      ? []
      : weekOutlines(input.plan, boundedEarliest, latestDate)
    ).map((week) => [week.startDate, week]),
  );
  for (
    let startDate = startOfWeek(boundedEarliest);
    startDate <= latestDate;
    startDate = addDays(startDate, 7)
  ) {
    const endDate = addDays(startDate, 6);
    const existing = weeks.get(startDate);
    weeks.set(startDate, {
      startDate,
      endDate,
      focus: existing?.focus ?? null,
      targetLoad: existing?.targetLoad ?? null,
      weekNumber: existing?.weekNumber ?? null,
      blockName: existing?.blockName ?? null,
      stats: weekStats(
        startDate,
        endDate,
        days,
        input.plan,
        input.weekTotals?.get(startDate),
      ),
    });
  }

  return calendarResponseSchema.parse({
    earliestDate: boundedEarliest,
    latestDate,
    season: input.plan?.season ?? null,
    weeks: [...weeks.values()]
      .filter((week) => week.startDate <= latestDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    days: [...days.values()]
      .filter(
        (entry) => entry.date >= boundedEarliest && entry.date <= latestDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
}

/**
 * The calendar page's data: activities, manual entries, planned sessions, block
 * starts, the season end, and the athlete's dated goals and events over the
 * range the athlete has data for.
 */
export function createCalendarRoute(deps: ResolvedAppDependencies): Hono {
  const loadFeed = deps.loadCachedFeed ?? loadCachedActivityFeed;
  const loadManual = deps.loadManualActivities ?? loadManualActivities;
  const loadReplies =
    deps.loadManualActivityReplies ?? loadManualActivityReplies;
  const loadEvents = deps.loadEvents ?? loadAthleteEvents;
  const loadWeekTotals = deps.loadWeekTotals ?? loadPlanWeekTotals;

  return new Hono().get("/", async (c) => {
    const today = planDateSchema.safeParse(c.req.query("today"));
    if (!today.success) {
      return c.text("A valid today date (YYYY-MM-DD) is required", 400);
    }

    try {
      const user = await deps.userStore.ensureUser(getAthlete(c).sub);
      const [
        feed,
        manualActivities,
        manualReplies,
        stored,
        events,
        weekTotals,
      ] = await Promise.all([
        loadFeed(user.id),
        loadManual(user.id),
        loadReplies(user.id),
        loadValidatedPlan(deps.planStore, user.id),
        loadEvents(user.id).catch((err: unknown) => {
          // Events are advisory. A read failure must not empty the calendar.
          console.error("[calendar] could not load the athlete's events:", err);
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
        stored === null ? null : promoteNextPeriod(stored.plan, today.data);

      return c.json(
        buildCalendar({
          today: today.data,
          plan,
          feed,
          manualActivities,
          manualReplies,
          events,
          weekTotals,
        }),
      );
    } catch (err) {
      console.error("[calendar] could not build the calendar:", err);
      return c.text("Service Unavailable", 503);
    }
  });
}
