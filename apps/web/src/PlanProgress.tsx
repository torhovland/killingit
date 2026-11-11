import type { AppBusyState } from "./AppStatus";
import { Card } from "./components/Card";

/** The step and percentage of a running plan generation. */
export interface PlanProgressState {
  step: string | null;
  progress: number;
}

const BUSY_LABELS: Record<AppBusyState, string> = {
  loading: "Loading…",
  syncing: "Syncing…",
  thinking: "The coach is thinking…",
};

/** The step shown while a fresh prompt is on its way to the coach. */
export const WAKING_STEP_LABEL = "Waking the coach…";

/**
 * The progress to show when a run begins. Only a run that sends its own prompt
 * shows the waking step; a run that tracks a generation already started on the
 * server waits for that generation to report a step instead.
 */
export function initialPlanProgress(
  request: Promise<unknown> | null,
): PlanProgressState | null {
  return request === null ? null : { step: WAKING_STEP_LABEL, progress: 0 };
}

/**
 * The plan progress panel shown while the header spinner is visible. A running
 * generation shows its step and a determinate bar; any other busy state shows
 * an indeterminate bar under the matching label.
 */
export function PlanProgress({
  progress,
  status,
}: {
  /** The running generation's progress, or null when none is running. */
  progress: PlanProgressState | null;
  /** The shared header-spinner state. */
  status: AppBusyState | "idle";
}) {
  if (progress === null && status === "idle") {
    return null;
  }

  const label =
    progress?.step ?? (status === "idle" ? "" : BUSY_LABELS[status]);

  return (
    <Card
      variant="inset"
      className="flex flex-col gap-2 rounded p-3"
      data-testid="plan-progress"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-base">
        <span className="font-medium">{label}</span>
        {progress && (
          <span className="text-muted-foreground">{progress.progress}%</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-card">
        {progress ? (
          <div
            // Match the poll interval so each small increase blends into a
            // continuous move instead of a visible step.
            className="h-full rounded bg-primary transition-[width] duration-[1500ms] ease-linear"
            // Dynamic width is the one value that must be inline.
            style={{ width: `${progress.progress}%` }}
          />
        ) : (
          <div
            className="h-full w-full animate-pulse rounded bg-primary/40"
            data-testid="plan-progress-indeterminate"
          />
        )}
      </div>
    </Card>
  );
}
