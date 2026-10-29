import {
  FORM_INTERPRETATION_LABELS,
  interpretTrainingStressBalance,
  type TrainingLoad,
} from "@killingit/shared";
import { FORM_TEXT_CLASSES } from "./formColors";

/** How much of each metric to spell out. */
export type TrainingLoadLineVariant = "compact" | "described";

/**
 * Training stress and the fitness/fatigue snapshot for one day, with the
 * TSB interpretation. Shared by the plan, activity, and fitness views so the
 * numbers and labels stay identical. The `described` variant spells each
 * metric out beside its acronym for the summary on the Fitness page.
 */
export function TrainingLoadLine({
  load,
  testId,
  variant = "compact",
  tss,
}: {
  load: TrainingLoad;
  testId?: string;
  variant?: TrainingLoadLineVariant;
  /** Shows this activity's TSS instead of the day's total. */
  tss?: number | null | undefined;
}) {
  const form = interpretTrainingStressBalance(load.tsb);
  const described = variant === "described";
  const metrics = [
    {
      name: "Training stress",
      short: "TSS",
      value: Math.round(tss ?? load.tss),
    },
    { name: "Fatigue", short: "ATL", value: Math.round(load.atl) },
    { name: "Fitness", short: "CTL", value: Math.round(load.ctl) },
    { name: "Form", short: "TSB", value: formatSigned(load.tsb) },
  ];

  return (
    <p
      className={
        described
          ? "w-full text-base text-muted-foreground tabular-nums"
          : "w-full text-xs text-muted-foreground tabular-nums"
      }
      data-testid={testId}
      title="TSS: training stress score. ATL: acute load (fatigue). CTL: chronic load (fitness). TSB: training stress balance (form)."
    >
      {metrics.map((metric, index) => (
        <span key={metric.short}>
          {index > 0 && " · "}
          <span className="font-medium text-foreground">
            {described
              ? `${metric.name} ${metric.value}`
              : `${metric.short} ${metric.value}`}
          </span>
          {described && ` (${metric.short})`}
        </span>
      ))}
      {" · "}
      <span className={FORM_TEXT_CLASSES[form]}>
        {FORM_INTERPRETATION_LABELS[form]}
      </span>
    </p>
  );
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
