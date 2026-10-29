import type { AthleteAnswerContext } from "./planContext.js";
import { formatAthleteProfile } from "./planContext.js";
import {
  BODY_METRIC_UNITS_RULE,
  COACH_PERSONA,
  JSON_ONLY_RULES,
  ONLY_STATED_NUMBERS_RULE,
  promptSections,
  RETURN_JSON_FROM_SYSTEM_PROMPT,
} from "./promptRules.js";

/**
 * One dated piece of athlete-authored text other than the profile: an activity
 * comment, a manual activity, a weekly note, or a review comment. `label` names
 * where it came from so the coach can tell a weigh-in in a comment apart from a
 * note about the week.
 */
export interface AthleteMetricEntry {
  date: string;
  label: string;
  text: string;
}

/** Everything the coach reads to find the measurements the athlete states. */
export interface AthleteMetricSource {
  /** The interview answers, which are the athlete's own words. */
  profile: readonly AthleteAnswerContext[];
  /** When the profile was last saved; an undated profile value is dated here. */
  profileSavedAt: string | null;
  /** Every dated comment, note, and manual entry, newest first. */
  entries: readonly AthleteMetricEntry[];
}

/**
 * Bump when the extraction prompt or its generation parameters change
 * materially, so a cached reading can be recognized as outdated.
 */
export const ATHLETE_METRICS_PROMPT_VERSION = 2;

export const ATHLETE_METRICS_SYSTEM_PROMPT = promptSections(
  COACH_PERSONA,
  "Read an amateur athlete's own words and report the measurements they state about themselves: FTP (functional threshold power), body weight, and body-fat percentage.",
  ONLY_STATED_NUMBERS_RULE,
  `For example, "I want an FTP of 300 W" and "I want to get to 15 % body fat" state targets, not current values.`,
  `FTP: report the level the athlete says they are at now. When they give both a typical best and a current number ("I reach 280 W when fit, but I am now close to 220 W"), report only the current one. When they give only a typical or best value and no current one, report that value. Ignore a number that only refers to a past season or a peak they no longer hold.`,
  BODY_METRIC_UNITS_RULE,
  "Body mass index, weight lost, and other derived numbers are not measurements.",
  "Date every statement with the date it was given, which is the date shown beside that piece of text. A number in the profile with no date of its own uses the profile's save date. Never use a future date. When the athlete states more than one value for the same date, report only the newest one.",
  `Return only one JSON object with exactly this shape:
{ "statements": [ { "date": "YYYY-MM-DD", "ftpWatts": 0, "weightKg": 0, "bodyFatPercent": 0 } ] }`,
  `Set a value the input does not state to null. Return { "statements": [] } when the athlete states none of these measurements.`,
  JSON_ONLY_RULES,
);

/** Builds the chat messages that ask the coach to read the athlete's metrics. */
export function buildAthleteMetricsMessages(source: AthleteMetricSource): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: ATHLETE_METRICS_SYSTEM_PROMPT },
    { role: "user", content: buildAthleteMetricsPrompt(source) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildAthleteMetricsPrompt(source: AthleteMetricSource): string {
  const lines = [
    ...formatAthleteProfile(source.profile, source.profileSavedAt),
  ];

  if (source.entries.length > 0) {
    lines.push(
      "",
      "Other athlete statements (newest first):",
      ...source.entries.map(
        (entry) => `- ${entry.date} (${entry.label}): ${entry.text.trim()}`,
      ),
    );
  } else {
    lines.push(
      "",
      "The athlete has written no comments, notes, or manual entries.",
    );
  }

  lines.push(
    "",
    "Report the FTP, body weight, and body-fat percentage the athlete states above, each dated by the text it comes from.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
