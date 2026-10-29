import {
  FORM_ZONES,
  interpretTrainingStressBalance,
  type FormInterpretation,
  type FormZone,
} from "@killingit/shared";

/** The SVG viewBox the charts are drawn in; the page scales it to its width. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 320;

/** Room for the axis labels around the plotted area. */
export const CHART_PADDING = { top: 10, right: 8, bottom: 22, left: 40 };

/** The dash pattern of the projected part of a line. */
export const FUTURE_DASH = "2 3";

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
 * A y domain that covers every value with breathing room and lands on round
 * tick boundaries, so the axis reads as whole numbers. `minSpan` keeps a flat
 * series from filling the plot with a two-watt range.
 */
export function niceDomain(
  values: readonly number[],
  options: { minSpan?: number; tickCount?: number } = {},
): Domain {
  const { minSpan = 20, tickCount = 4 } = options;
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: 0, max: minSpan };
  }
  let lowest = Math.min(...finite);
  let highest = Math.max(...finite);
  if (highest - lowest < minSpan) {
    const middle = (lowest + highest) / 2;
    lowest = middle - minSpan / 2;
    highest = middle + minSpan / 2;
  }
  const padding = (highest - lowest) * 0.05;
  const step = tickStep(highest - lowest + padding * 2, tickCount);
  return {
    min: Math.floor((lowest - padding) / step) * step,
    max: Math.ceil((highest + padding) / step) * step,
  };
}

/**
 * Y-axis ticks on a round step (1, 2, 5, 10, 20, 50, …), so the labels never
 * show fractions of a watt or a load point.
 */
export function axisTicks(domain: Domain, count = 4): number[] {
  const step = tickStep(domain.max - domain.min, count);
  const ticks: number[] = [];
  for (
    let value = Math.ceil(domain.min / step) * step;
    value <= domain.max + step / 1000;
    value += step
  ) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

/** The round step closest to `span / count` at or above it. */
function tickStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  if (!(raw > 0)) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const factor = [1, 2, 2.5, 5, 10].find((step) => normalised <= step) ?? 10;
  return factor * magnitude;
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

/**
 * The day index nearest to a pointer position, given as a share of the plot
 * width (0 at the first day, 1 at the last).
 */
export function indexAt(plotFraction: number, count: number): number {
  if (count <= 1 || !Number.isFinite(plotFraction)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, plotFraction));
  return Math.round(clamped * (count - 1));
}

/** One run of the TSB line inside a single form zone. */
export interface TsbSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
  interpretation: FormInterpretation;
  /** The day index the segment runs to, for telling past from projection. */
  index: number;
}

/** The TSB values where the form zone changes, lowest first. */
const ZONE_BOUNDARIES = FORM_ZONES.map((zone) => zone.from).filter(
  Number.isFinite,
);

/**
 * The TSB line split into segments, each coloured by the zone the line is in.
 * A day-to-day step that crosses a zone boundary is split at the crossing, so
 * the colour changes exactly where the line enters the next zone.
 */
export function tsbSegments(
  values: readonly number[],
  scale: ChartScale,
): TsbSegment[] {
  const segments: TsbSegment[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const value = values[index];
    if (previous === undefined || value === undefined) {
      continue;
    }
    const x0 = scale.x(index - 1);
    const x1 = scale.x(index);
    const pointAt = (fraction: number, at: number) => ({
      x: x0 + (x1 - x0) * fraction,
      y: scale.y(at),
    });

    if (previous === value) {
      segments.push({
        from: pointAt(0, previous),
        to: pointAt(1, value),
        interpretation: interpretTrainingStressBalance(value),
        index,
      });
      continue;
    }

    const rising = value > previous;
    const crossings = ZONE_BOUNDARIES.filter((boundary) =>
      rising
        ? boundary > previous && boundary < value
        : boundary < previous && boundary > value,
    ).sort((a, b) => (rising ? a - b : b - a));
    const stops = [previous, ...crossings, value];
    for (let stop = 1; stop < stops.length; stop += 1) {
      const start = stops[stop - 1];
      const end = stops[stop];
      if (start === undefined || end === undefined || start === end) {
        continue;
      }
      segments.push({
        from: pointAt((start - previous) / (value - previous), start),
        to: pointAt((end - previous) / (value - previous), end),
        interpretation: interpretTrainingStressBalance((start + end) / 2),
        index,
      });
    }
  }
  return segments;
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

/**
 * The last day index that is on or before `date`. Used to split each line into
 * what was measured (solid) and what the stored plan projects (dotted).
 */
export function lastIndexOnOrBefore(
  dates: readonly string[],
  date: string,
): number {
  let last = -1;
  for (let index = 0; index < dates.length; index += 1) {
    const day = dates[index];
    if (day === undefined || day > date) {
      break;
    }
    last = index;
  }
  return last;
}

/**
 * A polyline through the values, starting at day `start` of the chart. Pass a
 * slice of the values with the slice offset so the path keeps the chart scale.
 */
export function linePath(
  values: readonly number[],
  scale: ChartScale,
  start = 0,
): string {
  return values
    .map((value, offset) => {
      const index = start + offset;
      return `${offset === 0 ? "M" : "L"}${round(scale.x(index))} ${round(scale.y(value))}`;
    })
    .join(" ");
}

/** A step-after path: each value holds until the next day. */
export function stepPath(
  values: readonly number[],
  scale: ChartScale,
  start = 0,
): string {
  return values
    .map((value, offset) => {
      const index = start + offset;
      const x = round(scale.x(index));
      const y = round(scale.y(value));
      if (offset === 0) {
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
