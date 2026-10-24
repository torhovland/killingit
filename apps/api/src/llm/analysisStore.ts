import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { activityAnalyses } from "../db/schema.js";

/** A `general` review of the workout, or a `program` review against the plan. */
export type AnalysisKind = "general" | "program";

export interface StoredAnalysis {
  activityId: number;
  kind: AnalysisKind;
  model: string;
  text: string;
  generatedAt: Date;
}

/**
 * Loads one account's cached analyses for the given activities, limited to the
 * requested kind, the currently selected model, and prompt version. An analysis
 * produced by a different model or prompt version is stale and is regenerated
 * by the caller.
 */
export async function loadAnalyses(
  userId: number,
  activityIds: number[],
  model: string,
  promptVersion: number,
  kind: AnalysisKind = "general",
): Promise<Map<number, StoredAnalysis>> {
  if (activityIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select()
    .from(activityAnalyses)
    .where(
      and(
        eq(activityAnalyses.userId, userId),
        inArray(activityAnalyses.activityId, activityIds),
        eq(activityAnalyses.kind, kind),
        eq(activityAnalyses.model, model),
        eq(activityAnalyses.promptVersion, promptVersion),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.activityId,
      {
        activityId: row.activityId,
        kind,
        model: row.model,
        text: row.analysis,
        generatedAt: row.updatedAt,
      },
    ]),
  );
}

/** Inserts or replaces the cached analysis for one activity and kind. */
export async function saveAnalysis(input: {
  userId: number;
  activityId: number;
  kind?: AnalysisKind;
  model: string;
  promptVersion: number;
  text: string;
}): Promise<StoredAnalysis> {
  const kind = input.kind ?? "general";
  const now = new Date();
  const [row] = await db
    .insert(activityAnalyses)
    .values({
      userId: input.userId,
      activityId: input.activityId,
      kind,
      model: input.model,
      promptVersion: input.promptVersion,
      analysis: input.text,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        activityAnalyses.userId,
        activityAnalyses.activityId,
        activityAnalyses.kind,
      ],
      set: {
        model: input.model,
        promptVersion: input.promptVersion,
        analysis: input.text,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new Error("failed to persist activity analysis");
  }
  return {
    activityId: row.activityId,
    kind,
    model: row.model,
    text: row.analysis,
    generatedAt: row.updatedAt,
  };
}
