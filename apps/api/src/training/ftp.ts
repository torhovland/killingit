import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
} from "../llm/planContext.js";

/** Plausible human FTP range in watts. */
const MIN_FTP_WATTS = 50;
const MAX_FTP_WATTS = 2000;

/** The latest FTP baseline, and whether it came from a coaching update. */
export interface FtpBaseline {
  watts: number;
  /**
   * True when the value came from a dated activity comment, manual activity,
   * weekly note, or review comment rather than the survey profile. A revised
   * test result should not be undercut by an older weekly projection.
   */
  fromRevision: boolean;
}

/** One known FTP value at the moment the athlete stated it. */
export interface FtpAnchor {
  at: number;
  watts: number;
  /** Profile and later athlete inputs are measurements; `coach` is an estimate. */
  source: "profile" | "update" | "coach";
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

/** Everything that can contain an athlete-stated FTP value. */
export interface FtpInput {
  answers: readonly Pick<AthleteAnswerContext, "answer" | "answeredAt">[];
  /** When the survey answers were last saved, if known. */
  answersUpdatedAt?: Date | null;
  manualActivities?: readonly ManualActivityContext[] | undefined;
  activityComments?: readonly ActivityCommentContext[] | undefined;
  weeklyNote?: string | null | undefined;
  weeklyNoteUpdatedAt?: Date | null | undefined;
  periodReviews?: readonly PeriodReviewContext[] | undefined;
}

/**
 * The first FTP value the athlete states in their survey answers. The
 * answers are free-form, so this accepts the common phrasings ("FTP: 250",
 * "FTP around 220 W", "280 W FTP") and ignores everything outside a plausible
 * wattage range.
 *
 * The first value is deliberately used as the current baseline: a profile such
 * as "FTP around 220 W against roughly 280 W when fit" describes the present
 * first and a past peak second.
 */
export function extractFtpWatts(
  answers: readonly Pick<AthleteAnswerContext, "answer">[],
): number | null {
  for (const entry of answers) {
    const text = entry.answer?.trim();
    if (!text) {
      continue;
    }
    const value = firstFtpInText(text);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/**
 * The profile value and every dated athlete-authored FTP mention, oldest first.
 * Used to seed the FTP time series from existing free-text inputs.
 */
export function extractFtpAnchors(input: FtpInput): FtpAnchor[] {
  const mentions = datedMentions(input).sort((a, b) => a.at - b.at);
  const profile = profileAnchor(input, mentions);
  const anchors = [...(profile === null ? [] : [profile]), ...mentions].sort(
    (a, b) =>
      a.at - b.at ||
      (a.source === "profile" ? -1 : b.source === "profile" ? 1 : 0),
  );
  return dedupeAnchors(anchors);
}

/**
 * Builds the FTP timeline from the profile and every dated coaching input. A
 * later test result becomes the new anchor, and the API interpolates between
 * anchors so the historical TSS values reflect the athlete's revised numbers
 * instead of the coach's old projection.
 */
export function buildFtpTimeline(input: FtpInput): FtpTimeline {
  const deduped = extractFtpAnchors(input);
  return timelineFromAnchors(deduped);
}

/** Builds a timeline from already-deduplicated anchors. */
function timelineFromAnchors(anchors: FtpAnchor[]): FtpTimeline {
  const latest = anchors[anchors.length - 1];
  return {
    anchors,
    latest:
      latest === undefined
        ? null
        : { watts: latest.watts, fromRevision: latest.source === "update" },
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
        point.source === "coach" ? ("coach" as const) : ("update" as const),
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

/** Resolves the athlete's current FTP, including any newer test result. */
export function detectFtpBaseline(input: FtpInput): FtpBaseline | null {
  return buildFtpTimeline(input).latest;
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
    : { watts: result.watts, fromRevision: result.source === "update" };
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

/** Finds an FTP value in one piece of text, or null when none is stated. */
export function firstFtpInText(text: string): number | null {
  const patterns = [
    /\b(?:ftp|threshold(?: power)? test)\b[^0-9]{0,30}(\d{2,4})\s*(?:w\b|watts?\b)?/gi,
    /(\d{2,4})\s*(?:w|watts?)\b[^0-9]{0,12}\b(?:ftp|threshold(?: power)? test)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (raw === undefined) {
        continue;
      }
      const value = Number(raw);
      if (value >= MIN_FTP_WATTS && value <= MAX_FTP_WATTS) {
        return value;
      }
    }
  }
  return null;
}

/** The profile's FTP anchor, dated by the answer or the latest answer save. */
function profileAnchor(
  input: FtpInput,
  mentions: readonly FtpAnchor[],
): FtpAnchor | null {
  for (const entry of input.answers) {
    const text = entry.answer?.trim();
    if (!text) {
      continue;
    }
    const watts = firstFtpInText(text);
    if (watts === null) {
      continue;
    }
    const dated = parseTimestamp(entry.answeredAt ?? input.answersUpdatedAt);
    // Without a profile date, keep the profile flat until the first mention
    // rather than ramping from an arbitrary point in the past.
    const at =
      dated ?? (mentions[0]?.at !== undefined ? mentions[0].at - 1 : null);
    if (at === null) {
      return { at: 0, watts, source: "profile" };
    }
    return { at, watts, source: "profile" };
  }
  return null;
}

/** Every FTP number in a dated athlete-authored input. */
function datedMentions(input: FtpInput): FtpAnchor[] {
  const mentions: FtpAnchor[] = [];

  for (const entry of input.activityComments ?? []) {
    addMention(mentions, entry.comment, entry.updatedAt);
  }
  for (const entry of input.manualActivities ?? []) {
    addMention(mentions, entry.details, entry.updatedAt);
  }
  addMention(
    mentions,
    input.weeklyNote,
    input.weeklyNoteUpdatedAt?.toISOString() ?? null,
  );
  for (const review of input.periodReviews ?? []) {
    if (review.comment !== null) {
      addMention(mentions, review.comment, review.updatedAt);
    }
  }

  return mentions;
}

function addMention(
  mentions: FtpAnchor[],
  text: string | null | undefined,
  updatedAt: Date | string | null | undefined,
): void {
  if (text == null || text.trim() === "") {
    return;
  }
  const at = parseTimestamp(updatedAt);
  if (at === null) {
    return;
  }
  const watts = firstFtpInText(text);
  if (watts !== null) {
    mentions.push({ at, watts, source: "update" });
  }
}

/** Parses an ISO timestamp or calendar date into milliseconds. */
function parseTimestamp(
  value: Date | string | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }
  const at =
    value instanceof Date
      ? value.getTime()
      : Date.parse(
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
        );
  return Number.isFinite(at) ? at : null;
}
