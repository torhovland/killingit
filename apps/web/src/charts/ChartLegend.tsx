import { cn } from "../components/cn";

/** The geometry of a legend swatch. */
export type ChartLegendSwatchShape = "line" | "bar" | "square" | "plot-line";

/** A swatch shape, or `none` for a text-only entry. */
export type ChartLegendSwatch = ChartLegendSwatchShape | "none";

/** One entry in a chart's legend: a swatch and its label, or the label alone. */
export interface ChartLegendItem {
  /** The entry's React key. */
  key: string;
  label: string;
  /** The swatch's colour classes; omit for a text-only entry. */
  swatch?: string | undefined;
  /** Extra swatch classes, such as a top margin. */
  swatchClassName?: string | undefined;
  /** The swatch shape; `none` draws a text-only entry. Defaults to `line`. */
  swatchShape?: ChartLegendSwatch | undefined;
  /** A muted detail after the label, such as `cycling · W`. */
  detail?: string | undefined;
  /** The label's classes; defaults to `font-medium`, `null` leaves it bare. */
  text?: string | null | undefined;
  /** Extra classes for the list item, such as a tighter gap. */
  className?: string | undefined;
  /** A test id for the list item, when a test asserts a specific entry. */
  testId?: string | undefined;
}

const SWATCH_SHAPE_CLASSES: Record<ChartLegendSwatchShape, string> = {
  line: "inline-block h-0.5 w-4",
  bar: "inline-block h-3 w-4",
  square: "inline-block size-2.5 rounded-sm",
  "plot-line":
    "flex h-3 w-6 items-center justify-center rounded-sm bg-chart-plot",
};

/**
 * The legend lines up with the plot's left edge rather than the axis gutter:
 * `CHART_PADDING.left` of the `CHART_WIDTH` viewBox, or 6.25%. Tailwind needs a
 * literal utility class, so the value is written here once;
 * `ChartLegend.test.tsx` keeps it in step with the chart geometry.
 */
export const CHART_LEGEND_INSET_CLASS = "pl-[6.25%]";

/**
 * The legend under a chart: one list item per series, each with a coloured
 * swatch, its label and an optional muted detail. The sleep chart's "Awake"
 * entry is text alone. See `docs/specs/web-component-library.md`.
 */
export function ChartLegend({
  items,
  className,
  testId,
}: {
  items: readonly ChartLegendItem[];
  /** Extra classes for the list, such as the plot inset. */
  className?: string | undefined;
  /** A test id for the list, when a test asserts a chart's legend. */
  testId?: string | undefined;
}) {
  return (
    <ul
      className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm", className)}
      data-testid={testId}
    >
      {items.map((item) => (
        <li
          key={item.key}
          className={cn("flex items-center gap-1.5", item.className)}
          data-testid={item.testId}
        >
          <ChartLegendSwatch item={item} />
          <span
            className={
              item.text === undefined ? "font-medium" : (item.text ?? undefined)
            }
          >
            {item.label}
          </span>
          {item.detail !== undefined && (
            <span className="text-muted-foreground">{item.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChartLegendSwatch({ item }: { item: ChartLegendItem }) {
  const shape = item.swatchShape ?? "line";
  if (shape === "none") {
    return null;
  }
  if (shape === "plot-line") {
    return (
      <span
        className={cn(SWATCH_SHAPE_CLASSES[shape], item.swatchClassName)}
        aria-hidden="true"
      >
        <span className={cn("block h-0.5 w-4", item.swatch)} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        SWATCH_SHAPE_CLASSES[shape],
        item.swatch,
        item.swatchClassName,
      )}
      aria-hidden="true"
    />
  );
}
