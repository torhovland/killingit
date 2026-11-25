import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import { PLAN_MAX_TOKENS } from "./planBudget.js";
import {
  withBlockGoalCoverage,
  withSeasonGoalCoverage,
} from "./planGoalSchemas.js";
import {
  initialBlockUpdateSchema,
  seasonPlanUpdateSchema,
  type InitialBlockUpdate,
  type SeasonPlanUpdate,
} from "./planResult.js";
import {
  buildInitialBlockMessages,
  buildSeasonPlanMessages,
  type InitialBlockInput,
  type SeasonPlanInput,
} from "./planInitialPrompt.js";
import type { CompletionCredentials } from "./resilientCompletion.js";

/** Asks the coach for the season plan alone. */
export async function generateSeasonPlan(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: SeasonPlanInput,
): Promise<SeasonPlanUpdate> {
  return completePlanJson(
    withSeasonGoalCoverage(seasonPlanUpdateSchema, input),
    provider,
    credentials,
    buildSeasonPlanMessages(input),
    { maxTokens: PLAN_MAX_TOKENS, kind: "season_plan" },
  );
}

/** Asks the coach for the first block of the season. */
export async function generateInitialBlock(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: InitialBlockInput,
): Promise<InitialBlockUpdate> {
  return completePlanJson(
    withBlockGoalCoverage(initialBlockUpdateSchema, input),
    provider,
    credentials,
    buildInitialBlockMessages(input),
    { maxTokens: PLAN_MAX_TOKENS, kind: "initial_block" },
  );
}
