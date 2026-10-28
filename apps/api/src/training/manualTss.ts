import { z } from "zod";
import { completePlanJson } from "../llm/planCompletion.js";
import type { CompletionCredentials } from "../llm/resilientCompletion.js";
import type { LlmProvider } from "../llm/openrouter.js";

const manualTssSchema = z.object({
  tss: z.number().int().min(0).max(2000),
});

const MANUAL_TSS_SYSTEM_PROMPT = `You estimate the training stress score (TSS) of an athlete's manually recorded activity. A score of 100 is one hour at FTP; an easy aerobic hour is roughly 40-60, a moderate hour 60-75, and a hard race or interval hour 80-100. Use the duration, activity type, intensity clues, heart rate, power, and the athlete's FTP when provided. If the description gives little detail, make a conservative assumption and keep the estimate modest.

Return only a JSON object with exactly this shape: {"tss": 0}. "tss" is a whole number from 0 to 2000.`;

/**
 * Asks the coach to turn a free-text manual activity into a TSS number. If the
 * model is unavailable or returns something unusable, a deterministic
 * duration/intensity estimate keeps the entry scored.
 */
export async function estimateManualActivityTss(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: {
    startDate: string;
    details: string;
    ftpWatts: number | null;
  },
): Promise<number> {
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
    console.error(`[manual-tss] estimate failed, using fallback: ${detail}`);
    return fallbackManualTss(input.details);
  }
}

/**
 * A conservative TSS estimate from the wording: duration first, then activity
 * type and intensity clues such as "race" or a high heart rate.
 */
export function fallbackManualTss(details: string): number {
  const hours = durationHours(details);
  if (hours <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(2000, Math.round(hours * tssPerHour(details))));
}

function durationHours(details: string): number {
  const text = details.toLowerCase();
  const compact = text.match(/(\d+)\s*h\s*(\d+)/);
  if (compact?.[1] !== undefined && compact[2] !== undefined) {
    return Number(compact[1]) + Number(compact[2]) / 60;
  }
  const hourMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*[- ]?\s*(?:h|hr|hrs|hour|hours)\b/,
  );
  if (hourMatch?.[1] !== undefined) {
    return Number(hourMatch[1].replace(",", "."));
  }
  const minuteMatch = text.match(
    /(\d+)\s*[- ]?\s*(?:min|mins|minute|minutes)\b/,
  );
  if (minuteMatch?.[1] !== undefined) {
    return Number(minuteMatch[1]) / 60;
  }
  const clock = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock?.[1] !== undefined && clock[2] !== undefined) {
    return Number(clock[1]) + Number(clock[2]) / 60;
  }
  return 0;
}

function tssPerHour(details: string): number {
  const text = details.toLowerCase();
  const heartRate = Number(text.match(/\b(\d{2,3})\s*(?:bpm|beats)\b/)?.[1]);
  const hard =
    /\b(race|racing|crit|interval|intervals|threshold|vo2|all[- ]out|sprint|hill repeats)\b/.test(
      text,
    ) ||
    (Number.isFinite(heartRate) && heartRate >= 175);
  const easy =
    /\b(easy|recovery|zone 2|z2|conversational|steady)\b/.test(text) && !hard;

  let perHour = easy ? 40 : hard ? 85 : 60;
  if (/\b(swim|swimming)\b/.test(text)) {
    perHour = easy ? 35 : hard ? 75 : 55;
  } else if (/\b(row|rowing|erg)\b/.test(text)) {
    perHour = easy ? 35 : hard ? 75 : 55;
  } else if (/\b(run|running|jog)\b/.test(text)) {
    perHour = easy ? 45 : hard ? 85 : 65;
  } else if (/\b(hik(?:e|es|ing)?|walk(?:s|ing)?)\b/.test(text)) {
    perHour = easy ? 35 : hard ? 60 : 45;
  } else if (/\b(gym|strength|weights|lift|lifting)\b/.test(text)) {
    perHour = 40;
  } else if (
    /\b(bike|biking|cycle|cycling|zwift|trainer|ride|riding)\b/.test(text)
  ) {
    perHour = easy ? 40 : hard ? 85 : 55;
  }
  return perHour;
}
