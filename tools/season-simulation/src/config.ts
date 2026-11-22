import { resolve } from "node:path";
import type {
  AthleteProfile,
  RaceGoal,
  ScenarioConfig,
  ScenarioName,
} from "./types.js";

/** The one model every prompt in both scenarios uses. */
export const MODEL_ID =
  process.env["SEASON_SIM_MODEL"] ?? "openai/gpt-6-luna-pro";

export const START_DATE = "2026-11-22";
const HALF_MARATHON_DATE = "2027-05-23";
const GRAVEL_RACE_DATE = "2027-08-22";
export const SEASON_END_DATE = "2027-08-29";

/**
 * A dedicated database: the harness rebuilds the schema before every scenario,
 * so it must never be pointed at the development or production database.
 */
export const SIM_DATABASE_URL =
  process.env["SEASON_SIM_DATABASE_URL"] ??
  "postgres://killingit:killingit@localhost:5432/killingit_season_sim";

export const OUTPUT_ROOT = resolve(
  import.meta.dir,
  "../../../benchmarks/season-simulation",
);

/** The athlete the user specified, with the prior peak used by the model. */
export const ATHLETE: AthleteProfile = {
  sex: "male",
  age: 50,
  weightKg: 85,
  heightCm: 187,
  timezone: "Europe/Oslo",
  location: {
    latitude: 63.4305,
    longitude: 10.3951,
    name: "Trondheim",
  },
  startFtpWatts: 180,
  priorFtpWatts: 285,
  startRunThresholdSecPerKm: 360,
  priorRunThresholdSecPerKm: 315,
  restingHeartRate: 55,
  maxHeartRate: 185,
  thresholdHeartRate: 168,
};

export const HALF_MARATHON: RaceGoal = {
  kind: "half",
  date: HALF_MARATHON_DATE,
  title: "Half marathon",
  targetSeconds: 2 * 60 * 60,
  distanceMeters: 21_097.5,
};

export const GRAVEL_RACE: RaceGoal = {
  kind: "gravel",
  date: GRAVEL_RACE_DATE,
  title: "100 km gravel race",
  targetSeconds: 3 * 60 * 60 + 10 * 60,
  distanceMeters: 100_000,
  elevationMeters: 1_170,
};

export const SCENARIOS: Record<ScenarioName, ScenarioConfig> = {
  full: {
    name: "full",
    label: "Compliant athlete",
    cadence: "every-session",
    description:
      "Completes every prescribed workout, including optional sessions, on its planned day.",
  },
  reduced: {
    name: "reduced",
    label: "Alternate-day athlete",
    cadence: "alternate-days",
    description:
      "Completes a prescribed workout only every second calendar day; the in-between days are not trained.",
  },
};

/**
 * The athlete profile as free text. The app stores onboarding as answers, so
 * this is the only place age, history and the two goals are stated.
 */
export const PROFILE_TEXT = [
  "I am a 50-year-old man, 187 cm and 85 kg, living in Trondheim, Norway.",
  "I trained seriously a few years ago but I am out of shape now and have not done any consistent training recently.",
  "Five years ago my cycling FTP was about 285 W; right now it is about 180 W.",
  "My running threshold pace is about 6:00 per km. I do not know my current 10 km or half-marathon time.",
  "My resting heart rate is about 55 bpm and my maximum heart rate is about 185 bpm.",
  "Five years ago I rode a 100 km gravel race with 1170 m of climbing in 3:20, with an average heart rate of 163 bpm.",
  "This season I want to run a half marathon under 2:00 on 2027-05-23, and ride a 100 km gravel race with 1170 m of climbing on 2027-08-22 in 3:10 or faster.",
  "Please plan my season from 2026-11-22 through the week ending 2027-08-29.",
  "I can train 8-10 hours a week, mostly early mornings, and I am healthy with no injuries.",
].join(" ");

export const SEASON_EVENT_TITLES = {
  half: "Half marathon, sub-2:00 goal",
  gravel: "100 km gravel race, 1170 m climbing, 3:10 goal",
} as const;

/** Refuses to drop a database that is not clearly the harness's own. */
export function assertDedicatedDatabase(databaseUrl: string): void {
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!name.endsWith("_season_sim")) {
    throw new Error(
      `Refusing to rebuild "${name}": the simulation database name must end with _season_sim.`,
    );
  }
}
