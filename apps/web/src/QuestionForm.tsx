import { useState } from "react";
import type { QuestionInput } from "@killingit/shared";
import { reportError } from "./reportError";
import { Button } from "./components/Button";
import { Textarea } from "./components/Textarea";

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
      <label className="flex flex-col gap-1 text-base">
        Question prompt
        <Textarea
          name="prompt"
          rows={4}
          maxLength={2000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          size="line"
          placeholder="What should the athlete answer?"
        />
      </label>
      <label className="flex items-center gap-2 text-base">
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
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="self-start"
          disabled={disabled}
        >
          {submitting ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="self-start"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
