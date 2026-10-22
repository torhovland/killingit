import { z } from "zod";

/**
 * A normalized, minimal summary of an activity from any data source (currently
 * Garmin; a future source maps into the same shape). Only the fields the
 * coaching features will need — kept intentionally small (ADR 0003
 * single-operator phase).
 */
export const activitySummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  startDate: z.string().datetime(),
  distance: z.number(),
  movingTime: z.number(),
  elapsedTime: z.number(),
  totalElevationGain: z.number(),
});

export type ActivitySummary = z.infer<typeof activitySummarySchema>;

/** One GPS point retained for the activity route preview. */
export const routePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export type RoutePoint = z.infer<typeof routePointSchema>;

/**
 * Turns a source activity key such as `indoor_cycling` into readable text
 * (`Indoor cycling`) for display. Unknown keys are still shown rather than
 * hidden, because the device's classification is the best information we have.
 */
export function formatActivityType(type: string): string {
  const words = type
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");

  if (words.length === 0) {
    return "Unknown activity";
  }

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (lower === "gps") {
        return "GPS";
      }
      return index === 0
        ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
        : lower;
    })
    .join(" ");
}

/**
 * One recorded point in an activity's timeseries. Channels are optional: a
 * sample only carries the values the device recorded at that moment.
 *
 * Units: latitude/longitude degrees, heartRate bpm, power W, temperature °C,
 * speed m/s, distance m (cumulative), elevation m, cadence rpm (bike) or
 * steps/min (run) as reported by the source.
 */
export const activitySampleSchema = z.object({
  timestamp: z.string().datetime(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  heartRate: z.number().optional(),
  power: z.number().optional(),
  temperature: z.number().optional(),
  speed: z.number().optional(),
  distance: z.number().optional(),
  elevation: z.number().optional(),
  cadence: z.number().optional(),
});

export type ActivitySample = z.infer<typeof activitySampleSchema>;

/**
 * A synced activity: the summary plus its normalized workout timeseries.
 *
 * `samples` defaults to an empty list so payloads from a sidecar older than the
 * timeseries change still parse instead of crashing the UI.
 */
export const activitySchema = activitySummarySchema.extend({
  samples: z.array(activitySampleSchema).default([]),
});

export type Activity = z.infer<typeof activitySchema>;

/** Response body of the Garmin sync endpoint (`GET /api/garmin/activities`). */
export const activitiesResponseSchema = z.object({
  activities: z.array(activitySchema),
});

export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>;
