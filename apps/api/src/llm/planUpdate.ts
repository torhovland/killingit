import {
  blockPlanUpdateSchema,
  dailyPlanUpdateSchema,
  weeklyPlanUpdateSchema,
  type BlockPlanUpdate,
  type DailyPlanUpdate,
  type WeeklyPlanUpdate,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import { completePlan } from "./planCompletion.js";
import { parsePlanJson } from "./planJson.js";
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
  const text = await completePlan(
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    4096,
  );
  return parsePlanJson(dailyPlanUpdateSchema, text);
}

/** Asks the coach for a new week and a revised block. */
export async function generateWeeklyUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: WeeklyUpdateInput,
): Promise<WeeklyPlanUpdate> {
  const text = await completePlan(
    provider,
    credentials,
    buildWeeklyUpdateMessages(input),
    4096,
  );
  return parsePlanJson(weeklyPlanUpdateSchema, text);
}

/** Asks the coach for the next block and a revised season. */
export async function generateBlockUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: BlockUpdateInput,
): Promise<BlockPlanUpdate> {
  const text = await completePlan(
    provider,
    credentials,
    buildBlockUpdateMessages(input),
    4096,
  );
  return parsePlanJson(blockPlanUpdateSchema, text);
}
