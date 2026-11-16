import { llmCallsResponseSchema, type LlmCallSummary } from "@killingit/shared";
import { useAuth } from "../auth";
import { useApiResource } from "../useApiResource";
import { Button } from "../components/Button";
import { LlmCallDetail } from "./LlmCallDetail";
import { LlmCallList } from "./LlmCallList";
import {
  selectedCallId,
  useLlmCallDetail,
  type LlmCallDetailState,
} from "./useLlmCallDetail";

const PAGE_SIZE = 50;

/**
 * Admin-only prompt log. The API stores every completion attempt; this view
 * lists recent calls and shows the exact prompt, response, and metadata for the
 * one selected. Prompts can include health and training details, so the route
 * is admin-guarded on the server as well.
 */
export function AdminLlmCallsSection() {
  const auth = useAuth();
  const callsResource = useApiResource(
    auth.isAuthenticated ? `/api/admin/llm-calls?limit=${PAGE_SIZE}` : null,
    llmCallsResponseSchema,
    "Loading LLM calls",
  );
  const calls = callsResource.data?.calls ?? null;
  const detail = useLlmCallDetail();

  function selectCall(id: number): void {
    callsResource.setError(null);
    detail.select(id);
  }

  const detailError =
    detail.state.status === "error" ? detail.state.error : null;

  return (
    <LlmCallsView
      calls={calls}
      detail={detail.state}
      loading={callsResource.loading}
      error={callsResource.error ?? detailError}
      onSelect={selectCall}
      onRefresh={callsResource.reload}
    />
  );
}

/** Presentational prompt log, split out so it is testable without fetching. */
function LlmCallsView({
  calls,
  detail,
  loading,
  error,
  onSelect,
  onRefresh,
}: {
  calls: LlmCallSummary[] | null;
  detail: LlmCallDetailState;
  loading: boolean;
  error: string | null;
  onSelect: (id: number) => void;
  onRefresh: () => void;
}) {
  const detailLoading = detail.status === "loading";
  const call = detail.status === "loaded" ? detail.call : null;
  return (
    <section className="flex flex-col gap-3" data-testid="admin-llm-calls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">LLM prompts</h2>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      <p className="text-base text-muted-foreground">
        Every prompt sent to the coach, with its response and request metadata.
        Showing the newest {PAGE_SIZE} calls; select one to read it in full.
      </p>

      {error && (
        <p className="text-destructive" data-testid="admin-llm-calls-error">
          {error}
        </p>
      )}

      {/* The list and the selected call sit side by side on wide screens, so
          reading a prompt never means scrolling past the rest of the list. */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <LlmCallList
          calls={calls}
          selectedId={selectedCallId(detail)}
          loading={loading}
          onSelect={onSelect}
        />

        <div
          className="flex min-w-0 flex-col gap-3"
          data-testid="llm-call-detail-pane"
        >
          {detailLoading && (
            <p className="text-base text-muted-foreground">Loading call…</p>
          )}

          {call !== null && <LlmCallDetail call={call} />}

          {call === null && !detailLoading && (calls?.length ?? 0) > 0 && (
            <p className="rounded border border-dashed bg-card px-3 py-6 text-center text-base text-muted-foreground">
              Select a prompt to read it in full.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
