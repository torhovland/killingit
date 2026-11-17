import type {
  FitnessHistoryDay,
  ThresholdHistorySeries,
} from "@killingit/shared";

/** One threshold line with its value on every chart day and its per-day lookup. */
export interface ThresholdSeriesData {
  series: ThresholdHistorySeries;
  /** The value on every chart day, aligned with the days handed in. */
  values: readonly (number | null)[];
  /** The measured value by date, so the hover card is a lookup. */
  byDate: ReadonlyMap<string, number>;
}

/**
 * Pairs every threshold series with the chart's days once, so the plotted line
 * and its hover card read the same per-day values instead of searching the
 * series' points again.
 */
export function prepareThresholdSeries(
  days: readonly Pick<FitnessHistoryDay, "date">[],
  series: readonly ThresholdHistorySeries[],
): ThresholdSeriesData[] {
  return series.map((entry) => {
    const byDate = new Map(
      entry.points.map((point) => [point.date, point.value]),
    );
    return {
      series: entry,
      values: days.map((day) => byDate.get(day.date) ?? null),
      byDate,
    };
  });
}
