import {
  coachResponseNotesSchema,
  formatThresholdValue,
  type ThresholdSummary,
} from "@killingit/shared";
import { z } from "zod";
import { completePlanJson } from "../llm/planCompletion.js";
import { saveCoachQuestions } from "../plans/coachQuestions.js";
import {
  COACH_RESPONSE_NOTES_CONTRACT,
  COACH_RESPONSE_NOTES_RULES,
  GLOBAL_PROMPT_RULES,
  JSON_ONLY_RULES,
  promptSections,
  TSS_ESTIMATE_GUIDE,
} from "../llm/promptRules.js";
import type { CompletionCredentials } from "../llm/resilientCompletion.js";
import type { LlmProvider } from "../llm/openrouter.js";

const manualTssSchema = z
  .object({
    tss: z.number().int().min(0).max(2000),
  })
  .extend(coachResponseNotesSchema.shape);

const MANUAL_TSS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Estimate the training stress score (TSS) of an athlete's manually recorded activity.",
  TSS_ESTIMATE_GUIDE,
  "Read the duration, activity type, intensity clues, heart rate, and power from the athlete's own wording, and use the athlete's threshold for that sport when it is provided. If the description gives little detail, make a conservative assumption and keep the estimate modest.",
  `Return only a JSON object with exactly this shape: {"tss": 0, ${COACH_RESPONSE_NOTES_CONTRACT}}. "tss" is a whole number from 0 to 2000.`,
  COACH_RESPONSE_NOTES_RULES,
  JSON_ONLY_RULES,
);

/**
 * Asks the coach to turn a free-text manual activity into a TSS number. The
 * wording is read by the model rather than by a keyword list, so "a 3 hour
 * Zwift race" and "90 minutes easy spinning" are scored from their meaning.
 *
 * Returns null when the model is unavailable or fails, so the caller can leave
 * the entry unscored instead of showing a guessed number.
 */
export async function estimateManualActivityTss(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: {
    startDate: string;
    details: string;
    ftpWatts: number | null;
    /** Every threshold measure in effect on the activity date. */
    thresholds?: readonly ThresholdSummary[];
    /** When set, clarification questions are stored for the athlete. */
    userId?: number;
  },
): Promise<number | null> {
  try {
    const thresholdLines = (input.thresholds ?? []).map(
      (entry) =>
        `- ${entry.sport} ${entry.label}: ${formatThresholdValue(entry.value, entry.unit, entry.kind)}`,
    );
    const result = await completePlanJson(
      manualTssSchema,
      provider,
      credentials,
      [
        { role: "system", content: MANUAL_TSS_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Date: ${input.startDate}`,
            `Athlete FTP: ${input.ftpWatts === null ? "not stated" : `${input.ftpWatts} W`}`,
            ...(thresholdLines.length > 0
              ? ["Athlete thresholds:", ...thresholdLines]
              : []),
            `Activity details: ${input.details.trim()}`,
          ].join("\n"),
        },
      ],
      1024,
      { kind: "manual_tss" },
    );
    if (
      input.userId !== undefined &&
      result.coachQuestions !== undefined &&
      result.coachQuestions !== null &&
      result.coachQuestions.length > 0
    ) {
      try {
        await saveCoachQuestions({
          userId: input.userId,
          questions: result.coachQuestions,
          model: credentials.model,
          sourceKind: "manual_tss",
        });
      } catch (err) {
        console.error("[manual-tss] could not store coach questions:", err);
      }
    }
    return result.tss;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[manual-tss] estimate failed: ${detail}`);
    return null;
  }
}
