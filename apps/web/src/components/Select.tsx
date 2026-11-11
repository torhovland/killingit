import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

/** A select control on the app's card surface. */
export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cn(
        "rounded border bg-card px-2 py-1 disabled:opacity-50",
        className,
      )}
    />
  );
}
