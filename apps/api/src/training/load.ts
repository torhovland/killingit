import {
  bikeWorkoutTrainingStressScore,
  CTL_DAYS,
  dailyTrainingLoad,
  estimatedTssFromSession,
  powerTrainingStressScore,
  type AnalyzedActivity,
  type BlockPlan,
  type CoachPlan,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import type { AthleteAnswerContext } from "../llm/planContext.js";
import { addDays } from "../plans/dates.js";
import { extractFtpWatts } from "./ftp.js";

export interface TrainingLoadContext {
  answers: readonly AthleteAnswerContext[];
  activities: readonly AnalyzedActivity[];
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
  const baseFtpWatts = extractFtpWatts(context.answers);
  const activitiesByDate = groupActivitiesByDate(context.activities);
  const current = applyWeekLoad(
    plan.week,
    baseFtpWatts,
    activitiesByDate,
    undefined,
    weekFtpFromBlock(plan.block, plan.week.startDate),
  );
  const next =
    plan.nextWeek === null
      ? null
      : applyWeekLoad(
          plan.nextWeek,
          baseFtpWatts,
          activitiesByDate,
          current.tssByDate,
          weekFtpFromBlock(
            plan.nextBlock ?? plan.block,
            plan.nextWeek.startDate,
          ),
        );

  const sessions = new Map<string, WeekSession>();
  for (const session of current.week.sessions) {
    sessions.set(session.date, session);
  }
  for (const session of next?.week.sessions ?? []) {
    sessions.set(session.date, session);
  }

  return {
    ...plan,
    block: withEstimatedFtp(
      plan.block,
      baseFtpWatts,
      current.week.startDate,
      current.week.estimatedFtpWatts ?? null,
    ),
    nextBlock:
      plan.nextBlock === null
        ? null
        : withEstimatedFtp(plan.nextBlock, baseFtpWatts, null, null),
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
  baseFtpWatts: number | null,
  activitiesByDate: ReadonlyMap<string, readonly AnalyzedActivity[]>,
  priorTssByDate?: ReadonlyMap<string, number>,
  blockEstimate?: number | null,
): LoadedWeek {
  const ftpWatts = resolveFtpWatts(
    week.estimatedFtpWatts ?? blockEstimate,
    baseFtpWatts,
  );
  const tssByDate = new Map<string, number>();

  for (const session of week.sessions) {
    tssByDate.set(
      session.date,
      resolveSessionTss(
        session,
        ftpWatts,
        activitiesByDate.get(session.date) ?? [],
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
      seriesInput.set(date, activityDayTss(activities, baseFtpWatts));
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

  const sessions = week.sessions.map((session) => ({
    ...session,
    // Keep the downloaded workout's FTP in step with the week's estimate, so
    // the Day card, the Week header, and the trainer file agree.
    bikeWorkout:
      session.bikeWorkout != null && ftpWatts !== null
        ? { ...session.bikeWorkout, ftpWatts }
        : session.bikeWorkout,
    trainingLoad: series.get(session.date) ?? null,
  }));

  return {
    week: { ...week, estimatedFtpWatts: ftpWatts, sessions },
    tssByDate,
  };
}

/**
 * Keeps the coach's weekly FTP estimate inside a realistic band around the
 * athlete's stated value. With no stated FTP there is no anchor, so the plan
 * shows no estimate and the coach's value is discarded.
 */
function resolveFtpWatts(
  estimate: number | null | undefined,
  baseFtpWatts: number | null,
): number | null {
  if (baseFtpWatts === null) {
    return null;
  }
  if (estimate === null || estimate === undefined || estimate <= 0) {
    return baseFtpWatts;
  }
  const minimum = Math.round(baseFtpWatts * 0.7);
  const maximum = Math.round(baseFtpWatts * 1.5);
  return Math.min(maximum, Math.max(minimum, Math.round(estimate)));
}

/** The coach's block-level estimate for the week starting on `startDate`. */
function weekFtpFromBlock(
  block: BlockPlan,
  startDate: string,
): number | null | undefined {
  return block.weeks.find((week) => week.startDate === startDate)
    ?.estimatedFtpWatts;
}

/** Shows a weekly estimate in the block view, anchored to the stated FTP. */
function withEstimatedFtp(
  block: BlockPlan,
  baseFtpWatts: number | null,
  currentWeekStartDate: string | null,
  currentWeekEstimate: number | null,
): BlockPlan {
  return {
    ...block,
    weeks: block.weeks.map((week) => ({
      ...week,
      estimatedFtpWatts:
        currentWeekStartDate !== null &&
        currentWeekEstimate !== null &&
        week.startDate === currentWeekStartDate
          ? currentWeekEstimate
          : resolveFtpWatts(week.estimatedFtpWatts, baseFtpWatts),
    })),
  };
}

/** Copies a day's resolved load and workout from its week session. */
function withDayLoad(
  day: DayPlan,
  sessions: ReadonlyMap<string, WeekSession>,
): DayPlan {
  const session = sessions.get(day.date);
  if (session === undefined) {
    return { ...day, trainingLoad: null };
  }
  return {
    ...day,
    // The week session is the source of truth for the day's resolved training,
    // so a completed activity's replacement workout is reflected here too.
    bikeWorkout:
      session.bikeWorkout === undefined ? day.bikeWorkout : session.bikeWorkout,
    trainingLoad: session.trainingLoad ?? null,
  };
}

/** The TSS for one session, preferring measured power over the coach's guess. */
function resolveSessionTss(
  session: WeekSession,
  ftpWatts: number | null,
  activities: readonly AnalyzedActivity[],
): number {
  if (session.type === "rest" || session.status === "missed") {
    return 0;
  }

  const measured = measuredTss(activities, ftpWatts);
  if (measured !== null) {
    return measured;
  }
  if (session.bikeWorkout !== null && session.bikeWorkout !== undefined) {
    return bikeWorkoutTrainingStressScore(session.bikeWorkout);
  }
  if (session.estimatedTss !== undefined && session.estimatedTss > 0) {
    return Math.round(session.estimatedTss);
  }
  return estimatedTssFromSession(session);
}

/** Sums the power-scored TSS of every activity on one day, when measurable. */
function measuredTss(
  activities: readonly AnalyzedActivity[],
  ftpWatts: number | null,
): number | null {
  if (ftpWatts === null) {
    return null;
  }
  let total: number | null = null;
  for (const activity of activities) {
    const normalized = activity.normalizedPower;
    if (normalized === null || normalized === undefined) {
      continue;
    }
    const durationSeconds =
      activity.movingTime > 0 ? activity.movingTime : activity.elapsedTime;
    const tss = powerTrainingStressScore({
      durationSeconds,
      normalizedPowerWatts: normalized,
      ftpWatts,
    });
    if (tss !== null) {
      total = (total ?? 0) + tss;
    }
  }
  return total;
}

/** TSS used only to seed the fitness history before the planned week. */
function activityDayTss(
  activities: readonly AnalyzedActivity[],
  ftpWatts: number | null,
): number {
  const measured = measuredTss(activities, ftpWatts);
  if (measured !== null) {
    return measured;
  }
  return activities.reduce(
    (total, activity) => total + fallbackActivityTss(activity),
    0,
  );
}

/**
 * A conservative stress estimate for a recorded activity without power. It is
 * used only to seed ATL/CTL before the planned week, never as a workout's
 * displayed TSS; the coach estimates those.
 */
function fallbackActivityTss(activity: AnalyzedActivity): number {
  if (activity.type === "manual" || activity.movingTime <= 0) {
    return 0;
  }
  const hours = activity.movingTime / 3600;
  return Math.round(hours * tssPerHour(activity.type));
}

function tssPerHour(type: string): number {
  const normalized = type.toLowerCase();
  if (normalized.includes("cycl") || normalized.includes("bik")) {
    return 55;
  }
  if (normalized.includes("run")) {
    return 65;
  }
  if (normalized.includes("hik")) {
    return 45;
  }
  if (normalized.includes("walk")) {
    return 35;
  }
  if (normalized.includes("strength") || normalized.includes("weight")) {
    return 40;
  }
  if (normalized.includes("row") || normalized.includes("ski")) {
    return 50;
  }
  return 45;
}

function groupActivitiesByDate(
  activities: readonly AnalyzedActivity[],
): Map<string, AnalyzedActivity[]> {
  const grouped = new Map<string, AnalyzedActivity[]>();
  for (const activity of activities) {
    const date = activity.startDate.slice(0, 10);
    const entries = grouped.get(date);
    if (entries) {
      entries.push(activity);
    } else {
      grouped.set(date, [activity]);
    }
  }
  return grouped;
}
