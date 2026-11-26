import {
  BODY_MEASUREMENT_KEYS,
  dailyMeasurementSaveRequestSchema,
  dailyMeasurementSaveResponseSchema,
  dailyMeasurementsResponseSchema,
  type BodyMeasurementKey,
  type DailyMeasurementsResponse,
} from "@killingit/shared";
import { Hono } from "hono";
import { getUser } from "../auth/middleware.js";
import type { ResolvedAppDependencies } from "../dependencies.js";
import { serviceUnavailable } from "../http/errors.js";
import { zValidator } from "../http/validation.js";
import {
  loadBodyHistoryForUser,
  recordUserBodyMetrics,
} from "../metrics/store.js";
import type { BodyMetricHistory } from "../llm/profileContext.js";

/** The tracked measures, in the order the entry panel shows them. */
function trackedMetrics(history: BodyMetricHistory): BodyMeasurementKey[] {
  const hasPoint: Record<BodyMeasurementKey, boolean> = {
    weight: history.weight.length > 0,
    bodyFat: history.bodyFat.length > 0,
  };
  return BODY_MEASUREMENT_KEYS.filter((key) => hasPoint[key]);
}

/** The tracked measures as the entry panel's response. */
function toResponse(history: BodyMetricHistory): DailyMeasurementsResponse {
  return { metrics: trackedMetrics(history) };
}

/**
 * The hand-entered daily body measurements: which measures the athlete tracks,
 * and the write that replaces one day's value.
 */
export function createMeasurementsRoute(deps: ResolvedAppDependencies): Hono {
  const loadHistory = deps.loadBodyHistory ?? loadBodyHistoryForUser;
  const save = deps.recordUserBodyMetrics ?? recordUserBodyMetrics;

  return new Hono()
    .get("/", async (c) => {
      try {
        const history = await loadHistory(getUser(c).id);
        return c.json(
          dailyMeasurementsResponseSchema.parse(toResponse(history)),
        );
      } catch (err) {
        console.error("[measurements] read failure:", err);
        return serviceUnavailable(c);
      }
    })
    .put(
      "/",
      zValidator("json", dailyMeasurementSaveRequestSchema),
      async (c) => {
        const input = c.req.valid("json");
        try {
          await save(getUser(c).id, input);
          return c.json(
            dailyMeasurementSaveResponseSchema.parse({
              date: input.date,
              saved: true,
            }),
          );
        } catch (err) {
          console.error("[measurements] write failure:", err);
          return serviceUnavailable(c);
        }
      },
    );
}
