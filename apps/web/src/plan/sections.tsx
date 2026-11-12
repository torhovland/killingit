import type { ReactNode } from "react";
import {
  formatThresholdValue,
  type DietProgress,
  type ThresholdSummary,
} from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { Card } from "../components/Card";

/** Dimmed overlay shown while a plan level is being replaced in flight. */
export function RefreshingOverlay({
  label,
  testId,
}: {
  /** Possessive name of the level, such as `today's` or `this week's`. */
  label: string;
  testId: string;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-inset/60"
      data-testid={testId}
    >
      <span
        className="inline-flex size-6 animate-spin rounded-full border-2 border-current border-t-transparent text-primary"
        role="status"
        aria-label={`Updating ${label} plan`}
      />
      <span className="text-base text-muted-foreground">
        Updating {label} plan…
      </span>
    </div>
  );
}

/** The athlete's known threshold measures in a compact, inline list. */
export function ThresholdsLine({
  thresholds,
  testId,
  inline = false,
}: {
  thresholds: readonly ThresholdSummary[];
  testId: string;
  /** True when the line sits inside an existing paragraph. */
  inline?: boolean;
}) {
  const content = (
    <span data-testid={testId}>
      {inline && <Bullet />}
      <span className="font-medium">Thresholds</span>
      {thresholds.map((entry) => (
        <span key={`${entry.sport}:${entry.measure}`}>
          <Bullet />
          {entry.sport} {entry.label}{" "}
          <span className="font-medium">
            {formatThresholdValue(entry.value, entry.unit, entry.kind)}
          </span>
        </span>
      ))}
    </span>
  );
  return inline ? content : <p className="text-base">{content}</p>;
}

/** The coach's body-composition target for the end of a plan period. */
export function DietProgressLine({
  progress,
  period,
  testId,
}: {
  progress: DietProgress;
  /** The period named in the label, such as `the block`. */
  period: string;
  testId: string;
}) {
  const targets: string[] = [];
  if (progress.targetWeightKg !== null) {
    targets.push(`${progress.targetWeightKg.toFixed(1)} kg`);
  }
  if (progress.targetBodyFatPercent !== null) {
    targets.push(`${progress.targetBodyFatPercent.toFixed(1)} % body fat`);
  }
  return (
    <Card
      className="mt-3 flex flex-col gap-1 rounded p-3 text-base"
      data-testid={testId}
    >
      <p>
        <span className="font-medium">
          Diet target by the end of {period}:{" "}
        </span>
        {targets.length > 0 ? targets.join(" and ") : "no numeric target"}
      </p>
      <FormattedText
        text={progress.note}
        className="text-muted-foreground"
        testId={`${testId}-note`}
      />
    </Card>
  );
}

/** List shared by the block and season views, with the Week tab's rules. */
export function PlanList({ children }: { children: ReactNode }) {
  return <ol className="mt-4 flex flex-col gap-3 text-base">{children}</ol>;
}

export function PlanListItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
      {children}
    </li>
  );
}
