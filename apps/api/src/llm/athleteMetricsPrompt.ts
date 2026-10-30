import type { AthleteAnswerContext } from "./planContext.js";
import { formatAthleteProfile } from "./planContext.js";
import {
  COACH_RESPONSE_NOTES_CONTRACT,
  COACH_RESPONSE_NOTES_RULES,
  GLOBAL_PROMPT_RULES,
  JSON_ONLY_RULES,
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
  /** Threshold measures already stored, so the coach can keep names consistent. */
  knownThresholds?: readonly {
    sport: string;
    measure: string;
    label: string;
    unit: string;
    kind: string;
  }[];
}

/**
 * Bump when the extraction prompt or its generation parameters change
 * materially, so a cached reading can be recognized as outdated.
 */
export const ATHLETE_METRICS_PROMPT_VERSION = 3;

export const ATHLETE_METRICS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Read an amateur athlete's own words and report the measurements they state about themselves: threshold values per sport, body weight, and body-fat percentage.",
  `Threshold values include FTP (functional threshold power), threshold heart rate, functional threshold pace, critical power, critical swim speed, running stress score, and any similar threshold measure the athlete mentions.`,
  `For example, "I want an FTP of 300 W" and "I want to get to 15 % body fat" state targets, not current values.`,
  `Thresholds: report the level the athlete says they are at now. When they give both a typical best and a current number ("I reach 280 W when fit, but I am now close to 220 W"), report only the current one. When they give only a typical or best value and no current one, report that value. Ignore a number that only refers to a past season or a peak they no longer hold.`,
  `Every threshold belongs to a sport. If the athlete states a threshold but does not say which sport it is for, set "sport" to null. Do not guess; the app will ask the athlete which sport it belongs to.`,
  `Use the athlete's sport names, lower-case, such as "cycling", "running", "swimming", "rowing", or "strength". Use a stable lower-case "measure" key without spaces, such as "ftp", "threshold_heart_rate", "threshold_pace", "critical_power", "critical_swim_speed", or "running_stress_score". "label" is the short name shown to the athlete, such as "FTP" or "Threshold heart rate".`,
  `Set "kind" to one of "power", "heart_rate", "pace", "speed", "stress", or "other". Use "pace" only when the unit is seconds per kilometre ("s/km"); convert a pace such as 4:30 min/km to 270. Use "speed" for kilometres per hour ("km/h"), "power" for watts ("W"), "heart_rate" for beats per minute ("bpm"), and "stress" for a stress score ("points").`,
  "Body mass index, weight lost, and other derived numbers are not measurements.",
  "Date every statement with the date it was given, which is the date shown beside that piece of text. A number in the profile with no date of its own uses the profile's save date. Never use a future date. When the athlete states more than one value for the same date, report only the newest one.",
  `Set a value the input does not state to null, and return an empty "thresholds" list when a statement carries no threshold. Return { "statements": [] } when the athlete states none of these measurements.`,
  `Return only one JSON object with exactly this shape:
{ "statements": [ { "date": "YYYY-MM-DD", "weightKg": 0, "bodyFatPercent": 0,
  "thresholds": [ { "sport": "cycling", "measure": "ftp", "label": "FTP", "unit": "W", "kind": "power", "value": 0 } ] } ],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
  COACH_RESPONSE_NOTES_RULES,
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

  if (
    source.knownThresholds !== undefined &&
    source.knownThresholds.length > 0
  ) {
    lines.push(
      "",
      "Threshold measures already stored (use the same sport, measure, label, unit, and kind when the athlete refers to one):",
      ...source.knownThresholds.map(
        (entry) =>
          `- ${entry.sport} / ${entry.measure}: ${entry.label} (${entry.unit}, ${entry.kind})`,
      ),
    );
  }

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
    "Report every threshold measure, body weight, and body-fat percentage the athlete states above, each dated by the text it comes from. When a threshold's sport is not stated, return it with a null sport.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
