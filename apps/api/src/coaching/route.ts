import type { ActivitySample, RoutePoint } from "@killingit/shared";

/** Enough detail for a readable preview without bloating the cached feed. */
export const MAX_ROUTE_POINTS = 500;

/**
 * Extracts GPS positions from an activity's timeseries and downsamples them to
 * a bounded route preview. Samples without both coordinates are ignored, as are
 * non-finite values.
 */
export function routeFromSamples(
  samples: readonly ActivitySample[],
  maxPoints: number = MAX_ROUTE_POINTS,
): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (const sample of samples) {
    if (sample.latitude === undefined || sample.longitude === undefined) {
      continue;
    }
    if (
      !Number.isFinite(sample.latitude) ||
      !Number.isFinite(sample.longitude)
    ) {
      continue;
    }
    points.push({
      latitude: sample.latitude,
      longitude: sample.longitude,
    });
  }

  if (maxPoints <= 1 || points.length <= maxPoints) {
    return points.slice(0, Math.max(0, maxPoints));
  }

  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: RoutePoint[] = [];
  let previousIndex = -1;
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * step);
    if (sourceIndex === previousIndex) {
      continue;
    }
    const point = points[sourceIndex];
    if (point !== undefined) {
      sampled.push(point);
      previousIndex = sourceIndex;
    }
  }
  return sampled;
}
