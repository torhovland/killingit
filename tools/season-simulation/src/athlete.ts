import type { AnalyzedActivity, WeekSession } from "@killingit/shared";
import {
  bikePrediction,
  FRESHNESS_FACTOR,
  GRAVEL_COURSE,
  halfMarathonPrediction,
  speedForAveragePower,
} from "./course.js";
import type { AthleteProfile, Cadence, Capability, RaceGoal } from "./types.js";

const MAX_SESSION_TSS = 250;
const MIN_SESSION_TSS = 10;

/**
 * A title that names a test, time trial or rehearsal. A description is more
 * ambiguous: "test comfort near goal pace" or "without compromising the key
 * weekend rehearsal" mentions testing without prescribing one, so a
 * description needs a test noun or an explicit instruction.
 */
const TEST_TITLE_PATTERN =
  /\b(?:test|testing|time trial|tt|benchmark|rehearsal|race simulation)\b/i;
const TEST_DESCRIPTION_PATTERN =
  /\b(?:ftp|threshold|field|fitness|performance|power|pace|heart[- ]rate|lactate|vo2(?:max)?)\s+test\b|\btime trial\b|\brace (?:rehearsal|simulation)\b|\btest (?:the|your|how|whether)\b/i;

const SPORT_PATTERNS: ReadonlyArray<{ sport: string; pattern: RegExp }> = [
  {
    sport: "cycling",
    pattern: /bike|cycl|ride|trainer|gravel|pedal|sweet spot|ftp/i,
  },
  {
    sport: "running",
    pattern: /run|jog|tempo|interval|fartlek|stride|mile|10k|5k|half marathon/i,
  },
  { sport: "swimming", pattern: /swim|pool|stroke/i },
  {
    sport: "strength",
    pattern: /strength|gym|lift|core|squat|deadlift|weight|mobility/i,
  },
  { sport: "walking", pattern: /walk|hik/i },
];

/** The sport a session names in its title, falling back to its description. */
export function inferSport(session: WeekSession): string {
  const fromTitle = sportInText(session.title);
  return fromTitle ?? sportInText(session.description) ?? "other";
}

function sportInText(text: string): string | null {
  for (const entry of SPORT_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.sport;
    }
  }
  return null;
}

/**
 * Whether a workout prescribes a test. Tests are ordinary workouts, so the
 * simulation recognises one from its title or description rather than a
 * separate session type.
 */
function isTestSession(session: WeekSession): boolean {
  return (
    session.type === "workout" &&
    (TEST_TITLE_PATTERN.test(session.title) ||
      TEST_DESCRIPTION_PATTERN.test(session.description))
  );
}

/** The hardest intensity a test of this length can hold. */
function testIntensity(minutes: number): number {
  if (minutes <= 60) return 1;
  if (minutes <= 120) return 0.95;
  if (minutes <= 180) return 0.88;
  return 0.82;
}

/** The session's training stress: the coach's estimate, else an intensity rate. */
export function plannedSessionTss(session: WeekSession): number {
  if (session.type === "rest") {
    return 0;
  }
  if (session.estimatedTss !== undefined && session.estimatedTss > 0) {
    return Math.min(MAX_SESSION_TSS, Math.round(session.estimatedTss));
  }
  const perHour =
    session.intensity === "hard"
      ? 85
      : session.intensity === "moderate"
        ? 65
        : 45;
  const tss = (session.durationMinutes / 60) * perHour;
  return Math.min(MAX_SESSION_TSS, Math.max(MIN_SESSION_TSS, Math.round(tss)));
}

/** The intensity factor that turns a TSS target into a session effort. */
function intensityFromTss(tss: number, durationMinutes: number): number {
  const hours = Math.max(0.1, durationMinutes / 60);
  return Math.max(0.3, Math.min(1.1, Math.sqrt(tss / (100 * hours))));
}

/** The highest intensity a session of this length can reasonably hold. */
function sustainableIntensity(durationMinutes: number): number {
  if (durationMinutes <= 60) return 1.05;
  if (durationMinutes <= 120) return 0.95;
  if (durationMinutes <= 180) return 0.88;
  return 0.82;
}

/**
 * Whether the prescribed session looks completable at the athlete's current
 * ability. A session above the duration-adjusted intensity cap, or a workout
 * with no duration, is flagged for the report rather than silently recorded.
 */
export function checkSessionFeasibility(
  session: WeekSession,
  tss: number,
): { feasible: boolean; note: string } {
  if (session.type === "rest") {
    return { feasible: true, note: "Rest day." };
  }
  if (session.durationMinutes <= 0) {
    return { feasible: false, note: "Workout has no duration." };
  }
  const intensity = intensityFromTss(tss, session.durationMinutes);
  const cap = sustainableIntensity(session.durationMinutes);
  if (intensity > cap) {
    return {
      feasible: false,
      note: `IF ${intensity.toFixed(2)} exceeds the ${cap.toFixed(2)} cap for ${session.durationMinutes} min.`,
    };
  }
  return {
    feasible: true,
    note: `${session.durationMinutes} min at IF ${intensity.toFixed(2)}.`,
  };
}

/** Whether the scenario schedules a workout on this calendar day. */
export function isTrainingDay(
  cadence: Cadence,
  startDate: string,
  date: string,
): boolean {
  if (cadence === "every-session") {
    return true;
  }
  const elapsed = daysBetween(startDate, date);
  return elapsed % 2 === 1;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function heartRateFor(profile: AthleteProfile, intensity: number): number {
  const factor = Math.min(1, Math.max(0.55, 0.72 + 0.25 * intensity));
  return Math.round(profile.thresholdHeartRate * factor);
}

/** `m:ss /km` for the activity analysis and the run report. */
export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")} /km`;
}

function analysisText(parts: {
  title: string;
  minutes: number;
  sport: string;
  intensity: number;
  power: number | null;
  heartRate: number;
  testResult?: string | undefined;
}): string {
  const power = parts.power === null ? "" : `, NP ${String(parts.power)} W`;
  const result =
    parts.testResult === undefined ? "" : ` Test result: ${parts.testResult}.`;
  return `Completed as prescribed: ${parts.title}. ${String(parts.minutes)} min ${parts.sport}, IF ${parts.intensity.toFixed(2)}${power}, avg HR ${String(parts.heartRate)}.${result}`;
}

function activityBase(input: {
  id: number;
  name: string;
  type: string;
  date: string;
  movingTime: number;
  distance: number;
  elevation: number;
  averageHeartRate: number;
  averagePower: number | null;
  normalizedPower: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  analysis: string;
}): AnalyzedActivity {
  const startDate = `${input.date}T10:00:00.000Z`;
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    startDate,
    distance: Math.round(input.distance),
    movingTime: Math.round(input.movingTime),
    elapsedTime: Math.round(input.movingTime) + 180,
    totalElevationGain: Math.round(input.elevation),
    averagePower: input.averagePower,
    normalizedPower: input.normalizedPower,
    averageHeartRate: input.averageHeartRate,
    averageSpeed: input.averageSpeed,
    maxSpeed: input.maxSpeed,
    samples: [],
    sampleCount: 0,
    analysis: {
      text: input.analysis,
      model: "season-simulation",
      generatedAt: startDate,
      planChangeNeeded: false,
      planChangeScope: "none",
    },
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    reviewed: false,
  };
}

interface SessionActivityInput {
  session: WeekSession;
  capability: Capability;
  profile: AthleteProfile;
  id: number;
}

/** Builds the recorded activity for one completed session. */
export function buildSessionActivity(
  input: SessionActivityInput,
): AnalyzedActivity {
  const tss = plannedSessionTss(input.session);
  const minutes = Math.max(10, input.session.durationMinutes);
  const test = isTestSession(input.session);
  const plannedIntensity = intensityFromTss(tss, minutes);
  // A test measures the athlete's current level, so it is recorded at the
  // hardest effort its duration supports rather than at the planned session's
  // easy or moderate TSS.
  const intensity = test
    ? Math.min(1.05, Math.max(plannedIntensity, testIntensity(minutes)))
    : plannedIntensity;
  const sport = inferSport(input.session);
  const heartRate = heartRateFor(input.profile, intensity);

  if (sport === "cycling") {
    return cyclingActivity(input, intensity, heartRate, test);
  }
  if (sport === "running") {
    return runningActivity(input, intensity, heartRate, test);
  }
  return otherActivity(input, sport, intensity, heartRate, test);
}

function cyclingActivity(
  input: SessionActivityInput,
  intensity: number,
  heartRate: number,
  test: boolean,
): AnalyzedActivity {
  const normalizedPower = Math.round(input.capability.ftpWatts * intensity);
  const averagePower = Math.round(normalizedPower * 0.95);
  const indoor =
    input.session.canBeOutdoor === false ||
    /indoor|trainer|treadmill/i.test(input.session.title);
  const speed = indoor
    ? null
    : speedForAveragePower(normalizedPower, GRAVEL_COURSE);
  const distance =
    speed === null ? 0 : speed * (input.session.durationMinutes * 60);
  const elevation = indoor ? 0 : (distance / 100_000) * 1_170;
  return activityBase({
    id: input.id,
    name: input.session.title,
    type: "cycling",
    date: input.session.date,
    movingTime: input.session.durationMinutes * 60,
    distance,
    elevation,
    averageHeartRate: heartRate,
    averagePower,
    normalizedPower,
    averageSpeed: speed,
    maxSpeed: speed === null ? null : speed * 1.45,
    analysis: analysisText({
      title: input.session.title,
      minutes: input.session.durationMinutes,
      sport: indoor ? "indoor cycling" : "cycling",
      intensity,
      power: normalizedPower,
      heartRate,
      testResult: test
        ? `FTP ${String(Math.round(input.capability.ftpWatts))} W`
        : undefined,
    }),
  });
}

function runningActivity(
  input: SessionActivityInput,
  intensity: number,
  heartRate: number,
  test: boolean,
): AnalyzedActivity {
  const pace = input.capability.runThresholdSecPerKm / intensity;
  const movingTime = input.session.durationMinutes * 60;
  const speed = 1000 / pace;
  const distance = movingTime * speed;
  return activityBase({
    id: input.id,
    name: input.session.title,
    type: "running",
    date: input.session.date,
    movingTime,
    distance,
    elevation: distance * 0.005,
    averageHeartRate: heartRate,
    averagePower: null,
    normalizedPower: null,
    averageSpeed: speed,
    maxSpeed: speed * 1.35,
    analysis: analysisText({
      title: input.session.title,
      minutes: input.session.durationMinutes,
      sport: "running",
      intensity,
      power: null,
      heartRate,
      testResult: test
        ? `threshold pace ${formatPace(input.capability.runThresholdSecPerKm)}`
        : undefined,
    }),
  });
}

function otherActivity(
  input: SessionActivityInput,
  sport: string,
  intensity: number,
  heartRate: number,
  test: boolean,
): AnalyzedActivity {
  const movingTime = input.session.durationMinutes * 60;
  const type =
    sport === "strength"
      ? "strength_training"
      : sport === "swimming"
        ? "swimming"
        : sport === "walking"
          ? "walking"
          : "other";
  const speed = sport === "swimming" ? 1.2 : sport === "walking" ? 1.4 : null;
  const distance = speed === null ? 0 : speed * movingTime;
  return activityBase({
    id: input.id,
    name: input.session.title,
    type,
    date: input.session.date,
    movingTime,
    distance,
    elevation: sport === "walking" ? distance * 0.02 : 0,
    averageHeartRate: heartRate,
    averagePower: null,
    normalizedPower: null,
    averageSpeed: speed,
    maxSpeed: speed === null ? null : speed * 1.3,
    analysis: analysisText({
      title: input.session.title,
      minutes: input.session.durationMinutes,
      sport,
      intensity,
      power: null,
      heartRate,
      testResult: test ? "completed at the expected level" : undefined,
    }),
  });
}

/** The race-day activity, from the athlete's modelled race-day ability. */
export function buildRaceActivity(input: {
  goal: RaceGoal;
  capability: Capability;
  profile: AthleteProfile;
  id: number;
}): AnalyzedActivity {
  if (input.goal.kind === "half") {
    return halfRaceActivity(input);
  }
  return gravelRaceActivity(input);
}

function halfRaceActivity(input: {
  goal: RaceGoal;
  capability: Capability;
  profile: AthleteProfile;
  id: number;
}): AnalyzedActivity {
  const prediction = halfMarathonPrediction(
    input.capability.runThresholdSecPerKm,
    FRESHNESS_FACTOR,
  );
  const movingTime = Math.round(prediction.seconds);
  const pace = movingTime / (input.goal.distanceMeters / 1000);
  const speed = 1000 / pace;
  const met = movingTime <= input.goal.targetSeconds;
  return activityBase({
    id: input.id,
    name: input.goal.title,
    type: "running",
    date: input.goal.date,
    movingTime,
    distance: input.goal.distanceMeters,
    elevation: 100,
    averageHeartRate: Math.min(
      input.profile.maxHeartRate,
      Math.round(input.profile.thresholdHeartRate * 1.0),
    ),
    averagePower: null,
    normalizedPower: null,
    averageSpeed: speed,
    maxSpeed: speed * 1.25,
    analysis: `Race: ${input.goal.title}. Finish ${formatClock(movingTime)}, target ${formatClock(input.goal.targetSeconds)}. ${met ? "Target met." : "Target missed."}`,
  });
}

function gravelRaceActivity(input: {
  goal: RaceGoal;
  capability: Capability;
  profile: AthleteProfile;
  id: number;
}): AnalyzedActivity {
  const prediction = bikePrediction(input.capability.ftpWatts);
  const movingTime = Math.round(prediction.draftSeconds);
  const speed = input.goal.distanceMeters / movingTime;
  const met = movingTime <= input.goal.targetSeconds;
  const racePower = Math.round(
    input.capability.ftpWatts * FRESHNESS_FACTOR * 0.97,
  );
  return activityBase({
    id: input.id,
    name: input.goal.title,
    type: "cycling",
    date: input.goal.date,
    movingTime,
    distance: input.goal.distanceMeters,
    elevation: input.goal.elevationMeters ?? 0,
    averageHeartRate: 163,
    averagePower: Math.round(racePower * 0.95),
    normalizedPower: racePower,
    averageSpeed: speed,
    maxSpeed: speed * 1.6,
    analysis: `Race: ${input.goal.title}. Finish ${formatClock(movingTime)}, target ${formatClock(input.goal.targetSeconds)}. ${met ? "Target met." : "Target missed."}`,
  });
}

/** Compact `h:mm:ss` used in activity analysis text. */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes)}:${String(rest).padStart(2, "0")}`;
}
