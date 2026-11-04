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
 * coach question. `label` names where it came from so the coach can tell a race
 * named in a comment apart from one named in a weekly note.
 */
export interface AthleteEventEntry {
  date: string;
  label: string;
  text: string;
}

/** Everything the coach reads to find the dated goals and events the athlete states. */
export interface AthleteEventSource {
  /** The interview answers, which are the athlete's own words. */
  profile: readonly AthleteAnswerContext[];
  /** When the profile was last saved. */
  profileSavedAt: string | null;
  /** Every dated comment, note, and manual entry, newest first. */
  entries: readonly AthleteEventEntry[];
  /** Today's date, so a date the athlete gives in words can be resolved. */
  today: string;
}

/**
 * Bump when the extraction prompt or its generation parameters change
 * materially, so a cached reading can be recognized as outdated.
 */
export const ATHLETE_EVENTS_PROMPT_VERSION = 1;

export const ATHLETE_EVENTS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Read an amateur athlete's own words and report every dated goal or event they state: a race or competition, a sportive or group event, a trip or holiday, an appointment or commitment, or a dated target such as covering 100 km by a given day. The calendar and the athlete's training plan show these dates.",
  `Only report something the athlete actually states. Never report a workout the coach has planned, a session the athlete has already recorded, a date that belongs only to the training plan, or a birthday or anniversary unless the athlete says it affects their training.`,
  `Only a date is useful. When the athlete gives no date, or only a vague period such as "sometime in spring", do not report it. When they give a date in words, resolve it against the date shown beside that statement, or against the profile's save date for an answer in the profile: "next March" is March of the next calendar year, "this Saturday" is the coming Saturday, and "15 March" with no year is the next 15 March on or after that statement's date. Report every date as YYYY-MM-DD.`,
  `Report events from today onward. Skip a date that has already passed. When an event spans several days, set "endDate" to its last day; for a one-day event set "endDate" to null. When the same event is mentioned more than once, report it once, using the newest date.`,
  `Set "kind" to "race" for a competition, "event" for another dated commitment such as a group ride, sportive, or appointment, "trip" for travel that changes when the athlete can train, and "goal" for a dated target that is not a competition.`,
  `"title" is a short name the athlete would recognise, such as "Oslo Marathon" or "Gran Canaria training camp". Do not quote a whole sentence.`,
  `Return only one JSON object with exactly this shape:
{ "events": [ { "startDate": "YYYY-MM-DD", "endDate": null, "title": "string", "kind": "race | event | trip | goal" } ],
  ${COACH_RESPONSE_NOTES_CONTRACT}
}`,
  COACH_RESPONSE_NOTES_RULES,
  JSON_ONLY_RULES,
);

/** Builds the chat messages that ask the coach to read the athlete's events. */
export function buildAthleteEventsMessages(source: AthleteEventSource): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: ATHLETE_EVENTS_SYSTEM_PROMPT },
    { role: "user", content: buildAthleteEventsPrompt(source) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildAthleteEventsPrompt(source: AthleteEventSource): string {
  const lines = [
    `Today's date: ${source.today}`,
    "",
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
    "Report every dated goal or event the athlete states above, dated by the text it comes from and resolved against the date beside it. Report nothing without a date, and nothing that has already passed.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
