import type { ReactNode } from "react";
import { cn } from "./cn";

/** How a preformatted block reads: ordinary output or an error message. */
export type PreBlockTone = "default" | "destructive";

const PRE_BLOCK_TONES = {
  default: "",
  destructive: "text-destructive",
} as const;

export interface PreBlockProps {
  tone?: PreBlockTone;
  className?: string;
  children: ReactNode;
}

/**
 * A scrollable block of preformatted text. Prompt messages, responses, request
 * metadata and provider errors share it so long model output wraps inside the
 * panel instead of forcing the page to scroll sideways.
 */
export function PreBlock({
  tone = "default",
  className,
  children,
}: PreBlockProps) {
  return (
    <pre
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-3 text-sm",
        PRE_BLOCK_TONES[tone],
        className,
      )}
    >
      {children}
    </pre>
  );
}
