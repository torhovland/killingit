import type { CoachPlan } from "@killingit/shared";
import {
  COACH_REPLY_SYSTEM_PROMPT,
  formatCoachReplyTarget,
  type CoachReplyTarget,
} from "./coachReplyPrompt.js";
import {
  formatPlanContext,
  formatPlanLevels,
  type PlanContextInput,
} from "./planContext.js";
import { JSON_ONLY_RULES, promptSections } from "./promptRules.js";

/** One athlete input in a batched reply request. */
export interface CoachReplyBatchItem {
  /** Stable id the coach must echo back, usually the activity id. */
  id: string;
  request: CoachReplyTarget;
}

export interface CoachReplyBatchPromptInput {
  plan: CoachPlan;
  context: PlanContextInput;
  items: readonly CoachReplyBatchItem[];
}

const BATCH_INSTRUCTION = `The athlete has shared several inputs at once. Write one brief reply for each numbered input below. Answer every input, keep each reply independent, and do not repeat another input's reply.`;

const BATCH_CONTRACT = `Return only one JSON object with exactly this shape:
{
  "replies": [
    { "id": "string", "reply": "string" }
  ]
}

Echo each input's id exactly as given. Include one entry for every input and no others.`;

/** Builds the chat messages for one completion that answers several inputs. */
export function buildCoachReplyBatchMessages(
  input: CoachReplyBatchPromptInput,
): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    {
      role: "system",
      content: promptSections(
        COACH_REPLY_SYSTEM_PROMPT,
        BATCH_INSTRUCTION,
        BATCH_CONTRACT,
        JSON_ONLY_RULES,
      ),
    },
    { role: "user", content: buildCoachReplyBatchPrompt(input) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildCoachReplyBatchPrompt(
  input: CoachReplyBatchPromptInput,
): string {
  const lines = [
    ...formatPlanContext(input.context),
    "",
    ...formatPlanLevels(input.plan),
    "",
    "Inputs to answer:",
  ];
  for (const item of input.items) {
    lines.push(`id: ${item.id}`, formatCoachReplyTarget(item.request), "");
  }
  lines.push(
    "Return one reply per id in the JSON object described in the system prompt.",
  );
  return lines.join("\n");
}
