import type { FitnessHistoryDay } from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  nullAwarePath,
} from "../../charts/chartGeometry";
import { ChartFrame } from "../../charts/ChartFrame";
import { ChartLegend } from "../../charts/ChartLegend";
import { cn } from "../../components/cn";
import type { HealthLineChartData, HealthSeries } from "./dailyHealthData";

/**
 * The recovery card shared by the resting-heart-rate and score charts. The
 * series and y domain are prepared in `dailyHealthData.ts`.
 */
export function HealthLineChart({
  title,
  subtitle,
  days,
  data,
  formatTick,
}: {
  title: string;
  subtitle?: string;
  days: readonly FitnessHistoryDay[];
  data: HealthLineChartData;
  formatTick: (value: number) => string;
}) {
  const scale = chartScale(days.length, data.domain);
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      label={`${title} chart`}
      svgTitle={title}
      days={days}
      scale={scale}
      ticks={axisTicks(data.domain)}
      formatTick={formatTick}
      tooltipTestId="health-chart-tooltip"
      tooltip={(hovered) => {
        const index = days.findIndex((day) => day.date === hovered.day.date);
        return (
          <>
            <p className="text-base font-medium">
              {formatChartDate(hovered.day.date)}
            </p>
            <HealthTooltip
              series={data.series}
              index={index}
              date={hovered.day.date}
            />
          </>
        );
      }}
      legend={
        <ChartLegend
          items={data.series.map((entry) => ({
            key: entry.key,
            label: entry.label,
            swatch: entry.swatch,
          }))}
        />
      }
    >
      {() =>
        data.series.map((entry) => (
          <path
            key={entry.key}
            d={nullAwarePath(entry.values, scale, 0, days.length - 1)}
            className={cn("fill-none", entry.stroke)}
            strokeWidth={2}
            data-series={entry.key}
          />
        ))
      }
    </ChartFrame>
  );
}

function HealthTooltip({
  series,
  index,
  date,
}: {
  series: readonly HealthSeries[];
  index: number;
  date: string;
}) {
  const values = series.flatMap((entry) => {
    const value = index < 0 ? null : entry.values[index];
    return value === null || value === undefined
      ? []
      : [{ label: entry.label, value: entry.format(value) }];
  });
  if (values.length === 0) {
    return <p className="text-muted-foreground">No Garmin data on {date}</p>;
  }
  return (
    <ul className="text-muted-foreground">
      {values.map((entry) => (
        <li key={entry.label}>
          <span className="font-medium text-foreground">{entry.label}</span>{" "}
          {entry.value}
        </li>
      ))}
    </ul>
  );
}
