import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./components/Button";
import { cn } from "./components/cn";
import { Spinner } from "./Spinner";

/**
 * A submit button that shows a spinner and disables itself while its operation
 * is in flight. The label stays visible so the action remains identifiable.
 */
export function SubmitButton({
  busy,
  children,
  className,
  disabled = false,
  type = "submit",
  ...rest
}: ButtonProps & {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      {...rest}
      type={type}
      className={cn("inline-flex items-center gap-2", className)}
      disabled={busy || disabled}
    >
      {busy && <Spinner />}
      {children}
    </Button>
  );
}
