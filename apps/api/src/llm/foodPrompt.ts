import type { FoodAnalysis } from "@killingit/shared";
import {
  FOOD_ANALYSIS_RESPONSE_RULES,
  GLOBAL_PROMPT_RULES,
  TEXT_FORMATTING_RULES,
  promptSections,
} from "./promptRules.js";
import { formatPlanContext, type PlanContextInput } from "./planContext.js";
import type { LlmMessage } from "./openrouter.js";

/** The saved meal an edit started from. */
export interface PreviousFoodAnalysis {
  /** The description stored with the earlier assessment. */
  description: string | null;
  /** The earlier assessment, or null when that meal was never analysed. */
  analysis: FoodAnalysis | null;
}

/** One meal the athlete just logged or edited. */
export interface FoodAnalysisInput {
  /** The athlete's training and profile context, as every coach prompt sees it. */
  context: PlanContextInput;
  eatenDate: string;
  eatenTime: string;
  /** The athlete's description, or null when the meal is a photo alone. */
  description: string | null;
  /** The full-resolution image data URL used for the analysis, when attached. */
  photoDataUrl?: string | null;
  /**
   * The meal as it was stored before an edit. Present only for a re-assessment,
   * so the coach can compare the two versions and adjust its earlier reading.
   */
  previous?: PreviousFoodAnalysis;
}

export const FOOD_ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "The athlete has logged one meal and wants your reading of it.",
  "Give your reading of the meal, estimate its carbohydrate, protein, fat and energy content for the whole meal, and comment on how it fits the athlete's goal, current training and recent food log.",
  "Estimate from the athlete's description and, when one is attached, the photo. When the description is vague, assume an ordinary portion and say so in the meal description. Never invent ingredients that neither the description nor the photo shows.",
  TEXT_FORMATTING_RULES,
  FOOD_ANALYSIS_RESPONSE_RULES,
);

/** The extra rule for a meal the athlete has edited since it was assessed. */
export const FOOD_REASSESSMENT_RULES = promptSections(
  "This is a re-assessment of a meal the athlete already logged.",
  "The athlete's edit is authoritative. Compare the earlier version with the new input, change every part of the earlier assessment that no longer matches, keep the parts that still apply, and do not mention the earlier version unless the change itself matters.",
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

  const system = promptSections(
    FOOD_ANALYSIS_SYSTEM_PROMPT,
    input.previous !== undefined ? FOOD_REASSESSMENT_RULES : null,
  );

  return [
    { role: "system", content: system },
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

  const meal = [
    `- Local date and time: ${input.eatenDate} ${input.eatenTime}`,
    description === null
      ? "- The athlete gave no description; identify the meal from the photo."
      : `- Athlete's description: "${description}"`,
    hasPhoto
      ? "- A photo of the meal is attached."
      : "- No photo was attached.",
  ];

  return [
    ...formatPlanContext(input.context),
    "",
    ...(input.previous === undefined
      ? ["The athlete just logged this meal:", ...meal]
      : [
          "The athlete edited this meal, which is already in their food log.",
          "",
          "Previous version:",
          ...formatPreviousMeal(input.previous),
          "",
          "The meal now reads:",
          ...meal,
          "",
          "Compare the two versions. Update the meal description, the macro estimates and the diet-fit note to match what the athlete changed, and keep the parts that still apply.",
        ]),
    "",
    "Describe what you add to the athlete's description, estimate the meal's nutrition, and say how it fits the athlete's diet and training.",
    "Return the JSON object described in the system prompt.",
  ].join("\n");
}

/** Renders the saved description and assessment an edit started from. */
function formatPreviousMeal(previous: PreviousFoodAnalysis): string[] {
  const description =
    previous.description === null || previous.description.trim() === ""
      ? null
      : previous.description.trim().replace(/\s+/g, " ");
  const lines = [
    description === null
      ? "- Previous description: none; the meal was read from its photo."
      : `- Previous description: "${description}"`,
  ];
  if (previous.analysis === null) {
    lines.push("- Previous assessment: none; this meal has not been analysed.");
    return lines;
  }
  const analysis = previous.analysis;
  lines.push(
    "- Previous assessment:",
    `  - Meal: ${analysis.meal}`,
    `  - Carbs: ${analysis.carbsGrams} g; protein: ${analysis.proteinGrams} g; fat: ${analysis.fatGrams} g; energy: ${analysis.caloriesKcal} kcal`,
    `  - Diet fit: ${analysis.dietFit}`,
  );
  return lines;
}
