import { FORM_ZONES, type FormZone } from "@killingit/shared";

/** The SVG viewBox the charts are drawn in; the page scales it to its width. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 220;

/** Room for the axis labels around the plotted area. */
export const CHART_PADDING = { top: 10, right: 8, bottom: 22, left: 40 };

/** A value range on the y axis. */
export interface Domain {
  min: number;
  max: number;
}

/** Maps day indices and values onto the plot's pixel space. */
export interface ChartScale {
  plotWidth: number;
  plotHeight: number;
  /** X for the day at `index` of `count` points. */
  x(index: number): number;
  /** Y for a value; the domain minimum sits on the bottom edge. */
  y(value: number): number;
}

/** The scale for `count` evenly spaced days in a plot of the given size. */
export function chartScale(
  count: number,
  domain: Domain,
  size: { width: number; height: number } = {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  },
): ChartScale {
  const plotWidth = size.width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = size.height - CHART_PADDING.top - CHART_PADDING.bottom;
  const span = domain.max - domain.min || 1;
  return {
    plotWidth,
    plotHeight,
    x: (index) =>
      count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth,
    y: (value) => plotHeight - ((value - domain.min) / span) * plotHeight,
  };
}

/**
 * A y domain that covers every value with 10% breathing room and lands on
 * round `step` boundaries, so the axis ticks read as whole numbers.
 */
export function niceDomain(values: readonly number[], step = 10): Domain {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: 0, max: step };
  }
  const lowest = Math.min(...finite);
  const highest = Math.max(...finite);
  const padding = Math.max(highest - lowest, step) * 0.1;
  return {
    min: Math.floor((lowest - padding) / step) * step,
    max: Math.ceil((highest + padding) / step) * step,
  };
}

/** Evenly spaced y-axis ticks, including both edges of the domain. */
export function axisTicks(domain: Domain, count = 4): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    ticks.push(domain.min + ((domain.max - domain.min) * index) / count);
  }
  return ticks;
}

/** Up to `max` evenly spaced point indices, including the first and last. */
export function labelIndices(count: number, max = 4): number[] {
  if (count <= 0) {
    return [];
  }
  const wanted = Math.min(max, count);
  if (wanted === 1) {
    return [0];
  }
  const step = (count - 1) / (wanted - 1);
  return [
    ...new Set(Array.from({ length: wanted }, (_, i) => Math.round(i * step))),
  ];
}

/** The TSB bands clipped to the visible domain, lowest first. */
export function zoneBlocks(
  domain: Domain,
): { zone: FormZone; from: number; to: number }[] {
  return FORM_ZONES.map((zone) => ({
    zone,
    from: Math.max(zone.from, domain.min),
    to: Math.min(zone.to, domain.max),
  })).filter((block) => block.to > block.from);
}

/** A polyline through every value. */
export function linePath(values: readonly number[], scale: ChartScale): string {
  return values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${round(scale.x(index))} ${round(scale.y(value))}`,
    )
    .join(" ");
}

/** A step-after path: each value holds until the next day. */
export function stepPath(values: readonly number[], scale: ChartScale): string {
  return values
    .map((value, index) => {
      const x = round(scale.x(index));
      const y = round(scale.y(value));
      if (index === 0) {
        return `M${x} ${y}`;
      }
      return `H${x} V${y}`;
    })
    .join(" ");
}

/** The range of a TSB zone in words, e.g. `+5 to +25`. */
export function formatZoneRange(zone: FormZone): string {
  if (!Number.isFinite(zone.from)) {
    return `below ${formatSigned(zone.to)}`;
  }
  if (!Number.isFinite(zone.to)) {
    return `above ${formatSigned(zone.from)}`;
  }
  return `${formatSigned(zone.from)} to ${formatSigned(zone.to)}`;
}

/** A short axis label for a `YYYY-MM-DD` date, e.g. `12 Oct`. */
export function formatChartDate(date: string): string {
  const [, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1];
  if (name === undefined || day === undefined) {
    return date;
  }
  return `${Number(day)} ${name}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
