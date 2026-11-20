import type { ComponentProps, ReactNode } from "react";
import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  formatChartDate,
  labelIndices,
  type ChartScale,
} from "./chartGeometry";
import { useChartHover, type HoveredChartDay } from "./useChartHover";
import { cn } from "../components/cn";
import { CHART_KEYBOARD_HINT } from "./useChartKeyboard";

/** The visible heading, its subtitle and any control beside them. */
function ChartHeader({
  title,
  subtitle,
  headerAction,
}: {
  title: string | undefined;
  subtitle: string | undefined;
  headerAction: ReactNode;
}) {
  if (
    title === undefined &&
    subtitle === undefined &&
    headerAction === undefined
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <figcaption className="flex flex-col">
        {title !== undefined && (
          <span className="text-lg font-medium">{title}</span>
        )}
        {subtitle !== undefined && (
          <span className="text-sm text-muted-foreground">{subtitle}</span>
        )}
      </figcaption>
      {headerAction}
    </div>
  );
}

/** The horizontal grid lines and the hovered day's vertical guide. */
function ChartGrid({
  grid,
  scale,
  gridClassName,
  hovered,
  hoverLineClassName,
}: {
  grid: readonly number[];
  scale: ChartScale;
  gridClassName: string;
  hovered: { x: number } | null;
  hoverLineClassName: string;
}) {
  return (
    <>
      {grid.map((tick) => (
        <line
          key={tick}
          x1={0}
          x2={scale.plotWidth}
          y1={scale.y(tick)}
          y2={scale.y(tick)}
          className={gridClassName}
          strokeWidth={1}
        />
      ))}
      {hovered !== null && (
        <line
          x1={hovered.x}
          x2={hovered.x}
          y1={0}
          y2={scale.plotHeight}
          className={hoverLineClassName}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
    </>
  );
}

/** The left-axis tick labels. */
function ChartYAxis({
  ticks,
  scale,
  formatTick,
}: {
  ticks: readonly number[];
  scale: ChartScale;
  formatTick: ((value: number) => string) | undefined;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <text
          key={tick}
          x={CHART_PADDING.left - 6}
          y={CHART_PADDING.top + scale.y(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {formatTick?.(tick) ?? tick}
        </text>
      ))}
    </>
  );
}

/** The optional right-axis tick labels. */
function ChartRightAxis({
  rightTicks,
  rightScale,
  scale,
  formatRightTick,
}: {
  rightTicks: readonly number[] | undefined;
  rightScale: ChartScale | undefined;
  scale: ChartScale;
  formatRightTick: ((value: number) => string) | undefined;
}) {
  return (
    <>
      {rightTicks?.map((tick) => (
        <text
          key={`right-${tick}`}
          x={CHART_PADDING.left + scale.plotWidth - 2}
          y={CHART_PADDING.top + (rightScale ?? scale).y(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {formatRightTick?.(tick) ?? tick}
        </text>
      ))}
    </>
  );
}

/** The date labels under the plot, anchored so the edge days stay inside. */
function ChartXAxis({
  xLabels,
  days,
  scale,
}: {
  xLabels: readonly number[];
  days: readonly { date: string }[];
  scale: ChartScale;
}) {
  return (
    <>
      {xLabels.map((index) => {
        const day = days[index];
        if (day === undefined) {
          return null;
        }
        return (
          <text
            key={day.date}
            x={CHART_PADDING.left + scale.x(index)}
            y={CHART_PADDING.top + scale.plotHeight + 14}
            textAnchor={
              index === 0
                ? "start"
                : index === days.length - 1
                  ? "end"
                  : "middle"
            }
            className="fill-muted-foreground text-[10px]"
          >
            {formatChartDate(day.date)}
          </text>
        );
      })}
    </>
  );
}

/** The hover card that follows the pointer or keyboard cursor. */
function ChartTooltip<T extends { date: string }>({
  hovered,
  tooltip,
  tooltipClassName,
  tooltipTestId,
}: {
  hovered: HoveredChartDay<T>;
  tooltip: (hovered: HoveredChartDay<T>) => ReactNode;
  tooltipClassName: string;
  tooltipTestId: string | undefined;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg",
        tooltipClassName,
      )}
      // The card follows the hovered day across the plot, so its offset is a
      // share of the rendered width that changes per pointer move.
      style={{ left: `${hovered.percent}%` }}
      data-testid={tooltipTestId}
    >
      {tooltip(hovered)}
    </div>
  );
}

/** The polite live region that announces the keyboard cursor's day. */
function ChartAnnouncement<T extends { date: string }>({
  announced,
  tooltip,
}: {
  announced: HoveredChartDay<T> | null;
  tooltip: ((hovered: HoveredChartDay<T>) => ReactNode) | undefined;
}) {
  return (
    // Mounted from the start so a screen reader reports each change. Only the
    // keyboard writes to it, so a pointer sweeping the plot is silent; the card
    // itself is visual. See ADR 0051.
    <div className="sr-only" role="status" aria-live="polite">
      {announced === null
        ? null
        : tooltip === undefined
          ? formatChartDate(announced.day.date)
          : tooltip(announced)}
    </div>
  );
}

/**
 * The shared frame for the fitness charts: the card, accessible SVG, the y and
 * x axes, the hover guide and its card. A chart supplies its scale and ticks,
 * draws its own series inside the plot, and can add a legend and footer.
 *
 * An interactive chart is one keyboard stop: the frame owns the cursor keys
 * through `useChartHover`, and announces the card of the day the keyboard
 * moved to in a polite live region. See
 * `docs/specs/chart-keyboard-navigation.md`.
 */
export function ChartFrame<T extends { date: string }>({
  title,
  subtitle,
  label,
  svgTitle,
  headerAction,
  days,
  scale,
  ticks,
  formatTick,
  gridTicks,
  gridClassName = "stroke-border",
  hoverLineClassName = "stroke-foreground/40",
  rightTicks,
  formatRightTick,
  rightScale,
  interactive = true,
  children,
  legend,
  footer,
  tooltip,
  tooltipClassName = "w-60",
  tooltipTestId,
  svgTestId,
  figureProps,
}: {
  /** The visible heading; omit it when the caller renders its own. */
  title?: string | undefined;
  subtitle?: string | undefined;
  /** The chart's accessible name. */
  label: string;
  /** The SVG's tooltip title; falls back to the accessible name. */
  svgTitle?: string | undefined;
  /** A control shown beside the heading, such as a view toggle. */
  headerAction?: ReactNode;
  /** One day per x-axis point. */
  days: readonly T[];
  scale: ChartScale;
  /** Left-axis ticks, and the grid lines unless `gridTicks` overrides them. */
  ticks: readonly number[];
  formatTick?: ((value: number) => string) | undefined;
  /** Ticks to draw grid lines for, when they differ from the left axis. */
  gridTicks?: readonly number[] | undefined;
  gridClassName?: string | undefined;
  /** The colour of the hovered day's vertical guide. */
  hoverLineClassName?: string | undefined;
  /** Optional right-axis ticks, for a chart with a second measure. */
  rightTicks?: readonly number[] | undefined;
  formatRightTick?: ((value: number) => string) | undefined;
  /** The scale for the right axis when it measures a different domain. */
  rightScale?: ChartScale | undefined;
  /** Draws the hover guide and card. Off for charts without a hover card. */
  interactive?: boolean;
  /** The chart's series, drawn inside the translated plot group. */
  children: (hovered: HoveredChartDay<T> | null) => ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
  /** The hover card's content; the frame positions it like every other chart. */
  tooltip?: ((hovered: HoveredChartDay<T>) => ReactNode) | undefined;
  tooltipClassName?: string | undefined;
  tooltipTestId?: string | undefined;
  svgTestId?: string | undefined;
  /** Extra attributes for the card, such as a test id or data attribute. */
  figureProps?:
    | (Omit<ComponentProps<"figure">, "className" | "children"> &
        Record<`data-${string}`, string | undefined>)
    | undefined;
}) {
  const {
    hovered,
    announced,
    instructionId,
    onPointerMove,
    onPointerLeave,
    onKeyDown,
    onBlur,
  } = useChartHover(days.length, (index) => days[index]);
  const xLabels = labelIndices(days.length);
  const grid = gridTicks ?? ticks;
  const activeHover = interactive ? hovered : null;

  return (
    <figure
      className="relative flex flex-col gap-2 rounded-lg border bg-card p-4"
      {...figureProps}
    >
      <ChartHeader
        title={title}
        subtitle={subtitle}
        headerAction={headerAction}
      />
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={label}
          aria-describedby={interactive ? instructionId : undefined}
          tabIndex={interactive ? 0 : undefined}
          data-testid={svgTestId}
          onPointerMove={interactive ? onPointerMove : undefined}
          onPointerDown={interactive ? onPointerMove : undefined}
          onPointerLeave={interactive ? onPointerLeave : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
          onBlur={interactive ? onBlur : undefined}
        >
          <title>{svgTitle ?? label}</title>
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            <ChartGrid
              grid={grid}
              scale={scale}
              gridClassName={gridClassName}
              hovered={activeHover}
              hoverLineClassName={hoverLineClassName}
            />
            {children(activeHover)}
          </g>
          <ChartYAxis ticks={ticks} scale={scale} formatTick={formatTick} />
          <ChartRightAxis
            rightTicks={rightTicks}
            rightScale={rightScale}
            scale={scale}
            formatRightTick={formatRightTick}
          />
          <ChartXAxis xLabels={xLabels} days={days} scale={scale} />
        </svg>
        {interactive && (
          <p id={instructionId} className="sr-only">
            {CHART_KEYBOARD_HINT}
          </p>
        )}
        {activeHover !== null && tooltip !== undefined && (
          <ChartTooltip
            hovered={activeHover}
            tooltip={tooltip}
            tooltipClassName={tooltipClassName}
            tooltipTestId={tooltipTestId}
          />
        )}
        {interactive && (
          <ChartAnnouncement announced={announced} tooltip={tooltip} />
        )}
      </div>
      {legend}
      {footer}
    </figure>
  );
}
