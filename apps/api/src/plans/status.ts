import type { CoachPlan, PlanPending } from "@killingit/shared";
import { addDays } from "./dates.js";

/**
 * Works out which plan levels are missing for `today`. A day is missing when it
 * is not for today, a week is missing when today is not one of its sessions,
 * and a block is missing when today falls outside its date range. After 18:00
 * (`includeTomorrow`), a missing tomorrow session is also pending.
 */
export function planPending(
  plan: CoachPlan | null,
  today: string,
  includeTomorrow = false,
): PlanPending {
  if (!plan) {
    return {
      initial: true,
      day: true,
      week: true,
      block: true,
      tomorrow: true,
    };
  }

  const todaySession = plan.week.sessions.find(
    (session) => session.date === today,
  );
  return {
    initial: false,
    day: plan.today.date !== today,
    // A recorded result belongs on both today and the week. Treat a mismatch
    // as pending so the regular cascade refreshes the week instead of leaving
    // the two views disagreeing.
    week:
      todaySession === undefined ||
      (plan.today.date === today &&
        (plan.today.status === "completed" ||
          plan.today.status === "partial") &&
        todaySession.status !== plan.today.status),
    block: today < plan.block.startDate || today > plan.block.endDate,
    tomorrow: includeTomorrow && plan.tomorrow?.date !== addDays(today, 1),
  };
}

/**
 * A plan is stale when the athlete has saved an answer newer than the one the
 * plan was generated from. A missing stored answer is treated as older than any
 * existing answer.
 */
export function planIsStale(
  planAnswersUpdatedAt: Date | null,
  currentAnswersUpdatedAt: Date | null,
): boolean {
  if (currentAnswersUpdatedAt === null) {
    return planAnswersUpdatedAt !== null;
  }
  if (planAnswersUpdatedAt === null) {
    return true;
  }
  return currentAnswersUpdatedAt.getTime() > planAnswersUpdatedAt.getTime();
}

/**
 * The newest general coach analysis timestamp across the supplied activities.
 * This is compared with the saved plan to tell whether an activity was analysed
 * after the plan was last generated.
 */
export function latestActivityAnalysisTimestamp(
  activities: readonly { analysis: { generatedAt: string } | null }[],
): Date | null {
  let latest: Date | null = null;
  for (const activity of activities) {
    if (activity.analysis === null) {
      continue;
    }
    const generatedAt = new Date(activity.analysis.generatedAt);
    if (Number.isNaN(generatedAt.getTime())) {
      continue;
    }
    if (latest === null || generatedAt.getTime() > latest.getTime()) {
      latest = generatedAt;
    }
  }
  return latest;
}

/** The newest `answeredAt` across the athlete's current answers. */
export function latestAnswerTimestamp(
  answers: readonly { answeredAt: Date | null }[],
): Date | null {
  let latest: Date | null = null;
  for (const answer of answers) {
    if (
      answer.answeredAt !== null &&
      (latest === null || answer.answeredAt.getTime() > latest.getTime())
    ) {
      latest = answer.answeredAt;
    }
  }
  return latest;
}
