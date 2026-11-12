import {
  activityUsesPace,
  cadenceUnit,
  formatDuration,
  formatPace,
  paceUnitLabel,
  paceUnitMetres,
} from "@killingit/shared";
import type {
  Activity,
  ActivitySample,
  BlockPlan,
  DailyHealthPoint,
  MetricPoint,
  SeasonPlan,
  ThresholdSummary,
  WeekPlan,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { downsample } from "../lib/downsample.js";
import { weekCovers, weekEnd } from "../plans/periods.js";
import { formatDailyHealthContext } from "./healthContext.js";
import {
  formatActivitySummary,
  formatBlockPlan,
  formatBodyHistory,
  formatDietContext,
  formatFtpContext,
  formatPlannedSession,
  formatSeasonPlan,
  formatThresholdContext,
  formatWeekPlan,
  type BodyMetricHistory,
} from "./planContext.js";
import {
  ACTIVITY_BODY_METRIC_RULES,
  ACTIVITY_EXTRA_PRAISE_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_PRAISE_RULES,
  ACTIVITY_TYPE_RULE,
  COACH_ANALYSIS_RESPONSE_RULES,
  DAILY_HEALTH_RULES,
  DIET_RULES,
  DURATION_TOLERANCE_RULES,
  GLOBAL_PROMPT_RULES,
  promptSections,
  LAP_STRUCTURE_RULES,
  rollExtraPraise,
  STRENGTH_SET_RULES,
  TEXT_FORMATTING_RULES,
  RETURN_JSON_FROM_SYSTEM_PROMPT,
} from "./promptRules.js";

/** Upper bound on time-series rows sent to the model (keeps prompts small). */
export const MAX_PROMPT_SAMPLES = 90;

/**
 * Recorded with each stored analysis for provenance. Changing it does not
 * invalidate a cached analysis: only a newer athlete comment makes an analysis
 * stale, so a prompt edit or a model change does not re-bill the athlete.
 */
export const ANALYSIS_PROMPT_VERSION = 20;

/**
 * The athlete's current week, used to match an activity to its planned session
 * when the activity happened inside that week.
 */
export interface ActivityAnalysisContext {
  today: string;
  /** The current season, shown so the coach can relate the workout to its focus. */
  season?: SeasonPlan;
  /** The current block, shown so the coach can relate the workout to its focus. */
  block?: BlockPlan;
  /** The athlete's current week, when one is stored. */
  week?: WeekPlan;
  /** The stored FTP threshold history, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The FTP in effect on the activity date, when known. */
  currentFtpWatts?: number | null;
  /** Every threshold measure in effect on the activity date. */
  thresholds?: readonly ThresholdSummary[];
  /** Daily health and recovery values, filtered through the activity date. */
  dailyHealth?: readonly DailyHealthPoint[];
  /** Stored body weight and body-fat history, including Garmin weigh-ins. */
  bodyHistory?: BodyMetricHistory;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext;
}

const ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Review one completed workout for an amateur athlete.",
  ACTIVITY_TYPE_RULE,
  "When the athlete's current week plan is provided and the workout happened within that week, match the workout to the planned session for its date, or another session that week if the data fits one, then make how well it fit the plan part of the same summary. If it followed the plan reasonably well, say so warmly and encouragingly. If it did not, point out clearly what could be improved without being harsh. When the workout happened outside the supplied week, do not match it to a session in the current week and do not claim it did or did not follow a prescription; the athlete may have older activities that have not been analysed yet, so analyse the workout on its own merits, though you may relate it to the current block's focus.",
  DURATION_TOLERANCE_RULES,
  "Be brief and to the point: use 2-3 sentences for the assessment, cite only the most useful numbers, and finish with one actionable recommendation for the next session. Use a short bullet list when the session has several points worth noting. The recommendation must follow from a real improvement: when the session went to plan, build on it instead of inventing a correction. Do not add a separate plan-fit section.",
  ACTIVITY_PRAISE_RULES,
  STRENGTH_SET_RULES,
  LAP_STRUCTURE_RULES,
  DAILY_HEALTH_RULES,
  DIET_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_BODY_METRIC_RULES,
  TEXT_FORMATTING_RULES,
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

/** One channel's labels and value renderers. */
interface ChannelFormat {
  /** Label used in the aggregate statistics. */
  name: string;
  /** Label (with unit) used in the time-series table header. */
  label: string;
  /** Renders the value in the time-series table. */
  display: (value: number) => string;
  /** Renders the value in the aggregate statistics. */
  stat: (value: number) => string;
}

interface ChannelDefinition extends ChannelFormat {
  key: NumericChannel;
  /** How to read the channel for a sport that normally uses pace. */
  pace?: (activityType: string) => ChannelFormat;
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
    pace: (activityType) => {
      const unit = paceUnitLabel(activityType);
      const metres = paceUnitMetres(activityType);
      return {
        name: "pace",
        label: `pace ${unit}`,
        display: (v) => formatPace(metres / v),
        stat: (v) => `${formatPace(metres / v)} ${unit}`,
      };
    },
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

/** The pace rendering of a channel for a pace-based activity, when it has one. */
function paceFormat(
  channel: ChannelDefinition,
  activityType: string,
): ChannelFormat | null {
  return channel.key === "speed" &&
    activityUsesPace(activityType) &&
    channel.pace !== undefined
    ? channel.pace(activityType)
    : null;
}

/** The aggregate-statistics label for a channel and activity type. */
function channelName(channel: ChannelDefinition, activityType: string): string {
  return paceFormat(channel, activityType)?.name ?? channel.name;
}

/** The time-series column label, including the unit for the activity type. */
function channelLabel(
  channel: ChannelDefinition,
  activityType: string,
): string {
  const pace = paceFormat(channel, activityType);
  if (pace !== null) {
    return pace.label;
  }
  return channel.key === "cadence"
    ? `cadence ${cadenceUnit(activityType)}`
    : channel.label;
}

/** Renders a time-series value, using pace for pace-based activities. */
function channelDisplay(
  channel: ChannelDefinition,
  value: number,
  activityType: string,
): string {
  return (
    paceFormat(channel, activityType)?.display(value) ?? channel.display(value)
  );
}

/** An aggregate value with its unit, matching the activity's cadence unit. */
function channelStat(
  channel: ChannelDefinition,
  value: number,
  activityType: string,
): string {
  const pace = paceFormat(channel, activityType);
  if (pace !== null) {
    return pace.stat(value);
  }
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
 * prompt includes the current week plan when available, the athlete's comment,
 * the summary, aggregate channel stats, and a downsampled time-series table so
 * the model can inspect how the workout unfolded.
 */
export function buildActivityAnalysisMessages(
  activity: Activity,
  context?: ActivityAnalysisContext,
  comment?: string | null,
  random: () => number = Math.random,
): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildActivityAnalysisPrompt(activity, context, comment, random),
    },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildActivityAnalysisPrompt(
  activity: Activity,
  context?: ActivityAnalysisContext,
  comment?: string | null,
  random: () => number = Math.random,
): string {
  const shown = downsampleSamples(activity.samples);
  const activityDate = activity.startDate.slice(0, 10);
  const inWeek =
    context?.week !== undefined
      ? weekCovers(context.week, activityDate)
      : false;
  const plannedSession =
    inWeek && context?.week !== undefined
      ? context.week.sessions.find((session) => session.date === activityDate)
      : undefined;
  const lines: string[] = [];

  if (context) {
    lines.push(`Today's date: ${context.today}`, "");
    if (context.season !== undefined && context.block !== undefined) {
      lines.push(
        "Current season plan:",
        formatSeasonPlan(context.season),
        "",
        "Current block plan:",
        formatBlockPlan(context.block),
        "",
      );
    }
    if (context.week !== undefined) {
      if (inWeek) {
        lines.push("Current week plan:", formatWeekPlan(context.week), "");
        lines.push(
          plannedSession !== undefined
            ? `Planned session for ${activityDate}: ${formatPlannedSession(plannedSession)}. Match the workout to it.`
            : `The workout happened on ${activityDate}, within the current week, but no session was planned for that date. Match it to another session this week if its data fits one.`,
          "",
        );
      } else {
        lines.push(
          `The workout happened on ${activityDate}, outside the current week (${context.week.startDate} to ${weekEnd(context.week)}). No planned session is available for that date. Do not match it to a session in the current week and do not claim it did or did not follow a prescription; review the workout on its own merits, though you may relate it to the current block's focus.`,
          "",
        );
      }
    } else {
      lines.push(
        "No current week plan is available. Analyse the workout on its own merits and do not compare it to a planned session.",
        "",
      );
    }
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
    if (context.bodyHistory !== undefined) {
      lines.push(...formatBodyHistory(context.bodyHistory, activityDate));
    }
    if (context.dailyHealth !== undefined) {
      lines.push(
        ...formatDailyHealthContext(context.dailyHealth, activityDate, {
          today: context.today,
        }),
        "",
      );
    }
    if (context.diet !== undefined) {
      lines.push(...formatDietContext(context.diet, context.today), "");
    }
  }

  lines.push(
    "Activity summary:",
    ...formatActivitySummary(activity, activity.samples.length),
  );

  if (comment !== undefined && comment !== null && comment.trim() !== "") {
    lines.push(
      "",
      "Athlete comment on this activity (it describes this same activity, not an additional session):",
      comment.trim(),
    );
  }

  const statsLines: string[] = [];
  for (const channel of CHANNELS) {
    const stats = channelStats(activity.samples, channel.key);
    if (stats) {
      statsLines.push(
        `- ${channelName(channel, activity.type)}: avg ${channelStat(channel, stats.avg, activity.type)}, min ${channelStat(channel, stats.min, activity.type)}, max ${channelStat(channel, stats.max, activity.type)}`,
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
        return Number.isFinite(value)
          ? channelDisplay(channel, value as number, activity.type)
          : "–";
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
    ...(rollExtraPraise(random) ? [ACTIVITY_EXTRA_PRAISE_RULES, ""] : []),
    context?.week !== undefined
      ? inWeek
        ? "Write the brief coach summary. Include how well the workout fit its planned session and cite only the most useful evidence."
        : "Write the brief coach summary. Do not compare the workout to the current week plan; cite only the most useful evidence."
      : "Write the brief coach summary, citing only the most useful evidence.",
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  );
  return lines.join("\n");
}
