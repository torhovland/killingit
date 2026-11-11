import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

/** Sizes carry the field's width, padding and text size. */
const INPUT_SIZES = {
  field: "w-full p-2 text-base",
  inline: "p-2 text-base",
  line: "px-3 py-1",
  sm: "px-2 py-1",
} as const;

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  size?: keyof typeof INPUT_SIZES;
}

/** A text field on the app's card surface. */
export function Input({
  size = "field",
  className,
  type = "text",
  ...rest
}: InputProps) {
  return (
    <input
      {...rest}
      type={type}
      className={cn("rounded border bg-card", INPUT_SIZES[size], className)}
    />
  );
}
