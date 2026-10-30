import {
  bikeWorkoutTrainingStressScore,
  CTL_DAYS,
  dailyTrainingLoad,
  estimatedTssFromSession,
  type AnalyzedActivity,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";
import { addDays } from "../plans/dates.js";
import {
  activityDayTss,
  groupActivitiesByDate,
  measuredActivityTss,
} from "./activityLoad.js";
import { ftpAt, type FtpTimeline } from "./ftp.js";
import {
  thresholdTimelineFromFtp,
  type ThresholdTimeline,
} from "./thresholds.js";

export interface TrainingLoadContext {
  activities: readonly AnalyzedActivity[];
  manualActivities?: readonly ManualActivityContext[] | undefined;
  /**
   * The stored FTP time series. The athlete's stated FTP is read by the coach
   * and stored before this runs, so no free text is read here.
   */
  ftpTimeline?: FtpTimeline | null | undefined;
  /** Every stored threshold measure, used to score each sport's activities. */
  thresholdTimelines?: readonly ThresholdTimeline[] | undefined;
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
  const timeline = context.ftpTimeline ?? { anchors: [], latest: null };
  const thresholdTimelines =
    context.thresholdTimelines ??
    (timeline.anchors.length > 0 ? [thresholdTimelineFromFtp(timeline)] : []);
  const baseFtpWatts = timeline.latest?.watts ?? null;
  const floorAtBase = timeline.latest?.fromRevision ?? false;
  const activitiesByDate = groupActivitiesByDate(context.activities);
  const manualTssByDate = new Map<string, number>();
  for (const activity of context.manualActivities ?? []) {
    if (activity.estimatedTss === null || activity.estimatedTss === undefined) {
      continue;
    }
    manualTssByDate.set(
      activity.startDate,
      (manualTssByDate.get(activity.startDate) ?? 0) + activity.estimatedTss,
    );
  }
  const current = applyWeekLoad(
    plan.week,
    plan.today.date,
    timeline,
    thresholdTimelines,
    activitiesByDate,
    manualTssByDate,
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
          timeline,
          thresholdTimelines,
          activitiesByDate,
          manualTssByDate,
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
      timeline,
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
            timeline,
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
 * Resolves the week's FTP estimate, each session's TSS, and the fitness
 * snapshot for every day in the week.
 */
function applyWeekLoad(
  week: WeekPlan,
  today: string,
  timeline: FtpTimeline,
  thresholdTimelines: readonly ThresholdTimeline[],
  activitiesByDate: ReadonlyMap<string, readonly AnalyzedActivity[]>,
  manualTssByDate: ReadonlyMap<string, number>,
  priorTssByDate?: ReadonlyMap<string, number>,
  blockEstimate?: number | null,
  floorAtBase = false,
): LoadedWeek {
  const baseFtpWatts = timeline.latest?.watts ?? null;
  const estimate = week.estimatedFtpWatts ?? blockEstimate;
  const ftpWatts =
    estimate !== null && estimate !== undefined && estimate > 0
      ? resolveFtpWatts(estimate, baseFtpWatts, floorAtBase)
      : floorAtBase
        ? baseFtpWatts
        : (ftpAt(timeline, week.startDate) ?? baseFtpWatts);
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
      timeline,
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
  timeline: FtpTimeline,
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
    : (ftpAt(timeline, session.date) ?? baseFtpWatts);
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
  timeline: FtpTimeline,
  baseFtpWatts: number | null,
  currentWeekStartDate: string | null,
  currentWeekEstimate: number | null,
  floorAtBase = false,
): BlockPlan {
  const latestAt = timeline.anchors[timeline.anchors.length - 1]?.at ?? null;
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
      const interpolated = ftpAt(timeline, week.startDate);
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
