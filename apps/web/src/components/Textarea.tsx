import type { TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/** Sizes carry the field's width, padding and text size. */
const TEXTAREA_SIZES = {
  field: "w-full p-2 text-base",
  line: "px-3 py-1",
} as const;

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: keyof typeof TEXTAREA_SIZES;
}

/** A multi-line text field on the app's card surface. */
export function Textarea({
  size = "field",
  className,
  ...rest
}: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={cn("rounded border bg-card", TEXTAREA_SIZES[size], className)}
    />
  );
}
