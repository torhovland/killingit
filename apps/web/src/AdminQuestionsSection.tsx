import { useState } from "react";
import {
  questionArchivedResponseSchema,
  questionSchema,
  questionsResponseSchema,
  type Question,
  type QuestionInput,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { QuestionForm } from "./QuestionForm";
import { QuestionRow } from "./QuestionRow";
import { useApiResource } from "./useApiResource";
import { Button } from "./components/Button";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Admin surface for the versioned athlete question set (ADR 0005). Creating a
 * question stores version 1; editing appends a version; deleting archives the
 * question while preserving its versions.
 */
export function AdminQuestionsSection() {
  const auth = useAuth();
  const resource = useApiResource(
    auth.isAuthenticated ? `${API_URL}/api/admin/questions` : null,
    questionsResponseSchema,
    "Loading questions",
  );
  const questions = resource.data?.questions ?? null;
  const loading = resource.loading;
  const error = resource.error;
  const [adding, setAdding] = useState(false);

  function setQuestions(
    update: (previous: Question[] | null) => Question[],
  ): void {
    resource.setData((previous) => ({
      questions: update(previous?.questions ?? null),
    }));
  }

  async function createQuestion(input: QuestionInput): Promise<void> {
    const created = await requestParsed(
      `${API_URL}/api/admin/questions`,
      auth,
      questionSchema,
      "Creating the question",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    setQuestions((previous) => [...(previous ?? []), created]);
    setAdding(false);
    resource.setError(null);
  }

  async function saveQuestion(id: number, input: QuestionInput): Promise<void> {
    const updated = await requestParsed(
      `${API_URL}/api/admin/questions/${id}/versions`,
      auth,
      questionSchema,
      "Saving the question",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    setQuestions(
      (previous) =>
        previous?.map((question) =>
          question.id === id ? updated : question,
        ) ?? [updated],
    );
    resource.setError(null);
  }

  async function moveQuestion(id: number, offset: -1 | 1): Promise<void> {
    if (questions === null) {
      return;
    }
    const index = questions.findIndex((question) => question.id === id);
    const target = index + offset;
    if (index === -1 || target < 0 || target >= questions.length) {
      return;
    }

    const next = [...questions];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(target, 0, moved);

    const response = await requestParsed(
      `${API_URL}/api/admin/questions/order`,
      auth,
      questionsResponseSchema,
      "Reordering questions",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: next.map((question) => question.id) }),
      },
    );
    setQuestions(() => response.questions);
    resource.setError(null);
  }

  async function deleteQuestion(id: number): Promise<void> {
    const response = await requestParsed(
      `${API_URL}/api/admin/questions/${id}`,
      auth,
      questionArchivedResponseSchema,
      "Archiving the question",
      { method: "DELETE" },
    );
    setQuestions(
      (previous) =>
        previous?.filter((question) => question.id !== response.id) ?? [],
    );
    resource.setError(null);
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3" data-testid="admin-questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Athlete questions</h2>
        {!adding && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setAdding(true)}
            disabled={loading}
          >
            Add question
          </Button>
        )}
      </div>
      <p className="text-base text-muted-foreground">
        Free-text questions for the athlete profile and coach prompts. Editing a
        question adds a new version; deleting archives it and keeps every
        previous version.
      </p>

      {error && (
        <p className="text-destructive" data-testid="admin-questions-error">
          {error}
        </p>
      )}

      {loading && questions === null && (
        <p className="text-base text-muted-foreground">Loading questions…</p>
      )}

      {adding && (
        <QuestionForm
          submitLabel="Add question"
          onSubmit={createQuestion}
          onCancel={() => setAdding(false)}
        />
      )}

      {!loading && !adding && questions !== null && questions.length === 0 && (
        <p className="text-base text-muted-foreground">
          No questions yet. Add the first one.
        </p>
      )}

      {questions !== null && questions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {questions.map((question, index) => (
            <QuestionRow
              key={question.id}
              question={question}
              onSave={(input) => saveQuestion(question.id, input)}
              onDelete={() => deleteQuestion(question.id)}
              onMoveUp={
                index === 0 ? undefined : () => moveQuestion(question.id, -1)
              }
              onMoveDown={
                index === questions.length - 1
                  ? undefined
                  : () => moveQuestion(question.id, 1)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
