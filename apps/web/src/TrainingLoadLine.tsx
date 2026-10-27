import {
  FORM_INTERPRETATION_LABELS,
  interpretTrainingStressBalance,
  type TrainingLoad,
} from "@killingit/shared";
import { FORM_TEXT_CLASSES } from "./formColors";

/**
 * Training stress and the fitness/fatigue snapshot for one day, with the
 * TSB interpretation. Shared by the plan and activity views so the numbers and
 * labels stay identical.
 */
export function TrainingLoadLine({
  load,
  testId,
}: {
  load: TrainingLoad;
  testId?: string;
}) {
  const form = interpretTrainingStressBalance(load.tsb);
  return (
    <p
      className="w-full text-xs text-muted-foreground tabular-nums"
      data-testid={testId}
      title="TSS: training stress score. ATL: acute load (fatigue). CTL: chronic load (fitness). TSB: training stress balance (form)."
    >
      <span className="font-medium text-foreground">
        TSS {Math.round(load.tss)}
      </span>
      {" · "}ATL {Math.round(load.atl)}
      {" · "}CTL {Math.round(load.ctl)}
      {" · "}TSB {formatSigned(load.tsb)}
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
