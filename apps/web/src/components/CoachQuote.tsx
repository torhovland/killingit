import { FormattedText } from "../FormattedText";
import { CoachAvatar } from "./CoachAvatar";
import { cn } from "./cn";

/**
 * One of the coach's plan rationales as a spoken quote: a lime quote mark, the
 * formatted rationale, and the coach's portrait. The season, block, week and
 * day sections all render their rationale through it, so the coach looks and
 * reads the same at every level.
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
      className={cn(
        "grid grid-cols-[22px_minmax(0,1fr)_44px] items-center gap-3 rounded-xl border border-border/55 bg-inset px-3.5 py-3.5",
        "min-[520px]:grid-cols-[30px_minmax(0,1fr)_56px] min-[520px]:gap-[18px] min-[520px]:px-5 min-[520px]:py-[18px]",
        className,
      )}
      data-testid={testId}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[22px] self-start fill-primary drop-shadow-[0_0_10px_color-mix(in_srgb,var(--color-primary)_25%,transparent)] min-[520px]:size-[30px]"
      >
        <path
          transform="rotate(180 12 12)"
          d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"
        />
      </svg>
      <blockquote className="min-w-0 text-pretty text-base leading-relaxed text-foreground">
        <FormattedText text={text} />
      </blockquote>
      <CoachAvatar className="size-11 rounded-full shadow-lg ring-4 ring-primary/10 min-[520px]:size-14" />
    </figure>
  );
}
