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

  return {
    initial: false,
    day: plan.today.date !== today,
    week: !plan.week.sessions.some((session) => session.date === today),
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
