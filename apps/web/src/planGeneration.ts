import {
  coachPlanResponseSchema,
  type CoachPlanResponse,
  type PlanPending,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";

/**
 * The result of tracking one plan generation to completion. A generation that
 * fails or times out still settles here so the UI can stop spinning and show
 * the reason.
 */
export type PlanGenerationOutcome =
  | { status: "done"; plan: CoachPlanResponse }
  | { status: "error"; error: string }
  | { status: "timeout"; error: string };

/** Shown when the server keeps reporting a run for longer than the UI waits. */
const GENERATION_TIMEOUT_MESSAGE =
  "The coach is taking longer than expected. Refresh to check again.";

export interface PollPlanGenerationOptions {
  /** The athlete's current date, sent with every status check. */
  today: string;
  /** Whether tomorrow's session was requested, sent with every status check. */
  includeTomorrow: boolean;
  /**
   * The generate request. A `done` status from the previous run must not end
   * the poll before this request has settled.
   */
  request: Promise<unknown> | null;
  fetchPlan: (
    today: string,
    includeTomorrow: boolean,
  ) => Promise<CoachPlanResponse>;
  /** Called with every plan response fetched while the generation runs. */
  onUpdate: (response: CoachPlanResponse) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  intervalMs?: number;
  timeoutMs?: number;
  /** Turns a thrown error into the message shown to the athlete. */
  describeError?: (error: unknown) => string;
}

const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Which plan the caller wants: the athlete's today and, optionally, tomorrow. */
export interface CoachPlanQuery {
  /** The athlete's current date, sent with every plan fetch. */
  today: string;
  /** Whether tomorrow's session is wanted; omitted means the server's false. */
  includeTomorrow?: boolean;
}

/**
 * Fetch the stored plan through the shared response validator. Always sends
 * `today`, sends `includeTomorrow` only when the caller supplies it, and
 * forwards an abort signal, so every reader builds the same request.
 */
export function fetchCoachPlan(
  auth: AuthState,
  { today, includeTomorrow }: CoachPlanQuery,
  signal?: AbortSignal,
): Promise<CoachPlanResponse> {
  const query = new URLSearchParams({ today });
  if (includeTomorrow !== undefined) {
    query.set("includeTomorrow", String(includeTomorrow));
  }
  return requestParsed(
    `/api/coaching/plan?${query.toString()}`,
    auth,
    coachPlanResponseSchema,
    "Loading your plan",
    signal === undefined ? undefined : { signal },
  );
}

/**
 * Whether the stored plan has any level missing for today, so the section should
 * start a generation. `stale` is checked separately: a plan can be stale
 * without a level being absent.
 */
export function hasPendingWork(pending: PlanPending): boolean {
  return (
    pending.initial ||
    pending.day ||
    pending.week ||
    pending.block ||
    pending.tomorrow ||
    pending.nextWeek ||
    pending.nextBlock ||
    pending.dietProgress
  );
}

/**
 * Poll a generation's status until it finishes, fails, or the deadline passes.
 * The plan response is handed to `onUpdate` on every poll so a mounted plan
 * view can show progressively fresher data while the coach works.
 */
export async function pollPlanGeneration({
  today,
  includeTomorrow,
  request,
  fetchPlan,
  onUpdate,
  sleep,
  now,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  describeError = reportError,
}: PollPlanGenerationOptions): Promise<PlanGenerationOutcome> {
  let requestDone = request === null;
  if (request !== null) {
    void request
      .finally(() => {
        requestDone = true;
      })
      .catch(() => {
        // The status endpoint carries the error; polling shows it.
      });
  }

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(intervalMs);
    let result: CoachPlanResponse;
    try {
      result = await fetchPlan(today, includeTomorrow);
    } catch (error: unknown) {
      return { status: "error", error: describeError(error) };
    }
    onUpdate(result);

    if (result.generation.status === "running") {
      continue;
    }
    if (result.generation.status === "error") {
      return {
        status: "error",
        error: result.generation.error ?? "The coach could not finish.",
      };
    }
    if (result.generation.status === "done" && requestDone) {
      return { status: "done", plan: result };
    }
  }

  return { status: "timeout", error: GENERATION_TIMEOUT_MESSAGE };
}
