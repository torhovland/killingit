import type { QuestionInput } from "@killingit/shared";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  questions,
  questionVersions,
  type QuestionRow,
  type QuestionVersionRow,
} from "../db/schema.js";

/** A question with its current version resolved for API responses. */
export interface StoredQuestion {
  id: number;
  versionId: number;
  prompt: string;
  required: boolean;
  version: number;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pure mapping from a question row plus its current version. Kept separate so
 * the version-selection shape is unit-testable without a database.
 */
export function toStoredQuestion(
  question: QuestionRow,
  currentVersion: QuestionVersionRow,
  versionCount: number,
): StoredQuestion {
  return {
    id: question.id,
    versionId: currentVersion.id,
    prompt: currentVersion.prompt,
    required: currentVersion.required,
    version: currentVersion.version,
    versionCount,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

/**
 * Lists active (non-archived) questions with their current version and total
 * version count. The admin set is small, so two queries and an in-memory join
 * keep this readable; archived versions are deliberately left untouched.
 */
export async function listActiveQuestions(): Promise<StoredQuestion[]> {
  const activeQuestions = await db
    .select()
    .from(questions)
    .where(isNull(questions.archivedAt))
    .orderBy(questions.position, questions.id);

  if (activeQuestions.length === 0) {
    return [];
  }

  const versions = await db
    .select()
    .from(questionVersions)
    .where(
      inArray(
        questionVersions.questionId,
        activeQuestions.map((question) => question.id),
      ),
    )
    .orderBy(questionVersions.questionId, questionVersions.version);

  const versionsByQuestion = new Map<number, QuestionVersionRow[]>();
  for (const version of versions) {
    const existing = versionsByQuestion.get(version.questionId);
    if (existing) {
      existing.push(version);
    } else {
      versionsByQuestion.set(version.questionId, [version]);
    }
  }

  return activeQuestions.map((question) => {
    const questionVersionRows = versionsByQuestion.get(question.id) ?? [];
    const current = questionVersionRows.find(
      (candidate) => candidate.version === question.currentVersion,
    );
    if (!current) {
      throw new Error(
        `question ${question.id} has no version ${question.currentVersion}`,
      );
    }
    return toStoredQuestion(question, current, questionVersionRows.length);
  });
}

/** Creates a new question and its first version atomically. */
export async function createQuestion(
  input: QuestionInput,
): Promise<StoredQuestion> {
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ maxPosition: max(questions.position) })
      .from(questions);
    const [question] = await tx
      .insert(questions)
      .values({
        currentVersion: 1,
        position: (last?.maxPosition ?? -1) + 1,
      })
      .returning();
    if (!question) {
      throw new Error("failed to insert question");
    }

    const [version] = await tx
      .insert(questionVersions)
      .values({
        questionId: question.id,
        version: 1,
        prompt: input.prompt,
        required: input.required,
      })
      .returning();
    if (!version) {
      throw new Error("failed to insert question version");
    }

    return toStoredQuestion(question, version, 1);
  });
}

/**
 * Appends a new immutable version and points the question at it. Returns null
 * when the question does not exist or has been archived. The row lock makes
 * concurrent edits allocate sequential version numbers instead of colliding on
 * the unique `(question_id, version)` constraint.
 */
export async function addQuestionVersion(
  id: number,
  input: QuestionInput,
): Promise<StoredQuestion | null> {
  return db.transaction(async (tx) => {
    const [question] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, id), isNull(questions.archivedAt)))
      .for("update");
    if (!question) {
      return null;
    }

    const versionNumber = question.currentVersion + 1;
    const [version] = await tx
      .insert(questionVersions)
      .values({
        questionId: question.id,
        version: versionNumber,
        prompt: input.prompt,
        required: input.required,
      })
      .returning();
    if (!version) {
      throw new Error("failed to insert question version");
    }

    const [updated] = await tx
      .update(questions)
      .set({ currentVersion: versionNumber, updatedAt: new Date() })
      .where(eq(questions.id, question.id))
      .returning();
    if (!updated) {
      throw new Error("failed to update the question's current version");
    }

    return toStoredQuestion(updated, version, versionNumber);
  });
}

/**
 * Applies a complete ordering of the active question set. Returns false when
 * `ids` is not exactly the set of active questions, so the caller can answer
 * 400 instead of silently dropping or duplicating entries.
 */
export async function reorderQuestions(ids: number[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const active = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(isNull(questions.archivedAt));
    const activeIds = new Set(active.map((question) => question.id));
    if (ids.length !== activeIds.size || ids.some((id) => !activeIds.has(id))) {
      return false;
    }

    const now = new Date();
    for (const [position, id] of ids.entries()) {
      await tx
        .update(questions)
        .set({ position, updatedAt: now })
        .where(eq(questions.id, id));
    }
    return true;
  });
}

/**
 * Archives a question without deleting its versions. Returns false when the id
 * does not exist. Archiving an already-archived question is idempotent.
 */
export async function archiveQuestion(id: number): Promise<boolean> {
  const now = new Date();
  const archived = await db
    .update(questions)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(questions.id, id))
    .returning({ id: questions.id });

  return archived.length > 0;
}
