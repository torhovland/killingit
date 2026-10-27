import type { AthleteAnswerContext } from "../llm/planContext.js";

/** Plausible human FTP range in watts. */
const MIN_FTP_WATTS = 50;
const MAX_FTP_WATTS = 2000;

/**
 * Reads the first FTP value the athlete states in their survey answers. The
 * answer text is free-form, so this accepts the common phrasings ("FTP: 250",
 * "FTP around 220 W", "280 W FTP") and ignores everything outside a plausible
 * wattage range.
 *
 * The first value is deliberately used as the current baseline: a profile such
 * as "FTP around 220 W against roughly 280 W when fit" describes the present
 * first and a past peak second.
 */
export function extractFtpWatts(
  answers: readonly Pick<AthleteAnswerContext, "answer">[],
): number | null {
  for (const entry of answers) {
    const text = entry.answer?.trim();
    if (!text) {
      continue;
    }
    const value = firstFtpInText(text);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** Finds an FTP value in one piece of text, or null when none is stated. */
export function firstFtpInText(text: string): number | null {
  const patterns = [
    /\bftp\b[^0-9]{0,30}(\d{2,4})\s*(?:w\b|watts?\b)?/gi,
    /(\d{2,4})\s*(?:w|watts?)\b[^0-9]{0,12}\bftp\b/gi,
    /\bftp\b[^0-9]{0,30}(\d{2,4})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (raw === undefined) {
        continue;
      }
      const value = Number(raw);
      if (value >= MIN_FTP_WATTS && value <= MAX_FTP_WATTS) {
        return value;
      }
    }
  }
  return null;
}
