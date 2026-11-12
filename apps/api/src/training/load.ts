import {
  bikeWorkoutTrainingStressScore,
  CTL_DAYS,
  dailyTrainingLoad,
  estimatedTssFromSession,
  type AnalyzedActivity,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type TrainingLoad,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";
import { addDays } from "@killingit/shared";
import {
  activityDayTss,
  groupActivitiesByDate,
  manualTssByDate,
  measuredActivityTss,
} from "./activityLoad.js";
import {
  ftpTimeline,
  ftpWattsAt,
  type ThresholdTimeline,
} from "./thresholds.js";

export interface TrainingLoadContext {
  activities: readonly AnalyzedActivity[];
  manualActivities?: readonly ManualActivityContext[] | undefined;
  /**
   * Every stored threshold measure, used to score each sport's activities and
   * to select the cycling FTP the plan projects. The athlete's stated FTP is
   * read by the coach and stored before this runs, so no free text is read
   * here.
   */
  thresholdTimelines?: readonly ThresholdTimeline[] | undefined;
  /**
   * The athlete's IANA time zone, so each activity is scored on its local day.
   * A missing zone reads as UTC; see `docs/specs/activity-local-date.md`.
   */
  timeZone?: string | null | undefined;
}

interface LoadedWeek {
  week: WeekPlan;
  /** TSS resolved for each of the week's seven days. */
  tssByDate: Map<string, number>;
}

/**
 * Fills in each session's training stress score and the day-by-day ATL, CTL,
 * and TSB. A session with measured power is scored from normalized power and
 * the week's estimated FTP; a structured indoor bike workout is scored from its
 * intervals; everything else uses the coach's estimate (or a duration-based
 * fallback when the coach gave none).
 *
 * The fitness history is seeded from recorded activities in the 42 days before
 * the week. That keeps CTL and ATL meaningful on the first day of the week even
 * though the stored plan only covers one week.
 */
export function applyTrainingLoad(
  plan: CoachPlan,
  context: TrainingLoadContext,
): CoachPlan {
  const thresholdTimelines = context.thresholdTimelines ?? [];
  const ftp = ftpTimeline(thresholdTimelines);
  const latest = ftp?.anchors[ftp.anchors.length - 1] ?? null;
  const baseFtpWatts = latest?.value ?? null;
  const floorAtBase = latest !== null && latest.source !== "coach";
  const activitiesByDate = groupActivitiesByDate(
    context.activities,
    context.timeZone,
  );
  const manualByDate = manualTssByDate(context.manualActivities ?? []);
  const current = applyWeekLoad(
    plan.week,
    plan.today.date,
    ftp,
    thresholdTimelines,
    activitiesByDate,
    manualByDate,
    undefined,
    weekFtpFromBlock(plan.block, plan.week.startDate),
    floorAtBase,
  );
  const next =
    plan.nextWeek === null
      ? null
      : applyWeekLoad(
          plan.nextWeek,
          plan.today.date,
          ftp,
          thresholdTimelines,
          activitiesByDate,
          manualByDate,
          current.tssByDate,
          weekFtpFromBlock(
            plan.nextBlock ?? plan.block,
            plan.nextWeek.startDate,
          ),
          floorAtBase,
        );

  const sessions = new Map<string, WeekSession>();
  for (const session of current.week.sessions) {
    sessions.set(session.date, session);
  }
  for (const session of next?.week.sessions ?? []) {
    sessions.set(session.date, session);
  }

  const currentFtp = current.week.estimatedFtpWatts ?? null;
  return {
    ...plan,
    season: { ...plan.season, estimatedFtpWatts: currentFtp },
    block: withEstimatedFtp(
      plan.block,
      ftp,
      baseFtpWatts,
      current.week.startDate,
      currentFtp,
      floorAtBase,
    ),
    nextBlock:
      plan.nextBlock === null
        ? null
        : withEstimatedFtp(
            plan.nextBlock,
            ftp,
            baseFtpWatts,
            null,
            next?.week.estimatedFtpWatts ?? currentFtp,
            floorAtBase,
          ),
    week: current.week,
    nextWeek: next?.week ?? null,
    today: withDayLoad(plan.today, sessions),
    tomorrow:
      plan.tomorrow === null ? null : withDayLoad(plan.tomorrow, sessions),
  };
}

/**
 * The athlete's fitness snapshot on `today`, calculated from recorded
 * activities and manual entries. Prompts use it when no stored plan carries a
 * load series, so a new plan or a reply starts from the athlete's actual form.
 * Returns null when the recent history holds no load at all.
 */
export function currentTrainingLoad(
  context: Pick<
    TrainingLoadContext,
    "activities" | "manualActivities" | "thresholdTimelines" | "timeZone"
  >,
  today: string,
): TrainingLoad | null {
  const thresholdTimelines = context.thresholdTimelines ?? [];
  const tssByDate = new Map<string, number>();
  for (const [date, activities] of groupActivitiesByDate(
    context.activities,
    context.timeZone,
  )) {
    tssByDate.set(date, activityDayTss(activities, thresholdTimelines));
  }
  for (const [date, tss] of manualTssByDate(context.manualActivities ?? [])) {
    if (!tssByDate.has(date)) {
      tssByDate.set(date, tss);
    }
  }

  const startDate = addDays(today, -CTL_DAYS);
  const hasLoad = [...tssByDate.keys()].some((date) => date >= startDate);
  if (!hasLoad) {
    return null;
  }
  return (
    dailyTrainingLoad({ startDate, endDate: today, tssByDate }).get(today) ??
    null
  );
}

/**
 * Resolves the week's FTP estimate, each session's TSS, and the fitness
 * snapshot for every day in the week.
 */
function applyWeekLoad(
  week: WeekPlan,
  today: string,
  ftp: ThresholdTimeline | null,
  thresholdTimelines: readonly ThresholdTimeline[],
  activitiesByDate: ReadonlyMap<string, readonly AnalyzedActivity[]>,
  manualTssByDate: ReadonlyMap<string, number>,
  priorTssByDate?: ReadonlyMap<string, number>,
  blockEstimate?: number | null,
  floorAtBase = false,
): LoadedWeek {
  const baseFtpWatts = ftp?.anchors[ftp.anchors.length - 1]?.value ?? null;
  const estimate = week.estimatedFtpWatts ?? blockEstimate;
  const ftpWatts =
    estimate !== null && estimate !== undefined && estimate > 0
      ? resolveFtpWatts(estimate, baseFtpWatts, floorAtBase)
      : floorAtBase
        ? baseFtpWatts
        : (ftpWattsAt(ftp, week.startDate) ?? baseFtpWatts);
  const tssByDate = new Map<string, number>();

  for (const session of week.sessions) {
    tssByDate.set(
      session.date,
      resolveSessionTss(
        session,
        thresholdTimelines,
        activitiesByDate.get(session.date) ?? [],
        manualTssByDate,
      ),
    );
  }

  // Start far enough back for CTL to settle. Older recorded activities carry
  // no planned TSS, so power-scored activities use their measured effort and
  // the rest fall back to a duration estimate purely to seed the history.
  const historyStartDate = addDays(week.startDate, -CTL_DAYS);
  const seriesInput = new Map<string, number>();
  for (const [date, activities] of activitiesByDate) {
    if (date >= historyStartDate && date < week.startDate) {
      seriesInput.set(date, activityDayTss(activities, thresholdTimelines));
    }
  }
  // A previously planned week already resolved its own TSS, including the
  // coach's estimates, so it takes precedence over a generic activity seed.
  for (const [date, value] of priorTssByDate ?? []) {
    if (date < week.startDate) {
      seriesInput.set(date, value);
    }
  }
  for (const [date, value] of tssByDate) {
    seriesInput.set(date, value);
  }

  const series = dailyTrainingLoad({
    startDate: historyStartDate,
    endDate: addDays(week.startDate, 6),
    tssByDate: seriesInput,
  });

  const sessions = week.sessions.map((session) => {
    const dayFtp = resolveDayFtp(
      session,
      today,
      estimate,
      ftp,
      baseFtpWatts,
      floorAtBase,
    );
    return {
      ...session,
      // Days from today onward carry the daily projection the Fitness page
      // charts. Past days keep their historical value, if any.
      ...(session.date >= today ? { estimatedFtpWatts: dayFtp ?? null } : {}),
      // Keep the downloaded workout's FTP in step with the day it belongs to.
      bikeWorkout:
        session.bikeWorkout != null && dayFtp != null
          ? { ...session.bikeWorkout, ftpWatts: dayFtp }
          : session.bikeWorkout,
      trainingLoad: series.get(session.date) ?? null,
    };
  });

  return {
    week: { ...week, estimatedFtpWatts: ftpWatts, sessions },
    tssByDate,
  };
}

/**
 * The FTP estimate for one day. Days from today onward use the coach's daily
 * estimate, falling back to the week's estimate and then the stored timeline.
 * A past day keeps whatever historical value the plan already carries; the
 * Fitness page reads recorded history from the timeline instead.
 */
function resolveDayFtp(
  session: WeekSession,
  today: string,
  weekEstimate: number | null | undefined,
  ftp: ThresholdTimeline | null,
  baseFtpWatts: number | null,
  floorAtBase: boolean,
): number | null | undefined {
  if (session.date < today) {
    return session.estimatedFtpWatts;
  }
  const raw = session.estimatedFtpWatts ?? weekEstimate;
  if (raw !== null && raw !== undefined) {
    return resolveFtpWatts(raw, baseFtpWatts, floorAtBase);
  }
  return floorAtBase
    ? baseFtpWatts
    : (ftpWattsAt(ftp, session.date) ?? baseFtpWatts);
}

/**
 * Keeps the coach's weekly FTP estimate inside a realistic band around the
 * athlete's stated value. With no stated FTP there is no anchor, so the plan
 * shows no estimate and the coach's value is discarded.
 */
function resolveFtpWatts(
  estimate: number | null | undefined,
  baseFtpWatts: number | null,
  floorAtBase = false,
): number | null {
  if (baseFtpWatts === null) {
    return null;
  }
  if (estimate === null || estimate === undefined || estimate <= 0) {
    return baseFtpWatts;
  }
  const minimum = Math.round(baseFtpWatts * 0.7);
  const maximum = Math.round(baseFtpWatts * 1.5);
  const resolved = Math.min(maximum, Math.max(minimum, Math.round(estimate)));
  // A fresh test result is a measurement, not a projection: do not let an
  // older weekly estimate present a lower current FTP than the athlete's test.
  return floorAtBase ? Math.max(baseFtpWatts, resolved) : resolved;
}

/** The coach's block-level estimate for the week starting on `startDate`. */
function weekFtpFromBlock(
  block: BlockPlan,
  startDate: string,
): number | null | undefined {
  return block.weeks.find((week) => week.startDate === startDate)
    ?.estimatedFtpWatts;
}

/**
 * Shows a weekly estimate in the block view. Weeks that start before the
 * latest athlete-provided FTP use the interpolated timeline instead of the
 * coach's old projection; later weeks keep the coach's progression, clamped to
 * the current baseline. The block summary shows the current week's value.
 */
function withEstimatedFtp(
  block: BlockPlan,
  ftp: ThresholdTimeline | null,
  baseFtpWatts: number | null,
  currentWeekStartDate: string | null,
  currentWeekEstimate: number | null,
  floorAtBase = false,
): BlockPlan {
  const latestAt = ftp?.anchors[ftp.anchors.length - 1]?.at ?? null;
  return {
    ...block,
    estimatedFtpWatts: currentWeekEstimate,
    weeks: block.weeks.map((week) => {
      if (
        currentWeekStartDate !== null &&
        currentWeekEstimate !== null &&
        week.startDate === currentWeekStartDate
      ) {
        return { ...week, estimatedFtpWatts: currentWeekEstimate };
      }

      // Only completed weeks before the new test are re-interpolated. The
      // week that contains the test is refreshed to the new value instead.
      const weekEnd = Date.parse(`${addDays(week.startDate, 6)}T00:00:00Z`);
      const interpolated = ftpWattsAt(ftp, week.startDate);
      if (latestAt !== null && Number.isFinite(weekEnd) && weekEnd < latestAt) {
        return { ...week, estimatedFtpWatts: interpolated };
      }

      return {
        ...week,
        estimatedFtpWatts:
          resolveFtpWatts(week.estimatedFtpWatts, baseFtpWatts, floorAtBase) ??
          interpolated ??
          baseFtpWatts,
      };
    }),
  };
}

/** Copies a day's resolved training load from its week session. */
function withDayLoad(
  day: DayPlan,
  sessions: ReadonlyMap<string, WeekSession>,
): DayPlan {
  const session = sessions.get(day.date);
  if (session === undefined) {
    return { ...day, trainingLoad: null };
  }
  const dayFtp = session.estimatedFtpWatts;
  return {
    ...day,
    // The day plan owns the detailed prescription, including its bike workout.
    // Keep that workout's FTP in step with the day the week projects.
    bikeWorkout:
      day.bikeWorkout != null && dayFtp != null
        ? { ...day.bikeWorkout, ftpWatts: dayFtp }
        : day.bikeWorkout,
    trainingLoad: session.trainingLoad ?? null,
  };
}

/** The TSS for one session, preferring measured power over the coach's guess. */
function resolveSessionTss(
  session: WeekSession,
  thresholdTimelines: readonly ThresholdTimeline[],
  activities: readonly AnalyzedActivity[],
  manualTssByDate: ReadonlyMap<string, number>,
): number {
  if (session.type === "rest" || session.status === "missed") {
    return 0;
  }

  const measured = measuredActivityTss(activities, thresholdTimelines);
  if (measured !== null) {
    return measured;
  }
  if (session.bikeWorkout !== null && session.bikeWorkout !== undefined) {
    return bikeWorkoutTrainingStressScore(session.bikeWorkout);
  }
  const manualTss = manualTssByDate.get(session.date);
  if (manualTss !== undefined && manualTss > 0) {
    return Math.round(manualTss);
  }
  if (session.estimatedTss !== undefined && session.estimatedTss > 0) {
    return Math.round(session.estimatedTss);
  }
  return estimatedTssFromSession(session);
}
