import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/** The app's button looks. `ghost` is a borderless menu or list action. */
const BUTTON_VARIANTS = {
  primary:
    "rounded border border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover",
  secondary: "rounded border bg-card enabled:hover:bg-muted",
  danger:
    "rounded border border-destructive/40 text-destructive enabled:hover:bg-destructive/10",
  dangerStrong:
    "rounded border border-destructive bg-destructive/15 text-destructive enabled:hover:bg-destructive/25",
  ghost: "rounded enabled:hover:bg-muted",
  link: "text-sm text-muted-foreground enabled:hover:underline",
  linkStrong: "underline enabled:hover:no-underline",
} as const;

/** Sizes carry padding and text size; `className` can override either. */
const BUTTON_SIZES = {
  none: "",
  xs: "px-2 py-0.5 text-base",
  sm: "px-2 py-1 text-base",
  md: "px-3 py-1 text-base",
  lg: "px-4 py-2 text-base",
  hero: "px-6 py-2.5 text-lg font-medium",
  icon: "inline-flex size-9 items-center justify-center",
  menu: "px-3 py-1.5 text-left",
  menuSm: "px-2 py-1 text-left",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}

/**
 * The standard button. It renders a real `button` and defaults to
 * `type="button"`, so a button inside a form never submits unless it says so.
 */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cn(
        "disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    />
  );
}
