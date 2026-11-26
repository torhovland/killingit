import { planChangeScopeSchema, type PlanChangeScope } from "@killingit/shared";
import { coachReplyResultSchema } from "./coachResult.js";

/**
 * The athlete-facing reply text and the plan-change decision recovered from one
 * completion. Either structured field stays undefined when the response carried
 * no usable envelope, so the caller can fail open exactly as before.
 */
export interface CoachReplyText {
  text: string;
  planChangeScope: PlanChangeScope | undefined;
  planChangeNeeded: boolean | undefined;
}

/** Keys that identify a JSON object as a coach reply envelope. */
const ENVELOPE_KEYS = ["reply", "planChangeScope", "planChangeNeeded"] as const;

/**
 * Reads the reply out of a completion. A model sometimes writes the reply as
 * prose and then appends the JSON envelope, which leaked the envelope into the
 * answer when validation failed. The envelope is stripped and its scope kept;
 * plain prose passes through untouched.
 */
export function readCoachReplyText(raw: string): CoachReplyText {
  const text = raw.trim();
  const suffix = trailingEnvelope(text);
  if (suffix === null) {
    return { text, planChangeScope: undefined, planChangeNeeded: undefined };
  }

  const parsed = coachReplyResultSchema.safeParse(suffix.value);
  if (parsed.success) {
    return {
      text: parsed.data.reply,
      planChangeScope: parsed.data.planChangeScope,
      planChangeNeeded: parsed.data.planChangeNeeded,
    };
  }

  const scope = planChangeScopeSchema.safeParse(suffix.value.planChangeScope);
  return {
    text: withoutTrailingFence(suffix.before),
    planChangeScope: scope.success ? scope.data : undefined,
    planChangeNeeded:
      typeof suffix.value.planChangeNeeded === "boolean"
        ? suffix.value.planChangeNeeded
        : undefined,
  };
}

interface JsonEnvelope {
  value: Record<string, unknown>;
  before: string;
}

/** Finds the last JSON object in the text that looks like a reply envelope. */
function trailingEnvelope(text: string): JsonEnvelope | null {
  const end = text.lastIndexOf("}");
  if (end === -1) {
    return null;
  }
  let start = text.lastIndexOf("{", end);
  while (start !== -1) {
    const value = parseRecord(text.slice(start, end + 1));
    if (value !== null && isEnvelope(value)) {
      return { value, before: text.slice(0, start).trim() };
    }
    if (start === 0) {
      break;
    }
    start = text.lastIndexOf("{", start - 1);
  }
  return null;
}

function parseRecord(candidate: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnvelope(value: Record<string, unknown>): boolean {
  return ENVELOPE_KEYS.some((key) => key in value);
}

/** Removes a code-fence opener left behind when the JSON block was stripped. */
function withoutTrailingFence(text: string): string {
  return text.replace(/```(?:json)?\s*$/i, "").trim();
}
