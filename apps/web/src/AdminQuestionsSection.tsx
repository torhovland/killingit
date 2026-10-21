import { useEffect, useState } from "react";
import {
  questionArchivedResponseSchema,
  questionSchema,
  questionsResponseSchema,
  type Question,
  type QuestionInput,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { QuestionForm } from "./QuestionForm";
import { QuestionRow } from "./QuestionRow";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Parses a single-question response, throwing a descriptive error if invalid. */
function parseQuestion(response: unknown, action: string): Question {
  const parsed = questionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(`${action} returned an unexpected response`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Admin surface for the versioned athlete question set (ADR 0005). Creating a
 * question stores version 1; editing appends a version; deleting archives the
 * question while preserving its versions.
 */
export function AdminQuestionsSection() {
  const auth = useAuth();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchJsonAuthed<unknown>(`${API_URL}/api/admin/questions`, auth)
      .then((response) => {
        const parsed = questionsResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error("Loading questions returned an unexpected response", {
            cause: parsed.error,
          });
        }
        if (!cancelled) {
          setQuestions(parsed.data.questions);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(reportError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  async function createQuestion(input: QuestionInput): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/admin/questions`,
      auth,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const created = parseQuestion(response, "Creating the question");
    setQuestions((previous) => [...(previous ?? []), created]);
    setAdding(false);
    setError(null);
  }

  async function saveQuestion(id: number, input: QuestionInput): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/admin/questions/${id}/versions`,
      auth,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const updated = parseQuestion(response, "Saving the question");
    setQuestions(
      (previous) =>
        previous?.map((question) =>
          question.id === id ? updated : question,
        ) ?? [updated],
    );
    setError(null);
  }

  async function deleteQuestion(id: number): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/admin/questions/${id}`,
      auth,
      { method: "DELETE" },
    );
    const parsed = questionArchivedResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        "Archiving the question returned an unexpected response",
        {
          cause: parsed.error,
        },
      );
    }
    setQuestions(
      (previous) =>
        previous?.filter((question) => question.id !== parsed.data.id) ?? [],
    );
    setError(null);
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3" data-testid="admin-questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Athlete questions</h2>
        {!adding && (
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setAdding(true)}
            disabled={loading}
          >
            Add question
          </button>
        )}
      </div>
      <p className="text-sm opacity-70">
        Free-text questions for the athlete profile and coach prompts. Editing a
        question adds a new version; deleting archives it and keeps every
        previous version.
      </p>

      {error && (
        <p className="text-red-500" data-testid="admin-questions-error">
          {error}
        </p>
      )}

      {loading && questions === null && (
        <p className="text-sm opacity-60">Loading questions…</p>
      )}

      {adding && (
        <QuestionForm
          submitLabel="Add question"
          onSubmit={createQuestion}
          onCancel={() => setAdding(false)}
        />
      )}

      {!loading && !adding && questions !== null && questions.length === 0 && (
        <p className="text-sm opacity-60">
          No questions yet. Add the first one.
        </p>
      )}

      {questions !== null && questions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {questions.map((question) => (
            <QuestionRow
              key={question.id}
              question={question}
              onSave={(input) => saveQuestion(question.id, input)}
              onDelete={() => deleteQuestion(question.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
