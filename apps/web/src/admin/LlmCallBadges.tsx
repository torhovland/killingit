import type { ReactNode } from "react";
import type { LlmCallSummary } from "@killingit/shared";
import { cn } from "../components/cn";

/** Retry and plan-failure markers shared by the list and the detail view. */
export function CallBadges({ call }: { call: LlmCallSummary }) {
  const retried = call.repair || (call.attempt !== null && call.attempt > 1);
  return (
    <>
      {retried && (
        <Badge tone="accent" testId="llm-call-retry">
          Retry
        </Badge>
      )}
      {call.planFailed && (
        <Badge tone="danger" testId="llm-call-plan-failed">
          Plan failed
        </Badge>
      )}
    </>
  );
}

export function CallStatus({
  failed,
  pending,
}: {
  failed: boolean;
  pending: boolean;
}) {
  if (pending) {
    return (
      <Badge tone="accent" testId="llm-call-status">
        In flight
      </Badge>
    );
  }
  return (
    <Badge tone={failed ? "danger" : "muted"} testId="llm-call-status">
      {failed ? "Failed" : "Succeeded"}
    </Badge>
  );
}

function Badge({
  tone,
  testId,
  children,
}: {
  tone: "accent" | "danger" | "muted";
  testId: string;
  children: ReactNode;
}) {
  const toneClass = {
    accent: "border-transparent bg-accent text-accent-foreground",
    danger: "border-destructive/40 text-destructive",
    muted: "border-border text-muted-foreground",
  }[tone];
  return (
    <span
      className={cn("rounded border px-2 py-0.5 text-sm", toneClass)}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
