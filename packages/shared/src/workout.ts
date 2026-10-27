import { z } from "zod";

/**
 * One steady block of a structured indoor bike workout. Power is expressed as a
 * percentage of FTP so the same workout can be exported to a trainer app
 * without needing the athlete's absolute wattage.
 */
export const bikeWorkoutIntervalSchema = z.object({
  /** How long the block lasts. */
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(6 * 60 * 60),
  /** Target power as a percentage of FTP (75 = 75%). */
  powerPercent: z.number().positive().max(300),
});

export type BikeWorkoutInterval = z.infer<typeof bikeWorkoutIntervalSchema>;

/**
 * Structured power targets for an indoor bike session. The coach only supplies
 * this when it prescribes a trainer workout with explicit power; other sessions
 * leave it out.
 */
export const bikeWorkoutSchema = z.object({
  /** The FTP the coach used to prescribe the percentages. */
  ftpWatts: z.number().int().positive().max(2000),
  intervals: z.array(bikeWorkoutIntervalSchema).min(1).max(40),
});

export type BikeWorkout = z.infer<typeof bikeWorkoutSchema>;

/** The session fields needed to decide whether it can be exported. */
export interface BikeWorkoutSession {
  type: "workout" | "rest";
  outdoor?: boolean | undefined;
  bikeWorkout?: BikeWorkout | null | undefined;
}

/**
 * Whether a session is an indoor bike workout with power targets. That is the
 * only kind of session that can be turned into a trainer workout file.
 */
export function hasExportableBikeWorkout<T extends BikeWorkoutSession>(
  session: T,
): session is T & { bikeWorkout: BikeWorkout } {
  return (
    session.type === "workout" &&
    session.outdoor === false &&
    session.bikeWorkout != null
  );
}
