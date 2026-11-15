import { useId, type ReactNode } from "react";
import { DangerIcon } from "../DangerIcon";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  /** The question that names the dialog, e.g. "Delete this activity?" */
  title: string;
  /** The consequence under the title, which also describes the dialog. */
  description: ReactNode;
  /** The destructive action's text; it is also the button's accessible name. */
  confirmLabel: string;
  /** The confirm button's text while the action runs. */
  busyLabel?: string;
  /** Whether the action is running; both actions and every close path wait. */
  busy?: boolean;
  /** An error from the failed action, shown inside the dialog. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** The dialog's test id; the confirm button appends `-confirm`. */
  testId?: string;
}

/**
 * A destructive confirmation on the shared `Modal`. Cancel is the first
 * control, so opening the dialog focuses the safe action rather than the one
 * that deletes; the destructive button still carries its own label as its
 * accessible name. Escape and the backdrop cancel like the Cancel button, and
 * all three wait while the action runs so a second request cannot start.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel = "Working…",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
  testId = "confirm-dialog",
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Modal
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      className="max-w-md"
      testId={testId}
    >
      <h3
        id={titleId}
        className="flex items-center gap-2 text-xl font-semibold text-destructive"
      >
        <DangerIcon />
        {title}
      </h3>
      <p id={descriptionId} className="mt-2 text-base">
        {description}
      </p>
      {error && (
        <p className="mt-2 text-base text-destructive">Error: {error}</p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="lg"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          variant="dangerStrong"
          size="lg"
          className="font-medium"
          onClick={onConfirm}
          disabled={busy}
          data-testid={`${testId}-confirm`}
        >
          {busy ? busyLabel : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
