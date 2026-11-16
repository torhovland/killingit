import {
  activityLocalDate,
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
  WeekSession,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { downsample } from "../lib/downsample.js";
import { weekCovers, weekEnd } from "../plans/periods.js";
import { formatActivitySummary } from "./activityContext.js";
import { formatDietContext } from "./dietContext.js";
import { formatDailyHealthContext } from "./healthContext.js";
import {
  formatBlockPlan,
  formatPlannedSession,
  formatSeasonPlan,
  formatWeekPlan,
} from "./planLevelsContext.js";
import {
  formatBodyHistory,
  formatFtpContext,
  formatThresholdContext,
  type BodyMetricHistory,
} from "./profileContext.js";
import {
  ACTIVITY_BODY_METRIC_RULES,
  ACTIVITY_EXTRA_PRAISE_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  ACTIVITY_PRAISE_RULES,
  ACTIVITY_TYPE_RULE,
  ACTIVITY_WEEK_MATCH_RULES,
  COACH_ANALYSIS_RESPONSE_RULES,
  DAILY_HEALTH_RULES,
  DIET_RULES,
  DURATION_TOLERANCE_RULES,
  GLOBAL_PROMPT_RULES,
  type LlmMessage,
  promptSections,
  systemUserMessages,
  LAP_STRUCTURE_RULES,
  rollExtraPraise,
  STRENGTH_SET_RULES,
  TEXT_FORMATTING_RULES,
  RETURN_JSON_FROM_SYSTEM_PROMPT,
} from "./promptRules.js";

/** Upper bound on time-series rows sent to the model (keeps prompts small). */
const MAX_PROMPT_SAMPLES = 90;

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
  /**
   * The athlete's IANA time zone, so the activity's planned-session match,
   * health window and body history all use its local day. A missing zone reads
   * as UTC.
   */
  timezone?: string | undefined;
  /** The current season, shown so the coach can relate the workout to its focus. */
  season?: SeasonPlan | undefined;
  /** The current block, shown so the coach can relate the workout to its focus. */
  block?: BlockPlan | undefined;
  /** The athlete's current week, when one is stored. */
  week?: WeekPlan | undefined;
  /** The stored FTP threshold history, oldest first, including coach estimates. */
  ftpHistory?: readonly Pick<MetricPoint, "date" | "value" | "source">[];
  /** The FTP in effect on the activity date, when known. */
  currentFtpWatts?: number | null;
  /** Every threshold measure in effect on the activity date. */
  thresholds?: readonly ThresholdSummary[];
  /** Daily health and recovery values, filtered through the activity date. */
  dailyHealth?: readonly DailyHealthPoint[] | undefined;
  /** Stored body weight and body-fat history, including Garmin weigh-ins. */
  bodyHistory?: BodyMetricHistory | undefined;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext;
}

const ANALYSIS_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "Review one completed workout for an amateur athlete.",
  ACTIVITY_TYPE_RULE,
  ACTIVITY_WEEK_MATCH_RULES,
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
    // The unit comes from `cadenceUnit`, the single statement of the display
    // unit, which `channelLabel` and `channelStat` append.
    label: "cadence",
    display: (v) => `${Math.round(v)}`,
    stat: (v) => `${Math.round(v)}`,
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

/** The one rendering of a channel for `activityType`. */
function resolveChannel(
  channel: ChannelDefinition,
  activityType: string,
): ChannelFormat {
  if (
    channel.key === "speed" &&
    activityUsesPace(activityType) &&
    channel.pace !== undefined
  ) {
    return channel.pace(activityType);
  }
  if (channel.key === "cadence") {
    const unit = cadenceUnit(activityType);
    return {
      name: channel.name,
      label: `cadence ${unit}`,
      display: channel.display,
      stat: (value) => `${Math.round(value)} ${unit}`,
    };
  }
  return channel;
}

/** Min/avg/max for one numeric channel, or null when it was not recorded. */
function channelStats(
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
): LlmMessage[] {
  return systemUserMessages(
    ANALYSIS_SYSTEM_PROMPT,
    buildActivityAnalysisPrompt(activity, context, comment, random),
  );
}

/**
 * Where the activity falls relative to the athlete's stored week. Resolved once
 * so the week-fit paragraph and the closing instruction read the same value.
 */
type WeekFit =
  | { kind: "no-week" }
  | {
      kind: "planned";
      week: WeekPlan;
      activityDate: string;
      session: WeekSession;
    }
  | { kind: "unplanned"; week: WeekPlan; activityDate: string }
  | { kind: "outside-week"; week: WeekPlan; activityDate: string };

/**
 * The closing instruction when the workout falls inside the stored week. A date
 * without a session keeps it: the system prompt asks the coach to match another
 * session that week when the data fits one.
 */
const IN_WEEK_CLOSING =
  "Write the brief coach summary. Include how well the workout fit its planned session and cite only the most useful evidence.";

/** The closing instruction for each plan-fit state. */
const CLOSING_INSTRUCTIONS: Record<WeekFit["kind"], string> = {
  planned: IN_WEEK_CLOSING,
  unplanned: IN_WEEK_CLOSING,
  "outside-week":
    "Write the brief coach summary. Do not compare the workout to the current week plan; cite only the most useful evidence.",
  "no-week":
    "Write the brief coach summary, citing only the most useful evidence.",
};

/** Resolves where the activity falls relative to the stored week. */
function resolveWeekFit(
  activityDate: string,
  week: WeekPlan | undefined,
): WeekFit {
  if (week === undefined) {
    return { kind: "no-week" };
  }
  if (!weekCovers(week, activityDate)) {
    return { kind: "outside-week", week, activityDate };
  }
  const session = week.sessions.find(
    (candidate) => candidate.date === activityDate,
  );
  return session === undefined
    ? { kind: "unplanned", week, activityDate }
    : { kind: "planned", week, activityDate, session };
}

/** The plan-fit paragraph for the activity's place in the stored week. */
function formatWeekFit(weekFit: WeekFit): string[] {
  switch (weekFit.kind) {
    case "no-week":
      return [
        "No current week plan is available. Analyse the workout on its own merits and do not compare it to a planned session.",
        "",
      ];
    case "planned":
      return [
        "Current week plan:",
        formatWeekPlan(weekFit.week),
        "",
        `Planned session for ${weekFit.activityDate}: ${formatPlannedSession(weekFit.session)}. Match the workout to it.`,
        "",
      ];
    case "unplanned":
      return [
        "Current week plan:",
        formatWeekPlan(weekFit.week),
        "",
        `The workout happened on ${weekFit.activityDate}, within the current week, but no session was planned for that date. Match it to another session this week if its data fits one.`,
        "",
      ];
    case "outside-week":
      return [
        `The workout happened on ${weekFit.activityDate}, outside the current week (${weekFit.week.startDate} to ${weekEnd(weekFit.week)}). No planned session is available for that date. Do not match it to a session in the current week and do not claim it did or did not follow a prescription; review the workout on its own merits, though you may relate it to the current block's focus.`,
        "",
      ];
  }
}

/** Today's date plus the season, block and week context, including plan fit. */
function formatPlanContext(
  context: ActivityAnalysisContext,
  weekFit: WeekFit,
): string[] {
  const lines = [`Today's date: ${context.today}`, ""];
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
  return [...lines, ...formatWeekFit(weekFit)];
}

/** The FTP, threshold, body, health and diet context for the activity date. */
function formatAthleteContext(
  context: ActivityAnalysisContext,
  activityDate: string,
): string[] {
  const lines: string[] = [];
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
  return lines;
}

/** The activity summary the coach reviews. */
function formatSummary(activity: Activity): string[] {
  return [
    "Activity summary:",
    ...formatActivitySummary(activity, activity.samples.length),
  ];
}

/** The athlete's own description of the activity, when they wrote one. */
function formatComment(comment: string | null | undefined): string[] {
  if (comment === undefined || comment === null || comment.trim() === "") {
    return [];
  }
  return [
    "",
    "Athlete comment on this activity (it describes this same activity, not an additional session):",
    comment.trim(),
  ];
}

/** Min, average and max for each recorded channel. */
function formatAggregates(activity: Activity): string[] {
  const lines: string[] = [];
  for (const channel of CHANNELS) {
    const stats = channelStats(activity.samples, channel.key);
    if (stats === null) {
      continue;
    }
    const format = resolveChannel(channel, activity.type);
    lines.push(
      `- ${format.name}: avg ${format.stat(stats.avg)}, min ${format.stat(stats.min)}, max ${format.stat(stats.max)}`,
    );
  }
  return lines.length > 0 ? ["", "Aggregate values:", ...lines] : [];
}

/** The elapsed time and channel table for the samples sent to the model. */
function formatTimeSeries(
  activity: Activity,
  shown: readonly ActivitySample[],
): string[] {
  if (shown.length === 0) {
    return [
      "",
      "Time series:",
      "No time-series samples were recorded for this activity.",
    ];
  }
  const start = Date.parse(shown[0]?.timestamp ?? activity.startDate);
  const present = CHANNELS.filter((channel) =>
    shown.some((sample) => Number.isFinite(sample[channel.key])),
  ).map((channel) => ({
    key: channel.key,
    format: resolveChannel(channel, activity.type),
  }));
  const lines = [
    "",
    "Time series:",
    ["elapsed", ...present.map((column) => column.format.label)].join(" | "),
  ];

  for (const sample of shown) {
    const elapsed = Math.max(0, (Date.parse(sample.timestamp) - start) / 1000);
    const values = present.map(({ key, format }) => {
      const value = sample[key];
      return Number.isFinite(value) ? format.display(value as number) : "–";
    });
    lines.push([formatDuration(elapsed), ...values].join(" | "));
  }

  if (activity.samples.length > shown.length) {
    lines.push(
      `(${shown.length} of ${activity.samples.length} samples shown, evenly spaced.)`,
    );
  }
  return lines;
}

/** The closing instruction, with the occasional extra praise above it. */
function formatClosing(weekFit: WeekFit, random: () => number): string[] {
  return [
    "",
    ...(rollExtraPraise(random) ? [ACTIVITY_EXTRA_PRAISE_RULES, ""] : []),
    CLOSING_INSTRUCTIONS[weekFit.kind],
    RETURN_JSON_FROM_SYSTEM_PROMPT,
  ];
}

/**
 * Builds the user message that asks the coach to review one activity. It renders
 * the plan fit, the athlete context, the summary, the athlete's comment, the
 * aggregate channel stats and a downsampled time-series table so the model can
 * inspect how the workout unfolded.
 */
function buildActivityAnalysisPrompt(
  activity: Activity,
  context?: ActivityAnalysisContext,
  comment?: string | null,
  random: () => number = Math.random,
): string {
  const activityDate = activityLocalDate(activity, context?.timezone);
  const weekFit = resolveWeekFit(activityDate, context?.week);
  const shown = downsample(activity.samples, MAX_PROMPT_SAMPLES);
  const contextLines =
    context !== undefined
      ? [
          ...formatPlanContext(context, weekFit),
          ...formatAthleteContext(context, activityDate),
        ]
      : [];

  return [
    ...contextLines,
    ...formatSummary(activity),
    ...formatComment(comment),
    ...formatAggregates(activity),
    ...formatTimeSeries(activity, shown),
    ...formatClosing(weekFit, random),
  ].join("\n");
}
