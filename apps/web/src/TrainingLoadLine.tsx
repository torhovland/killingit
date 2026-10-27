import {
  FORM_INTERPRETATION_LABELS,
  interpretTrainingStressBalance,
  type FormInterpretation,
  type TrainingLoad,
} from "@killingit/shared";

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
      <span className={formClass(form)}>
        {FORM_INTERPRETATION_LABELS[form]}
      </span>
    </p>
  );
}

const FORM_CLASSES: Record<FormInterpretation, string> = {
  risk: "font-medium text-form-risk",
  productive: "font-medium text-form-productive",
  maintaining: "text-form-maintaining",
  fresh: "text-form-fresh",
  detraining: "text-form-detraining",
};

function formClass(interpretation: FormInterpretation): string {
  return FORM_CLASSES[interpretation];
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
