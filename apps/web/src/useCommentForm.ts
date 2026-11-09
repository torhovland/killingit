import { useState } from "react";
import type { FormEvent } from "react";

/** Whether a comment is being added for the first time or replacing one. */
export type CommentMode = "create" | "edit";

export interface CommentFormOptions {
  /** The comment already stored on the activity or review, if any. */
  storedComment: string | null;
  /** The coach's reply already stored on the activity or review, if any. */
  storedReply: string | null;
  /** Saves the comment and returns the coach's immediate reply, if any. */
  onSubmit:
    | ((comment: string, mode: CommentMode) => Promise<string | null>)
    | undefined;
  /** Marks the activity or review as reviewed without a comment. */
  onDismiss?: (() => Promise<void>) | undefined;
  /** Error shown when the dismiss request fails. */
  dismissErrorMessage: string;
}

export interface CommentFormState {
  comment: string;
  setComment: (value: string) => void;
  submitting: boolean;
  dismissing: boolean;
  error: string | null;
  editing: boolean;
  /** The stored comment, or the one saved during this visit. */
  shownComment: string | null;
  /** The stored reply, or the one returned during this visit. */
  shownReply: string | null;
  /** Whether the owner offers the "No comment" action. */
  canDismiss: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  edit: () => void;
  cancelEdit: () => void;
  dismiss: () => Promise<void>;
}

/**
 * Owns the comment draft, save, edit, cancel and dismiss state shared by the
 * activity card and the week/block review card.
 */
export function useCommentForm({
  storedComment,
  storedReply,
  onSubmit,
  onDismiss,
  dismissErrorMessage,
}: CommentFormOptions): CommentFormState {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedComment, setSavedComment] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const shownComment = savedComment ?? storedComment;
  const shownReply = coachReply ?? storedReply;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (onSubmit === undefined || !comment.trim()) {
      return;
    }
    const submitted = comment.trim();
    setSubmitting(true);
    setError(null);
    try {
      const reply = await onSubmit(
        submitted,
        shownComment === null ? "create" : "edit",
      );
      setSavedComment(submitted);
      setCoachReply(reply);
      setComment("");
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save comment");
    } finally {
      setSubmitting(false);
    }
  }

  function edit(): void {
    setComment(shownComment ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setComment("");
    setError(null);
  }

  async function dismiss(): Promise<void> {
    if (onDismiss === undefined || dismissing) {
      return;
    }
    setDismissing(true);
    setError(null);
    try {
      await onDismiss();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : dismissErrorMessage);
    } finally {
      setDismissing(false);
    }
  }

  return {
    comment,
    setComment,
    submitting,
    dismissing,
    error,
    editing,
    shownComment,
    shownReply,
    canDismiss: onDismiss !== undefined,
    submit,
    edit,
    cancelEdit,
    dismiss,
  };
}
