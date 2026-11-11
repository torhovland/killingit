import type { ReactNode } from "react";
import { SubmitButton } from "./SubmitButton";
import type { CommentFormState } from "./useCommentForm";
import { Button } from "./components/Button";
import { Textarea } from "./components/Textarea";

/**
 * The athlete's comment, the coach's reply and the form that edits the
 * comment. Test ids are prefixed by the card's name (for example
 * `activity-comment`, `activity-comment-form`). The reply is passed as
 * children so each card can render its own coach side, including the activity
 * card's pending-reply placeholder.
 */
export function CommentSection({
  form,
  editable,
  testIdPrefix,
  textareaId,
  ariaLabel,
  placeholder,
  children,
}: {
  form: CommentFormState;
  /** Whether a submit handler exists, which enables editing. */
  editable: boolean;
  /** Prefix for the comment, edit, form and no-comment test ids. */
  testIdPrefix: string;
  textareaId?: string;
  ariaLabel: string;
  placeholder: string;
  /** The coach's side of the conversation, shown between comment and form. */
  children: ReactNode;
}) {
  return (
    <>
      {form.shownComment && (
        <div className="flex flex-wrap items-baseline gap-2 text-base">
          <p data-testid={`${testIdPrefix}-comment`}>
            <span className="font-medium">You:</span> {form.shownComment}
          </p>
          {editable && !form.editing && (
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={form.edit}
              data-testid={`${testIdPrefix}-comment-edit`}
            >
              Edit comment
            </Button>
          )}
        </div>
      )}

      {children}

      {editable && (form.shownComment === null || form.editing) && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void form.submit(event)}
          data-testid={`${testIdPrefix}-comment-form`}
        >
          <Textarea
            id={textareaId}
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={form.comment}
            onChange={(event) => form.setComment(event.target.value)}
            disabled={form.submitting}
            rows={4}
          />
          {form.error && (
            <p className="text-sm text-destructive">{form.error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              busy={form.submitting}
              variant="primary"
              size="md"
              className="self-start"
              disabled={!form.comment.trim()}
            >
              {form.submitting ? "Coach is thinking…" : "Send to coach"}
            </SubmitButton>
            {form.shownComment !== null && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="self-start"
                onClick={form.cancelEdit}
                disabled={form.submitting}
              >
                Cancel
              </Button>
            )}
            {form.canDismiss && form.shownComment === null && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="self-start"
                onClick={() => void form.dismiss()}
                disabled={form.dismissing || form.submitting}
                data-testid={`${testIdPrefix}-no-comment`}
              >
                {form.dismissing ? "Saving…" : "No comment"}
              </Button>
            )}
          </div>
        </form>
      )}
    </>
  );
}
