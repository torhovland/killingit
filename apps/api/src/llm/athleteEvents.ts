import {
  athleteEventsResultSchema,
  type AthleteEventsResult,
} from "@killingit/shared";
import type { LlmProvider } from "./openrouter.js";
import {
  completePlanJson,
  type PlanCompletionCredentials,
} from "./planCompletion.js";
import {
  buildAthleteEventsMessages,
  type AthleteEventSource,
} from "./athleteEventsPrompt.js";

/** Leaves room for reasoning tokens plus a compact list of events. */
const ATHLETE_EVENTS_MAX_TOKENS = 2048;

/**
 * Asks the coach to read the athlete's dated goals and events from their own
 * words. Only dates the athlete states are reported; nothing here invents one.
 */
export async function extractAthleteEvents(
  provider: LlmProvider,
  credentials: PlanCompletionCredentials,
  source: AthleteEventSource,
): Promise<AthleteEventsResult> {
  return completePlanJson(
    athleteEventsResultSchema,
    provider,
    credentials,
    buildAthleteEventsMessages(source),
    ATHLETE_EVENTS_MAX_TOKENS,
    { kind: "athlete_events" },
  );
}
