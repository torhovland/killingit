import {
  FOOD_ANALYSIS_RESPONSE_RULES,
  GLOBAL_PROMPT_RULES,
  TEXT_FORMATTING_RULES,
  promptSections,
} from "./promptRules.js";
import { formatPlanContext, type PlanContextInput } from "./planContext.js";
import type { LlmMessage } from "./openrouter.js";

/** One meal the athlete just logged. */
export interface FoodAnalysisInput {
  /** The athlete's training and profile context, as every coach prompt sees it. */
  context: PlanContextInput;
  eatenDate: string;
  eatenTime: string;
  /** The athlete's description, or null when the meal is a photo alone. */
  description: string | null;
  /** The full-resolution image data URL used for the analysis, when attached. */
  photoDataUrl?: string | null;
}

export const FOOD_ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "The athlete has logged one meal and wants your reading of it.",
  "Describe the meal in your own words, estimate its carbohydrate, protein, fat and energy content for the whole meal, and comment on how it fits the athlete's goal, current training and recent food log.",
  "Estimate from the athlete's description and, when one is attached, the photo. When the description is vague, assume an ordinary portion and say so in the meal description. Never invent ingredients that neither the description nor the photo shows.",
  TEXT_FORMATTING_RULES,
  FOOD_ANALYSIS_RESPONSE_RULES,
);

/** Builds the chat messages for one meal analysis, with the photo when present. */
export function buildFoodAnalysisMessages(
  input: FoodAnalysisInput,
  includePhoto = true,
): LlmMessage[] {
  const text = buildFoodAnalysisPrompt(input, includePhoto);
  const photo =
    includePhoto &&
    input.photoDataUrl !== undefined &&
    input.photoDataUrl !== null &&
    input.photoDataUrl !== ""
      ? input.photoDataUrl
      : null;

  return [
    { role: "system", content: FOOD_ANALYSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        photo === null
          ? text
          : [
              { type: "text", text },
              { type: "image_url", image_url: { url: photo } },
            ],
    },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildFoodAnalysisPrompt(
  input: FoodAnalysisInput,
  includePhoto = true,
): string {
  const hasPhoto =
    includePhoto &&
    input.photoDataUrl !== undefined &&
    input.photoDataUrl !== null &&
    input.photoDataUrl !== "";

  const description =
    input.description === null || input.description.trim() === ""
      ? null
      : input.description.trim().replace(/\s+/g, " ");

  return [
    ...formatPlanContext(input.context),
    "",
    "The athlete just logged this meal:",
    `- Local date and time: ${input.eatenDate} ${input.eatenTime}`,
    description === null
      ? "- The athlete gave no description; identify the meal from the photo."
      : `- Athlete's description: "${description}"`,
    hasPhoto
      ? "- A photo of the meal is attached."
      : "- No photo was attached.",
    "",
    "Describe the meal, estimate its nutrition, and say how it fits the athlete's diet and training.",
    "Return the JSON object described in the system prompt.",
  ].join("\n");
}
