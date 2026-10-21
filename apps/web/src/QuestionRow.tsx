import { useState } from "react";
import type { Question, QuestionInput } from "@killingit/shared";
import { QuestionForm } from "./QuestionForm";
import { reportError } from "./reportError";

interface QuestionRowProps {
  question: Question;
  onSave: (input: QuestionInput) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * One active question. Editing opens the shared form; saving appends a new
 * version through `onSave`. Deleting archives the question after confirmation.
 */
export function QuestionRow({ question, onSave, onDelete }: QuestionRowProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(): Promise<void> {
    const confirmed = window.confirm(
      "Archive this question? Existing versions are kept for past answers.",
    );
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <li data-testid="question-row">
        <QuestionForm
          initialPrompt={question.prompt}
          initialRequired={question.required}
          submitLabel="Save new version"
          onSubmit={async (input) => {
            await onSave(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className="flex flex-col gap-2 rounded border p-3"
      data-testid="question-row"
    >
      <p className="whitespace-pre-wrap font-medium">{question.prompt}</p>
      <p className="text-xs opacity-60">
        v{question.version} of {question.versionCount} ·{" "}
        {question.required ? "Required" : "Optional"}
      </p>
      {error && (
        <p className="text-red-500" data-testid="question-row-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={() => void remove()}
          disabled={deleting}
        >
          {deleting ? "Archiving…" : "Delete"}
        </button>
      </div>
    </li>
  );
}
