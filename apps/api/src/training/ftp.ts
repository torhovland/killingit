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

/** Everything that can contain an athlete-stated FTP value. */
export interface FtpInput {
  answers: readonly Pick<AthleteAnswerContext, "answer">[];
  /** When the survey answers were last saved, if known. */
  answersUpdatedAt?: Date | null;
  manualActivities?: readonly ManualActivityContext[] | undefined;
  activityComments?: readonly ActivityCommentContext[] | undefined;
  weeklyNote?: string | null | undefined;
  weeklyNoteUpdatedAt?: Date | null | undefined;
  periodReviews?: readonly PeriodReviewContext[] | undefined;
}

/**
 * Reads the first FTP value the athlete states in their survey answers. The
 * answer text is free-form, so this accepts the common phrasings ("FTP: 250",
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
 * Resolves the athlete's current FTP from the profile and every dated coaching
 * input. A revised test result in a later comment, manual activity, weekly
 * note, or review comment replaces the profile value. When the survey answers
 * were saved after the latest mention, the profile is treated as the newer
 * source and wins.
 */
export function detectFtpBaseline(input: FtpInput): FtpBaseline | null {
  const profile = extractFtpWatts(input.answers);
  const latest = latestDatedMention(input);
  if (latest === null) {
    return profile === null ? null : { watts: profile, fromRevision: false };
  }
  if (
    profile !== null &&
    input.answersUpdatedAt != null &&
    input.answersUpdatedAt.getTime() >= latest.at
  ) {
    return { watts: profile, fromRevision: false };
  }
  return { watts: latest.watts, fromRevision: true };
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

interface DatedMention {
  watts: number;
  at: number;
}

/** The newest FTP number in a dated athlete-authored input. */
function latestDatedMention(input: FtpInput): DatedMention | null {
  const mentions: DatedMention[] = [];

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

  let latest: DatedMention | null = null;
  for (const mention of mentions) {
    if (latest === null || mention.at > latest.at) {
      latest = mention;
    }
  }
  return latest;
}

function addMention(
  mentions: DatedMention[],
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
    mentions.push({ watts, at });
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
