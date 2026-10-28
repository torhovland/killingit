/** The latest FTP baseline, and whether the athlete measured it. */
export interface FtpBaseline {
  watts: number;
  /**
   * True when the athlete supplied the value rather than the coach estimating
   * it. A revised test result should not be undercut by an older projection.
   */
  fromRevision: boolean;
}

/** One known FTP value at the moment it applies. */
export interface FtpAnchor {
  at: number;
  watts: number;
  /** A measurement the athlete supplied; `coach` is an estimate. */
  source: "measurement" | "coach";
}

/** A stored metric point from the database, keyed by calendar date. */
export interface FtpTimelinePoint {
  date: string;
  value: number;
  source: "user" | "coach" | "garmin";
}

/** The athlete's FTP values over time, oldest first. */
export interface FtpTimeline {
  anchors: FtpAnchor[];
  latest: FtpBaseline | null;
}

/** Builds a timeline from already-deduplicated anchors. */
function timelineFromAnchors(anchors: FtpAnchor[]): FtpTimeline {
  const latest = anchors[anchors.length - 1];
  return {
    anchors,
    latest:
      latest === undefined
        ? null
        : {
            watts: latest.watts,
            fromRevision: latest.source === "measurement",
          },
  };
}

/**
 * Builds a timeline from stored metric points. Points after `throughDate` are
 * excluded so a future coach projection cannot become the current baseline.
 * At an identical timestamp the more specific athlete measurement wins.
 */
export function buildFtpTimelineFromPoints(
  points: readonly FtpTimelinePoint[],
  throughDate?: string | null,
): FtpTimeline {
  const anchors = points
    .filter(
      (point) =>
        throughDate === undefined ||
        throughDate === null ||
        point.date <= throughDate,
    )
    .map((point) => ({
      at: Date.parse(`${point.date}T00:00:00Z`),
      watts: point.value,
      source:
        point.source === "coach"
          ? ("coach" as const)
          : ("measurement" as const),
    }))
    .filter((anchor) => Number.isFinite(anchor.at))
    .sort(
      (a, b) =>
        a.at - b.at ||
        (a.source === "coach" ? -1 : b.source === "coach" ? 1 : 0),
    );
  return timelineFromAnchors(dedupeAnchors(anchors));
}

/** Keeps the last anchor for an identical timestamp. */
function dedupeAnchors(anchors: readonly FtpAnchor[]): FtpAnchor[] {
  const deduped: FtpAnchor[] = [];
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

/**
 * The FTP baseline in effect on a date. Unlike `timeline.latest`, this ignores
 * estimates dated in the future, which is what a plan needs when it reasons
 * about today.
 */
export function ftpBaselineAt(
  timeline: FtpTimeline | null,
  date: string | Date,
): FtpBaseline | null {
  if (timeline === null || timeline.anchors.length === 0) {
    return null;
  }
  const at =
    date instanceof Date
      ? date.getTime()
      : Date.parse(
          /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date,
        );
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
  return result === null
    ? null
    : { watts: result.watts, fromRevision: result.source === "measurement" };
}

/**
 * The FTP in effect on a date, interpolated between the two surrounding
 * anchors. Before the first anchor the earliest value applies; after the last
 * anchor the latest value applies.
 */
export function ftpAt(
  timeline: FtpTimeline | null,
  date: string | Date,
): number | null {
  if (timeline === null || timeline.anchors.length === 0) {
    return null;
  }
  const at =
    date instanceof Date
      ? date.getTime()
      : Date.parse(
          /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date,
        );
  if (!Number.isFinite(at)) {
    return null;
  }

  const first = timeline.anchors[0];
  const last = timeline.anchors[timeline.anchors.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  if (at <= first.at) {
    return first.watts;
  }
  if (at >= last.at) {
    return last.watts;
  }

  for (let index = 1; index < timeline.anchors.length; index += 1) {
    const right = timeline.anchors[index];
    const left = timeline.anchors[index - 1];
    if (right === undefined || left === undefined || at > right.at) {
      continue;
    }
    const span = right.at - left.at;
    if (span <= 0) {
      return right.watts;
    }
    const fraction = (at - left.at) / span;
    return Math.round(left.watts + (right.watts - left.watts) * fraction);
  }
  return last.watts;
}
