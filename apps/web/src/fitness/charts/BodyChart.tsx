import { useState } from "react";
import {
  chartPath,
  datedPathPoints,
  formatChartDate,
  FUTURE_DASH,
  roundChartValue,
} from "../../charts/chartGeometry";
import { ChartFrame } from "../../charts/ChartFrame";
import { ChartLegend } from "../../charts/ChartLegend";
import {
  bodyLegendItems,
  bodyValuesAt,
  prepareBodyChart,
  type BodyChartInput,
} from "./bodyChartData";

/** The dotted dash of the coach's target line, longer than the best-fit one. */
const TARGET_DASH = "5 4";

/** The Body chart's inputs, shared by the pure chart and its toggle wrapper. */
export interface BodyChartProps extends BodyChartInput {
  /** Selects the season view. */
  onShowFutureChange?: (show: boolean) => void;
}

/**
 * Body weight and body-fat percentage over the same window as the fitness
 * charts. Weight uses the left axis and body fat the right axis, so both trends
 * can share one plot without one hiding the other; each axis shows plain
 * numbers because the legend names its unit. Values between measurements are
 * interpolated by the API; the part after today is a best-fit projection and is
 * drawn dotted. When the athlete chooses the season view, the coach's diet
 * targets are drawn as a second dotted line with markers.
 *
 * The series, scales and target lines are prepared in `bodyChartData.ts`.
 */
function BodyChart({ onShowFutureChange, ...input }: BodyChartProps) {
  const data = prepareBodyChart(input);
  if (data === null) {
    return null;
  }
  const weight = data.weight;
  const bodyFat = data.bodyFat;

  return (
    <ChartFrame
      title="Body"
      label="Body weight and body-fat percentage chart"
      svgTitle={`Body weight and body fat over ${data.chartDays.length} days`}
      svgTestId="body-chart"
      days={data.chartDays}
      scale={data.yScale}
      ticks={data.ticks}
      gridTicks={data.gridTicks}
      gridClassName="stroke-chart-ink-muted/20"
      rightTicks={data.rightTicks}
      rightScale={bodyFat?.scale}
      tooltipClassName="w-44"
      headerAction={
        data.canShowFuture && onShowFutureChange !== undefined ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={input.showFuture ?? false}
              onChange={(event) => onShowFutureChange(event.target.checked)}
              data-testid="body-chart-future-toggle"
            />
            Include future dates to the end of the season
          </label>
        ) : undefined
      }
      tooltip={(hovered) => {
        const values = bodyValuesAt(data, hovered.day.date);
        return (
          <>
            <p className="font-medium">{formatChartDate(hovered.day.date)}</p>
            {values.weight !== null && <p>Weight {values.weight} kg</p>}
            {values.targetWeight !== null && (
              <p>Target weight {roundChartValue(values.targetWeight)} kg</p>
            )}
            {values.fat !== null && <p>Body fat {values.fat}%</p>}
            {values.targetFat !== null && (
              <p>Target body fat {roundChartValue(values.targetFat)}%</p>
            )}
            {values.weight === null &&
              values.fat === null &&
              values.targetWeight === null &&
              values.targetFat === null && (
                <p className="text-muted-foreground">No measurement</p>
              )}
          </>
        );
      }}
      legend={<ChartLegend items={bodyLegendItems(data)} />}
    >
      {(hovered) => {
        const values = bodyValuesAt(data, hovered?.day.date ?? null);
        return (
          <>
            {weight !== null && (
              <>
                <path
                  d={chartPath(
                    datedPathPoints(weight.points, data.dayIndex, {
                      to: data.split,
                    }),
                    weight.scale,
                  )}
                  className="fill-none stroke-primary"
                  strokeWidth={2.5}
                  data-series="weight"
                />
                <path
                  d={chartPath(
                    datedPathPoints(weight.points, data.dayIndex, {
                      from: Math.max(data.split, 0),
                    }),
                    weight.scale,
                  )}
                  className="fill-none stroke-primary"
                  strokeWidth={2.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="weight"
                  data-future="true"
                />
              </>
            )}
            {bodyFat !== null && (
              <>
                <path
                  d={chartPath(
                    datedPathPoints(bodyFat.points, data.dayIndex, {
                      to: data.split,
                    }),
                    bodyFat.scale,
                  )}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  data-series="body-fat"
                />
                <path
                  d={chartPath(
                    datedPathPoints(bodyFat.points, data.dayIndex, {
                      from: Math.max(data.split, 0),
                    }),
                    bodyFat.scale,
                  )}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="body-fat"
                  data-future="true"
                />
              </>
            )}
            {weight !== null && data.weightTargets.length > 0 && (
              <>
                <path
                  d={chartPath(
                    datedPathPoints(data.weightTargets, data.dayIndex),
                    weight.scale,
                  )}
                  className="fill-none stroke-chart-ink"
                  strokeWidth={2}
                  strokeDasharray={TARGET_DASH}
                  data-series="diet-target-weight"
                />
                {data.weightTargets.slice(1).map((point) => (
                  <circle
                    key={`weight-target-${point.date}`}
                    cx={weight.scale.x(data.dayIndex.get(point.date) ?? 0)}
                    cy={weight.scale.y(point.value)}
                    r={2.5}
                    className="fill-chart-ink"
                    data-target-date={point.date}
                  />
                ))}
              </>
            )}
            {bodyFat !== null && data.fatTargets.length > 0 && (
              <>
                <path
                  d={chartPath(
                    datedPathPoints(data.fatTargets, data.dayIndex),
                    bodyFat.scale,
                  )}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  strokeDasharray={TARGET_DASH}
                  data-series="diet-target-body-fat"
                />
                {data.fatTargets.slice(1).map((point) => (
                  <circle
                    key={`fat-target-${point.date}`}
                    cx={bodyFat.scale.x(data.dayIndex.get(point.date) ?? 0)}
                    cy={bodyFat.scale.y(point.value)}
                    r={2.5}
                    className="fill-chart-ink-muted"
                    data-target-date={point.date}
                  />
                ))}
              </>
            )}
            {hovered !== null && values.weight !== null && weight !== null && (
              <circle
                cx={hovered.x}
                cy={weight.scale.y(values.weight)}
                r={3.5}
                className="fill-primary"
              />
            )}
            {hovered !== null && values.fat !== null && bodyFat !== null && (
              <circle
                cx={hovered.x}
                cy={bodyFat.scale.y(values.fat)}
                r={3.5}
                className="fill-chart-ink-muted"
              />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}

/**
 * The Body chart with its season-view toggle. Kept separate so the chart itself
 * stays controlled and easy to render in tests.
 */
export function BodyChartSection(
  props: Omit<BodyChartProps, "showFuture" | "onShowFutureChange">,
) {
  const [showFuture, setShowFuture] = useState(false);
  return (
    <BodyChart
      {...props}
      showFuture={showFuture}
      onShowFutureChange={setShowFuture}
    />
  );
}
