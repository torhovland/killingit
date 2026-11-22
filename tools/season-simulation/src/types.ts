import type {
  AnalyzedActivity,
  AthleteLocation,
  CoachPlan,
  WeekSession,
} from "@killingit/shared";

export type ScenarioName = "full" | "reduced";

export type Cadence = "every-session" | "alternate-days";

export interface AthleteProfile {
  sex: "male" | "female";
  age: number;
  weightKg: number;
  heightCm: number;
  timezone: string;
  location: AthleteLocation;
  startFtpWatts: number;
  priorFtpWatts: number;
  startRunThresholdSecPerKm: number;
  priorRunThresholdSecPerKm: number;
  restingHeartRate: number;
  maxHeartRate: number;
  thresholdHeartRate: number;
}

export interface RaceGoal {
  kind: "half" | "gravel";
  date: string;
  title: string;
  targetSeconds: number;
  distanceMeters: number;
  elevationMeters?: number;
}

export interface ScenarioConfig {
  name: ScenarioName;
  label: string;
  cadence: Cadence;
  description: string;
}

/** The athlete's modelled ability on one day. */
export interface Capability {
  ftpWatts: number;
  runThresholdSecPerKm: number;
}

export interface AthleteState extends Capability {
  date: string;
  ctl: number;
}

export interface BikeCourse {
  distanceMeters: number;
  elevationMeters: number;
  systemMassKg: number;
  cda: number;
  crr: number;
  airDensity: number;
  drivetrainEfficiency: number;
  /** Effective power gain from riding in a group. */
  draftPowerFactor: number;
}

export interface BikePrediction {
  soloSeconds: number;
  draftSeconds: number;
}

export interface HalfPrediction {
  seconds: number;
  requiredThresholdSecPerKm: number;
}

export interface SessionRecord {
  date: string;
  day: string;
  session: WeekSession;
  sport: string;
  plannedTss: number;
  recorded: boolean;
  feasible: boolean;
  feasibilityNote: string;
  skippedReason: string | null;
  activity: AnalyzedActivity | null;
}

export interface WeekRecord {
  runDate: string;
  weekStart: string;
  weekEnd: string;
  blockName: string;
  blockFocus: string;
  weekFocus: string;
  weekRationale: string;
  plannedTss: number;
  completedTss: number;
  sessions: SessionRecord[];
  stateAtStart: AthleteState;
  stateAtEnd: AthleteState;
  halfPrediction: HalfPrediction;
  bikePrediction: BikePrediction;
  coachFeasibility: string | null;
}

export interface RaceResult {
  kind: "half" | "gravel";
  date: string;
  title: string;
  targetSeconds: number;
  predictedSeconds: number;
  soloPredictedSeconds: number | null;
  actualSeconds: number;
  met: boolean;
  detail: string;
  coachText: string;
}

export interface CallRecord {
  at: string;
  kind: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  finishReason: string | null;
}

export interface ScenarioResult {
  scenario: ScenarioName;
  label: string;
  cadence: Cadence;
  description: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  season: CoachPlan["season"] | null;
  weeks: WeekRecord[];
  races: RaceResult[];
  calls: CallRecord[];
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalRecordedTss: number;
  totalSessions: number;
  recordedSessions: number;
  trees: {
    seed: string;
  };
  notes: string[];
}

export interface ReportData {
  generatedAt: string;
  model: string;
  scenarios: ScenarioResult[];
}
