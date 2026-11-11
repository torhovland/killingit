import type { LlmClient } from "../src/llm/client.js";
import {
  llmMessageText,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../src/llm/openrouter.js";

/** The reply the stub returns for every athlete input. */
export const E2E_COACH_REPLY =
  "Good work. Keep the rest of the week steady and save something for the weekend.";

/** The meal the stub reads from a food prompt. */
export const E2E_FOOD_ANALYSIS = {
  meal: "A bowl of porridge with a banana, as an ordinary portion.",
  carbsGrams: 62,
  proteinGrams: 14,
  fatGrams: 9,
  caloriesKcal: 385,
  dietFit: "It fits the training load and leaves room for a proper lunch.",
} as const;

function isFoodPrompt(request: LlmCompletionRequest): boolean {
  return request.messages.some((message) =>
    llmMessageText(message.content).includes('"carbsGrams"'),
  );
}

/**
 * A deterministic provider for the browser suite: food prompts receive fixed
 * macros and every other prompt receives a short coach reply. It never
 * contacts a real model.
 */
const provider: LlmProvider = {
  id: "e2e",
  listModels: () => Promise.resolve([]),
  validateKey: () => Promise.resolve(),
  complete: (request) =>
    Promise.resolve(
      isFoodPrompt(request)
        ? JSON.stringify(E2E_FOOD_ANALYSIS)
        : E2E_COACH_REPLY,
    ),
};

/** The client `loadLlm` returns for every account in the e2e API process. */
export const e2eLlmClient: LlmClient = {
  provider,
  apiKey: "e2e-api-key",
  model: "e2e/coach",
  seasonModel: "e2e/coach",
  dailyModel: "e2e/coach",
};
