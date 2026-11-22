import type {
  CoachPlan,
  PlanChangeScope,
  PlanPending,
} from "@killingit/shared";
import { calorieEstimateProblems } from "./calorieEstimates.js";
import { addDays } from "@killingit/shared";
import { isNewer } from "./dates.js";
import { dietProgressPending } from "./dietProgress.js";
import type { PlanRefreshChange } from "./inputChanges.js";
import { blockFor, weekFor } from "./periods.js";

export interface PlanPendingInput {
  plan: CoachPlan | null;
  today: string;
  /** After 18:00 the run also plans and checks tomorrow. */
  includeTomorrow?: boolean;
  /** The latest forecast differs significantly from the stored week's. */
  weatherChanged?: boolean;
  /** A week review arrived after the stored plan was saved. */
  weekReviewPending?: boolean;
  /** The athlete opted in to diet advice, so a missing target is pending. */
  dietAdvice?: boolean;
}

/**
 * Works out which plan levels are missing for `today`. A day is missing when it
 * is not for today, a week is missing when today is not one of its sessions,
 * and a block is missing when today falls outside its date range or a week
 * review arrived after the plan was saved. After 18:00
 * (`includeTomorrow`), tomorrow's session is checked against the stored week
 * and block, and a crossing into a new week or block is reported so the next
 * one can be generated. `weatherChanged` marks the week for a refresh when the
 * latest forecast differs significantly from the weather stored on it.
 */
export function planPending(input: PlanPendingInput): PlanPending {
  const { plan, today } = input;
  const includeTomorrow = input.includeTomorrow === true;
  const weatherChanged = input.weatherChanged === true;
  const weekReviewPending = input.weekReviewPending === true;
  const dietAdvice = input.dietAdvice === true;
  if (!plan) {
    return {
      initial: true,
      day: true,
      week: true,
      block: true,
      tomorrow: true,
      nextWeek: true,
      nextBlock: true,
      dietProgress: false,
    };
  }

  const todaySession = plan.week.sessions.find(
    (session) => session.date === today,
  );
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = includeTomorrow ? weekFor(plan, tomorrowDate) : null;
  const tomorrowBlock = includeTomorrow ? blockFor(plan, tomorrowDate) : null;
  // A stored plan can carry a calorie target so low that it is clearly a
  // deficit or burned calories rather than the day's intake. Treat it as
  // pending once so the corrected prompt regenerates it; a failed generation
  // stops the automatic retry until the athlete asks again.
  const calorieTargetInvalid = calorieEstimateProblems(plan).length > 0;
  return {
    initial: false,
    day: plan.today.date !== today || calorieTargetInvalid,
    // A recorded result belongs on both today and the week. Treat a mismatch
    // as pending so the regular cascade refreshes the week instead of leaving
    // the two views disagreeing.
    week:
      weatherChanged ||
      calorieTargetInvalid ||
      todaySession === undefined ||
      (plan.today.date === today &&
        (plan.today.status === "completed" ||
          plan.today.status === "partial") &&
        todaySession.status !== plan.today.status),
    block:
      weekReviewPending ||
      today < plan.block.startDate ||
      today > plan.block.endDate,
    tomorrow:
      includeTomorrow &&
      (plan.tomorrow?.date !== tomorrowDate ||
        tomorrowWeek === null ||
        !tomorrowWeek.sessions.some(
          (session) => session.date === tomorrowDate,
        )),
    nextWeek: includeTomorrow && tomorrowWeek === null,
    nextBlock: includeTomorrow && tomorrowBlock === null,
    dietProgress: dietProgressPending(plan, dietAdvice, today),
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
    if (isNewer(generatedAt, latest)) {
      latest = generatedAt;
    }
  }
  return latest;
}

/** The analysis fields the refresh decision reads from a recent activity. */
export interface PlanChangingAnalysis {
  generatedAt: string;
  planChangeNeeded?: boolean | undefined;
  planChangeScope?: PlanChangeScope | undefined;
}

/**
 * Every analysis that judged the workout changes the plan, with the scope the
 * coach chose. An analysis without a scope falls back to its boolean; a missing
 * boolean fails open to the season. A context-only analysis is left out.
 */
export function planChangingAnalysisChanges(
  activities: readonly { analysis: PlanChangingAnalysis | null }[],
): PlanRefreshChange[] {
  const changes: PlanRefreshChange[] = [];
  for (const activity of activities) {
    if (activity.analysis === null) {
      continue;
    }
    const scope =
      activity.analysis.planChangeScope ??
      (activity.analysis.planChangeNeeded === false ? "none" : "season");
    if (scope === "none") {
      continue;
    }
    const updatedAt = new Date(activity.analysis.generatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      continue;
    }
    changes.push({ updatedAt, planChangeScope: scope });
  }
  return changes.sort(
    (left, right) => left.updatedAt.getTime() - right.updatedAt.getTime(),
  );
}

/**
 * The newest analysis that judged the workout changes the plan. An analysis
 * without the flag is context only, so it never makes the plan stale.
 */
export function latestPlanChangingAnalysisTimestamp(
  activities: readonly { analysis: PlanChangingAnalysis | null }[],
): Date | null {
  let latest: Date | null = null;
  for (const change of planChangingAnalysisChanges(activities)) {
    if (isNewer(change.updatedAt, latest)) {
      latest = change.updatedAt;
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
    if (isNewer(answer.answeredAt, latest)) {
      latest = answer.answeredAt;
    }
  }
  return latest;
}
