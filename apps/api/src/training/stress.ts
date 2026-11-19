import {
  addDays,
  type ActivitySample,
  type BikeWorkout,
  type TrainingLoad,
} from "@killingit/shared";

/**
 * The training-load maths: normalized power, training stress scores and the
 * day-by-day exponentially weighted load. Only the API computes these; the
 * shared package keeps the `trainingLoadSchema` the wire contract carries and
 * the form interpretation both sides read. See ADR 0055.
 */

/** Time constant of the acute (fatigue) load. */
const ATL_DAYS = 7;
/** Time constant of the chronic (fitness) load. */
export const CTL_DAYS = 42;

/**
 * Window used to normalize power before scoring it. A 30-second window removes
 * short spikes while keeping the sustained effort that matters for TSS.
 */
const POWER_WINDOW_SECONDS = 30;

/** Reasonable bounds for an activity's samples; the API caps at six hours. */
const MAX_POWER_SECONDS = 6 * 60 * 60;

/**
 * Training stress score for `hours` at `intensityFactor`, where one hour at the
 * threshold (an intensity factor of 1) scores 100. The value is unrounded so a
 * caller can sum intervals before rounding once.
 */
export function trainingStressScore(
  hours: number,
  intensityFactor: number,
): number {
  return hours * intensityFactor ** 2 * 100;
}

/**
 * Rounds to a whole, non-negative number. TSS and power are never negative, so
 * every caller shares this rather than writing the clamp again.
 */
export function roundWholeNonNegative(value: number): number {
  return Math.max(0, Math.round(value));
}

/**
 * Training stress score for a ride with measured power. Uses normalized power
 * as the intensity factor, so a steady hour at FTP scores 100 and an hour at
 * 70% of FTP scores 49.
 */
export function powerTrainingStressScore(input: {
  durationSeconds: number;
  normalizedPowerWatts: number;
  ftpWatts: number;
}): number | null {
  if (
    !Number.isFinite(input.durationSeconds) ||
    !Number.isFinite(input.normalizedPowerWatts) ||
    !Number.isFinite(input.ftpWatts) ||
    input.durationSeconds <= 0 ||
    input.normalizedPowerWatts <= 0 ||
    input.ftpWatts <= 0
  ) {
    return null;
  }
  const intensityFactor = input.normalizedPowerWatts / input.ftpWatts;
  return roundWholeNonNegative(
    trainingStressScore(input.durationSeconds / 3600, intensityFactor),
  );
}

/**
 * Training stress score for a structured indoor bike workout. Every block is a
 * steady percentage of FTP, so the score follows directly from the intervals
 * and does not depend on an absolute FTP value.
 */
export function bikeWorkoutTrainingStressScore(workout: BikeWorkout): number {
  const total = workout.intervals.reduce(
    (sum, interval) =>
      sum +
      trainingStressScore(
        interval.durationSeconds / 3600,
        interval.powerPercent / 100,
      ),
    0,
  );
  return roundWholeNonNegative(total);
}

/**
 * Normalized power: the fourth-power mean of a 30-second rolling average of the
 * recorded power. Samples at inconsistent intervals are expanded onto a
 * one-second timeline first, so a missing sample does not distort the result.
 * Returns null when the activity has no usable power samples.
 */
function normalizedPower(samples: readonly ActivitySample[]): number | null {
  const powered = timedPowerSamples(samples);

  if (powered.length === 0) {
    return null;
  }
  const first = powered[0];
  if (first === undefined) {
    return null;
  }

  const start = first.time;
  const end = Math.min(
    powered[powered.length - 1]?.time ?? start,
    start + MAX_POWER_SECONDS,
  );
  const seconds = Math.max(1, Math.ceil(end - start) + 1);
  const perSecond = new Float64Array(seconds);

  for (let index = 0; index < powered.length; index += 1) {
    const current = powered[index];
    if (current === undefined) {
      continue;
    }
    const next = powered[index + 1];
    // Hold each sample until the next sample arrives. The final sample gets a
    // one-second contribution so a single sample still yields a value.
    const until = next === undefined ? current.time + 1 : next.time;
    const fromSecond = Math.max(0, Math.floor(current.time - start));
    const toSecond = Math.min(seconds, Math.ceil(until - start));
    for (let second = fromSecond; second < toSecond; second += 1) {
      perSecond[second] = current.power;
    }
  }

  if (seconds < POWER_WINDOW_SECONDS) {
    return roundWholeNonNegative(averagePower(powered));
  }

  let fourthPowerSum = 0;
  let windows = 0;
  for (let second = 0; second < seconds; second += 1) {
    const from = Math.max(0, second - POWER_WINDOW_SECONDS + 1);
    let sum = 0;
    for (let cursor = from; cursor <= second; cursor += 1) {
      sum += perSecond[cursor] ?? 0;
    }
    const average = sum / (second - from + 1);
    fourthPowerSum += average ** 4;
    windows += 1;
  }
  if (windows === 0) {
    return null;
  }
  return roundWholeNonNegative((fourthPowerSum / windows) ** 0.25);
}

/**
 * Mean and normalized power for an activity, or nulls when it has no usable
 * power samples. Used when the synced activity is summarized for storage.
 */
export function recordedPowerSummary(samples: readonly ActivitySample[]): {
  averagePower: number | null;
  normalizedPower: number | null;
} {
  const powered = timedPowerSamples(samples);
  if (powered.length === 0) {
    return { averagePower: null, normalizedPower: null };
  }
  return {
    averagePower: roundWholeNonNegative(averagePower(powered)),
    normalizedPower: normalizedPower(samples),
  };
}

/**
 * The first day of a load series. It starts 42 days before the earliest day
 * with a TSS, or earlier when the caller's required start is before that, so
 * the chronic load has its whole warm-up and the series still covers the range
 * its view needs. Every view uses the same rule for the same data, so the plan
 * and the charts cannot show different ATL, CTL or TSB.
 */
export function trainingLoadSeriesStart(
  tssByDate: ReadonlyMap<string, number>,
  requiredStartDate: string,
): string {
  let earliest = requiredStartDate;
  for (const date of tssByDate.keys()) {
    if (date < earliest) {
      earliest = date;
    }
  }
  return addDays(earliest, -CTL_DAYS);
}

/**
 * Builds the day-by-day training load for a date range. TSS on days without an
 * entry counts as zero (rest), which matches how an off day is scored.
 */
export function dailyTrainingLoad(input: {
  startDate: string;
  endDate: string;
  tssByDate: ReadonlyMap<string, number>;
  /** Load reached before `startDate`; defaults to zero. */
  initial?: { atl: number; ctl: number };
}): Map<string, TrainingLoad> {
  const result = new Map<string, TrainingLoad>();
  let atl = input.initial?.atl ?? 0;
  let ctl = input.initial?.ctl ?? 0;

  for (
    let date = input.startDate;
    date <= input.endDate;
    date = addDays(date, 1)
  ) {
    const tss = Math.max(0, input.tssByDate.get(date) ?? 0);
    atl += (tss - atl) / ATL_DAYS;
    ctl += (tss - ctl) / CTL_DAYS;
    result.set(date, {
      tss: roundWholeNonNegative(tss),
      atl: roundOneDecimal(atl),
      ctl: roundOneDecimal(ctl),
      tsb: roundOneDecimal(ctl - atl),
    });
  }

  return result;
}

/**
 * A duration-and-intensity estimate used when neither measured power nor the
 * coach supplies a TSS. It keeps every workout with a load number and seeds the
 * fitness history before the planned week.
 */
export function estimatedTssFromSession(session: {
  type: string;
  durationMinutes: number;
  intensity: string;
}): number {
  if (session.type === "rest") {
    return 0;
  }
  const perHour =
    session.intensity === "hard"
      ? 80
      : session.intensity === "moderate"
        ? 60
        : 40;
  return roundWholeNonNegative((session.durationMinutes / 60) * perHour);
}

/** Usable power samples paired with their timestamp in seconds. */
function timedPowerSamples(
  samples: readonly ActivitySample[],
): { time: number; power: number }[] {
  return samples
    .filter(
      (sample): sample is ActivitySample & { power: number } =>
        typeof sample.power === "number" && Number.isFinite(sample.power),
    )
    .map((sample) => ({
      time: Date.parse(sample.timestamp) / 1000,
      power: Math.max(0, sample.power),
    }))
    .filter((sample) => Number.isFinite(sample.time))
    .sort((a, b) => a.time - b.time);
}

/** Time-weighted mean power of the supplied samples, rounded to whole watts. */
function averagePower(
  samples: readonly { time: number; power: number }[],
): number {
  let weighted = 0;
  let seconds = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    if (current === undefined) {
      continue;
    }
    const next = samples[index + 1];
    const duration =
      next === undefined ? 1 : Math.max(0, next.time - current.time);
    weighted += current.power * duration;
    seconds += duration;
  }
  return seconds > 0 ? weighted / seconds : 0;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
