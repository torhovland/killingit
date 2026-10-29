import { useEffect, useState, type ReactNode } from "react";
import {
  llmCallDetailSchema,
  llmCallsResponseSchema,
  LLM_PROMPT_KIND_LABELS,
  type LlmCallDetail,
  type LlmCallSummary,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { Bullet } from "./Bullet";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { browserTimeZone, formatDateTime } from "./timeZone";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const PAGE_SIZE = 50;

/**
 * Admin-only prompt log. The API stores every completion attempt; this view
 * lists recent calls and shows the exact prompt, response, and metadata for the
 * one selected. Prompts can include health and training details, so the route
 * is admin-guarded on the server as well.
 */
export function AdminLlmCallsSection() {
  const auth = useAuth();
  const [calls, setCalls] = useState<LlmCallSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<LlmCallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJsonAuthed<unknown>(
      `${API_URL}/api/admin/llm-calls?limit=${PAGE_SIZE}`,
      auth,
    )
      .then((response) => {
        const parsed = llmCallsResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error("Loading LLM calls returned an unexpected response", {
            cause: parsed.error,
          });
        }
        if (!cancelled) {
          setCalls(parsed.data.calls);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(reportError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // Only re-run on sign-in or an explicit refresh; `auth` is consumed inside.
  }, [auth.isAuthenticated, reloadKey]);

  async function selectCall(id: number): Promise<void> {
    if (id === selectedId) {
      return;
    }
    setSelectedId(id);
    setSelected(null);
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/admin/llm-calls/${id}`,
        auth,
      );
      const parsed = llmCallDetailSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading the LLM call returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      setSelected(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <LlmCallsView
      calls={calls}
      selectedId={selectedId}
      selected={selected}
      loading={loading}
      detailLoading={detailLoading}
      error={error}
      onSelect={(id) => void selectCall(id)}
      onRefresh={() => setReloadKey((key) => key + 1)}
    />
  );
}

/** Presentational prompt log, split out so it is testable without fetching. */
export function LlmCallsView({
  calls,
  selectedId,
  selected,
  loading,
  detailLoading,
  error,
  onSelect,
  onRefresh,
}: {
  calls: LlmCallSummary[] | null;
  selectedId: number | null;
  selected: LlmCallDetail | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  onSelect: (id: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="admin-llm-calls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">LLM prompts</h2>
        <button
          type="button"
          className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </button>
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
        <div
          className="flex min-w-0 flex-col gap-3"
          data-testid="llm-calls-list"
        >
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
              {calls.map((call) => (
                <li key={call.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-muted ${
                      call.id === selectedId ? "bg-accent" : ""
                    }`}
                    onClick={() => onSelect(call.id)}
                    aria-current={call.id === selectedId ? "true" : undefined}
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
                        <CallStatus
                          failed={call.failed}
                          pending={call.pending}
                        />
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                      <span>
                        {formatDateTime(call.createdAt, browserTimeZone())}
                      </span>
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
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="flex min-w-0 flex-col gap-3"
          data-testid="llm-call-detail-pane"
        >
          {detailLoading && (
            <p className="text-base text-muted-foreground">Loading call…</p>
          )}

          {selected !== null && <LlmCallDetailView call={selected} />}

          {selected === null && !detailLoading && (calls?.length ?? 0) > 0 && (
            <p className="rounded border border-dashed bg-card px-3 py-6 text-center text-base text-muted-foreground">
              Select a prompt to read it in full.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** The full prompt, response, and metadata for one logged call. */
export function LlmCallDetailView({ call }: { call: LlmCallDetail }) {
  return (
    <article
      className="flex flex-col gap-4 rounded border bg-card p-4"
      data-testid="llm-call-detail"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold">
            {LLM_PROMPT_KIND_LABELS[call.kind]}
          </h3>
          <p className="text-base text-muted-foreground">
            {formatDateTime(call.createdAt, browserTimeZone())}
            <Bullet />
            {call.userLabel}
            <Bullet />
            {call.model}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <CallBadges call={call} />
          </div>
        </div>
        <CallStatus failed={call.failed} pending={call.pending} />
      </header>

      {call.planFailed && typeof call.metadata.planError === "string" && (
        <p
          className="text-base text-destructive"
          data-testid="llm-call-plan-error"
        >
          Plan failure: {call.metadata.planError}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-base sm:grid-cols-3">
        <Metadata label="Call" value={`#${call.id}`} />
        <Metadata label="User" value={`${call.userLabel} (#${call.userId})`} />
        <Metadata label="Provider" value={call.provider} />
        <Metadata
          label="Duration"
          value={call.pending ? "In flight" : `${call.durationMs} ms`}
        />
        <Metadata
          label="Prompt tokens"
          value={call.usage?.promptTokens ?? "—"}
        />
        <Metadata
          label="Completion tokens"
          value={call.usage?.completionTokens ?? "—"}
        />
        <Metadata label="Total tokens" value={call.usage?.totalTokens ?? "—"} />
      </dl>

      {Object.keys(call.metadata).length > 0 && (
        <details>
          <summary className="cursor-pointer text-base font-medium">
            Request metadata
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-3 text-sm">
            {JSON.stringify(call.metadata, null, 2)}
          </pre>
        </details>
      )}

      <section className="flex flex-col gap-2">
        <h4 className="text-base font-semibold">Prompt</h4>
        {call.messages.map((message, index) => (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-sm font-medium uppercase text-muted-foreground">
              {message.role}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-3 text-sm">
              {message.content}
            </pre>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-base font-semibold">
          {call.failed ? "Error" : "Response"}
        </h4>
        {call.pending && (
          <p className="text-base text-muted-foreground">
            Waiting for the provider to answer.
          </p>
        )}
        {call.error !== null && (
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-3 text-sm text-destructive">
            {call.error}
          </pre>
        )}
        {call.response !== null && (
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-inset p-3 text-sm">
            {call.response}
          </pre>
        )}
      </section>
    </article>
  );
}

/** Retry and plan-failure markers shared by the list and the detail view. */
function CallBadges({ call }: { call: LlmCallSummary }) {
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

function CallStatus({
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
      className={`rounded border px-2 py-0.5 text-sm ${toneClass}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

function Metadata({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
