import { z } from "zod";

/**
 * The training-load contract the wire carries, plus the form interpretation
 * both sides read. The load maths — normalized power, training stress scores
 * and the daily exponentially weighted series — lives in
 * `apps/api/src/training/stress.ts`, because only the API computes it. See
 * ADR 0055.
 */

/** Training load for one day: stress plus the fitness/fatigue snapshot. */
export const trainingLoadSchema = z.object({
  /** Training stress score for the day (0 on a rest day). */
  tss: z.number().nonnegative().max(10000),
  /** Acute training load: a 7-day exponentially weighted average of TSS. */
  atl: z.number().nonnegative().max(10000),
  /** Chronic training load: a 42-day exponentially weighted average of TSS. */
  ctl: z.number().nonnegative().max(10000),
  /** Training stress balance for the day (`ctl - atl`). */
  tsb: z.number().min(-10000).max(10000),
});

export type TrainingLoad = z.infer<typeof trainingLoadSchema>;

/** How the athlete should read today's training stress balance. */
export const formInterpretationSchema = z.enum([
  "risk",
  "productive",
  "maintaining",
  "fresh",
  "detraining",
]);

export type FormInterpretation = z.infer<typeof formInterpretationSchema>;

/** Display labels for each TSB interpretation. */
export const FORM_INTERPRETATION_LABELS: Record<FormInterpretation, string> = {
  risk: "Risk",
  productive: "Productive",
  maintaining: "Maintaining",
  fresh: "Fresh",
  detraining: "Detraining",
};

/** A training-stress-balance band on the fitness chart. */
export interface FormZone {
  interpretation: FormInterpretation;
  /** Inclusive lower bound; `-Infinity` for the lowest band. */
  from: number;
  /** Exclusive upper bound; `Infinity` for the highest band. */
  to: number;
}

/**
 * The TSB bands, lowest first, matching `interpretTrainingStressBalance`. Used
 * to shade the fitness chart, so the bands and the interpretation text always
 * describe the same ranges. The label function keeps `+25` inside `Fresh`; the
 * chart's half-open bands differ only at that single boundary point.
 */
export const FORM_ZONES: readonly FormZone[] = [
  { interpretation: "risk", from: -Infinity, to: -30 },
  { interpretation: "productive", from: -30, to: -10 },
  { interpretation: "maintaining", from: -10, to: 5 },
  { interpretation: "fresh", from: 5, to: 25 },
  { interpretation: "detraining", from: 25, to: Infinity },
];

/**
 * Reads the training stress balance as a plain-language form state:
 *
 * - above +25: detraining
 * - +5 to +25: fresh
 * - −10 to +5: maintaining
 * - −30 to −10: productive
 * - below −30: risk
 */
export function interpretTrainingStressBalance(
  tsb: number,
): FormInterpretation {
  if (tsb > 25) {
    return "detraining";
  }
  if (tsb >= 5) {
    return "fresh";
  }
  if (tsb >= -10) {
    return "maintaining";
  }
  if (tsb >= -30) {
    return "productive";
  }
  return "risk";
}
