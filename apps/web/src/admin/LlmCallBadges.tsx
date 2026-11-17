import type { LlmCallSummary } from "@killingit/shared";
import { Badge } from "../components/Badge";

/** Retry and plan-failure markers shared by the list and the detail view. */
export function CallBadges({ call }: { call: LlmCallSummary }) {
  const retried = call.repair || (call.attempt !== null && call.attempt > 1);
  return (
    <>
      {retried && (
        <Badge variant="accent" data-testid="llm-call-retry">
          Retry
        </Badge>
      )}
      {call.planFailed && (
        <Badge variant="danger" data-testid="llm-call-plan-failed">
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
      <Badge variant="accent" data-testid="llm-call-status">
        In flight
      </Badge>
    );
  }
  return (
    <Badge
      variant={failed ? "danger" : "outline"}
      data-testid="llm-call-status"
    >
      {failed ? "Failed" : "Succeeded"}
    </Badge>
  );
}
