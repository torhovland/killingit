import type { ComponentPropsWithRef } from "react";

/**
 * A file input hidden from view, opened by an adjacent visible button. The
 * `accept` and `capture` props decide whether it opens the camera or a picker.
 */
export function HiddenFileInput(
  props: Omit<ComponentPropsWithRef<"input">, "type">,
) {
  return <input {...props} type="file" className="sr-only" />;
}
