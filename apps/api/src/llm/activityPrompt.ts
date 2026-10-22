import type { Activity, ActivitySample, WeekPlan } from "@killingit/shared";
import { formatDuration } from "./duration.js";
import { formatWeekPlan } from "./planContext.js";

export { formatDuration } from "./duration.js";

/** Upper bound on time-series rows sent to the model (keeps prompts small). */
export const MAX_PROMPT_SAMPLES = 90;

/**
 * Bump when the prompt or generation parameters change materially. Cached
 * analyses from an older version are ignored and regenerated.
 */
export const ANALYSIS_PROMPT_VERSION = 3;

/** The athlete's current week, used to match an activity to its planned session. */
export interface ActivityAnalysisContext {
  today: string;
  week: WeekPlan;
}

const ANALYSIS_SYSTEM_PROMPT = `You are an experienced endurance coach reviewing one completed workout for an amateur athlete.
The activity type recorded by the device is only a label and may be wrong: do not trust it. If the heart-rate data looks erratic — sudden spikes or drops that do not fit the steady effort the summary suggests — this may be a strength-training workout even when the device labelled it as running, cycling, or another endurance activity. Use the duration, distance, heart-rate shape, cadence, and power to decide what the athlete actually did.
When the athlete's current week plan is provided, first match the workout to a planned session: the session planned for the workout's date, today's planned session, or any other session this week whose type, duration, intensity, and effort pattern fit. Say which planned session you think it is and why, or say clearly that it does not match any planned session. Then analyse the workout in that context, using the summary and the recorded time series. Comment on pacing and effort distribution, heart-rate response (including drift if visible), power, cadence, elevation, and anything else the data shows. Be specific and cite numbers from the data.
Finish with one clear, actionable recommendation for the next session.
Reply with 3-5 sentences of plain text. Do not use headings, bullets, or markdown.`;

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

/**
 * Picks at most `maxSamples` samples spread evenly across the activity,
 * always keeping the first and last recorded point.
 */
export function downsampleSamples(
  samples: readonly ActivitySample[],
  maxSamples = MAX_PROMPT_SAMPLES,
): ActivitySample[] {
  if (samples.length <= maxSamples) {
    return [...samples];
  }
  if (maxSamples <= 1) {
    return samples[0] === undefined ? [] : [samples[0]];
  }

  const step = (samples.length - 1) / (maxSamples - 1);
  const picked: ActivitySample[] = [];
  for (let i = 0; i < maxSamples; i++) {
    const sample = samples[Math.round(i * step)];
    if (sample !== undefined) {
      picked.push(sample);
    }
  }
  return picked;
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
  const lines: string[] = [];

  if (context) {
    lines.push(
      `Today's date: ${context.today}`,
      "",
      "Current week plan:",
      formatWeekPlan(context.week),
      "",
      `The workout happened on ${activityDate}. Match it to the planned session for that date, today's planned session, or another session this week that fits the data.`,
      "",
    );
  }

  lines.push(
    "Activity summary:",
    `- Name: ${activity.name}`,
    `- Type (recorded by the device; may be wrong): ${activity.type}`,
    `- Started: ${activity.startDate}`,
    `- Distance: ${(activity.distance / 1000).toFixed(2)} km`,
    `- Moving time: ${formatDuration(activity.movingTime)}, elapsed time: ${formatDuration(activity.elapsedTime)}`,
    `- Elevation gain: ${Math.round(activity.totalElevationGain)} m`,
    `- Recorded samples: ${activity.samples.length}`,
  );

  const statsLines: string[] = [];
  for (const channel of CHANNELS) {
    const stats = channelStats(activity.samples, channel.key);
    if (stats) {
      statsLines.push(
        `- ${channel.name}: avg ${channel.stat(stats.avg)}, min ${channel.stat(stats.min)}, max ${channel.stat(stats.max)}`,
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
    const header = ["elapsed", ...present.map((channel) => channel.label)].join(
      " | ",
    );
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
      ? "Write the coach analysis, naming the planned session you matched and citing the time-series evidence where relevant."
      : "Write the coach analysis, citing the time-series evidence where relevant.",
  );
  return lines.join("\n");
}
