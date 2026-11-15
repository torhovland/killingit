import type { DailyHealthPoint, FitnessHistoryDay } from "@killingit/shared";
import { prepareDailyHealthCharts } from "./dailyHealthData";
import { HealthLineChart } from "./HealthLineChart";
import { SleepChart } from "./SleepChart";

/**
 * Recovery and sleep charts on the Fitness page. Each chart hides itself when
 * Garmin has not recorded its measures; the shaping lives in
 * `dailyHealthData.ts`.
 */
export function DailyHealthCharts({
  days,
  points,
}: {
  days: readonly FitnessHistoryDay[];
  points: readonly DailyHealthPoint[];
}) {
  const data = prepareDailyHealthCharts(days, points);
  if (data === null) {
    return null;
  }
  const hasRecovery = data.restingHeartRate !== null || data.score !== null;
  return (
    <section className="flex flex-col gap-4" data-testid="daily-health-charts">
      <h3 className="text-lg font-medium">Recovery and sleep</h3>
      {hasRecovery && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.restingHeartRate !== null && (
            <HealthLineChart
              title="Resting heart rate"
              subtitle="bpm"
              days={days}
              data={data.restingHeartRate}
              formatTick={(value) => `${Math.round(value)}`}
            />
          )}
          {data.score !== null && (
            <HealthLineChart
              title="Score"
              subtitle="Body Battery high, sleep score and stress"
              days={days}
              data={data.score}
              formatTick={(value) => `${Math.round(value)}`}
            />
          )}
        </div>
      )}
      {data.sleep !== null && <SleepChart days={days} data={data.sleep} />}
    </section>
  );
}
