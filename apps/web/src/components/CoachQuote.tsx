import { FormattedText } from "../FormattedText";
import { CoachAvatar } from "./CoachAvatar";
import { cn } from "./cn";

/**
 * One of the coach's plan rationales as a spoken quote: the avatar beside a
 * left-accented blockquote. The season, block, week and day sections all render
 * their rationale through it, so the coach looks and reads the same at every
 * level.
 */
export function CoachQuote({
  text,
  testId,
  className,
}: {
  text: string;
  /** The caller's test id, so each plan section keeps its existing hook. */
  testId?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn("flex items-start gap-3", className)}
      data-testid={testId}
    >
      <CoachAvatar />
      <blockquote className="min-w-0 flex-1 rounded-r-lg border-l-4 border-primary bg-muted/30 px-3 py-2 text-base text-muted-foreground">
        <FormattedText text={text} />
      </blockquote>
      <figcaption className="sr-only">Coach</figcaption>
    </figure>
  );
}
