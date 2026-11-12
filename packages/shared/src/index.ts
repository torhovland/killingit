import { z } from "zod";

/**
 * The shared package barrel. Every module is re-exported wholesale, so a new
 * shared symbol needs no edit here. Two modules must never export the same
 * name: `date.ts` owns `planDateSchema`, and the other modules import it from
 * there instead of re-exporting it.
 */

/** A simple heartbeat response, used for health checks across services. */
export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type Health = z.infer<typeof healthSchema>;

/** A placeholder greeting payload for the wiring smoke test. */
export const greetingSchema = z.object({
  message: z.string(),
});

export type Greeting = z.infer<typeof greetingSchema>;

export * from "./activity.js";
export * from "./apiVersion.js";
export * from "./athleteIdentity.js";
export * from "./calendar.js";
export * from "./coachQuestion.js";
export * from "./date.js";
export * from "./diet.js";
export * from "./duration.js";
export * from "./event.js";
export * from "./fitness.js";
export * from "./garminConnection.js";
export * from "./health.js";
export * from "./llm.js";
export * from "./metrics.js";
export * from "./plan.js";
export * from "./questions.js";
export * from "./review.js";
export * from "./trainingLoad.js";
export * from "./user.js";
export * from "./wallClock.js";
export * from "./weather.js";
export * from "./workout.js";
