import {
  athleteMetricsResultSchema,
  type AthleteMetricsResult,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import {
  completePlanJson,
  type PlanCompletionCredentials,
} from "./planCompletion.js";
import {
  buildAthleteMetricsMessages,
  type AthleteMetricSource,
} from "./athleteMetricsPrompt.js";

/** Leaves room for reasoning tokens plus a compact list of statements. */
const ATHLETE_METRICS_MAX_TOKENS = 2048;

/**
 * Asks the coach to read the athlete's stated FTP, body weight, and body-fat
 * percentage from their own words. The values are athlete measurements, so the
 * caller stores them as `user` points; nothing here guesses a number.
 */
export async function extractAthleteMetrics(
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  source: AthleteMetricSource,
): Promise<AthleteMetricsResult> {
  return completePlanJson(
    athleteMetricsResultSchema,
    provider,
    credentials,
    buildAthleteMetricsMessages(source),
    ATHLETE_METRICS_MAX_TOKENS,
    { kind: "athlete_metrics" },
  );
}
