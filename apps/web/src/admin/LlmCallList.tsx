import { LLM_PROMPT_KIND_LABELS, type LlmCallSummary } from "@killingit/shared";
import { Button } from "../components/Button";
import { cn } from "../components/cn";
import { formatDateTime } from "../timeZone";
import { useTimeZone } from "../TimeZoneContext";
import { CallBadges, CallStatus } from "./LlmCallBadges";

/**
 * The list column of the prompt log: its loading and empty states, and one
 * selectable row per logged call. The selected row is highlighted while its
 * detail is loading as well as after it arrives.
 */
export function LlmCallList({
  calls,
  selectedId,
  loading,
  onSelect,
}: {
  calls: LlmCallSummary[] | null;
  selectedId: number | null;
  loading: boolean;
  onSelect: (id: number) => void;
}) {
  const timeZone = useTimeZone();
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="llm-calls-list">
      {loading && calls === null && (
        <p className="text-base text-muted-foreground">Loading prompts…</p>
      )}

      {!loading && calls !== null && calls.length === 0 && (
        <p className="text-base text-muted-foreground">
          No prompts have been sent yet.
        </p>
      )}

      {calls !== null && calls.length > 0 && (
        <ul className="max-h-[60vh] divide-y overflow-y-auto rounded border bg-card lg:max-h-[70vh]">
          {calls.map((call) => {
            const isSelected = call.id === selectedId;
            return (
              <li key={call.id}>
                <Button
                  variant="ghost"
                  size="none"
                  className={cn(
                    "flex w-full flex-col gap-1 px-3 py-2 text-left",
                    isSelected && "bg-inset ring-1 ring-accent ring-inset",
                  )}
                  onClick={() => onSelect(call.id)}
                  aria-current={isSelected ? "true" : undefined}
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">
                      {LLM_PROMPT_KIND_LABELS[call.kind]}
                    </span>
                    <CallBadges call={call} />
                    <span
                      className="truncate text-sm text-muted-foreground"
                      title={call.model}
                    >
                      {call.model}
                    </span>
                    <span className="ml-auto">
                      <CallStatus failed={call.failed} pending={call.pending} />
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span>{formatDateTime(call.createdAt, timeZone)}</span>
                    <span className="truncate" title={call.userLabel}>
                      {call.userLabel}
                    </span>
                    {!call.pending && <span>{call.durationMs} ms</span>}
                    {call.ofAttempts !== null &&
                      call.attempt !== null &&
                      call.ofAttempts > 1 && (
                        <span data-testid="llm-call-attempt">
                          Attempt {call.attempt}/{call.ofAttempts}
                        </span>
                      )}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
