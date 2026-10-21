import type { z } from "zod";

/** Raised when the coach's JSON cannot be parsed or does not match the schema. */
export class PlanJsonError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlanJsonError";
  }
}

/**
 * Parses and validates the JSON object in an LLM response. Models occasionally
 * wrap JSON in markdown fences or a short sentence; both are tolerated.
 */
export function parsePlanJson<T>(schema: z.ZodType<T>, text: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch (cause) {
    throw new PlanJsonError(
      "The coach returned a response that was not valid JSON.",
      { cause },
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new PlanJsonError(
      "The coach returned a plan with an unexpected shape.",
      { cause: result.error },
    );
  }
  return result.data;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate;
}
