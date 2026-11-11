import {
  allocatedCaloriesKcal,
  type CalorieBreakdown,
} from "@killingit/shared";
import { Card } from "./components/Card";

/**
 * The day's calorie requirement, intake and remaining allowance. Shared by the
 * Today plan and the Diet page so both read the same numbers the same way. When
 * the coach supplied a breakdown, the requirement is shown as base metabolism
 * plus the workout requirement minus the diet deficit.
 */
export function CalorieBalancePanel({
  neededKcal,
  breakdown = null,
  consumedKcal,
  title = "Calories",
  testId = "calorie-balance",
}: {
  /** The coach's estimate for the day, or null when no plan covers it. */
  neededKcal: number | null;
  /** The coach's breakdown of the estimate, when it supplied one. */
  breakdown?: CalorieBreakdown | null;
  /** Calories from analysed meals, or null when nothing was logged. */
  consumedKcal: number | null;
  title?: string;
  testId?: string;
}) {
  if (neededKcal === null && breakdown === null && consumedKcal === null) {
    return null;
  }
  const allocated =
    breakdown === null ? neededKcal : allocatedCaloriesKcal(breakdown);
  const remaining =
    allocated !== null && consumedKcal !== null
      ? allocated - consumedKcal
      : null;

  return (
    <Card
      variant="inset"
      className="flex flex-col gap-2 rounded p-3"
      data-testid={testId}
    >
      <p className="text-base font-medium">{title}</p>
      {breakdown === null ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-base">
          <Stat
            label="Needed"
            value={neededKcal === null ? "—" : `${neededKcal} kcal`}
          />
        </dl>
      ) : (
        <dl
          className="flex flex-col gap-0.5 text-base"
          data-testid={`${testId}-breakdown`}
        >
          <BreakdownRow
            label="Base metabolism"
            value={`${breakdown.basalMetabolismKcal} kcal`}
          />
          <BreakdownRow
            label="Workout requirement"
            value={`+${breakdown.workoutCaloriesKcal} kcal`}
          />
          <BreakdownRow
            label={deficitLabel(breakdown.dietDeficitKcal)}
            value={deficitValue(breakdown.dietDeficitKcal)}
          />
          <BreakdownRow
            label="Allocated today"
            value={allocated === null ? "—" : `${allocated} kcal`}
            emphasised
          />
        </dl>
      )}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-base">
        <Stat
          label="Logged"
          value={consumedKcal === null ? "Nothing yet" : `${consumedKcal} kcal`}
        />
        <Stat
          label="Remaining"
          value={
            remaining === null
              ? "—"
              : remaining >= 0
                ? `${remaining} kcal`
                : `${Math.abs(remaining)} kcal over`
          }
        />
      </dl>
      {breakdown !== null && (
        <p className="text-sm text-muted-foreground">
          These are estimates. They become more accurate as you log meals and
          weight.
        </p>
      )}
    </Card>
  );
}

function deficitLabel(deficitKcal: number): string {
  return deficitKcal < 0 ? "Diet surplus" : "Diet deficit";
}

function deficitValue(deficitKcal: number): string {
  if (deficitKcal === 0) {
    return "0 kcal";
  }
  return deficitKcal < 0
    ? `+${Math.abs(deficitKcal)} kcal`
    : `−${deficitKcal} kcal`;
}

function BreakdownRow({
  label,
  value,
  emphasised = false,
}: {
  label: string;
  value: string;
  emphasised?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasised ? "font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
