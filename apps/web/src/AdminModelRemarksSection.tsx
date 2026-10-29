import { useEffect, useState } from "react";
import {
  llmModelRemarksResponseSchema,
  LLM_PROMPT_KIND_LABELS,
  type LlmModelRemark,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { browserTimeZone, formatDateTime } from "./timeZone";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const LIMIT = 20;

/**
 * Admin-only list of recent non-null model remarks. These are the model's own
 * notes about difficulties, inconsistencies or objections it hit while
 * answering a prompt.
 */
export function AdminModelRemarksSection() {
  const auth = useAuth();
  const [remarks, setRemarks] = useState<LlmModelRemark[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJsonAuthed<unknown>(
      `${API_URL}/api/admin/llm-calls/remarks?limit=${LIMIT}`,
      auth,
    )
      .then((response) => {
        const parsed = llmModelRemarksResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "Loading model remarks returned an unexpected response",
            { cause: parsed.error },
          );
        }
        if (!cancelled) {
          setRemarks(parsed.data.remarks);
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
  }, [auth, reloadKey]);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-left"
      data-testid="admin-model-remarks"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Model remarks</h2>
          <p className="text-base text-muted-foreground">
            Difficulties or objections the model reported while answering recent
            prompts.
          </p>
        </div>
        <button
          type="button"
          className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted"
          onClick={() => {
            setRemarks(null);
            setReloadKey((value) => value + 1);
          }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-base text-destructive">{error}</p>}
      {loading && remarks === null && (
        <p className="text-base text-muted-foreground">Loading remarks…</p>
      )}
      {!loading && remarks !== null && remarks.length === 0 && (
        <p className="text-base text-muted-foreground">
          No model remarks were reported recently.
        </p>
      )}
      {remarks !== null && remarks.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="model-remarks-list">
          {remarks.map((remark) => (
            <li
              key={remark.callId}
              className="flex flex-col gap-1 rounded border bg-inset p-3 text-base"
              data-testid="model-remark"
            >
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span className="font-medium">
                  {LLM_PROMPT_KIND_LABELS[remark.kind]}
                </span>
                <span>{remark.model}</span>
                <span>{remark.userLabel}</span>
                <span>
                  {formatDateTime(remark.createdAt, browserTimeZone())}
                </span>
                <span>Prompt #{remark.callId}</span>
              </div>
              <p className="whitespace-pre-line">{remark.remarks}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
