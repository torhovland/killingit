import type { QuestionInput } from "@killingit/shared";
import {
  addQuestionVersion,
  archiveQuestion,
  createQuestion,
  listActiveQuestions,
  reorderQuestions,
  type StoredQuestion,
} from "./store.js";

/**
 * Admin management of the versioned athlete question set. Kept behind an
 * interface so the admin routes can be tested without Postgres (matching the
 * answer, user and plan store pattern).
 */
export interface QuestionSetStore {
  /** Every active question, with its current version and version count. */
  listActiveQuestions(): Promise<StoredQuestion[]>;
  /** Adds a question and its first version atomically. */
  createQuestion(input: QuestionInput): Promise<StoredQuestion>;
  /** Appends a new immutable version; null when the question does not exist. */
  addQuestionVersion(
    id: number,
    input: QuestionInput,
  ): Promise<StoredQuestion | null>;
  /** Returns false unless `ids` lists every active question exactly once. */
  reorderQuestions(ids: number[]): Promise<boolean>;
  /** Archives a question, keeping its versions; false when it is missing. */
  archiveQuestion(id: number): Promise<boolean>;
}

/** PostgreSQL-backed question-set store. */
export const dbQuestionSetStore: QuestionSetStore = {
  listActiveQuestions,
  createQuestion,
  addQuestionVersion,
  reorderQuestions,
  archiveQuestion,
};
