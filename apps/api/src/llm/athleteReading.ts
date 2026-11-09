import {
  athleteReadingResultSchema,
  type AthleteReadingResult,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import {
  completePlanJson,
  type PlanCompletionCredentials,
} from "./planCompletion.js";
import {
  buildAthleteReadingMessages,
  type AthleteReadingSource,
} from "./athleteReadingPrompt.js";

/** Leaves room for reasoning plus both the measurement and event lists. */
const ATHLETE_READING_MAX_TOKENS = 4096;

/**
 * Asks the coach to read the athlete's stated measurements and their dated
 * goals and events from the same text. One call covers both, so the athlete's
 * words are not sent twice.
 */
export async function extractAthleteReading(
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  source: AthleteReadingSource,
): Promise<AthleteReadingResult> {
  return completePlanJson(
    athleteReadingResultSchema,
    provider,
    credentials,
    buildAthleteReadingMessages(source),
    ATHLETE_READING_MAX_TOKENS,
    { kind: "athlete_reading" },
  );
}
