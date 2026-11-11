import { useState } from "react";
import type { Question, QuestionInput } from "@killingit/shared";
import { Bullet } from "./Bullet";
import { QuestionForm } from "./QuestionForm";
import { reportError } from "./reportError";
import { Button } from "./components/Button";

interface QuestionRowProps {
  question: Question;
  onSave: (input: QuestionInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp?: (() => Promise<void>) | undefined;
  onMoveDown?: (() => Promise<void>) | undefined;
}

/**
 * One active question. Editing opens the shared form; saving appends a new
 * version through `onSave`. Deleting archives the question after confirmation.
 */
export function QuestionRow({
  question,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
}: QuestionRowProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState<"up" | "down" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(direction: "up" | "down"): Promise<void> {
    const handler = direction === "up" ? onMoveUp : onMoveDown;
    if (!handler || moving !== null) {
      return;
    }
    setMoving(direction);
    setError(null);
    try {
      await handler();
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setMoving(null);
    }
  }

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
      className="flex flex-col gap-2 rounded border bg-card p-3"
      data-testid="question-row"
    >
      <p className="whitespace-pre-wrap font-medium">{question.prompt}</p>
      <p className="text-sm text-muted-foreground">
        v{question.version} of {question.versionCount}
        <Bullet />
        {question.required ? "Required" : "Optional"}
      </p>
      {error && (
        <p className="text-destructive" data-testid="question-row-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onMoveUp && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void move("up")}
            disabled={moving !== null || deleting}
            aria-label={`Move "${question.prompt}" up`}
            data-testid="question-move-up"
          >
            ↑
          </Button>
        )}
        {onMoveDown && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void move("down")}
            disabled={moving !== null || deleting}
            aria-label={`Move "${question.prompt}" down`}
            data-testid="question-move-down"
          >
            ↓
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="danger"
          size="md"
          onClick={() => void remove()}
          disabled={deleting}
        >
          {deleting ? "Archiving…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}
