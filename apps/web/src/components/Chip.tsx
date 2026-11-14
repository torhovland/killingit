import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** How a chip reads: a plan or event marker, or a muted note. */
export type ChipVariant = "accent" | "muted";

const CHIP_VARIANTS = {
  accent: "bg-accent text-accent-foreground font-medium",
  muted: "bg-muted text-muted-foreground",
} as const;

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
}

/**
 * A small inline label inside a dense list, such as a calendar day's block
 * marker, event or rest note. Selectable entries are buttons, not chips.
 */
export function Chip({ variant = "accent", className, ...rest }: ChipProps) {
  return (
    <span
      className={cn("rounded px-1 py-0.5", CHIP_VARIANTS[variant], className)}
      {...rest}
    />
  );
}
