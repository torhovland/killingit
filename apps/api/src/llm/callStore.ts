import type {
  LlmCallDetail,
  LlmCallMessage,
  LlmCallSummary,
  LlmCallUsage,
  LlmPromptKind,
} from "@killingit/shared";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmCalls, users } from "../db/schema.js";

/** One completed (or failed) completion attempt to persist. */
export interface NewLlmCall {
  userId: number;
  kind: LlmPromptKind;
  provider: string;
  model: string;
  messages: LlmCallMessage[];
  response: string | null;
  error: string | null;
  usage: LlmCallUsage | null;
  metadata: Record<string, unknown>;
  durationMs: number;
}

/** Persists one prompt log row. Injectable so the logger is testable. */
export type LlmCallSink = (call: NewLlmCall) => Promise<void>;

/** Prompt kinds that belong to a plan generation run. */
const PLAN_PROMPT_KINDS: LlmPromptKind[] = [
  "coach_plan",
  "season_plan",
  "initial_block",
  "plan_update",
  "daily_update",
  "target_day_update",
  "weekly_update",
  "season_refresh",
  "block_update",
];

/** Reads a positive attempt number from untyped prompt metadata. */
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Stores one prompt attempt. The prompt can contain athlete health and
 * training details, so only the admin route reads it back.
 */
export async function saveLlmCall(call: NewLlmCall): Promise<void> {
  await db.insert(llmCalls).values({
    userId: call.userId,
    kind: call.kind,
    provider: call.provider,
    model: call.model,
    messages: call.messages,
    response: call.response,
    error: call.error,
    usage: call.usage,
    metadata: call.metadata,
    durationMs: call.durationMs,
  });
}

/**
 * Marks every plan prompt logged since a run started as belonging to a failed
 * generation. A plan can fail after its prompts succeeded, so the failure is
 * added to the rows afterwards. Fail-open: the plan error itself is what the
 * athlete needs, and a logging problem must not hide it.
 */
export async function markPlanPromptsFailed(
  userId: number,
  since: Date,
  error: string,
): Promise<void> {
  try {
    await db
      .update(llmCalls)
      .set({
        metadata: sql`${llmCalls.metadata} || ${JSON.stringify({
          planFailed: true,
          planError: error,
        })}::jsonb`,
      })
      .where(
        and(
          eq(llmCalls.userId, userId),
          inArray(llmCalls.kind, PLAN_PROMPT_KINDS),
          gte(llmCalls.createdAt, since),
          lte(llmCalls.createdAt, new Date()),
        ),
      );
  } catch (err) {
    console.error("[llm-log] could not mark the failed plan:", err);
  }
}

/** Newest-first prompt log, without the large prompt and response bodies. */
export async function listLlmCalls(
  limit: number,
  offset: number,
): Promise<LlmCallSummary[]> {
  const rows = await db
    .select({
      id: llmCalls.id,
      createdAt: llmCalls.createdAt,
      userId: llmCalls.userId,
      userLabel: users.authSubject,
      kind: llmCalls.kind,
      provider: llmCalls.provider,
      model: llmCalls.model,
      durationMs: llmCalls.durationMs,
      error: llmCalls.error,
      metadata: llmCalls.metadata,
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .orderBy(desc(llmCalls.id))
    .limit(limit)
    .offset(offset);

  return rows.map(({ error, metadata, createdAt, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
    failed: error !== null,
    repair: metadata.repair === true,
    attempt: positiveInteger(metadata.attempt),
    ofAttempts: positiveInteger(metadata.ofAttempts),
    planFailed: metadata.planFailed === true,
  }));
}

/** One prompt log entry with its full messages, response, and metadata. */
export async function getLlmCall(id: number): Promise<LlmCallDetail | null> {
  const [row] = await db
    .select({
      id: llmCalls.id,
      createdAt: llmCalls.createdAt,
      userId: llmCalls.userId,
      userLabel: users.authSubject,
      kind: llmCalls.kind,
      provider: llmCalls.provider,
      model: llmCalls.model,
      messages: llmCalls.messages,
      response: llmCalls.response,
      error: llmCalls.error,
      usage: llmCalls.usage,
      metadata: llmCalls.metadata,
      durationMs: llmCalls.durationMs,
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .where(eq(llmCalls.id, id))
    .limit(1);

  if (!row) {
    return null;
  }
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    failed: row.error !== null,
    repair: row.metadata.repair === true,
    attempt: positiveInteger(row.metadata.attempt),
    ofAttempts: positiveInteger(row.metadata.ofAttempts),
    planFailed: row.metadata.planFailed === true,
  };
}
