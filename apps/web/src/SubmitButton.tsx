import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * A submit button that shows a spinner and disables itself while its operation
 * is in flight. The label stays visible so the action remains identifiable.
 */
export function SubmitButton({
  busy,
  children,
  className = "",
  disabled = false,
  type = "submit",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type}
      className={`inline-flex items-center gap-2 ${className}`}
      disabled={busy || disabled}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}
