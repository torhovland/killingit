import type { ActivityFeed } from "../coaching/feed/presenter.js";
import { latestActivityAnalysisSince } from "../coaching/analysisRuns.js";
import { MAX_ANALYZED_ACTIVITIES } from "../coaching/activityStore.js";
import type { syncAthleteReading } from "../coaching/athleteReading.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import { reportError } from "../instrumentation/reportError.js";
import { markPlanPromptsFailed } from "../llm/callStore.js";
import type { LlmClient } from "../llm/client.js";
import {
  recordCoachBodyMetrics,
  recordPlanFtpEstimates,
} from "../metrics/store.js";
import type { PlanGenerateMode } from "@killingit/shared";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "../questions/adjustments.js";
import type { UserStore } from "../users/store.js";
import { isAfterPlanTomorrowCutoff } from "./dates.js";
import {
  clearPendingCoachQuestions,
  saveCoachQuestions,
} from "./coachQuestions.js";
import type { loadAnsweredCoachQuestions } from "./coachQuestions.js";
import {
  GENERATION_HEARTBEAT_MS,
  HEARTBEAT_FAILURE_LIMIT,
  isGenerationSuperseded,
} from "./generation.js";
import { ensureGenerationCurrent } from "./generation/persist.js";
import { planFailureMessage } from "./failure.js";
import {
  buildPlanContext,
  loadPlanGenerationContext,
  syncAthleteReadingIfChanged,
} from "./generationContext.js";
import { runPlanGeneration } from "./generate.js";
import { planFtpEstimates } from "../metrics/planFtpEstimates.js";
import { loadPlanInputs, type PlanInputDependencies } from "./planInputs.js";
import type { CoachingInputs } from "./inputs.js";
import { claimRun, releaseRun, stopRun } from "./runs.js";
import type { PlanGenerationStore, PlanStore } from "./store.js";
import {
  PLAN_TRIGGER_DEBOUNCE_MS,
  PlanTriggerDebounce,
} from "./triggerDebounce.js";

/**
 * The stores and injectable functions one plan run reads. The advisory loaders
 * live in `PlanInputDependencies`, which `loadPlanInputs` reads; the rest are
 * the account state, the trigger's writers and the athlete-reading seam.
 */
export interface PlanTriggerDependencies extends PlanInputDependencies {
  users: UserStore;
  answers: QuestionAnswerStore;
  plans: PlanStore;
  generations: PlanGenerationStore;
  /** Survey answers not yet incorporated into the plan. */
  coachingSurveyAdjustments?: CoachingSurveyAdjustmentStore | undefined;
  /** Injectable for route tests; defaults to a Garmin sync. */
  loadActivities?: ((userId: number) => Promise<ActivityFeed>) | undefined;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteReading?: typeof syncAthleteReading | undefined;
  /** Injectable for tests; defaults to waiting for a newer analysis pass. */
  latestActivityAnalysisSince?: typeof latestActivityAnalysisSince | undefined;
  /** Injectable for tests; defaults to the database-backed review writer. */
  capturePeriodReviews?: typeof captureCompletedPeriodReviews | undefined;
  /** Injectable for tests; defaults to the stored FTP estimate writer. */
  recordFtpEstimates?: typeof recordPlanFtpEstimates | undefined;
  /** Injectable for tests; defaults to the stored body-metric writer. */
  recordBodyMetrics?: typeof recordCoachBodyMetrics | undefined;
  /** Injectable for tests; defaults to the stored coach-question writer. */
  saveCoachQuestions?: typeof saveCoachQuestions | undefined;
  /** Injectable for tests; defaults to clearing the pending coach question. */
  clearPendingCoachQuestions?: typeof clearPendingCoachQuestions | undefined;
  /** Injectable for route tests; defaults to answered coach questions. */
  loadAnsweredCoachQuestions?: typeof loadAnsweredCoachQuestions | undefined;
  /** Injectable for route tests; defaults to the account's stored config. */
  loadLlm?: ((userId: number) => Promise<LlmClient | null>) | undefined;
  /** Injectable for route tests; defaults to the database-backed loader. */
  loadCoachingInputs?:
    | ((userId: number, weekStartDate: string) => Promise<CoachingInputs>)
    | undefined;
  /** Injectable for tests; defaults to the prompt-log writer. */
  markPlanPromptsFailed?: typeof markPlanPromptsFailed | undefined;
  /** Injectable for tests; defaults to the Sentry reporter. */
  reportError?: typeof reportError | undefined;
  /** Injectable for tests; defaults to {@link PLAN_TRIGGER_DEBOUNCE_MS}. */
  planTriggerDebounceMs?: number | undefined;
}

/** Options shared by the plan-only trigger and a combined coach run. */
export interface PlanRunOptions {
  userId: number;
  today: string;
  timezone?: string | undefined;
  mode?: PlanGenerateMode;
  force?: boolean;
  includeTomorrow?: boolean;
  /** Keep today's stored session while revising around a new input. */
  keepToday?: boolean;
}

/**
 * The one process-local debounce state every trigger in this process
 * schedules through. See `docs/specs/coach-run-cancellation.md`.
 */
const planTriggerDebounce = new PlanTriggerDebounce();

/**
 * Starts a plan generation in the background. The newest request always owns
 * the run: an older run is aborted and its writes are fenced by the run id.
 * Rapid auto triggers are coalesced by `planTriggerDebounce` before the
 * background work starts.
 */
export async function triggerPlanGeneration(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
): Promise<boolean> {
  const run = claimRun(options.userId);
  try {
    await deps.generations.begin(options.userId, run.runId);
  } catch (err) {
    // The claim must not outlive a run that never started, or the registry
    // would keep one entry per account whose begin failed.
    releaseRun(options.userId, run.runId);
    throw err;
  }

  planTriggerDebounce.schedule(
    options.userId,
    {
      mode: options.mode,
      force: options.force,
      windowMs: deps.planTriggerDebounceMs ?? PLAN_TRIGGER_DEBOUNCE_MS,
    },
    () => {
      if (!run.signal.aborted) {
        startBackgroundPlan(deps, options, run);
      }
    },
  );
  return true;
}

function startBackgroundPlan(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions,
  run: { runId: string; signal: AbortSignal },
): void {
  const heartbeat = startHeartbeat(deps, {
    userId: options.userId,
    runId: run.runId,
  });
  void runPlanForUser(deps, { ...options, ...run })
    .catch(async (err: unknown) => {
      if (isGenerationSuperseded(err)) {
        return;
      }
      console.error("[plan] background generation failed:", err);
      (deps.reportError ?? reportError)(err);
      // The loading phase fails the row itself and rethrows. A later phase
      // throws without doing so, so this catch covers the whole run. Failing
      // an already-failed row is a no-op. The reason is athlete-facing, and the
      // raw failure is logged above. See ADR 0038.
      try {
        await deps.generations.fail(
          options.userId,
          planFailureMessage(err),
          run.runId,
        );
      } catch (failure: unknown) {
        console.error("[plan] could not mark generation failed:", failure);
      }
    })
    .finally(() => {
      clearInterval(heartbeat);
      releaseRun(options.userId, run.runId);
    });
}

/** What one heartbeat needs to know about the run it refreshes. */
export interface HeartbeatOptions {
  userId: number;
  runId: string;
  /** Injectable for tests; defaults to {@link GENERATION_HEARTBEAT_MS}. */
  intervalMs?: number | undefined;
  /** Injectable for tests; defaults to stopping the run in the registry. */
  stop?: ((error: unknown) => void) | undefined;
}

/**
 * Refreshes the running row so loading a large feed cannot look like a crash.
 * A heartbeat that keeps failing means the run cannot save anything, so after
 * `HEARTBEAT_FAILURE_LIMIT` consecutive failures it stops the run, reports the
 * error and tries once to record the failure. A success resets the count, so a
 * single dropped connection does not end a run. See
 * `docs/specs/plan-run-resilience.md`.
 */
export function startHeartbeat(
  deps: PlanTriggerDependencies,
  {
    userId,
    runId,
    intervalMs = GENERATION_HEARTBEAT_MS,
    stop,
  }: HeartbeatOptions,
): ReturnType<typeof setInterval> {
  let failures = 0;
  const heartbeat = setInterval(() => {
    void deps.generations.heartbeat(userId, runId).then(
      () => {
        failures = 0;
      },
      (err: unknown) => {
        failures += 1;
        if (failures < HEARTBEAT_FAILURE_LIMIT) {
          console.error("[plan] could not refresh generation status:", err);
          return;
        }
        clearInterval(heartbeat);
        console.error("[plan] stopping a run that lost its database:", err);
        (deps.reportError ?? reportError)(err);
        if (stop !== undefined) {
          stop(err);
        } else {
          stopRun(userId, runId, err);
        }
        // A recovered database still has to stop the athlete's poll, so record
        // the failure when it answers; when it does not, the stale lease
        // releases the row on the next read.
        void deps.generations
          .fail(userId, planFailureMessage(err), runId)
          .catch((failure: unknown) => {
            console.error("[plan] could not mark generation failed:", failure);
          });
      },
    );
  }, intervalMs);
  heartbeat.unref();
  return heartbeat;
}

/**
 * Loads one run's context and executes it. The caller has already claimed the
 * generation row and owns the heartbeat, so this can run after an optional
 * reply phase in the same run.
 */
export async function runPlanForUser(
  deps: PlanTriggerDependencies,
  options: PlanRunOptions & { runId: string; signal: AbortSignal },
): Promise<void> {
  const { userId, today, timezone, mode, force, keepToday } = options;

  const loaded = await loadPlanGenerationContext(deps, options);
  if (loaded === null) {
    // The account has no model; the row already carries the reason.
    return;
  }
  const {
    activities,
    user,
    surveyAdjustments,
    surveyAdjustmentStore,
    activitiesSnapshotAt,
  } = loaded;

  // The request's zone (the athlete's selected or device zone) wins over the
  // stored setting; an account with neither reads as UTC. Every day derived
  // from an activity in this run uses the same zone.
  const timeZone = timezone ?? user?.timezone ?? null;

  // A server-triggered update (a new analysis, a saved comment, a weekly note)
  // must plan the same levels as the dashboard. After the athlete's local 18:00
  // that includes tomorrow and, at a week boundary, the next week.
  const includeTomorrow =
    options.includeTomorrow ?? isAfterPlanTomorrowCutoff(timeZone);

  // The stored feed keeps every activity ever synced. The load series needs that
  // whole history for the 42-day chronic warm-up; prompts stay on the same
  // recent window as the analysis cap so they do not grow with the athlete's
  // entire history.
  let activityHistory = activities.activities;
  let recentActivities = activityHistory.slice(0, MAX_ANALYZED_ACTIVITIES);

  await ensureGenerationCurrent({
    userId,
    runId: options.runId,
    signal: options.signal,
    generations: deps.generations,
  });

  const location = user?.location ?? null;

  await syncAthleteReadingIfChanged(deps, loaded, options);

  const inputs = await loadPlanInputs(deps, {
    userId,
    today,
    location,
    timeZone,
  });

  // The caller owns the background task and heartbeat; the client polls GET
  // for progress while this long cascade runs.
  //
  // An analysis pass can begin after this run loaded its feed, for example
  // while the athlete-metrics and forecast phases run. Wait for it and use its
  // finished feed so the prompt never plans from an analysis that is about to
  // be replaced.
  const refreshedActivities = await (
    deps.latestActivityAnalysisSince ?? latestActivityAnalysisSince
  )(userId, today, activitiesSnapshotAt);
  if (refreshedActivities !== null) {
    activityHistory = refreshedActivities.activities;
    recentActivities = activityHistory.slice(0, MAX_ANALYZED_ACTIVITIES);
  }

  await runPlanGeneration({
    userId,
    runId: options.runId,
    signal: options.signal,
    today,
    timezone,
    mode,
    force,
    includeTomorrow,
    keepToday,
    capturePeriodReviews:
      deps.capturePeriodReviews ?? captureCompletedPeriodReviews,
    markPromptsFailed: deps.markPlanPromptsFailed ?? markPlanPromptsFailed,
    recordFtpEstimates: (generatedPlan) =>
      (deps.recordFtpEstimates ?? recordPlanFtpEstimates)(
        userId,
        planFtpEstimates(generatedPlan),
      ),
    recordBodyMetrics: (points) =>
      (deps.recordBodyMetrics ?? recordCoachBodyMetrics)(userId, points, today),
    recordCoachQuestion: ({ question, model, sourceKind }) =>
      (deps.saveCoachQuestions ?? saveCoachQuestions)({
        userId,
        questions: [question],
        model,
        sourceKind,
      }),
    clearCoachQuestions: () =>
      (deps.clearPendingCoachQuestions ?? clearPendingCoachQuestions)(userId),
    plan: loaded.plan,
    context: buildPlanContext({
      loaded,
      activities: activityHistory,
      recentActivities,
      inputs,
      timeZone,
      location,
      signal: options.signal,
    }),
    plans: deps.plans,
    generations: deps.generations,
    clearCoachingSurveyAdjustments: () =>
      surveyAdjustmentStore.clearConsumed(
        userId,
        surveyAdjustments.map((adjustment) => adjustment.id),
      ),
  });
}
