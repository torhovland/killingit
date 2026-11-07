import {
  type AthleteThreshold,
  type MetricPoint,
  type MetricSource,
  type ThresholdSeries,
  type ThresholdSummary,
} from "@killingit/shared";

/** One known threshold value at the moment it applies. */
export interface ThresholdAnchor {
  at: number;
  value: number;
  source: MetricSource;
}

/** The stored values for one sport and measure over time, oldest first. */
export interface ThresholdTimeline {
  sport: string;
  measure: string;
  label: string;
  unit: string;
  kind: AthleteThreshold["kind"];
  anchors: ThresholdAnchor[];
}

/** The sport and measure that store the athlete's cycling FTP. */
export const FTP_THRESHOLD: Pick<
  AthleteThreshold,
  "sport" | "measure" | "label" | "unit" | "kind"
> = {
  sport: "cycling",
  measure: "ftp",
  label: "FTP",
  unit: "W",
  kind: "power",
};

/** Whether a stored threshold is the cycling FTP measure. */
export function isFtpThreshold(
  point: Pick<AthleteThreshold, "sport" | "measure">,
): boolean {
  return (
    point.sport === FTP_THRESHOLD.sport &&
    point.measure === FTP_THRESHOLD.measure
  );
}

/** The cycling FTP timeline, if the athlete has one. */
export function ftpTimeline(
  timelines: readonly ThresholdTimeline[],
): ThresholdTimeline | null {
  return timelines.find(isFtpThreshold) ?? null;
}

/**
 * The anchor in effect on a date: the last one dated on or before it. Before
 * the first anchor the earliest value applies, matching `thresholdAt`.
 */
export function thresholdBaselineAt(
  timeline: ThresholdTimeline | null,
  date: string | Date,
): ThresholdAnchor | null {
  if (timeline === null || timeline.anchors.length === 0) {
    return null;
  }
  const at = dateToTimestamp(date);
  if (!Number.isFinite(at)) {
    return null;
  }
  let result = timeline.anchors[0] ?? null;
  for (const anchor of timeline.anchors) {
    if (anchor.at > at) {
      break;
    }
    result = anchor;
  }
  return result;
}

/** The FTP in effect on a date and whether the athlete measured it. */
export function ftpBaselineAt(
  timeline: ThresholdTimeline | null,
  date: string | Date,
): { watts: number; fromRevision: boolean } | null {
  const anchor = thresholdBaselineAt(timeline, date);
  return anchor === null
    ? null
    : { watts: anchor.value, fromRevision: anchor.source !== "coach" };
}

/** The FTP in effect on a date, interpolated between anchors in whole watts. */
export function ftpWattsAt(
  timeline: ThresholdTimeline | null,
  date: string | Date,
): number | null {
  const value = thresholdAt(timeline, date);
  return value === null ? null : Math.round(value);
}

/** The cycling FTP history as flat prompt points, oldest first. */
export function ftpHistoryPoints(
  timelines: readonly ThresholdTimeline[],
  throughDate?: string | null,
): MetricPoint[] {
  const timeline = ftpTimeline(timelines);
  if (timeline === null) {
    return [];
  }
  return timeline.anchors.flatMap((anchor) => {
    const date = new Date(anchor.at).toISOString().slice(0, 10);
    if (
      throughDate !== undefined &&
      throughDate !== null &&
      date > throughDate
    ) {
      return [];
    }
    return [{ date, value: anchor.value, source: anchor.source }];
  });
}

function dateToTimestamp(date: string | Date): number {
  return date instanceof Date
    ? date.getTime()
    : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date);
}

function anchorFromPoint(point: AthleteThreshold): ThresholdAnchor {
  return {
    at: Date.parse(`${point.date}T00:00:00Z`),
    value: point.value,
    source: point.source,
  };
}

/**
 * Builds one timeline per sport and measure. Points after `throughDate` are
 * excluded so a future projection cannot become today's baseline. At an
 * identical date the athlete's measurement wins over a coach estimate.
 */
export function buildThresholdTimelines(
  points: readonly AthleteThreshold[],
  throughDate?: string | null,
): ThresholdTimeline[] {
  const groups = new Map<string, AthleteThreshold[]>();
  for (const point of points) {
    if (throughDate !== undefined && throughDate !== null) {
      if (point.date > throughDate) {
        continue;
      }
    }
    const key = `${point.sport}\u0000${point.measure}`;
    const entries = groups.get(key);
    if (entries === undefined) {
      groups.set(key, [point]);
    } else {
      entries.push(point);
    }
  }

  return [...groups.values()].map((entries) => {
    const first = entries[0];
    if (first === undefined) {
      throw new Error("A threshold group cannot be empty");
    }
    const anchors = entries
      .map(anchorFromPoint)
      .filter((anchor) => Number.isFinite(anchor.at))
      .sort(
        (a, b) =>
          a.at - b.at ||
          (a.source === "coach" ? -1 : b.source === "coach" ? 1 : 0),
      );
    return {
      sport: first.sport,
      measure: first.measure,
      label: first.label,
      unit: first.unit,
      kind: first.kind,
      anchors: dedupeAnchors(anchors),
    };
  });
}

/** Keeps the last anchor for an identical timestamp. */
function dedupeAnchors(anchors: readonly ThresholdAnchor[]): ThresholdAnchor[] {
  const deduped: ThresholdAnchor[] = [];
  for (const anchor of anchors) {
    const previous = deduped[deduped.length - 1];
    if (previous !== undefined && previous.at === anchor.at) {
      deduped[deduped.length - 1] = anchor;
    } else {
      deduped.push(anchor);
    }
  }
  return deduped;
}

/** The value in effect on a date, interpolated between surrounding anchors. */
export function thresholdAt(
  timeline: ThresholdTimeline | null,
  date: string | Date,
): number | null {
  if (timeline === null || timeline.anchors.length === 0) {
    return null;
  }
  const at = dateToTimestamp(date);
  if (!Number.isFinite(at)) {
    return null;
  }

  const first = timeline.anchors[0];
  const last = timeline.anchors[timeline.anchors.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  if (at <= first.at) {
    return first.value;
  }
  if (at >= last.at) {
    return last.value;
  }

  for (let index = 1; index < timeline.anchors.length; index += 1) {
    const right = timeline.anchors[index];
    const left = timeline.anchors[index - 1];
    if (right === undefined || left === undefined || at > right.at) {
      continue;
    }
    const span = right.at - left.at;
    if (span <= 0) {
      return right.value;
    }
    const fraction = (at - left.at) / span;
    const value = left.value + (right.value - left.value) * fraction;
    return Math.round(value * 10) / 10;
  }
  return last.value;
}

/** The threshold in a sport with the given kind, if one exists at the date. */
export function thresholdForSport(
  timelines: readonly ThresholdTimeline[],
  sport: string,
  kind: AthleteThreshold["kind"],
  date: string,
): { timeline: ThresholdTimeline; value: number } | null {
  for (const timeline of timelines) {
    if (timeline.sport !== sport || timeline.kind !== kind) {
      continue;
    }
    const value = thresholdAt(timeline, date);
    if (value !== null && value > 0) {
      return { timeline, value };
    }
  }
  return null;
}

/** Every threshold measure the athlete has stored, including future points. */
export function buildThresholdSeries(
  points: readonly AthleteThreshold[],
): ThresholdSeries[] {
  return buildThresholdTimelines(points).map((timeline) => ({
    sport: timeline.sport,
    measure: timeline.measure,
    label: timeline.label,
    unit: timeline.unit,
    kind: timeline.kind,
    points: timeline.anchors.map((anchor) => ({
      date: new Date(anchor.at).toISOString().slice(0, 10),
      value: anchor.value,
    })),
  }));
}

/** The latest value of every threshold measure as of `today`. */
export function currentThresholdSummaries(
  points: readonly AthleteThreshold[],
  today: string,
): ThresholdSummary[] {
  return buildThresholdTimelines(points, today)
    .map((timeline) => {
      const latest = timeline.anchors[timeline.anchors.length - 1];
      if (latest === undefined) {
        return null;
      }
      return {
        sport: timeline.sport,
        measure: timeline.measure,
        label: timeline.label,
        unit: timeline.unit,
        kind: timeline.kind,
        source: latest.source,
        date: new Date(latest.at).toISOString().slice(0, 10),
        value: latest.value,
      };
    })
    .filter((summary): summary is ThresholdSummary => summary !== null);
}
