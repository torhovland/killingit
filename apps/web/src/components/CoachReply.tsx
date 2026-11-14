import { FormattedText } from "../FormattedText";
import { cn } from "./cn";

/**
 * The coach's side of a conversation: its label above the reply, using the
 * shared long-text structure. Every card that shows a stored reply renders it
 * through this component so the label and spacing stay identical.
 */
export function CoachReply({
  text,
  testId,
  className,
}: {
  text: string;
  /** The caller's test id, so each card keeps its existing hook. */
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1 text-base", className)}
      data-testid={testId}
    >
      <span className="font-medium">Coach:</span>
      <FormattedText text={text} />
    </div>
  );
}
