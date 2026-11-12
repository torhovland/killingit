import type {
  AthleteThreshold,
  CoachPlan,
  ThresholdSummary,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";
import { loadThresholdHistoryForUser } from "../metrics/store.js";
import { startOfWeek } from "@killingit/shared";
import { loadCoachingInputs } from "../plans/inputs.js";
import { manualTssByDate } from "./activityLoad.js";
import { ftpTimeline, type ThresholdTimeline } from "./thresholds.js";

/** Everything the load calculations share: thresholds and TSS by date. */
export interface TrainingContext {
  /** The cycling FTP timeline selected from the stored thresholds. */
  ftpTimeline: ThresholdTimeline | null;
  /** Every stored threshold measure with its sport and unit. */
  thresholds: ThresholdSummary[];
  /** Every stored threshold point, for the Fitness page chart. */
  thresholdPoints: AthleteThreshold[];
  /** One timeline per sport and measure, for sport-aware TSS. */
  thresholdTimelines: ThresholdTimeline[];
  /** The resolved or coach-estimated TSS for each day the stored plan covers. */
  planTssByDate: Map<string, number>;
  /** The summed manual estimate for each day that has manual entries. */
  manualTssByDate: Map<string, number>;
  /** The athlete's manual entries, in the order they were loaded. */
  manualActivities: readonly ManualActivityContext[];
}

/**
 * Loads the athlete's FTP timeline and the TSS the stored plan and manual
 * entries contribute. The timeline is read from the stored metric series, which
 * includes the FTP the coach read from the athlete's words, every Garmin
 * measurement, and the coach's estimates. Values dated after the plan date are
 * excluded from the timeline used for load, so a future projection cannot
 * become today's baseline.
 */
export async function loadTrainingContext(
  userId: number,
  plan: CoachPlan | undefined,
): Promise<TrainingContext> {
  const planDate = plan?.today.date ?? new Date().toISOString().slice(0, 10);
  const [history, coachingInputs] = await Promise.all([
    loadThresholdHistoryForUser(userId, planDate),
    loadCoachingInputs(userId, startOfWeek(planDate)),
  ]);
  const manualByDate = manualTssByDate(coachingInputs.manualActivities);
  return {
    ftpTimeline: ftpTimeline(history.timelines),
    thresholds: history.summaries,
    thresholdPoints: history.points,
    thresholdTimelines: history.timelines,
    planTssByDate: planTssByDate(plan),
    manualTssByDate: manualByDate,
    manualActivities: coachingInputs.manualActivities,
  };
}

/** The resolved or coach-estimated TSS for each day the stored plan covers. */
export function planTssByDate(
  plan: CoachPlan | undefined,
): Map<string, number> {
  const result = new Map<string, number>();
  if (plan === undefined) {
    return result;
  }
  const sessions = [...plan.week.sessions, ...(plan.nextWeek?.sessions ?? [])];
  for (const session of sessions) {
    const tss = session.trainingLoad?.tss ?? session.estimatedTss;
    if (tss !== undefined) {
      result.set(session.date, tss);
    }
  }
  return result;
}
