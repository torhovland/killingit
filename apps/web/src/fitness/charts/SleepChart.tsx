import {
  formatDailyHealthValue,
  type FitnessHistoryDay,
} from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  roundChartValue,
  type ChartScale,
} from "../../charts/chartGeometry";
import { ChartFrame } from "../../charts/ChartFrame";
import { ChartLegend } from "../../charts/ChartLegend";
import { sleepLegendItems, type SleepChartData } from "./dailyHealthData";

/**
 * The stacked sleep-stage chart. Its layers, totals and domain are prepared in
 * `dailyHealthData.ts`.
 */
export function SleepChart({
  days,
  data,
}: {
  days: readonly FitnessHistoryDay[];
  data: SleepChartData;
}) {
  const scale = chartScale(days.length, data.domain);
  return (
    <ChartFrame
      title="Sleep"
      subtitle="Stacked stages add up to sleep duration."
      label="Sleep stages chart"
      svgTitle="Sleep stages"
      svgTestId="sleep-chart"
      days={days}
      scale={scale}
      ticks={axisTicks(data.domain)}
      formatTick={formatSleepAxis}
      tooltipTestId="sleep-chart-tooltip"
      tooltip={(hovered) => {
        const index = days.findIndex((day) => day.date === hovered.day.date);
        return (
          <>
            <p className="text-base font-medium">
              {formatChartDate(hovered.day.date)}
            </p>
            <ul className="text-muted-foreground">
              {data.series.map((entry) => {
                const value = index < 0 ? null : entry.values[index];
                return value === null || value === undefined ? null : (
                  <li key={entry.key}>
                    <span className="font-medium text-foreground">
                      {entry.label}
                    </span>{" "}
                    {entry.format(value)}
                  </li>
                );
              })}
              {index >= 0 && data.awake[index] != null && (
                <li>
                  <span className="font-medium text-foreground">Awake</span>{" "}
                  {formatDailyHealthValue(
                    "awake_sleep",
                    data.awake[index] ?? 0,
                  )}
                </li>
              )}
              {data.total[index] != null && (
                <li>
                  <span className="font-medium text-foreground">
                    Sleep duration
                  </span>{" "}
                  {formatDailyHealthValue(
                    "sleep_duration",
                    data.total[index] ?? 0,
                  )}
                </li>
              )}
            </ul>
          </>
        );
      }}
      legend={<ChartLegend items={sleepLegendItems(data)} />}
    >
      {() =>
        data.layers.map((layer) => (
          <path
            key={layer.key}
            d={stackedAreaPath(layer.top, layer.bottom, scale)}
            className={layer.className}
            strokeWidth={1}
            data-series={layer.key}
          />
        ))
      }
    </ChartFrame>
  );
}

function formatSleepAxis(value: number): string {
  return `${Math.round(value / 60)}h`;
}

/** A stacked area segment, breaking wherever a component is missing. */
function stackedAreaPath(
  top: readonly (number | null)[],
  bottom: readonly (number | null)[],
  scale: ChartScale,
): string {
  let path = "";
  let run: number[] = [];
  const flush = (): void => {
    if (run.length === 0) {
      return;
    }
    const forward = run.map(
      (index) =>
        `${roundChartValue(scale.x(index))} ${roundChartValue(scale.y(top[index] ?? 0))}`,
    );
    const backward = [...run]
      .reverse()
      .map(
        (index) =>
          `${roundChartValue(scale.x(index))} ${roundChartValue(scale.y(bottom[index] ?? 0))}`,
      );
    path += `M${forward.join(" L")} L${backward.join(" L")} Z `;
    run = [];
  };
  for (let index = 0; index < top.length; index += 1) {
    if (top[index] == null || bottom[index] == null) {
      flush();
      continue;
    }
    run.push(index);
  }
  flush();
  return path.trim();
}
