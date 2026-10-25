/** Ignore implausibly short or long observations when learning durations. */
const MIN_OBSERVED_MS = 100;
const MAX_OBSERVED_MS = 10 * 60 * 1000;

/** Weight of the newest observation. Older samples decay slowly. */
const SMOOTHING = 0.3;

/**
 * A step's displayed progress at a point in time. The bar moves from `from`
 * (the percentage it had reached when the step started) toward `target` over
 * `expectedMs`, then stops at `target` so a slow call never overshoots the next
 * step.
 */
export function progressAt(
  from: number,
  target: number,
  elapsedMs: number,
  expectedMs: number,
): number {
  if (target <= from) {
    return from;
  }
  if (expectedMs <= 0) {
    return target;
  }
  const fraction = Math.min(Math.max(elapsedMs / expectedMs, 0), 1);
  return Math.round(from + (target - from) * fraction);
}

export interface DurationSample {
  averageMs: number;
  samples: number;
}

/** Updates a step's learned duration with a newly observed one. */
export function recordDuration(
  previous: DurationSample | null,
  durationMs: number,
): DurationSample {
  const observed = Math.min(
    Math.max(durationMs, MIN_OBSERVED_MS),
    MAX_OBSERVED_MS,
  );
  if (previous === null || previous.samples <= 0 || previous.averageMs <= 0) {
    return { averageMs: observed, samples: 1 };
  }
  return {
    averageMs: Math.round(
      previous.averageMs * (1 - SMOOTHING) + observed * SMOOTHING,
    ),
    samples: previous.samples + 1,
  };
}
