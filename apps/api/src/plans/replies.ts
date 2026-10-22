import type { CoachAnalysis } from "@killingit/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityComments,
  coachReplies,
  type CoachReplyRow,
} from "../db/schema.js";

/** What the coach replied to. Mirrors the `coach_replies.kind` column. */
export type CoachReplyKind =
  "activity_comment" | "weekly_note" | "manual_activity";

export interface StoredCoachReply {
  kind: CoachReplyKind;
  /** Activity id, week start date, or manual activity id as text. */
  target: string;
  text: string;
  model: string;
  generatedAt: Date;
}

/** The athlete's comment and the coach's reply for one activity. */
export interface ActivityFeedback {
  comment: string | null;
  reply: StoredCoachReply | null;
}

function toStoredReply(row: CoachReplyRow): StoredCoachReply {
  return {
    kind: row.kind,
    target: row.target,
    text: row.reply,
    model: row.model,
    generatedAt: row.updatedAt,
  };
}

/** Converts a stored reply or analysis into the shared API shape. */
export function toCoachAnalysis(reply: {
  text: string;
  model: string;
  generatedAt: Date;
}): CoachAnalysis {
  return {
    text: reply.text,
    model: reply.model,
    generatedAt: reply.generatedAt.toISOString(),
  };
}

/** Inserts or replaces the coach's reply for one athlete input. */
export async function saveCoachReply(input: {
  userId: number;
  kind: CoachReplyKind;
  target: string;
  reply: string;
  model: string;
}): Promise<StoredCoachReply> {
  const now = new Date();
  const [row] = await db
    .insert(coachReplies)
    .values({
      userId: input.userId,
      kind: input.kind,
      target: input.target,
      reply: input.reply,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [coachReplies.userId, coachReplies.kind, coachReplies.target],
      set: {
        reply: input.reply,
        model: input.model,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error("failed to persist the coach reply");
  }
  return toStoredReply(row);
}

/** Loads the coach's reply attached to a weekly note, if any. */
export async function loadWeeklyNoteReply(
  userId: number,
  weekStartDate: string,
): Promise<StoredCoachReply | null> {
  const rows = await db
    .select()
    .from(coachReplies)
    .where(
      and(
        eq(coachReplies.userId, userId),
        eq(coachReplies.kind, "weekly_note"),
        eq(coachReplies.target, weekStartDate),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toStoredReply(row) : null;
}

/** Maps manual activity ids to the coach's reply. */
export async function loadManualActivityReplies(
  userId: number,
): Promise<Map<number, StoredCoachReply>> {
  const rows = await db
    .select()
    .from(coachReplies)
    .where(
      and(
        eq(coachReplies.userId, userId),
        eq(coachReplies.kind, "manual_activity"),
      ),
    );

  const replies = new Map<number, StoredCoachReply>();
  for (const row of rows) {
    const id = Number(row.target);
    if (!Number.isNaN(id)) {
      replies.set(id, toStoredReply(row));
    }
  }
  return replies;
}

/**
 * Loads each activity's saved comment and coach reply. Activities without
 * either are absent from the map.
 */
export async function loadActivityFeedback(
  userId: number,
  activityIds: number[],
): Promise<Map<string, ActivityFeedback>> {
  const ids = activityIds.map(String);
  if (ids.length === 0) {
    return new Map();
  }

  const [commentRows, replyRows] = await Promise.all([
    db
      .select()
      .from(activityComments)
      .where(
        and(
          eq(activityComments.userId, userId),
          inArray(activityComments.activityId, ids),
        ),
      ),
    db
      .select()
      .from(coachReplies)
      .where(
        and(
          eq(coachReplies.userId, userId),
          eq(coachReplies.kind, "activity_comment"),
          inArray(coachReplies.target, ids),
        ),
      ),
  ]);

  const feedback = new Map<string, ActivityFeedback>();
  const entry = (activityId: string): ActivityFeedback => {
    const existing = feedback.get(activityId);
    if (existing) {
      return existing;
    }
    const created: ActivityFeedback = { comment: null, reply: null };
    feedback.set(activityId, created);
    return created;
  };

  for (const row of commentRows) {
    entry(row.activityId).comment = row.comment;
  }
  for (const row of replyRows) {
    entry(row.target).reply = toStoredReply(row);
  }
  return feedback;
}
