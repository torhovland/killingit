import type {
  LlmCallDetail,
  LlmCallMessage,
  LlmCallSummary,
  LlmCallUsage,
  LlmPromptKind,
} from "@killingit/shared";
import { desc, eq } from "drizzle-orm";
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
    })
    .from(llmCalls)
    .innerJoin(users, eq(users.id, llmCalls.userId))
    .orderBy(desc(llmCalls.id))
    .limit(limit)
    .offset(offset);

  return rows.map(({ error, createdAt, ...row }) => ({
    ...row,
    createdAt: createdAt.toISOString(),
    failed: error !== null,
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
  };
}
