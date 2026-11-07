import { COST_SERIES_SWATCH } from "./costColors";
import {
  formatCallCount,
  formatCostUsd,
  type CostBucket,
  type CostSeriesTotal,
} from "./costChart";

/**
 * The hover card for one cost bar: the period's total spend and call count,
 * then each series' spend and call count.
 */
export function CostTooltip({
  bucket,
  series: totals,
  left,
}: {
  bucket: CostBucket;
  series: readonly CostSeriesTotal[];
  left: string;
}) {
  const parts = [...bucket.parts]
    .filter((part) => part.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
  const calls = bucket.parts.reduce((sum, part) => sum + part.calls, 0);
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-60 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
      style={{ left }}
      data-testid="cost-tooltip"
    >
      <p className="font-medium">{bucket.title}</p>
      <p className="text-muted-foreground">
        {formatCostUsd(bucket.totalUsd)}
        {calls > 0 && ` · ${formatCallCount(calls)}`}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {parts.map((part) => {
          const entry = totals.find((item) => item.series === part.series);
          const index = entry === undefined ? -1 : totals.indexOf(entry);
          return (
            <li
              key={part.series}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`inline-block size-2.5 shrink-0 rounded-sm ${
                    COST_SERIES_SWATCH[
                      Math.max(0, index) % COST_SERIES_SWATCH.length
                    ]
                  }`}
                />
                <span className="truncate">{entry?.label ?? part.series}</span>
              </span>
              <span className="shrink-0" data-testid="cost-tooltip-series">
                {formatCostUsd(part.costUsd)}
                <span className="text-muted-foreground">
                  {` · ${formatCallCount(part.calls)}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
