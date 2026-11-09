import type { FitnessNutritionDay } from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  FUTURE_DASH,
  lastIndexOnOrBefore,
  nullAwarePath,
  niceDomain,
} from "./chartGeometry";
import { ChartFrame } from "./ChartFrame";

/**
 * Calories logged against the coach's estimated daily requirement. Bars show
 * what the athlete logged; the line is the requirement the coach planned for
 * the same days, so the gap between them is the deficit or surplus.
 */
export function NutritionChart({
  days,
  today,
}: {
  days: readonly FitnessNutritionDay[];
  /** The last measured day; the line continues into the plan after it. */
  today: string;
}) {
  const hasNutrition = days.some(
    (day) => day.consumedKcal !== null || day.neededKcal !== null,
  );
  if (!hasNutrition) {
    return null;
  }

  const values = days.flatMap((day) => [
    ...(day.consumedKcal === null ? [] : [day.consumedKcal]),
    ...(day.neededKcal === null ? [] : [day.neededKcal]),
  ]);
  const domain = niceDomain(values, { minSpan: 1000 });
  const scale = chartScale(days.length, { min: 0, max: domain.max });
  const needed = days.map((day) => day.neededKcal);
  const barWidth = Math.max(
    2,
    (scale.plotWidth / Math.max(days.length, 1)) * 0.6,
  );
  const ticks = axisTicks({ min: 0, max: domain.max });
  // The coach's targets after today are the plan's projection, so that part of
  // the line is dotted like the other charts.
  const split = lastIndexOnOrBefore(
    days.map((day) => day.date),
    today,
  );
  const futureStart = Math.max(split, 0);
  const hasFuture = split < days.length - 1;

  return (
    <ChartFrame
      title="Calories"
      label="Calories logged per day with the coach's estimated daily requirement"
      svgTitle={`Calories logged and needed over the last ${days.length} days`}
      svgTestId="nutrition-chart"
      days={days}
      scale={scale}
      ticks={ticks}
      gridClassName="stroke-chart-ink-muted/20"
      interactive={false}
      legend={
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li className="flex items-center gap-1.5">
            <span className="block h-3 w-3 rounded-sm bg-primary/50" />
            Logged
          </li>
          <li className="flex items-center gap-1.5">
            <span className="block h-0.5 w-4 bg-chart-ink" />
            Needed
          </li>
        </ul>
      }
      footer={
        <p className="text-sm text-muted-foreground">
          The line is your coach's estimate for each day; bars are the calories
          in the meals analysed that day. Days without a bar have no analysed
          meal.
          {days.some((day) => day.date > today && day.neededKcal !== null) &&
            " Days after today are the plan's projection."}
        </p>
      }
    >
      {() => (
        <>
          {days.map((day, index) => {
            if (day.consumedKcal === null) {
              return null;
            }
            const height = Math.max(0, scale.y(0) - scale.y(day.consumedKcal));
            return (
              <rect
                key={day.date}
                x={scale.x(index) - barWidth / 2}
                y={scale.y(0) - height}
                width={barWidth}
                height={height}
                className="fill-primary/50"
                data-series="consumed"
              >
                <title>
                  {`${formatChartDate(day.date)}: ${day.consumedKcal} kcal logged`}
                </title>
              </rect>
            );
          })}
          <path
            d={nullAwarePath(needed, scale, 0, split)}
            className="fill-none stroke-chart-ink"
            strokeWidth={2}
            data-series="needed"
          />
          {hasFuture && (
            <path
              d={nullAwarePath(needed, scale, futureStart, days.length - 1)}
              className="fill-none stroke-chart-ink"
              strokeWidth={2}
              strokeDasharray={FUTURE_DASH}
              data-series="needed"
              data-future="true"
            />
          )}
        </>
      )}
    </ChartFrame>
  );
}
