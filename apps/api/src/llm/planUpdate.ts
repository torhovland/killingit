import {
  blockPlanUpdateSchema,
  dailyPlanUpdateSchema,
  targetDayUpdateSchema,
  weeklyPlanUpdateSchema,
  type BlockPlanUpdate,
  type DailyPlanUpdate,
  type TargetDayUpdate,
  type WeeklyPlanUpdate,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import {
  buildBlockUpdateMessages,
  buildDailyUpdateMessages,
  buildWeeklyUpdateMessages,
  type BlockUpdateInput,
  type DailyUpdateInput,
  type WeeklyUpdateInput,
} from "./planUpdatePrompt.js";

export interface PlanUpdateCredentials {
  apiKey: string;
  model: string;
}

/** Asks the coach for today's session and a revised week. */
export async function generateDailyUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: DailyUpdateInput,
): Promise<DailyPlanUpdate> {
  return completePlanJson(
    dailyPlanUpdateSchema,
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    4096,
  );
}

/**
 * Asks the coach for a specific target day (tomorrow when planning the next
 * period) and its week. The prompt also asks for the day after the target, but
 * that field is not used; ignoring it keeps a malformed optional suggestion
 * from failing the generation.
 */
export async function generateTargetDayUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: DailyUpdateInput,
): Promise<TargetDayUpdate> {
  return completePlanJson(
    targetDayUpdateSchema,
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    4096,
  );
}

/** Asks the coach for a new week and a revised block. */
export async function generateWeeklyUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: WeeklyUpdateInput,
): Promise<WeeklyPlanUpdate> {
  return completePlanJson(
    weeklyPlanUpdateSchema,
    provider,
    credentials,
    buildWeeklyUpdateMessages(input),
    4096,
  );
}

/** Asks the coach for the next block and a revised season. */
export async function generateBlockUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: BlockUpdateInput,
): Promise<BlockPlanUpdate> {
  return completePlanJson(
    blockPlanUpdateSchema,
    provider,
    credentials,
    buildBlockUpdateMessages(input),
    4096,
  );
}
