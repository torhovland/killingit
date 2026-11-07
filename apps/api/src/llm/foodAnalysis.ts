import { foodAnalysisResultSchema, type FoodAnalysis } from "@killingit/shared";
import {
  buildFoodAnalysisMessages,
  type FoodAnalysisInput,
} from "./foodPrompt.js";
import { isLlmAbortError, type LlmProvider } from "./openrouter.js";
import { parsePlanJson } from "./planJson.js";
import {
  completeWithFallbacks,
  type CompletionCredentials,
} from "./resilientCompletion.js";

/** The model's reading of one meal. */
export interface FoodAnalysisOutcome {
  analysis: FoodAnalysis;
  model: string;
}

/**
 * Asks the provider to describe a meal and estimate its macros. A model that
 * cannot read images is retried without the photo, so a text description still
 * gets an analysis instead of failing on the attachment.
 */
export async function analyzeFood(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: FoodAnalysisInput,
): Promise<FoodAnalysisOutcome> {
  const hasPhoto =
    input.photoDataUrl !== undefined &&
    input.photoDataUrl !== null &&
    input.photoDataUrl !== "";
  const hasDescription =
    input.description !== null && input.description.trim() !== "";

  let text: string;
  try {
    text = await completeWithFallbacks(
      provider,
      credentials,
      buildFoodAnalysisMessages(input, true),
      1024,
      0.2,
      { kind: "food_analysis", metadata: { withPhoto: hasPhoto } },
    );
  } catch (err) {
    // Retrying without the photo only helps when there is text to analyse. A
    // photo-only meal has nothing left to describe, and asking the model to
    // guess would invent a meal.
    if (!hasPhoto || !hasDescription || isLlmAbortError(err)) {
      throw err;
    }
    // Some models or routes reject image content. The athlete's description is
    // still usable, so retry once as text rather than losing the meal.
    console.error("[food] photo analysis failed, retrying without it:", err);
    text = await completeWithFallbacks(
      provider,
      credentials,
      buildFoodAnalysisMessages(input, false),
      1024,
      0.2,
      {
        kind: "food_analysis",
        metadata: { withPhoto: false, photoFallback: true },
      },
    );
  }

  return {
    analysis: parsePlanJson(foodAnalysisResultSchema, text),
    model: credentials.model,
  };
}
