/**
 * The day's calorie requirement, intake and remaining allowance. Shared by the
 * Today plan and the Diet page so both read the same numbers the same way.
 */
export function CalorieBalancePanel({
  neededKcal,
  consumedKcal,
  title = "Calories",
  testId = "calorie-balance",
}: {
  /** The coach's estimate for the day, or null when no plan covers it. */
  neededKcal: number | null;
  /** Calories from analysed meals, or null when nothing was logged. */
  consumedKcal: number | null;
  title?: string;
  testId?: string;
}) {
  if (neededKcal === null && consumedKcal === null) {
    return null;
  }
  const remaining =
    neededKcal !== null && consumedKcal !== null
      ? neededKcal - consumedKcal
      : null;

  return (
    <div
      className="flex flex-col gap-1 rounded border bg-inset p-3"
      data-testid={testId}
    >
      <p className="text-base font-medium">{title}</p>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-base">
        <Stat
          label="Needed"
          value={neededKcal === null ? "—" : `${neededKcal} kcal`}
        />
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
