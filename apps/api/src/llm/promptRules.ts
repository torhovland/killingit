/**
 * Shared rules and response contracts for the coaching prompts.
 *
 * A rule lives here when more than one prompt depends on it: the build prompts,
 * the update prompts, the activity reviews and the manual TSS estimate all
 * describe the same TSS scale, FTP projection, weather and outline behaviour.
 * Keeping one copy means a change reaches every prompt together and the plan
 * stays consistent no matter which completion produced it.
 */

/** The coach persona that opens every planning prompt. */
export const COACH_PERSONA = "You are an expert endurance coach.";

/**
 * Joins prompt sections with a blank line, dropping empty sections. Shared
 * fragments and prompt-specific text stay separate so a fragment can be
 * updated without editing the prose around it.
 */
export function promptSections(
  ...sections: readonly (string | false | null | undefined)[]
): string {
  return sections
    .filter(
      (section): section is string =>
        typeof section === "string" && section.trim() !== "",
    )
    .join("\n\n");
}

/**
 * Shared rule for every prompt that receives activity comments: a comment is
 * the athlete's description of an activity that is already listed, not another
 * activity.
 */
export const ACTIVITY_COMMENT_RULE =
  "A comment on an activity describes that same activity. It is not an additional activity and must never be added on top of the activity's recorded time or treated as extra training.";

/**
 * A weekly note is dated by its week. Without an explicit statement to the
 * contrary, constraints in it apply to that week only; a recurring statement
 * such as "on Thursdays I have a meetup" applies every week.
 */
export const WEEKLY_NOTE_SCOPE_RULE = `A weekly note is normally scoped to the week it was written for. If it says the athlete cannot train on Thursday, assume that Thursday of that week only. If it says that on Thursdays they have a meetup that keeps them from training, assume it applies to every Thursday. Unless the athlete explicitly says otherwise, do not extend a week-specific constraint to other weeks.`;

/**
 * How a week hangs together: seven dated sessions starting on its start date.
 * Every prompt that returns a week uses this.
 */
export const WEEK_SHAPE_RULES = `Keep the week's start date and exactly seven sessions, one for each day of the week.`;

/**
 * The link between the day view and the week for prompts that return both:
 * today's plan must be the same session the week holds.
 */
export const TODAY_IN_WEEK_RULE = `The today object must match today's date and must be present as the matching session in week.sessions.`;

/**
 * How the coach records what actually happened on past days: describe the
 * recorded activity rather than inventing a workout that was not done.
 */
export const PAST_SESSION_RULES = `For days before today, do not propose new workouts: describe what the athlete actually did using the recent activities and set each status to "completed", "partial", "missed", or "rest".`;

/** How today's session mirrors an activity that was already recorded. */
export const TODAY_SESSION_RULES = `If an activity has already been recorded for today, today's plan must describe that completed activity, using the athlete's latest comment to correct the summary, instead of proposing another workout. Give today's plan and today's week session the same status.`;

/**
 * Completion is judged with reasonable slack so a near-miss is not reported as
 * a partial session.
 */
export const COMPLETION_SLACK_RULES = `Allow reasonable slack when judging completion: a 60-minute ride recorded as 50 minutes is still completed, and power or pace zones that are close but not exact do not make a session partial; use "partial" only when a meaningful part of the session was not done.`;

/**
 * The full completed-session rule for prompts that return both a day plan and
 * a week plan.
 */
export const COMPLETED_SESSION_RULES = promptSections(
  PAST_SESSION_RULES,
  TODAY_SESSION_RULES,
  COMPLETION_SLACK_RULES,
);

/**
 * Shared rule for the day the athlete is about to train. A session must earn
 * its place: the coach states what it builds toward the plan's goal and what
 * skipping costs, and treats a session it cannot justify as a reason to revise
 * the week instead of hiding it behind an "optional" label.
 */
export const SESSION_PURPOSE_RULES = `For today's and tomorrow's workouts, explain the session's purpose against the plan's goal. In "optionalRationale", name the concrete adaptation or fitness quality the session builds toward the season goal, the block's focus, and the week's target load, and state what the athlete loses toward that goal if they skip it. Be specific and motivating (for example, "the aerobic durability that carries you through the last 10 km of the marathon") rather than generic encouragement.

Set "optional" to true only when the cost of skipping is genuinely small, and explain in "optionalRationale" why that cost is acceptable today (for example, a short recovery run at the end of a hard week). Never use "optional" as a label for a workout with no clear purpose.

Before returning, apply the same test to every workout in the week: if you cannot state a concrete loss for skipping a planned session, that session is filler. Revise the week so every workout serves the goal, or replace the session with rest, and update today's plan to match. The week must be the best plan you can make for this athlete's goal, not a template to fill.

If today or tomorrow is a rest day, explain in "rationale" why rest is the best choice today; no optionality assessment is needed.`;

/**
 * Shared instruction for the level of detail in a week plan. A week is a
 * shape, not seven finished workouts: only today and tomorrow need a concrete
 * prescription, because the daily update will detail each later day when it
 * arrives.
 */
export const WEEK_OUTLINE_RULES = `Treat the week as an outline, not seven finished workouts. Fully detail only the sessions the request says need detail: a concrete description, and for an indoor bike workout with power targets a "bikeWorkout". Keep every other future day as a short outline: the session type, a brief title naming the kind of session, a one-sentence description of its intent, an approximate duration and intensity, and an "estimatedTss". Do not prescribe detailed intervals, repetitions, paces, or power targets for outline days, and set "bikeWorkout" to null there; the daily update will turn an outline into a concrete workout when that day arrives. The outline must still show the week's shape: which days are long, hard, easy, or rest. Set the week's "estimatedFtpWatts" from the athlete's profile and the plan's progression, and estimate each outline day's "estimatedTss" against it.`;

/**
 * Shared rule for every prompt that reports a measurement the athlete stated:
 * only the athlete's own numbers count, and a goal is never a measurement.
 */
export const ONLY_STATED_NUMBERS_RULE = `Report only numbers the athlete states in the input. Never infer or guess a measurement from training data, a workout summary, the training plan, or earlier coach notes, never estimate a weigh-in from the workout data, and never turn a goal into a measurement.`;

/**
 * The units every prompt uses for body measurements: kilograms and body-fat
 * percentage of body weight.
 */
export const BODY_METRIC_UNITS_RULE = `Give body weight in kilograms and body fat as a percentage of body weight; convert a stated weight in pounds or stone. A fraction such as 0.245 and "24.5 %" both mean 24.5 % body fat.`;

/**
 * Shared weather and daylight instruction for prompts that choose which day
 * gets which session. The athlete's survey answers define explicit limits;
 * without one, the coach should still place outdoor work sensibly and prefer
 * daylight.
 */
export const WEATHER_PLANNING_RULES = `When a daily forecast is provided, use it to choose which day gets each session. Set "outdoor" to false when this instance is done indoors (gym, treadmill, trainer, pool) and true when it is done outside (running, cycling, hiking, and similar). Set "canBeOutdoor" to false only when the session is tied to indoor equipment or a venue (indoor cycling or trainer, treadmill, gym, pool, rowing machine); set it true when the same session could reasonably be done outdoors (road ride, run, hike, walk), even when you plan this instance indoors. Weather only restricts outdoor sessions.

Read the forecast row for the exact date. Do not describe a day as rainy or snowy, and do not move a flexible session indoors, when that date's forecast is dry and the athlete has no stated preference against training outdoors.

Respect every weather preference or limit the athlete states in their profile. For example, if they will not ride outdoors in rain or when the temperature is below 10 °C, do not schedule such a ride; move it to a suitable day, make it indoor, or replace it with an equivalent session. If the athlete has no weather preference, use common sense: put longer or more demanding outdoor sessions on the best-weather days and shorter or indoor sessions on the poorer days. For example, if Saturday is sunny and Sunday is rainy, schedule a long hike on Saturday and a short run on Sunday.

The daylight times let you keep outdoor work in daylight. Unless the athlete's profile, weekly notes, activity comments, or other input explicitly says they are willing or able to train in the dark, or prefer it, assume the athlete prefers daylight over darkness. Honour any such statement they do make and do not invent a darkness preference they did not state. If the athlete says they can train before or after work on weekdays, compare those training windows with sunrise and sunset. When the only daylight falls inside their working day, so a weekday outdoor session would happen in the dark, put long outdoor sessions at the weekend and keep weekday outdoor sessions within the available daylight or make them indoor.`;

/**
 * Instruction for structured indoor bike workouts. The athlete can download
 * these as a trainer workout file, so the intervals and power targets must be
 * machine-readable rather than only prose.
 */
export const BIKE_WORKOUT_RULES = `When you prescribe an indoor bike workout with power targets (for example a trainer or ERG session), set "outdoor" to false and include "bikeWorkout". "ftpWatts" is the FTP you used; use that day's session "estimatedFtpWatts" when it has one, otherwise the week's value, and when the athlete's profile states no FTP at all, estimate one from their current performance and mention the assumption in the description. List the session in order in "intervals", with each block's "durationSeconds" and its target "powerPercent" of FTP (75 means 75%). Include the warm-up, every work interval, every recovery, and the cool-down as separate entries. Their durations should add up to "durationMinutes" (rounding is fine). Use at most 40 intervals and keep each block at a steady power. For every other session, including outdoor rides and rest days, set "bikeWorkout" to null. If you revise an existing indoor bike session, keep or update its "bikeWorkout" so it still matches the description.`;

/** The common TSS scale shared by the plan prompts and the manual TSS estimate. */
export const TSS_ESTIMATE_GUIDE = `A score of 100 is roughly one hour at FTP, 60-70 is an easy aerobic hour, and 20-40 is a short strength session.`;

/**
 * Shared instruction for the week-by-week FTP estimate and the TSS numbers the
 * API uses when a session has no measured power. The estimate is anchored to
 * the FTP stated in the athlete's profile; without one the feature stays off.
 */
export const TRAINING_LOAD_RULES = promptSections(
  `When the athlete's profile states an FTP (functional threshold power), estimate how it will change day by day from the training they have actually completed, their recent form, and the plan's progression. Set "estimatedFtpWatts" on every week session from today onward, including rest days, to your estimate for that date; this daily projection feeds the athlete's FTP chart. Set the week's "estimatedFtpWatts" to the estimate for the day the week is shown from (today in the current week, otherwise the week's first day) so the Week view can show it once. Leave a past session's "estimatedFtpWatts" null. When the response contract also includes the block, set the weekly estimate in every week of the block so the athlete can see the progression. Be realistic: consistent completed load supports small gains, a deload or a missed week holds or reduces the estimate, and you never invent a large jump. When the profile states no FTP, set every session, week, and block week estimate to null and do not invent one.`,
  `Set "estimatedTss" on every workout, including recorded activities and today's and tomorrow's sessions, to your best estimate of its training stress score (a positive number; 0 on rest days). Use the session's duration and intensity, the athlete's FTP when known, and any recorded power or heart-rate data.`,
  TSS_ESTIMATE_GUIDE,
  "When measured power is available the app recalculates the number from the recorded effort and the estimated FTP.",
);

/**
 * The rules every plan prompt includes regardless of the level it builds or
 * updates. Keeping them in one fragment means the plan prompts share the same
 * persona, input reading, rationale and body-metric behaviour without listing
 * them separately.
 */
export const PLAN_PROMPT_GLOBAL_RULES = `You are an expert endurance coach.

Use state of the art training science to make the best possible plan for the athlete.

You receive the athlete's profile, recent activities with coach analyses, program reviews, and coach replies, manually recorded activities, comments on activities, a general weekly note, and coach summaries of completed weeks and blocks with the athlete's feedback on them. Use all of these to understand the athlete's goal, available time, experience, preferences, constraints, and subjective feedback, and to see what they actually completed or missed and how they responded.

A comment on an activity describes that same activity. It is not an additional activity and must never be added on top of the activity's recorded time or treated as extra training.

Respect the athlete's available time and constraints. The weekly note is a hard constraint: if it says the athlete cannot train on a specific day, move or cancel the session on that day. If a manually recorded activity indicates significant fatigue or extra load, adjust the upcoming sessions accordingly.

Do not invent facts that are not in the input. When an important detail is missing, make a conservative assumption and state it briefly in the relevant focus or description.

Every "rationale" field explains the plan as it stands, not the act of creating or revising it. Explain why this goal, season shape, block, week, session, or rest day is right for the athlete from this point forward, using the latest training and feedback. Do not describe a previous plan, what changed, or why it was revised. Do not write phrases such as "we adjusted", "we changed", "this replaces", or "because of the new review". State the current rationale directly.

When the profile, a weekly note, an activity comment, or another part of the input states the athlete's body weight or body-fat percentage, report it in "bodyMetrics" as { "date": "YYYY-MM-DD", "weightKg": number, "bodyFatPercent": number }.

Give body weight in kilograms and body fat as a percentage of body weight; convert a stated weight in pounds or stone. A fraction such as 0.245 and "24.5 %" both mean 24.5 % body fat.

Use the date the statement refers to. For a number in the profile that names no date, use the date the profile was last saved; for anything added more recently, use today's date. Set a value the input does not give to null, and return an empty "bodyMetrics" array when the input says nothing about either number.

Report only numbers the athlete states in the input. Never infer or guess a measurement from training data, a workout summary, the training plan, or earlier coach notes, never estimate a weigh-in from the workout data, and never turn a goal into a measurement.

The stored history tells you what is already known; do not repeat a value for the same date.`;

/** The exact enum values the plan schemas accept for a session. */
export const ENUM_RULES = `For every type field use either "workout" or "rest"; for every intensity field use "easy", "moderate", "hard", or "rest". For a rest session set both type and intensity to "rest"; for a workout set type to "workout" and intensity to "easy", "moderate", or "hard". These are exact, lowercase strings: never output a session name such as "run", "strength", or "rest day" as a type, and never copy the "|" choices from the contract into the response.`;

/** The JSON-only output rule shared by every structured prompt. */
export const JSON_ONLY_RULES = `Do not add markdown fences, headings, explanations, commentary, or extra fields.`;

/**
 * The plain-text output rule shared by the coaching replies and reviews.
 */
export const PLAIN_TEXT_RULES = `Do not use headings, bullets, or markdown. Do not invent activities or results you were not given.`;

/** The full JSON output rule for the plan prompts. */
export const JSON_RULES = promptSections(
  "Return only a single valid JSON object with exactly this shape.",
  JSON_ONLY_RULES,
  `Every field must use the exact name and value type shown in the contract. The top-level keys must be exactly the keys shown at the top level of the contract, with the same nesting; never return a bare inner object, an array, or a wrapper such as "plan" or "response". When a contract lists choices separated by "|", output exactly one of those choices as a string and never the list itself. Replace every placeholder such as "YYYY-MM-DD", "string", or 0 with a real value.`,
);

/** The structured power targets shared by the day and week session contracts. */
export const BIKE_WORKOUT_CONTRACT = `{ "ftpWatts": 0, "intervals": [{ "durationSeconds": 0, "powerPercent": 75 }] }`;

export const DAY_CONTRACT = `{
  "date": "YYYY-MM-DD",
  "type": "workout | rest",
  "title": "string",
  "description": "string",
  "durationMinutes": 0,
  "intensity": "easy | moderate | hard | rest",
  "status": "completed | partial | planned | missed | rest",
  "alternatives": ["string"],
  "rationale": "string",
  "optional": false,
  "optionalRationale": "string",
  "estimatedTss": 0,
  "outdoor": true,
  "canBeOutdoor": true,
  "bikeWorkout": ${BIKE_WORKOUT_CONTRACT}
}`;

export const WEEK_CONTRACT = `{
  "startDate": "YYYY-MM-DD",
  "focus": "string",
  "rationale": "string",
  "estimatedFtpWatts": 0,
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "day": "Monday",
      "type": "workout | rest",
      "title": "string",
      "description": "string",
      "durationMinutes": 0,
      "intensity": "easy | moderate | hard | rest",
      "status": "completed | partial | planned | missed | rest",
      "estimatedTss": 0,
      "estimatedFtpWatts": 0,
      "outdoor": true,
      "canBeOutdoor": true,
      "bikeWorkout": ${BIKE_WORKOUT_CONTRACT}
    }
  ]
}`;

export const BLOCK_CONTRACT = `{
  "name": "string",
  "focus": "string",
  "rationale": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "weeks": [
    {
      "number": 1,
      "startDate": "YYYY-MM-DD",
      "focus": "string",
      "targetLoad": "string",
      "estimatedFtpWatts": 0
    }
  ]
}`;

export const SEASON_CONTRACT = `{
  "goal": "string",
  "rationale": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "blocks": [
    {
      "name": "string",
      "focus": "string",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "weekCount": 0
    }
  ]
}`;

/** One dated body-composition point in a plan response. */
export const BODY_METRIC_POINT_CONTRACT = `{ "date": "YYYY-MM-DD", "weightKg": 0, "bodyFatPercent": 0 }`;

/**
 * The activity-type caveat shared by both activity reviews: the device label
 * is not evidence of what the session actually was.
 */
export const ACTIVITY_TYPE_RULE = `The activity type recorded by the device is only a label and may be wrong: do not trust it. If the heart-rate data looks erratic — sudden spikes or drops that do not fit the steady effort the summary suggests — this may be a strength-training workout even when the device labelled it as running, cycling, or another endurance activity.`;

/** The FTP estimate every activity review reports when the effort supports one. */
export const ACTIVITY_FTP_ESTIMATE_RULES = `Also estimate the athlete's FTP after this workout when the recorded effort supports it. Use the supplied FTP history as the baseline, respect its trend, and never invent a large jump. Set "estimatedFtpWatts" to null when the activity gives no useful evidence (for example a rest day, a strength session, or a workout with no power or hard aerobic effort).`;

/**
 * The body-composition fields every activity review reports when the athlete's
 * comment states them.
 */
export const ACTIVITY_BODY_METRIC_RULES = promptSections(
  `When the athlete's comment on this activity states their body weight or body-fat percentage, report it in "weightKg" and "bodyFatPercent".`,
  ONLY_STATED_NUMBERS_RULE,
);

/** The shared closing instruction for prompts that return JSON. */
export const RETURN_JSON_FROM_SYSTEM_PROMPT =
  "Return the JSON object described in the system prompt.";

/**
 * The sentence that names the exact top-level keys a plan response must use.
 * Kept as a helper so every plan prompt spells the response keys the same way.
 */
export function jsonTopLevelKeys(keys: readonly string[]): string {
  const quoted = keys.map((key) => `"${key}"`);
  const list =
    quoted.length <= 1
      ? (quoted[0] ?? "")
      : quoted.length === 2
        ? `${quoted[0]} and ${quoted[1]}`
        : `${quoted.slice(0, -1).join(", ")}, and ${quoted.at(-1)}`;
  return `Return one JSON object whose top-level keys are exactly ${list}.`;
}

/** The JSON contract shared by the activity and program reviews. */
export const COACH_ANALYSIS_RESPONSE_RULES = promptSections(
  `Return only one JSON object with exactly this shape:
{
  "analysis": "string",
  "estimatedFtpWatts": 0,
  "weightKg": 0,
  "bodyFatPercent": 0
}`,
  `Replace "estimatedFtpWatts" with the integer estimate in watts, or null when there is no useful evidence. Set "weightKg" to the athlete's body weight in kilograms and "bodyFatPercent" to their body fat as a percentage only when the input for this activity states them, and to null otherwise. Put the whole coach summary in "analysis".`,
  JSON_ONLY_RULES,
);
