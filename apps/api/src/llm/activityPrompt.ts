import { cadenceUnit } from "@killingit/shared";
import type {
  Activity,
  ActivitySample,
  DayPlan,
  MetricPoint,
  ThresholdSummary,
  WeekPlan,
} from "@killingit/shared";
import { downsample } from "../lib/downsample.js";
import { weekCovers, weekEnd } from "../plans/periods.js";
import { formatDuration } from "./duration.js";
import {
  formatActivitySummary,
  formatDayPlan,
  formatFtpContext,
  formatThresholdContext,
  formatWeekPlan,
} from "./planContext.js";
import {
  ACTIVITY_BODY_METRIC_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_TYPE_RULE,
  COACH_ANALYSIS_RESPONSE_RULES,
  GLOBAL_PROMPT_RULES,
  PLAIN_TEXT_RULES,
  promptSections,
  RETURN_JSON_FROM_SYSTEM_PROMPT,
} from "./promptRules.js";

export { formatDuration } from "./duration.js";

/** Upper bound on time-series rows sent to the model (keeps prompts small). */
export const MAX_PROMPT_SAMPLES = 90;

/**
 * Bump when the prompt or generation parameters change materially. Cached
 * analyses from an older version are ignored and regenerated.
 */
export const ANALYSIS_PROMPT_VERSION = 9;

/**
 * The athlete's current week, used to match an activity to its planned session
 * when the activity happened inside that week.
 */
export interface ActivityAnalysisContext {
  today: string;
  week: WeekPlan;
  /** The detailed plan for today, when the activity happened today. */
  todayPlan?: DayPlan;
  /** The detailed plan for tomorrow, when the activity happened tomorrow. */
  tomorrowPlan?: DayPlan | null;
  /** The stored FTP time series, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The FTP in effect on the activity date, when known. */
  currentFtpWatts?: number | null;
  /** Every threshold measure in effect on the activity date. */
  thresholds?: readonly ThresholdSummary[];
}

const ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Review one completed workout for an amateur athlete.",
  ACTIVITY_TYPE_RULE,
  "When the athlete's current week plan is provided and the workout happened within that week, match the workout to the planned session it best fits, then make how well it fit the plan part of the same summary. If it followed the plan reasonably well, say so warmly and encouragingly. If it did not, point out clearly what could be improved without being harsh. When the workout happened outside the supplied week, do not match it to any planned session and do not compare it to the plan; the athlete may have older activities that have not been analysed yet, so analyse the workout on its own merits.",
  "Be brief and to the point: use 2-3 sentences of plain text, cite only the most useful numbers, and finish with one actionable recommendation for the next session. Do not add a separate plan-fit section.",
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_BODY_METRIC_RULES,
  PLAIN_TEXT_RULES,
  COACH_ANALYSIS_RESPONSE_RULES,
);

type NumericChannel =
  | "heartRate"
  | "power"
  | "temperature"
  | "speed"
  | "distance"
  | "elevation"
  | "cadence";

interface ChannelDefinition {
  key: NumericChannel;
  /** Label used in the aggregate statistics. */
  name: string;
  /** Label (with unit) used in the time-series table header. */
  label: string;
  /** Renders the value in the time-series table. */
  display: (value: number) => string;
  /** Renders the value in the aggregate statistics. */
  stat: (value: number) => string;
}

const CHANNELS: ChannelDefinition[] = [
  {
    key: "distance",
    name: "distance",
    label: "distance km",
    display: (v) => (v / 1000).toFixed(2),
    stat: (v) => `${(v / 1000).toFixed(2)} km`,
  },
  {
    key: "heartRate",
    name: "heart rate",
    label: "HR bpm",
    display: (v) => `${Math.round(v)}`,
    stat: (v) => `${Math.round(v)} bpm`,
  },
  {
    key: "power",
    name: "power",
    label: "power W",
    display: (v) => `${Math.round(v)}`,
    stat: (v) => `${Math.round(v)} W`,
  },
  {
    key: "speed",
    name: "speed",
    label: "speed km/h",
    display: (v) => (v * 3.6).toFixed(1),
    stat: (v) => `${(v * 3.6).toFixed(1)} km/h`,
  },
  {
    key: "cadence",
    name: "cadence",
    label: "cadence rpm",
    display: (v) => `${Math.round(v)}`,
    stat: (v) => `${Math.round(v)} rpm`,
  },
  {
    key: "elevation",
    name: "elevation",
    label: "elevation m",
    display: (v) => `${Math.round(v)}`,
    stat: (v) => `${Math.round(v)} m`,
  },
  {
    key: "temperature",
    name: "temperature",
    label: "temp °C",
    display: (v) => `${v.toFixed(1)}`,
    stat: (v) => `${v.toFixed(1)} °C`,
  },
];

export interface ChannelStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/** The time-series column label, including the unit for the activity type. */
function channelLabel(
  channel: ChannelDefinition,
  activityType: string,
): string {
  return channel.key === "cadence"
    ? `cadence ${cadenceUnit(activityType)}`
    : channel.label;
}

/** An aggregate value with its unit, matching the activity's cadence unit. */
function channelStat(
  channel: ChannelDefinition,
  value: number,
  activityType: string,
): string {
  return channel.key === "cadence"
    ? `${Math.round(value)} ${cadenceUnit(activityType)}`
    : channel.stat(value);
}

/**
 * Picks at most `maxSamples` samples spread evenly across the activity,
 * always keeping the first and last recorded point.
 */
export function downsampleSamples(
  samples: readonly ActivitySample[],
  maxSamples = MAX_PROMPT_SAMPLES,
): ActivitySample[] {
  return downsample(samples, maxSamples);
}

/** Min/avg/max for one numeric channel, or null when it was not recorded. */
export function channelStats(
  samples: readonly ActivitySample[],
  key: NumericChannel,
): ChannelStats | null {
  const values = samples
    .map((sample) => sample[key])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  let min = values[0] ?? 0;
  let max = min;
  let sum = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, avg: sum / values.length, count: values.length };
}

/**
 * Builds the chat messages that ask the coach to analyse one activity. The
 * prompt includes the current week plan when available, the summary, aggregate
 * channel stats, and a downsampled time-series table so the model can inspect
 * how the workout unfolded.
 */
export function buildActivityAnalysisMessages(
  activity: Activity,
  context?: ActivityAnalysisContext,
): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content: buildActivityAnalysisPrompt(activity, context) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildActivityAnalysisPrompt(
  activity: Activity,
  context?: ActivityAnalysisContext,
): string {
  const shown = downsampleSamples(activity.samples);
  const activityDate = activity.startDate.slice(0, 10);
  const inWeek = context ? weekCovers(context.week, activityDate) : false;
  const detailedPlan =
    context?.todayPlan?.date === activityDate
      ? context.todayPlan
      : context?.tomorrowPlan?.date === activityDate
        ? context.tomorrowPlan
        : null;
  const lines: string[] = [];

  if (context) {
    lines.push(
      `Today's date: ${context.today}`,
      "",
      "Current week plan:",
      formatWeekPlan(context.week),
      "",
    );
    if (detailedPlan) {
      lines.push(
        `Detailed planned session for ${activityDate}:`,
        formatDayPlan(detailedPlan),
        "",
      );
    }
    lines.push(
      inWeek
        ? `The workout happened on ${activityDate}, within the current week. Match it to the planned session for that date, or another session this week that fits the data.`
        : `The workout happened on ${activityDate}, outside the current week (${context.week.startDate} to ${weekEnd(context.week)}). Do not match it to a planned session in the current week or comment on how it fit the plan; it is an older activity that has not been analysed yet, so analyse it on its own merits.`,
      "",
    );
    if (
      context.currentFtpWatts !== undefined &&
      context.currentFtpWatts !== null
    ) {
      lines.push(`Current FTP: ${context.currentFtpWatts} W`, "");
    }
    if (context.ftpHistory !== undefined && context.ftpHistory.length > 0) {
      lines.push(...formatFtpContext(context.ftpHistory), "");
    }
    if (context.thresholds !== undefined && context.thresholds.length > 0) {
      lines.push(...formatThresholdContext(context.thresholds), "");
    }
  }

  lines.push(
    "Activity summary:",
    ...formatActivitySummary(activity, activity.samples.length),
  );

  const statsLines: string[] = [];
  for (const channel of CHANNELS) {
    const stats = channelStats(activity.samples, channel.key);
    if (stats) {
      statsLines.push(
        `- ${channel.name}: avg ${channelStat(channel, stats.avg, activity.type)}, min ${channelStat(channel, stats.min, activity.type)}, max ${channelStat(channel, stats.max, activity.type)}`,
      );
    }
  }
  if (statsLines.length > 0) {
    lines.push("", "Aggregate values:", ...statsLines);
  }

  lines.push("", "Time series:");
  if (shown.length === 0) {
    lines.push("No time-series samples were recorded for this activity.");
  } else {
    const present = CHANNELS.filter((channel) =>
      shown.some((sample) => Number.isFinite(sample[channel.key])),
    );
    const start = Date.parse(shown[0]?.timestamp ?? activity.startDate);
    const header = [
      "elapsed",
      ...present.map((channel) => channelLabel(channel, activity.type)),
    ].join(" | ");
    lines.push(header);

    for (const sample of shown) {
      const elapsed = Math.max(
        0,
        (Date.parse(sample.timestamp) - start) / 1000,
      );
      const values = present.map((channel) => {
        const value = sample[channel.key];
        return Number.isFinite(value) ? channel.display(value as number) : "–";
      });
      lines.push([formatDuration(elapsed), ...values].join(" | "));
    }

    if (activity.samples.length > shown.length) {
      lines.push(
        `(${shown.length} of ${activity.samples.length} samples shown, evenly spaced.)`,
      );
    }
  }

  lines.push(
    "",
    context
      ? inWeek
        ? "Write the brief coach summary. Include how well the workout fit its planned session and cite only the most useful evidence."
        : "Write the brief coach summary. Do not compare the workout to the current week plan; cite only the most useful evidence."
      : "Write the brief coach summary, citing only the most useful evidence.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
