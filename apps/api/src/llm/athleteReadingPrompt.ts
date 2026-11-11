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
 * comment, a manual activity, a weekly note, a review comment, or an answer to a
 * coach question. `label` names where it came from so the coach can tell a
 * weigh-in in a comment apart from a race named in a weekly note.
 */
export interface AthleteReadingEntry {
  date: string;
  label: string;
  text: string;
}

/** Everything the coach reads to find stated measurements, goals and events. */
export interface AthleteReadingSource {
  /** The interview answers, which are the athlete's own words. */
  profile: readonly AthleteAnswerContext[];
  /** When the profile was last saved; an undated profile value is dated here. */
  profileSavedAt: string | null;
  /** Every dated comment, note, and manual entry, newest first. */
  entries: readonly AthleteReadingEntry[];
  /** Today's date, so a relative date can be resolved. */
  today: string;
  /** Threshold measures already stored, so the coach can keep names consistent. */
  knownThresholds?: readonly {
    sport: string;
    measure: string;
    label: string;
    unit: string;
    kind: string;
  }[];
}

export const ATHLETE_READING_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Read an amateur athlete's own words and report two things: the measurements they state about themselves (threshold values per sport, body weight, and body-fat percentage), and every dated goal or event they state (a race or competition, a sportive or group event, a trip or holiday, an appointment or commitment, or a dated target such as covering 100 km by a given day).",
  `Measurements: threshold values include FTP (functional threshold power), threshold heart rate, functional threshold pace, critical power, critical swim speed, running stress score, and any similar threshold measure the athlete mentions. For example, "I want an FTP of 300 W" and "I want to get to 15 % body fat" state targets, not current values. Never turn a goal into a measurement.`,
  `Thresholds: report the level the athlete says they are at now. When they give both a typical best and a current number ("I reach 280 W when fit, but I am now close to 220 W"), report only the current one. When they give only a typical or best value and no current one, report that value. Ignore a number that only refers to a past season or a peak they no longer hold.`,
  `Every threshold belongs to a sport. If the athlete states a threshold but does not say which sport it is for, set "sport" to null. Do not guess; the app will ask the athlete which sport it belongs to.`,
  `Use the athlete's sport names, lower-case, such as "cycling", "running", "swimming", "rowing", or "strength". Use a stable lower-case "measure" key without spaces, such as "ftp", "threshold_heart_rate", "threshold_pace", "critical_power", "critical_swim_speed", or "running_stress_score". "label" is the short name shown to the athlete, such as "FTP" or "Threshold heart rate".`,
  `Set "kind" to one of "power", "heart_rate", "pace", "speed", "stress", or "other". Use "pace" only when the unit is seconds per kilometre ("s/km"); convert a pace such as 4:30 min/km to 270. Use "speed" for kilometres per hour ("km/h"), "power" for watts ("W"), "heart_rate" for beats per minute ("bpm"), and "stress" for a stress score ("points").`,
  "Body mass index, weight lost, and other derived numbers are not measurements.",
  `Date every statement with the date it was given, which is the date shown beside that piece of text. A number in the profile with no date of its own uses the profile's save date. Never use a future date. When the athlete states more than one value for the same date, report only the newest one.`,
  `Set a value the input does not state to null, and return an empty "thresholds" list when a statement carries no threshold. Return { "statements": [] } when the athlete states none of these measurements.`,
  `Events: only report something the athlete actually states. Never report a workout the coach has planned, a session the athlete has already recorded, a date that belongs only to the training plan, or a birthday or anniversary unless the athlete says it affects their training.`,
  `Only a date is useful. When the athlete gives no date, or only a vague period such as "sometime in spring", do not report it. When they give a date in words, resolve it against the date shown beside that statement, or against the profile's save date for an answer in the profile: "next March" is March of the next calendar year, "this Saturday" is the coming Saturday, and "15 March" with no year is the next 15 March on or after that statement's date. Report every date as YYYY-MM-DD.`,
  `Report events from today onward. Skip a date that has already passed. When an event spans several days, set "endDate" to its last day; for a one-day event set "endDate" to null. When the same event is mentioned more than once, report it once, using the newest date.`,
  `Set "kind" to "race" for a competition, "event" for another dated commitment such as a group ride, sportive, or appointment, "trip" for travel that changes when the athlete can train, and "goal" for a dated target that is not a competition.`,
  `"title" is a short name the athlete would recognise, such as "Oslo Marathon" or "Gran Canaria training camp". Do not quote a whole sentence.`,
  `Return only one JSON object with exactly this shape:
{ "statements": [ { "date": "YYYY-MM-DD", "weightKg": 0, "bodyFatPercent": 0,
  "thresholds": [ { "sport": "cycling", "measure": "ftp", "label": "FTP", "unit": "W", "kind": "power", "value": 0 } ] } ],
  "events": [ { "startDate": "YYYY-MM-DD", "endDate": null, "title": "string", "kind": "race | event | trip | goal" } ],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
  COACH_RESPONSE_NOTES_RULES,
  JSON_ONLY_RULES,
);

/** Builds the chat messages that ask the coach to read the athlete's text. */
export function buildAthleteReadingMessages(source: AthleteReadingSource): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: ATHLETE_READING_SYSTEM_PROMPT },
    { role: "user", content: buildAthleteReadingPrompt(source) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildAthleteReadingPrompt(
  source: AthleteReadingSource,
): string {
  const lines = [
    `Today's date: ${source.today}`,
    "",
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
    "Report every threshold measure, body weight, and body-fat percentage the athlete states above, each dated by the text it comes from. When a threshold's sport is not stated, return it with a null sport. Also report every dated goal or event the athlete states, dated by the text it comes from and resolved against the date beside it. Report nothing without a date, and nothing that has already passed.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
