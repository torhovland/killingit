import { loadLlmClient } from "../llm/client.js";
import {
  GenerationSupersededError,
  isGenerationSuperseded,
} from "../plans/generation.js";
import { PLAN_GENERATION_STEPS } from "../plans/steps.js";
import { claimRun, releaseRun } from "../plans/runs.js";
import {
  runPlanForUser,
  startHeartbeat,
  type PlanRunOptions,
  type PlanTriggerDependencies,
} from "../plans/trigger.js";
import {
  replyToUnansweredActivityComments,
  type CoachReplyDependencies,
} from "./replies.js";

/** The plan dependencies plus the reply hooks used by the fast phase. */
export interface CoachRunDependencies extends PlanTriggerDependencies {
  loadContext?: CoachReplyDependencies["loadContext"];
  saveReply?: CoachReplyDependencies["saveReply"];
  loadUnansweredComments?: CoachReplyDependencies["loadUnansweredComments"];
}

export interface CoachRunOptions extends PlanRunOptions {
  /** Answer every unanswered activity comment before planning. */
  reply?: boolean;
}

/**
 * Starts one coach run for a user. The newest run always wins: the previous
 * in-flight completion is aborted, and its run id no longer owns the status row
 * or the stored plan. A run either answers comments and then plans, or plans
 * only, but both phases share the same fence.
 */
export async function startCoachRun(
  deps: CoachRunDependencies,
  options: CoachRunOptions,
): Promise<boolean> {
  const { userId } = options;
  const run = claimRun(userId);
  await deps.generations.begin(userId, run.runId);
  const heartbeat = startHeartbeat(deps, userId, run.runId);

  void runCoachTurn(deps, { ...options, ...run })
    .catch((err: unknown) => {
      if (!isGenerationSuperseded(err)) {
        console.error("[coach-run] background run failed:", err);
      }
    })
    .finally(() => {
      clearInterval(heartbeat);
      releaseRun(userId, run.runId);
    });

  return true;
}

async function runCoachTurn(
  deps: CoachRunDependencies,
  options: CoachRunOptions & { runId: string; signal: AbortSignal },
): Promise<void> {
  const { userId, today, runId, signal } = options;
  try {
    if (options.reply === true) {
      await deps.generations.update(
        userId,
        PLAN_GENERATION_STEPS.replies,
        runId,
      );
      await replyToUnansweredActivityComments(
        {
          plans: deps.plans,
          answers: deps.answers,
          loadLlm: deps.loadLlm ?? loadLlmClient,
          ...(deps.loadContext !== undefined
            ? { loadContext: deps.loadContext }
            : {}),
          ...(deps.saveReply !== undefined
            ? { saveReply: deps.saveReply }
            : {}),
          ...(deps.loadUnansweredComments !== undefined
            ? { loadUnansweredComments: deps.loadUnansweredComments }
            : {}),
          isCurrent: () => deps.generations.isCurrent(userId, runId),
        },
        { userId, today, signal },
      );
    }

    if (signal.aborted || !(await deps.generations.isCurrent(userId, runId))) {
      throw new GenerationSupersededError();
    }
    await runPlanForUser(deps, { ...options, runId, signal });
  } catch (err) {
    if (isGenerationSuperseded(err) || signal.aborted) {
      return;
    }
    const message =
      err instanceof Error ? err.message : "The coach could not finish.";
    await deps.generations.fail(userId, message, runId);
    throw err;
  }
}
