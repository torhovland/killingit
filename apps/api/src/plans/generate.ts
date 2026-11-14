import type { CoachPlan } from "@killingit/shared";
import { isGenerationSuperseded } from "./generation.js";
import {
  captureEndedPeriodReviews,
  decideRevisionPlan,
  planIsIdle,
} from "./generation/decision.js";
import { generateFreshPlan } from "./generation/freshPlan.js";
import {
  clearPendingCoachQuestions,
  ensureGenerationCurrent,
  finishUnchangedPlan,
  saveGeneratedPlan,
} from "./generation/persist.js";
import { advancePlan } from "./generation/revision.js";
import type { GeneratePlanInput } from "./generation/types.js";
import { promoteNextPeriod } from "./periods.js";
import type { StoredPlan } from "./store.js";

/** The stored plan an advancing run revises; a full build always has none. */
function requireCurrentPlan(plan: CoachPlan | null): CoachPlan {
  if (plan === null) {
    throw new Error("A stored plan is required to advance the plan.");
  }
  return plan;
}

/**
 * Generates or advances the athlete's plan. A missing or stale plan (or an
 * explicit force) rebuilds all four levels. Otherwise the cascade fills in a
 * missing block, then a missing week, then a missing day, revising the parent
 * level after each child.
 */
export async function runPlanGeneration(
  input: GeneratePlanInput,
): Promise<StoredPlan | null> {
  const { today } = input;

  try {
    // 1. Refuse to work for a run that a newer one has replaced.
    await ensureGenerationCurrent(input);

    // 2. Today may have moved into a week or block that was planned last
    // night. Promote it for this run; the raw stored plan is used below to
    // capture the ended period's review before it is dropped.
    const stored = input.plan?.plan ?? null;
    const currentPlan =
      stored === null ? null : promoteNextPeriod(stored, today);
    const promoted = currentPlan !== null && currentPlan !== stored;

    // 3. The cascade is about to replace the current week/block. Summarise
    // them first when they have ended, so the athlete keeps a review. The
    // captured reviews belong to this run, so they are threaded through a
    // resolved input instead of rewriting the caller's context.
    const context = await captureEndedPeriodReviews(input, today);
    const runInput: GeneratePlanInput = { ...input, context };

    // 4. Work out which levels this run has to build or revise.
    const decision = decideRevisionPlan(runInput, currentPlan);

    // 5. A new season or a season refresh replaces unanswered questions.
    if (decision.needsFullPlan || decision.kind === "refresh") {
      await clearPendingCoachQuestions(runInput);
    }

    // 6. Build every level when there is no plan to advance.
    if (decision.needsFullPlan) {
      const generated = await generateFreshPlan(runInput);
      return await saveGeneratedPlan(runInput, generated, {
        clearSurveyAdjustments: true,
      });
    }

    const activePlan = requireCurrentPlan(currentPlan);

    // 7. A refresh revises the stored season in place.
    if (decision.kind === "refresh") {
      const plan = await advancePlan(runInput, activePlan, decision);
      return await saveGeneratedPlan(runInput, plan, {
        clearSurveyAdjustments: true,
      });
    }

    // 8. Nothing is due: keep the plan, persisting a promotion or the inputs
    // that arrived since the last save.
    if (planIsIdle(decision.pending, decision.revisionNeeded)) {
      return await finishUnchangedPlan(
        runInput,
        activePlan,
        promoted,
        decision.acknowledgementNeeded,
      );
    }

    // 9. Advance the levels that are pending.
    const plan = await advancePlan(runInput, activePlan, decision);
    return await saveGeneratedPlan(runInput, plan, {
      clearSurveyAdjustments: false,
    });
  } catch (err) {
    // A superseded run unwinds silently: the newer run owns the status row,
    // the prompt log, and every later write.
    if (isGenerationSuperseded(err) || input.signal?.aborted === true) {
      return null;
    }
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    const startedAt = await input.generations.fail(
      input.userId,
      message,
      input.runId,
    );
    if (startedAt !== null) {
      await input.markPromptsFailed?.(input.userId, startedAt, message);
    }
    throw err;
  }
}
