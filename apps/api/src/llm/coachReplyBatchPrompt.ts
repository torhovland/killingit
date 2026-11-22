import type { CoachPlan } from "@killingit/shared";
import {
  COACH_REPLY_SYSTEM_PROMPT,
  formatCoachReplyTarget,
  type CoachReplyTarget,
} from "./coachReplyPrompt.js";
import { formatPlanContext, type PlanContextInput } from "./planContext.js";
import { formatPlanLevels } from "./planLevelsContext.js";
import {
  COACH_REPLY_FIELDS_CONTRACT,
  JSON_ONLY_RULES,
  jsonShape,
  type LlmMessage,
  PLAN_CHANGE_SCOPE_RULES,
  promptSections,
  systemUserMessages,
} from "./promptRules.js";

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

const BATCH_CONTRACT = promptSections(
  jsonShape(`{
  "replies": [
    { "id": "string", ${COACH_REPLY_FIELDS_CONTRACT} }
  ]
}`),
  "Echo each input's id exactly as given. Include one entry for every input and no others.",
);

/** Builds the chat messages for one completion that answers several inputs. */
export function buildCoachReplyBatchMessages(
  input: CoachReplyBatchPromptInput,
): LlmMessage[] {
  return systemUserMessages(
    promptSections(
      COACH_REPLY_SYSTEM_PROMPT,
      BATCH_INSTRUCTION,
      PLAN_CHANGE_SCOPE_RULES,
      BATCH_CONTRACT,
      JSON_ONLY_RULES,
    ),
    buildCoachReplyBatchPrompt(input),
  );
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
function buildCoachReplyBatchPrompt(input: CoachReplyBatchPromptInput): string {
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
