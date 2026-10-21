import type { AthleteQuestion, Question } from "@killingit/shared";
import type { StoredAthleteQuestion } from "./answers.js";
import type { StoredQuestion } from "./store.js";

/** Serializes a stored question; response schemas validate the rest. */
export function toQuestionResponse(question: StoredQuestion): Question {
  return {
    id: question.id,
    versionId: question.versionId,
    prompt: question.prompt,
    required: question.required,
    version: question.version,
    versionCount: question.versionCount,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
  };
}

/** Adds the signed-in athlete's answer to the admin-facing question shape. */
export function toAthleteQuestionResponse(
  question: StoredAthleteQuestion,
): AthleteQuestion {
  return {
    ...toQuestionResponse(question),
    answer: question.answer,
    skipped: question.skipped,
    answeredAt: question.answeredAt?.toISOString() ?? null,
  };
}
