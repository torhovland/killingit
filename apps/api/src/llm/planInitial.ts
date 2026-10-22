import {
  initialBlockUpdateSchema,
  seasonPlanUpdateSchema,
  type InitialBlockUpdate,
  type SeasonPlanUpdate,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import {
  buildInitialBlockMessages,
  buildSeasonPlanMessages,
  type InitialBlockInput,
  type SeasonPlanInput,
} from "./planInitialPrompt.js";
import type { PlanUpdateCredentials } from "./planUpdate.js";

/** Asks the coach for the season plan alone. */
export async function generateSeasonPlan(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: SeasonPlanInput,
): Promise<SeasonPlanUpdate> {
  return completePlanJson(
    seasonPlanUpdateSchema,
    provider,
    credentials,
    buildSeasonPlanMessages(input),
    4096,
  );
}

/** Asks the coach for the first block of the season. */
export async function generateInitialBlock(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: InitialBlockInput,
): Promise<InitialBlockUpdate> {
  return completePlanJson(
    initialBlockUpdateSchema,
    provider,
    credentials,
    buildInitialBlockMessages(input),
    4096,
  );
}
