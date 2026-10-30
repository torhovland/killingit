import {
  calendarResponseSchema,
  coachPlanSchema,
  planDateSchema,
  type AnalyzedActivitiesResponse,
  type CalendarActivity,
  type CalendarDay,
  type CalendarResponse,
  type CalendarWeek,
  type CoachPlan,
  type WeekSession,
} from "@killingit/shared";
import { Hono } from "hono";
import { getAthlete } from "../auth/middleware.js";
import { loadCachedActivityFeed } from "../coaching/feedCache.js";
import type { ManualActivityContext } from "../llm/planContext.js";
import { addDays, startOfWeek } from "../plans/dates.js";
import {
  loadManualActivityReplies,
  toCoachAnalysis,
} from "../plans/replies.js";
import { loadManualActivities } from "../plans/inputs.js";
import { promoteNextPeriod } from "../plans/periods.js";
import type { PlanStore } from "../plans/store.js";
import type { UserStore } from "../users/store.js";

export interface CalendarRouteDependencies {
  users: UserStore;
  plans: PlanStore;
  /** Injectable for route tests; defaults to the stored activity feed. */
  loadCachedFeed?: (
    userId: number,
  ) => Promise<AnalyzedActivitiesResponse | null>;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadManualActivities?: (userId: number) => Promise<ManualActivityContext[]>;
  loadManualActivityReplies?: typeof loadManualActivityReplies;
}

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
 * supply a fallback focus for weeks the coach has not detailed yet; the active
 * and next block's week plans then add the specific focus and target load, and
 * the current and next week win where they overlap.
 */
function weekOutlines(
  plan: CoachPlan,
  earliestDate: string,
  latestDate: string,
): CalendarWeek[] {
  const weeks = new Map<string, CalendarWeek>();
  const setWeek = (
    date: string,
    fields: Pick<CalendarWeek, "focus" | "targetLoad" | "blockName">,
  ): void => {
    const startDate = startOfWeek(date);
    const existing = weeks.get(startDate);
    weeks.set(startDate, {
      startDate,
      endDate: addDays(startDate, 6),
      focus: fields.focus ?? existing?.focus ?? null,
      targetLoad: fields.targetLoad ?? existing?.targetLoad ?? null,
      blockName: fields.blockName ?? existing?.blockName ?? null,
    });
  };

  for (const block of plan.season.blocks) {
    for (
      let startDate = startOfWeek(block.startDate);
      startDate <= block.endDate;
      startDate = addDays(startDate, 7)
    ) {
      setWeek(startDate, {
        focus: block.focus,
        targetLoad: null,
        blockName: block.name,
      });
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
        blockName: block.name,
      });
    }
  }

  for (const week of [plan.week, plan.nextWeek]) {
    if (week !== null) {
      setWeek(week.startDate, {
        focus: week.focus,
        targetLoad: null,
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
 * Builds the calendar from the stored activity feed, manual entries, and plan.
 * Days are sparse: only days with something to show are returned.
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
}): CalendarResponse {
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
  const earliestDate = earliest(
    [...activityDates, ...manualDates, ...seasonDates],
    input.today,
  );
  const latestDate = latest(
    [
      ...seasonDates,
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

  if (input.plan !== null) {
    for (const session of plannedSessions(input.plan).values()) {
      day(session.date).session = session;
    }
    for (const block of input.plan.season.blocks) {
      day(block.startDate).blockStart = block;
    }
    day(input.plan.season.endDate).seasonEnd = true;
  }

  return calendarResponseSchema.parse({
    earliestDate: boundedEarliest,
    latestDate,
    season: input.plan?.season ?? null,
    weeks:
      input.plan === null
        ? []
        : weekOutlines(input.plan, boundedEarliest, latestDate),
    days: [...days.values()]
      .filter(
        (entry) => entry.date >= boundedEarliest && entry.date <= latestDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
}

/**
 * The calendar page's data: activities, manual entries, planned sessions, block
 * starts, and the season end over the range the athlete has data for.
 */
export function createCalendarRoute(deps: CalendarRouteDependencies): Hono {
  const loadFeed = deps.loadCachedFeed ?? loadCachedActivityFeed;
  const loadManual = deps.loadManualActivities ?? loadManualActivities;
  const loadReplies =
    deps.loadManualActivityReplies ?? loadManualActivityReplies;

  return new Hono().get("/", async (c) => {
    const today = planDateSchema.safeParse(c.req.query("today"));
    if (!today.success) {
      return c.text("A valid today date (YYYY-MM-DD) is required", 400);
    }

    try {
      const user = await deps.users.ensureUser(getAthlete(c).sub);
      const [feed, manualActivities, manualReplies, stored] = await Promise.all(
        [
          loadFeed(user.id),
          loadManual(user.id),
          loadReplies(user.id),
          deps.plans.load(user.id),
        ],
      );
      const parsedPlan =
        stored === null ? null : coachPlanSchema.safeParse(stored.plan);
      const plan =
        parsedPlan !== null && parsedPlan.success
          ? promoteNextPeriod(parsedPlan.data, today.data)
          : null;

      return c.json(
        buildCalendar({
          today: today.data,
          plan,
          feed,
          manualActivities,
          manualReplies,
        }),
      );
    } catch (err) {
      console.error("[calendar] could not build the calendar:", err);
      return c.text("Service Unavailable", 503);
    }
  });
}
