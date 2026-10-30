import type {
  LlmCallDetail,
  LlmCallMessage,
  LlmCallSummary,
  LlmCallUsage,
  LlmModelRemark,
  LlmPromptKind,
} from "@killingit/shared";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmCalls, users } from "../db/schema.js";

/** One completion attempt when it starts, before the provider settles. */
export interface NewLlmCall {
  userId: number;
  kind: LlmPromptKind;
  provider: string;
  model: string;
  messages: LlmCallMessage[];
  metadata: Record<string, unknown>;
}

/** What the provider reported when a completion attempt settled. */
export interface LlmCallResult {
  response: string | null;
  error: string | null;
  usage: LlmCallUsage | null;
  /** Extra metadata such as the routed model and finish reason. */
  metadata: Record<string, unknown>;
  durationMs: number;
}

/**
 * Persists one prompt attempt: a row when the request starts, updated when the
 * provider settles. The start row is written before the request is sent, so an
 * attempt is visible even when the process dies while waiting for the answer.
 */
export interface LlmCallSink {
  start(call: NewLlmCall): Promise<number>;
  finish(id: number, result: LlmCallResult): Promise<void>;
}

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

/** The database-backed sink used in the real provider setup. */
export const dbLlmCallSink: LlmCallSink = {
  start: startLlmCall,
  finish: finishLlmCall,
};

/** Reads a positive attempt number from untyped prompt metadata. */
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Stores one prompt attempt as in flight. The prompt can contain athlete health
 * and training details, so only the admin route reads it back.
 */
export async function startLlmCall(call: NewLlmCall): Promise<number> {
  const [row] = await db
    .insert(llmCalls)
    .values({
      userId: call.userId,
      kind: call.kind,
      provider: call.provider,
      model: call.model,
      messages: call.messages,
      response: null,
      error: null,
      usage: null,
      metadata: call.metadata,
      durationMs: 0,
    })
    .returning({ id: llmCalls.id });
  if (row === undefined) {
    throw new Error("Could not store the prompt log row.");
  }
  return row.id;
}

/** Records how one in-flight prompt attempt settled. */
export async function finishLlmCall(
  id: number,
  result: LlmCallResult,
): Promise<void> {
  await db
    .update(llmCalls)
    .set({
      response: result.response,
      error: result.error,
      usage: result.usage,
      // Merge rather than replace: a stale run's plan-failure marker may have
      // been added while the provider call was still in flight.
      metadata: sql`${llmCalls.metadata} || ${JSON.stringify(result.metadata)}::jsonb`,
      durationMs: result.durationMs,
      completedAt: new Date(),
    })
    .where(eq(llmCalls.id, id));
}

/**
 * Marks every plan prompt logged since a run started as belonging to a failed
 * generation. A plan can fail after its prompts succeeded, so the failure is
 * added to the rows afterwards. An attempt still in flight when the run was
 * declared dead is settled as failed too, so the prompt that never returned is
 * visible. Fail-open: the plan error itself is what the athlete needs, and a
 * logging problem must not hide it.
 */
export async function markPlanPromptsFailed(
  userId: number,
  since: Date,
  error: string,
): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(llmCalls)
      .set({
        metadata: sql`${llmCalls.metadata} || ${JSON.stringify({
          planFailed: true,
          planError: error,
        })}::jsonb`,
        error: sql`case when ${llmCalls.completedAt} is null then coalesce(${llmCalls.error}, ${error}) else ${llmCalls.error} end`,
        durationMs: sql`case when ${llmCalls.completedAt} is null then greatest(${llmCalls.durationMs}, floor(extract(epoch from (${now} - ${llmCalls.createdAt})) * 1000)::int) else ${llmCalls.durationMs} end`,
        completedAt: sql`coalesce(${llmCalls.completedAt}, ${now})`,
      })
      .where(
        and(
          eq(llmCalls.userId, userId),
          inArray(llmCalls.kind, PLAN_PROMPT_KINDS),
          gte(llmCalls.createdAt, since),
          lte(llmCalls.createdAt, now),
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
      completedAt: llmCalls.completedAt,
      metadata: llmCalls.metadata,
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .orderBy(desc(llmCalls.id))
    .limit(limit)
    .offset(offset);

  return rows.map(({ error, completedAt, metadata, createdAt, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
    failed: error !== null,
    pending: completedAt === null,
    repair: metadata.repair === true,
    attempt: positiveInteger(metadata.attempt),
    ofAttempts: positiveInteger(metadata.ofAttempts),
    planFailed: metadata.planFailed === true,
  }));
}

/** Recent non-null model remarks, newest first. */
export async function listModelRemarks(
  limit: number,
): Promise<LlmModelRemark[]> {
  const rows = await db
    .select({
      id: llmCalls.id,
      createdAt: llmCalls.createdAt,
      userId: llmCalls.userId,
      userLabel: users.authSubject,
      kind: llmCalls.kind,
      model: llmCalls.model,
      response: llmCalls.response,
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .where(sql`${llmCalls.response} is not null`)
    .orderBy(desc(llmCalls.id))
    .limit(Math.max(limit * 5, 50));

  const remarks: LlmModelRemark[] = [];
  for (const row of rows) {
    const text = modelsRemarksFrom(row.response);
    if (text === null) {
      continue;
    }
    remarks.push({
      callId: row.id,
      createdAt: row.createdAt.toISOString(),
      userId: row.userId,
      userLabel: row.userLabel,
      kind: row.kind,
      model: row.model,
      remarks: text,
    });
    if (remarks.length >= limit) {
      break;
    }
  }
  return remarks;
}

function modelsRemarksFrom(response: string | null): string | null {
  if (response === null) {
    return null;
  }
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(response.slice(start, end + 1));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "modelsRemarks" in parsed
    ) {
      const value = (parsed as { modelsRemarks?: unknown }).modelsRemarks;
      return typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : null;
    }
  } catch {
    return null;
  }
  return null;
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
      completedAt: llmCalls.completedAt,
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .where(eq(llmCalls.id, id))
    .limit(1);

  if (!row) {
    return null;
  }
  const { completedAt, ...call } = row;
  return {
    ...call,
    createdAt: call.createdAt.toISOString(),
    failed: call.error !== null,
    pending: completedAt === null,
    repair: call.metadata.repair === true,
    attempt: positiveInteger(call.metadata.attempt),
    ofAttempts: positiveInteger(call.metadata.ofAttempts),
    planFailed: call.metadata.planFailed === true,
  };
}
