import { z } from "zod";
import { completePlanJson } from "../llm/planCompletion.js";
import { JSON_ONLY_RULES, TSS_ESTIMATE_GUIDE } from "../llm/promptRules.js";
import type { CompletionCredentials } from "../llm/resilientCompletion.js";
import type { LlmProvider } from "../llm/openrouter.js";

const manualTssSchema = z.object({
  tss: z.number().int().min(0).max(2000),
});

const MANUAL_TSS_SYSTEM_PROMPT = `You estimate the training stress score (TSS) of an athlete's manually recorded activity. ${TSS_ESTIMATE_GUIDE} Read the duration, activity type, intensity clues, heart rate, and power from the athlete's own wording, and use the athlete's FTP when it is provided. If the description gives little detail, make a conservative assumption and keep the estimate modest.

Return only a JSON object with exactly this shape: {"tss": 0}. "tss" is a whole number from 0 to 2000. ${JSON_ONLY_RULES}`;

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
  },
): Promise<number | null> {
  try {
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
            `Activity details: ${input.details.trim()}`,
          ].join("\n"),
        },
      ],
      1024,
      { kind: "manual_tss" },
    );
    return result.tss;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[manual-tss] estimate failed: ${detail}`);
    return null;
  }
}
