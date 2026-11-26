import type { ReactNode } from "react";
import {
  formatThresholdValue,
  type BlockSubGoal,
  type BlockSubGoalRole,
  type DietProgress,
  type SeasonGoal,
  type ThresholdSummary,
} from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { Spinner } from "../Spinner";
import { Card } from "../components/Card";
import { formatPlanDate } from "./formatPlanDate";

const SUB_GOAL_ROLE_LABELS: Record<BlockSubGoalRole, string> = {
  build: "Build",
  maintain: "Maintain",
  "accept-decline": "Accept decline",
};

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
      <Spinner
        className="size-6 text-primary"
        label={`Updating ${label} plan`}
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

/** The season's dated goals and their priorities. */
export function SeasonGoalList({
  goals,
  testId,
}: {
  goals: readonly SeasonGoal[] | undefined;
  testId: string;
}) {
  if (goals === undefined || goals.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-col gap-1 text-base" data-testid={testId}>
      <p className="font-medium">Season goals</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        {goals.map((goal) => (
          <li key={`${goal.date}-${goal.title}`}>
            <span className="font-medium">
              {goal.dateText ?? formatPlanDate(goal.date)} ({goal.priority})
            </span>
            <Bullet />
            {goal.title}: {goal.target}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One target as a complete sentence, capitalised and punctuated for display. */
function subGoalTargetSentence(target: string): string {
  const trimmed = target.trim();
  if (trimmed === "") {
    return trimmed;
  }
  const sentence = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** What a block does for every goal still ahead. */
export function SubGoalList({
  subGoals,
  goals,
  testId,
}: {
  subGoals: readonly BlockSubGoal[] | undefined;
  goals?: readonly SeasonGoal[] | undefined;
  testId: string;
}) {
  if (subGoals === undefined || subGoals.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-col gap-1 text-base" data-testid={testId}>
      <p className="font-medium">Block goals</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        {subGoals.map((subGoal) => {
          const goal = goals?.find((entry) => entry.date === subGoal.goalDate);
          const goalDate = goal?.dateText ?? formatPlanDate(subGoal.goalDate);
          return (
            <li
              key={`${subGoal.goalDate}-${subGoal.goalTitle}-${subGoal.byDate}-${subGoal.target}`}
              className="flex flex-col gap-0.5"
            >
              <p>
                <span className="font-medium">
                  {SUB_GOAL_ROLE_LABELS[subGoal.role]}:
                </span>{" "}
                {subGoalTargetSentence(subGoal.target)}
              </p>
              <p className="text-sm text-muted-foreground">
                Due {formatPlanDate(subGoal.byDate)} · Goal: {subGoal.goalTitle}{" "}
                ({goalDate})
              </p>
            </li>
          );
        })}
      </ul>
    </div>
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
