import type { CoachPlan } from "@killingit/shared";
import type { CoachQuestionSourceKind } from "../coachQuestions.js";
import { STORED_PLAN_FINALISATION, finalizePlan } from "../finalize.js";
import { GenerationSupersededError } from "../generation.js";
import { PLAN_GENERATION_STEPS } from "../steps.js";
import type { StoredPlan } from "../store.js";
import { finalizeInput } from "./finalize.js";
import type { GeneratePlanInput } from "./types.js";

/** Throws when a newer run has claimed the account's generation row. */
export async function ensureGenerationCurrent(
  input: GeneratePlanInput,
): Promise<void> {
  if (input.signal?.aborted === true) {
    throw new GenerationSupersededError();
  }
  if (!(await input.generations.isCurrent(input.userId, input.runId))) {
    throw new GenerationSupersededError();
  }
}

/**
 * Persists a generated plan and finishes the run. A season build or refresh
 * consumes the survey adjustments that shaped it; an incremental update leaves
 * them for the next refresh.
 */
export async function saveGeneratedPlan(
  input: GeneratePlanInput,
  plan: CoachPlan,
  options: { clearSurveyAdjustments: boolean },
): Promise<StoredPlan | null> {
  const { userId, runId } = input;
  await ensureGenerationCurrent(input);
  await input.generations.update(userId, PLAN_GENERATION_STEPS.save, runId);
  const saved = await input.plans.save({
    userId,
    plan,
    answersUpdatedAt: input.context.answersUpdatedAt,
    coachingInputsUpdatedAt: input.context.coachingInputsUpdatedAt,
    activitiesUpdatedAt: input.context.activitiesUpdatedAt ?? null,
    runId,
  });
  if (saved === null) {
    throw new GenerationSupersededError();
  }
  if (options.clearSurveyAdjustments) {
    await clearSurveyAdjustments(input);
  }
  await ensureGenerationCurrent(input);
  await persistFtpEstimates(input, plan);
  await persistBodyMetrics(input, plan);
  await input.generations.finish(userId, runId);
  return saved;
}

/**
 * Ends a run that has nothing to revise. A promotion or new inputs since the
 * last save are persisted first: the plan keeps its training content, but today's
 * completion, the completed days and the training load are settled so the Today
 * tab and the fitness numbers stay correct without a plan completion.
 */
export async function finishUnchangedPlan(
  input: GeneratePlanInput,
  currentPlan: CoachPlan,
  promoted: boolean,
  acknowledgeInputs: boolean,
): Promise<StoredPlan | null> {
  const { userId, runId } = input;
  if ((!promoted && !acknowledgeInputs) || input.plan === null) {
    await input.generations.finish(userId, runId);
    return input.plan;
  }
  await ensureGenerationCurrent(input);
  const saved = await input.plans.save({
    userId,
    plan: reconcileStoredPlan(input, currentPlan),
    answersUpdatedAt: input.plan.answersUpdatedAt,
    coachingInputsUpdatedAt: input.context.coachingInputsUpdatedAt,
    activitiesUpdatedAt: input.context.activitiesUpdatedAt ?? null,
    runId,
  });
  if (saved === null) {
    throw new GenerationSupersededError();
  }
  await input.generations.finish(userId, runId);
  return saved;
}

/**
 * Applies the parts of a refresh that need no coach completion. The stored
 * training content is kept; only the completion status and the load snapshot
 * move.
 */
function reconcileStoredPlan(
  input: GeneratePlanInput,
  currentPlan: CoachPlan,
): CoachPlan {
  return finalizePlan(
    currentPlan,
    finalizeInput(input),
    STORED_PLAN_FINALISATION,
  );
}

/** Stores the coach's weekly FTP estimates after a plan has been saved. */
async function persistFtpEstimates(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<void> {
  if (!input.recordFtpEstimates) {
    return;
  }
  try {
    await input.recordFtpEstimates(plan);
  } catch (err) {
    // The plan itself is saved; the time series must not fail the build.
    console.error("[plan] could not store FTP estimates:", err);
  }
}

/** Stores the body-composition points the coach found after a plan is saved. */
async function persistBodyMetrics(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<void> {
  const points = plan.bodyMetrics ?? [];
  if (!input.recordBodyMetrics || points.length === 0) {
    return;
  }
  try {
    await input.recordBodyMetrics(points);
  } catch (err) {
    // The plan itself is saved; the time series must not fail the build.
    console.error("[plan] could not store body metrics:", err);
  }
}

/** Clears consumed survey adjustments without letting a failure fail the plan. */
async function clearSurveyAdjustments(input: GeneratePlanInput): Promise<void> {
  if (
    input.clearCoachingSurveyAdjustments === undefined ||
    input.context.coachingSurveyAdjustments === undefined ||
    input.context.coachingSurveyAdjustments.length === 0
  ) {
    return;
  }
  try {
    await input.clearCoachingSurveyAdjustments();
  } catch (err) {
    console.error("[plan] could not clear survey adjustments:", err);
  }
}

/**
 * Drops unanswered questions before a new season or season refresh, without
 * letting a failure stop the plan. A question the same run asks is stored after
 * this clear, so only questions about the replaced plan disappear.
 */
export async function clearPendingCoachQuestions(
  input: GeneratePlanInput,
): Promise<void> {
  if (input.clearCoachQuestions === undefined) {
    return;
  }
  if (!(await input.generations.isCurrent(input.userId, input.runId))) {
    throw new GenerationSupersededError();
  }
  try {
    await input.clearCoachQuestions();
  } catch (err) {
    console.error("[plan] could not clear coach questions:", err);
  }
}

/** Stores a clarification question without letting a failure fail the plan. */
export async function recordCoachQuestion(
  input: GeneratePlanInput,
  question: string | null | undefined,
  sourceKind: CoachQuestionSourceKind,
  model: string,
): Promise<void> {
  if (
    input.recordCoachQuestion === undefined ||
    question === undefined ||
    question === null
  ) {
    return;
  }
  if (!(await input.generations.isCurrent(input.userId, input.runId))) {
    throw new GenerationSupersededError();
  }
  try {
    await input.recordCoachQuestion({
      question,
      model,
      sourceKind,
    });
  } catch (err) {
    console.error("[plan] could not store coach questions:", err);
  }
}
