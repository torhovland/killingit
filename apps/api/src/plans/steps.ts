/**
 * A labelled stage of plan generation. The UI shows the label while the step
 * runs, and the bar moves towards `target` over roughly `defaultMs`.
 */
export interface PlanGenerationStep {
  /** Stable key used to learn how long this kind of step takes. */
  id: string;
  /** Human-readable label shown while the step runs. */
  label: string;
  /** Percentage the bar approaches while the step runs. */
  target: number;
  /** Expected duration until the step has been measured at least once. */
  defaultMs: number;
}

/** Percentage shown while the run is being prepared. */
export const PLAN_GENERATION_START = 5;

/** A guess for a single reasoning-model completion. */
const LLM_STEP_MS = 45_000;

/**
 * Targets increase along every generation path, so a later step never pulls the
 * bar backwards. Steps that use the same prompt share an `id` so their measured
 * durations are pooled.
 */
export const PLAN_GENERATION_STEPS = {
  prepare: {
    id: "prepare",
    label: "Preparing your plan",
    target: 10,
    defaultMs: 20_000,
  },
  review: {
    id: "review",
    label: "Reviewing your profile and recent training",
    target: 22,
    defaultMs: LLM_STEP_MS,
  },
  season: {
    id: "season",
    label: "Designing your season",
    target: 40,
    defaultMs: LLM_STEP_MS,
  },
  seasonRefresh: {
    id: "seasonRefresh",
    label: "Refreshing your season",
    target: 50,
    defaultMs: LLM_STEP_MS,
  },
  initialBlock: {
    id: "block",
    label: "Designing your block",
    target: 58,
    defaultMs: LLM_STEP_MS,
  },
  cascadeBlock: {
    id: "block",
    label: "Designing your next block",
    target: 58,
    defaultMs: LLM_STEP_MS,
  },
  nextBlock: {
    id: "block",
    label: "Designing your next block",
    target: 90,
    defaultMs: LLM_STEP_MS,
  },
  initialWeek: {
    id: "week",
    label: "Building your week",
    target: 72,
    defaultMs: LLM_STEP_MS,
  },
  cascadeWeek: {
    id: "week",
    label: "Building this week's plan",
    target: 72,
    defaultMs: LLM_STEP_MS,
  },
  nextWeek: {
    id: "week",
    label: "Building next week's plan",
    target: 94,
    defaultMs: LLM_STEP_MS,
  },
  day: {
    id: "day",
    label: "Choosing today's session",
    target: 85,
    defaultMs: LLM_STEP_MS,
  },
  tomorrow: {
    id: "tomorrow",
    label: "Choosing tomorrow's session",
    target: 96,
    defaultMs: LLM_STEP_MS,
  },
  save: {
    id: "save",
    label: "Saving your plan",
    target: 98,
    defaultMs: 2_000,
  },
  reviewActivities: {
    id: "reviewActivities",
    label: "Reviewing your recent training against your plan",
    target: 99,
    defaultMs: LLM_STEP_MS,
  },
} as const satisfies Record<string, PlanGenerationStep>;
