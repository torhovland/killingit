import {
  addDays,
  type AnalyzedActivity,
  type CoachPlan,
  type WeekPlan,
  type WeekSession,
} from "@killingit/shared";
import { runPlanForUser } from "../../../apps/api/src/plans/trigger.js";
import {
  buildRaceActivity,
  buildSessionActivity,
  checkSessionFeasibility,
  formatClock,
  formatPace,
  inferSport,
  isTrainingDay,
  plannedSessionTss,
} from "./athlete.js";
import {
  bikePrediction,
  halfMarathonPrediction,
  requiredFtpForTime,
} from "./course.js";
import {
  ATHLETE,
  GRAVEL_RACE,
  HALF_MARATHON,
  MODEL_ID,
  SCENARIOS,
  SEASON_END_DATE,
  SIM_DATABASE_URL,
  START_DATE,
  WEEKLY_FEEDBACK,
} from "./config.js";
import {
  loadPlan,
  planDependencies,
  prepareSimulationDatabase,
  seedAthlete,
  writeThresholds,
  writeWeeklyFeedback,
} from "./db.js";
import { createRecordedLlm } from "./llm.js";
import {
  advanceAthleteState,
  advanceThroughDate,
  initialAthleteState,
} from "./progression.js";
import type {
  AthleteState,
  Capability,
  RaceGoal,
  RaceResult,
  ScenarioName,
  ScenarioResult,
  SessionRecord,
  WeekRecord,
} from "./types.js";

import {
  readSimulationState,
  writeSimulationState,
  type SimulationStateFile,
} from "./state.js";
import { OUTPUT_ROOT } from "./config.js";

/** The one-percent tolerance a modelled race prediction gets against a target. */
const FEASIBILITY_TOLERANCE = 0.01;

interface ScenarioRun {
  scenario: ScenarioName;
  apiKey: string;
  /** Stop after this many simulated weeks, for a cheap smoke run. */
  weekLimit?: number | undefined;
  /** Continue a saved run instead of rebuilding the database. */
  resume?: boolean;
}

/** Runs one full season and returns every week, activity and race result. */
export async function runScenario(input: ScenarioRun): Promise<ScenarioResult> {
  const config = SCENARIOS[input.scenario];
  const saved =
    input.resume === true
      ? await readSimulationState(OUTPUT_ROOT, input.scenario)
      : null;
  if (input.resume === true && saved === null) {
    throw new Error(`no saved ${input.scenario} run to resume`);
  }
  const run = saved ?? (await startFresh(input.scenario));
  const recorded = createRecordedLlm(input.apiKey, MODEL_ID, run.calls);
  run.calls = recorded.calls;
  const feed = () => ({
    model: MODEL_ID,
    activities: [...run.activities].sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    ),
  });
  const deps = planDependencies({
    llm: recorded.client,
    feed,
    today: () => run.today,
  });

  const plan = await runWeeks(run, deps, config, input);
  return buildResult(run, plan, config);
}

async function startFresh(
  scenario: ScenarioName,
): Promise<SimulationStateFile> {
  await prepareSimulationDatabase(SIM_DATABASE_URL);
  const { userId } = await seedAthlete();
  return {
    scenario,
    userId,
    startedAt: new Date().toISOString(),
    today: START_DATE,
    nextId: 1,
    state: initialAthleteState(ATHLETE, START_DATE),
    activities: [],
    weeks: [],
    races: [],
    notes: [],
    calls: [],
    pendingRefresh: { today: START_DATE, mode: "newSeason" },
  };
}

/** Rebuilds the pending run, then simulates every remaining week. */
async function runWeeks(
  run: SimulationStateFile,
  deps: ReturnType<typeof planDependencies>,
  config: (typeof SCENARIOS)[ScenarioName],
  input: ScenarioRun,
): Promise<CoachPlan> {
  let plan = await ensurePlan(run, deps, input.scenario);
  const stopDate =
    plan.season.endDate < SEASON_END_DATE
      ? plan.season.endDate
      : SEASON_END_DATE;
  if (plan.season.endDate < SEASON_END_DATE) {
    const note = `The coach ended the season on ${plan.season.endDate}, before the requested ${SEASON_END_DATE}.`;
    if (!run.notes.includes(note)) {
      run.notes.push(note);
    }
  }
  const lastWeek = run.weeks.at(-1);
  if (lastWeek !== undefined && lastWeek.weekEnd >= stopDate) {
    return plan;
  }
  console.error(
    `[sim] ${input.scenario}: season ${plan.season.startDate} → ${plan.season.endDate}, ${String(plan.season.blocks.length)} blocks`,
  );

  let refreshIndex = run.weeks.length + 1;
  while (plan.nextWeek !== null && plan.nextWeek.startDate <= stopDate) {
    if (input.weekLimit !== undefined && run.weeks.length >= input.weekLimit) {
      break;
    }
    const built = await simulateWeek({
      weekPlan: plan.nextWeek,
      plan,
      state: run.state,
      config: config.cadence,
      activities: run.activities,
      races: run.races,
      userId: run.userId,
      nextId: run.nextId,
    });
    run.nextId = built.nextId;
    run.weeks.push(built.week);
    run.state = built.state;
    run.today = built.week.weekEnd;
    console.error(
      `[sim] ${input.scenario}: week ${String(run.weeks.length)} ${built.week.weekStart} plan ${String(built.week.plannedTss)} done ${String(built.week.completedTss)} CTL ${built.week.stateAtEnd.ctl.toFixed(0)} FTP ${built.week.stateAtEnd.ftpWatts.toFixed(0)} run ${formatPace(built.week.stateAtEnd.runThresholdSecPerKm)}`,
    );
    await writeSimulationState(OUTPUT_ROOT, run);
    if (built.week.weekEnd >= stopDate) {
      break;
    }
    await writeThresholds(run.userId, run.today, run.state);
    await writeWeeklyFeedback(run.userId, run.today, WEEKLY_FEEDBACK);
    run.pendingRefresh = { today: run.today, mode: "auto" };
    await writeSimulationState(OUTPUT_ROOT, run);
    plan = await refreshPlan({
      deps,
      userId: run.userId,
      today: run.today,
      mode: "auto",
      runId: `season-sim-${input.scenario}-${String(refreshIndex)}`,
    });
    run.pendingRefresh = null;
    await writeSimulationState(OUTPUT_ROOT, run);
    refreshIndex += 1;
  }
  return plan;
}

/** Completes the saved pending refresh, or loads the stored plan. */
async function ensurePlan(
  run: SimulationStateFile,
  deps: ReturnType<typeof planDependencies>,
  scenario: ScenarioName,
): Promise<CoachPlan> {
  if (run.pendingRefresh !== null) {
    const pending = run.pendingRefresh;
    const plan = await refreshPlan({
      deps,
      userId: run.userId,
      today: pending.today,
      mode: pending.mode,
      runId: `season-sim-${scenario}-0`,
    });
    run.today = pending.today;
    run.pendingRefresh = null;
    await writeSimulationState(OUTPUT_ROOT, run);
    return plan;
  }
  const plan = await loadPlan(run.userId);
  if (plan === null) {
    throw new Error("cannot resume: the selected database has no stored plan");
  }
  return plan;
}

function buildResult(
  run: SimulationStateFile,
  plan: CoachPlan,
  config: (typeof SCENARIOS)[ScenarioName],
): ScenarioResult {
  return {
    scenario: run.scenario,
    label: config.label,
    cadence: config.cadence,
    description: config.description,
    model: MODEL_ID,
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    season: plan.season,
    weeks: run.weeks,
    races: run.races,
    calls: run.calls,
    costUsd: run.calls.reduce((sum, call) => sum + call.costUsd, 0),
    promptTokens: run.calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: run.calls.reduce(
      (sum, call) => sum + call.completionTokens,
      0,
    ),
    totalRecordedTss: run.weeks.reduce(
      (sum, week) => sum + week.completedTss,
      0,
    ),
    totalSessions: run.weeks.reduce(
      (sum, week) =>
        sum +
        week.sessions.filter((entry) => entry.session.type === "workout")
          .length,
      0,
    ),
    recordedSessions: run.weeks.reduce(
      (sum, week) =>
        sum + week.sessions.filter((entry) => entry.recorded).length,
      0,
    ),
    trees: { seed: "fixed" },
    notes: run.notes,
  };
}

interface RefreshInput {
  deps: ReturnType<typeof planDependencies>;
  userId: number;
  today: string;
  mode: "auto" | "newSeason";
  runId: string;
}

/** Runs one plan refresh and returns the stored plan. */
async function refreshPlan(input: RefreshInput): Promise<CoachPlan> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await refreshAttempt(input);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[sim] plan run failed (attempt ${String(attempt + 1)}/6): ${message}`,
      );
      if (attempt < 5) {
        await Bun.sleep(Math.min(30_000, 2_000 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function refreshAttempt(input: RefreshInput): Promise<CoachPlan> {
  await input.deps.generations.begin(input.userId, input.runId);
  try {
    await runPlanForUser(input.deps, {
      userId: input.userId,
      runId: input.runId,
      signal: new AbortController().signal,
      today: input.today,
      timezone: ATHLETE.timezone,
      includeTomorrow: true,
      mode: input.mode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await input.deps.generations.fail(input.userId, message, input.runId);
    throw err;
  }
  const stored = await loadPlan(input.userId);
  if (stored === null) {
    throw new Error(`no plan was stored after the run for ${input.today}`);
  }
  return stored;
}

interface SimulateWeekInput {
  weekPlan: WeekPlan;
  plan: CoachPlan;
  state: AthleteState;
  config: "every-session" | "alternate-days";
  activities: AnalyzedActivity[];
  races: RaceResult[];
  userId: number;
  nextId: number;
}

interface SimulatedWeek {
  week: WeekRecord;
  state: AthleteState;
  nextId: number;
}

/** Records the week's activities day by day and returns the end state. */
async function simulateWeek(input: SimulateWeekInput): Promise<SimulatedWeek> {
  let state = input.state;
  let nextId = input.nextId;
  const sessions: SessionRecord[] = [];
  const startState = state;
  let completedTss = 0;

  for (const session of input.weekPlan.sessions) {
    state = advanceThroughDate(state, session.date, ATHLETE);
    const raceGoal = raceGoalOn(session.date);
    let record: SessionRecord;
    if (raceGoal !== null) {
      await writeThresholds(input.userId, session.date, state);
      const built = buildRace(input, session, raceGoal, state, nextId);
      nextId += 1;
      record = built.record;
      input.races.push(built.race);
    } else {
      const built = await buildTrainingDay(input, session, state, nextId);
      nextId += built.nextId;
      record = built.record;
    }
    sessions.push(record);
    const tss =
      record.activity === null ? 0 : measuredTss(record.activity, state);
    completedTss += tss;
    state = advanceAthleteState(state, session.date, tss, ATHLETE);
  }

  const plannedTss = input.weekPlan.sessions.reduce(
    (sum, session) => sum + plannedSessionTss(session),
    0,
  );
  return {
    week: {
      runDate: addDays(input.weekPlan.startDate, 6),
      weekStart: input.weekPlan.startDate,
      weekEnd: addDays(input.weekPlan.startDate, 6),
      blockName: input.plan.block.name,
      blockFocus: input.plan.block.focus,
      weekFocus: input.weekPlan.focus,
      weekRationale: input.weekPlan.rationale,
      plannedTss: Math.round(plannedTss),
      completedTss: Math.round(completedTss),
      sessions,
      stateAtStart: startState,
      stateAtEnd: state,
      halfPrediction: halfMarathonPrediction(state.runThresholdSecPerKm),
      bikePrediction: bikePrediction(state.ftpWatts),
      coachFeasibility: feasibilityMentions(input.weekPlan),
    },
    state,
    nextId,
  };
}

interface TrainingDayBuild {
  record: SessionRecord;
  nextId: number;
}

/** Builds one prescribed session, or records why it was not trained. */
async function buildTrainingDay(
  input: SimulateWeekInput,
  session: WeekSession,
  state: AthleteState,
  nextId: number,
): Promise<TrainingDayBuild> {
  const base = {
    date: session.date,
    day: session.day,
    session,
    sport: inferSport(session),
    plannedTss: plannedSessionTss(session),
  };
  if (session.type === "rest") {
    return {
      record: {
        ...base,
        recorded: false,
        feasible: true,
        feasibilityNote: "Rest day.",
        skippedReason: "Rest day",
        activity: null,
      },
      nextId,
    };
  }
  if (
    input.config === "alternate-days" &&
    !isTrainingDay(input.config, START_DATE, session.date)
  ) {
    return {
      record: {
        ...base,
        recorded: false,
        feasible: true,
        feasibilityNote: "Scheduled off day.",
        skippedReason: "Alternate-day schedule",
        activity: null,
      },
      nextId,
    };
  }
  const check = checkSessionFeasibility(session, base.plannedTss);
  await writeThresholds(input.userId, session.date, state);
  const activity = buildSessionActivity({
    session,
    capability: state,
    profile: ATHLETE,
    id: nextId,
  });
  input.activities.push(activity);
  return {
    record: {
      ...base,
      recorded: true,
      feasible: check.feasible,
      feasibilityNote: check.note,
      skippedReason: null,
      activity,
    },
    nextId: nextId + 1,
  };
}

interface RaceBuild {
  record: SessionRecord;
  race: RaceResult;
}

/** Simulates a race from the athlete's ability on race morning. */
function buildRace(
  input: SimulateWeekInput,
  session: WeekSession,
  goal: RaceGoal,
  state: AthleteState,
  nextId: number,
): RaceBuild {
  const activity = buildRaceActivity({
    goal,
    capability: state,
    profile: ATHLETE,
    id: nextId,
  });
  input.activities.push(activity);
  const evaluation = evaluateRace(goal, state, input.weekPlan);
  return {
    record: {
      date: session.date,
      day: session.day,
      session,
      sport: goal.kind === "half" ? "running" : "cycling",
      plannedTss: plannedSessionTss(session),
      recorded: true,
      feasible: true,
      feasibilityNote: `Race completed in ${formatClock(evaluation.predictedSeconds)}; target ${evaluation.met ? "met" : "missed"}.`,
      skippedReason: null,
      activity,
    },
    race: evaluation,
  };
}

function raceGoalOn(date: string): RaceGoal | null {
  if (date === HALF_MARATHON.date) return HALF_MARATHON;
  if (date === GRAVEL_RACE.date) return GRAVEL_RACE;
  return null;
}

/** The independent race check the report uses, separate from the coach's view. */
function evaluateRace(
  goal: RaceGoal,
  capability: Capability,
  week: WeekPlan,
): RaceResult {
  const raceSession = week.sessions.find((entry) => entry.date === goal.date);
  const coachText = [
    week.focus,
    week.rationale,
    raceSession?.title ?? "",
    raceSession?.description ?? "",
  ]
    .filter((part) => part.trim() !== "")
    .join(" — ");
  if (goal.kind === "half") {
    const prediction = halfMarathonPrediction(capability.runThresholdSecPerKm);
    return {
      kind: "half",
      date: goal.date,
      title: goal.title,
      targetSeconds: goal.targetSeconds,
      predictedSeconds: prediction.seconds,
      soloPredictedSeconds: null,
      actualSeconds: prediction.seconds,
      met:
        prediction.seconds <= goal.targetSeconds * (1 + FEASIBILITY_TOLERANCE),
      detail: `Threshold ${formatPace(capability.runThresholdSecPerKm)}; needs ${formatPace(prediction.requiredThresholdSecPerKm)} or faster.`,
      coachText,
    };
  }
  const prediction = bikePrediction(capability.ftpWatts);
  const required = requiredFtpForTime(goal.targetSeconds);
  return {
    kind: "gravel",
    date: goal.date,
    title: goal.title,
    targetSeconds: goal.targetSeconds,
    predictedSeconds: prediction.draftSeconds,
    soloPredictedSeconds: prediction.soloSeconds,
    actualSeconds: prediction.draftSeconds,
    met:
      prediction.draftSeconds <=
      goal.targetSeconds * (1 + FEASIBILITY_TOLERANCE),
    detail: `FTP ${String(Math.round(capability.ftpWatts))} W (${(capability.ftpWatts / ATHLETE.weightKg).toFixed(2)} W/kg); needs ${String(Math.round(required.draft))} W in a group, ${String(Math.round(required.solo))} W solo.`,
    coachText,
  };
}

/** The stressed TSS an activity contributes, scored against today's ability. */
function measuredTss(
  activity: AnalyzedActivity,
  capability: Capability,
): number {
  const hours = activity.movingTime / 3600;
  if (activity.type === "cycling" && activity.normalizedPower !== null) {
    return (
      hours *
      ((activity.normalizedPower ?? 0) / Math.max(1, capability.ftpWatts)) **
        2 *
      100
    );
  }
  if (activity.type === "running" && activity.distance > 0) {
    const pace = activity.movingTime / (activity.distance / 1000);
    return (
      hours * (capability.runThresholdSecPerKm / Math.max(1, pace)) ** 2 * 100
    );
  }
  return hours * 50;
}

/** Sentences in the week plan that talk about goals or feasibility. */
function feasibilityMentions(week: WeekPlan): string | null {
  const source = [
    week.focus,
    week.rationale,
    ...week.sessions.map(
      (session) => `${session.title}. ${session.description}`,
    ),
  ].join(" ");
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      /feasib|realistic|target|goal|half marathon|gravel|sub-2|3:10|on track|ambitious/i.test(
        sentence,
      ),
    );
  return sentences.length === 0 ? null : sentences.slice(0, 3).join(" ");
}
