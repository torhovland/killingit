import { ATHLETE, GRAVEL_RACE } from "./config.js";
import type { BikeCourse, BikePrediction, HalfPrediction } from "./types.js";

const GRAVITY_MPS2 = 9.80665;
/** The share of FTP a rider can hold for a three-hour race. */
const RACE_INTENSITY_FACTOR = 0.97;
/** A tapered athlete is about one percent faster than the same fitness mid-block. */
export const FRESHNESS_FACTOR = 1.01;
/** Half-marathon pace relative to threshold pace. */
const HALF_MARATHON_PACE_FACTOR = 1.04;
const HALF_MARATHON_KM = 21.0975;
/** Chronic load at which the athlete is assumed to have regained the prior peak. */
export const CTL_FULL_REGAIN = 55;
/** Diminishing returns as chronic load approaches the full-regain point. */
export const REGAIN_EXPONENT = 0.8;

/**
 * The gravel course. The rolling 1,170 m is modelled as an average grade, and
 * the drivetrain loss is kept separate from the rolling resistance. A rider in
 * a group gets an effective power gain rather than a separately modelled draft.
 */
export const GRAVEL_COURSE: BikeCourse = {
  distanceMeters: GRAVEL_RACE.distanceMeters,
  elevationMeters: GRAVEL_RACE.elevationMeters ?? 0,
  systemMassKg: ATHLETE.weightKg + 8,
  cda: 0.385,
  crr: 0.0055,
  airDensity: 1.2,
  drivetrainEfficiency: 0.97,
  draftPowerFactor: 1.1,
};

/**
 * The average power needed to hold one speed on the course. Gravity is applied
 * as the average grade; the aero and rolling terms are speed-dependent, so the
 * result is a conservative steady-state approximation, not a lap simulation.
 */
function averagePowerForSpeed(speedMps: number, course: BikeCourse): number {
  const grade = course.elevationMeters / course.distanceMeters;
  const mass = course.systemMassKg;
  const rolling = course.crr * mass * GRAVITY_MPS2;
  const aero = 0.5 * course.airDensity * course.cda * speedMps * speedMps;
  const climbing = mass * GRAVITY_MPS2 * grade;
  return ((rolling + aero + climbing) * speedMps) / course.drivetrainEfficiency;
}

/** The speed one average power holds, found by bisection on a monotonic curve. */
export function speedForAveragePower(
  powerWatts: number,
  course: BikeCourse,
): number {
  let low = 1;
  let high = 25;
  for (let step = 0; step < 80; step += 1) {
    const middle = (low + high) / 2;
    if (averagePowerForSpeed(middle, course) < powerWatts) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function bikeTimeSeconds(
  averagePowerWatts: number,
  course: BikeCourse,
): number {
  return (
    course.distanceMeters / speedForAveragePower(averagePowerWatts, course)
  );
}

/** Predicts the race from the athlete's FTP, solo and in a group. */
export function bikePrediction(
  ftpWatts: number,
  freshness = FRESHNESS_FACTOR,
  course = GRAVEL_COURSE,
): BikePrediction {
  const racePower = Math.max(1, ftpWatts) * freshness * RACE_INTENSITY_FACTOR;
  const soloSeconds = bikeTimeSeconds(racePower, course);
  const draftSeconds = bikeTimeSeconds(
    racePower * course.draftPowerFactor,
    course,
  );
  return { soloSeconds, draftSeconds };
}

/** The FTP that makes the target time on this course under the given help. */
export function requiredFtpForTime(
  targetSeconds: number,
  freshness = FRESHNESS_FACTOR,
  course = GRAVEL_COURSE,
): { solo: number; draft: number } {
  const speed = course.distanceMeters / targetSeconds;
  return {
    solo: requiredFtpForSpeed(speed, course, freshness, 1),
    draft: requiredFtpForSpeed(
      speed,
      course,
      freshness,
      course.draftPowerFactor,
    ),
  };
}

function requiredFtpForSpeed(
  speedMps: number,
  course: BikeCourse,
  freshness: number,
  powerFactor: number,
): number {
  return (
    averagePowerForSpeed(speedMps, course) /
    (RACE_INTENSITY_FACTOR * freshness * powerFactor)
  );
}

/** Predicts a half marathon from threshold pace, at the given freshness. */
export function halfMarathonPrediction(
  runThresholdSecPerKm: number,
  freshness = FRESHNESS_FACTOR,
): HalfPrediction {
  return {
    seconds:
      (HALF_MARATHON_KM * runThresholdSecPerKm * HALF_MARATHON_PACE_FACTOR) /
      freshness,
    requiredThresholdSecPerKm:
      (2 * 60 * 60 * freshness) /
      (HALF_MARATHON_KM * HALF_MARATHON_PACE_FACTOR),
  };
}
