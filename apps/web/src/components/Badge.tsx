import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** How a badge reads: the default muted marker, or a coloured status. */
export type BadgeVariant = "muted" | "accent" | "danger" | "outline";

const BADGE_VARIANTS = {
  muted: "bg-muted",
  accent: "border-transparent bg-accent text-accent-foreground",
  danger: "border-destructive/40 text-destructive",
  outline: "border-border text-muted-foreground",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/**
 * A compact inline label, such as a status, a day type or an admin marker.
 * Callers keep their own spacing, casing and visibility through `className`.
 */
export function Badge({ variant = "muted", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "rounded border px-2 py-0.5 text-sm",
        BADGE_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
