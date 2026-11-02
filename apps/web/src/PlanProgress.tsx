import type { AppBusyState } from "./AppStatus";

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
    <div
      className="flex flex-col gap-2 rounded border bg-inset p-3"
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
    </div>
  );
}
