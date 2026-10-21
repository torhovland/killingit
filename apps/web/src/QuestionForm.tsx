import { useState } from "react";
import type { QuestionInput } from "@killingit/shared";
import { reportError } from "./reportError";

interface QuestionFormProps {
  initialPrompt?: string;
  initialRequired?: boolean;
  submitLabel: string;
  onSubmit: (input: QuestionInput) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Shared create/edit form. Editing calls the same submit path as creating; the
 * parent decides whether that creates a question or appends a version.
 */
export function QuestionForm({
  initialPrompt = "",
  initialRequired = true,
  submitLabel,
  onSubmit,
  onCancel,
}: QuestionFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [required, setRequired] = useState(initialRequired);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = submitting || prompt.trim() === "";

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (prompt.trim() === "") {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ prompt: prompt.trim(), required });
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded border bg-card p-3"
      data-testid="question-form"
    >
      <label className="flex flex-col gap-1 text-sm">
        Question prompt
        <textarea
          name="prompt"
          rows={2}
          maxLength={2000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="rounded border bg-card px-3 py-1"
          placeholder="What should the athlete answer?"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="required"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        Required
      </label>
      {error && (
        <p className="text-destructive" data-testid="question-form-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="self-start rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
          disabled={disabled}
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="self-start rounded border bg-card px-4 py-2 enabled:hover:bg-muted disabled:opacity-50"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
