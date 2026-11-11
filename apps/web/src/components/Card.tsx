import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Elements a card may render as, so panels keep their document semantics. */
export type CardElement = "div" | "section" | "article" | "aside";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  /** `inset` drops the card into the darker well inside another card. */
  variant?: "card" | "inset";
}

/**
 * A panel on the app's card surface. The default padding and radius can be
 * overridden through `className` when a panel needs to sit tighter.
 */
export function Card({
  as: Tag = "div",
  variant = "card",
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lg border p-4",
        variant === "card" ? "bg-card" : "bg-inset",
        className,
      )}
      {...rest}
    />
  );
}
