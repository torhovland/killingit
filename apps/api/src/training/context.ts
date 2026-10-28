import type { CoachPlan, MetricPoint } from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";
import { loadFtpHistoryForUser } from "../metrics/store.js";
import { startOfWeek } from "../plans/dates.js";
import { loadCoachingInputs, type CoachingInputs } from "../plans/inputs.js";
import { latestAnswerTimestamp } from "../plans/status.js";
import { dbQuestionAnswerStore } from "../questions/answers.js";
import { type FtpTimeline } from "./ftp.js";

/** Everything the load calculations share: FTP history and TSS by date. */
export interface TrainingContext {
  timeline: FtpTimeline;
  /** Every stored FTP point, including future coach estimates. */
  ftpHistory: MetricPoint[];
  /** The resolved or coach-estimated TSS for each day the stored plan covers. */
  planTssByDate: Map<string, number>;
  /** The summed manual estimate for each day that has manual entries. */
  manualTssByDate: Map<string, number>;
  /** The athlete's manual entries, in the order they were loaded. */
  manualActivities: readonly ManualActivityContext[];
}

/**
 * Loads the athlete's FTP timeline and the TSS the stored plan and manual
 * entries contribute. The timeline is read from the metric time series, which
 * includes the profile FTP, every later test the athlete mentioned, and coach
 * estimates. Values dated after the plan date are excluded from the timeline
 * used for load, so a future projection cannot become today's baseline.
 */
export async function loadTrainingContext(
  userId: number,
  plan: CoachPlan | undefined,
): Promise<TrainingContext> {
  const planDate = plan?.today.date ?? new Date().toISOString().slice(0, 10);
  const [answers, coachingInputs] = await Promise.all([
    dbQuestionAnswerStore.listForUser(userId),
    loadCoachingInputs(userId, startOfWeek(planDate)),
  ]);
  const ftpInput = {
    answers,
    answersUpdatedAt: latestAnswerTimestamp(answers),
    manualActivities: coachingInputs.manualActivities,
    activityComments: coachingInputs.activityComments,
    weeklyNote: coachingInputs.weeklyNote,
    weeklyNoteUpdatedAt: coachingInputs.weeklyNoteUpdatedAt,
    periodReviews: coachingInputs.periodReviews,
  };
  const ftp = await loadFtpHistoryForUser(userId, ftpInput, planDate);
  return {
    timeline: ftp.timeline,
    ftpHistory: ftp.points,
    planTssByDate: planTssByDate(plan),
    manualTssByDate: manualTssByDate(coachingInputs),
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

/**
 * Manual entries are part of the same load history. Their stored estimates
 * replace the plan's estimate for the date and are summed when the athlete
 * logged more than one entry that day.
 */
export function manualTssByDate(
  coachingInputs: Pick<CoachingInputs, "manualActivities">,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const manual of coachingInputs.manualActivities) {
    if (manual.estimatedTss === null || manual.estimatedTss === undefined) {
      continue;
    }
    result.set(
      manual.startDate,
      (result.get(manual.startDate) ?? 0) + manual.estimatedTss,
    );
  }
  return result;
}
