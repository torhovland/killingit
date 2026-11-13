import {
  llmModelRemarksResponseSchema,
  LLM_PROMPT_KIND_LABELS,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { FormattedText } from "./FormattedText";
import { browserTimeZone, formatDateTime } from "./timeZone";
import { useApiResource } from "./useApiResource";
import { Button } from "./components/Button";
import { Card } from "./components/Card";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const LIMIT = 20;

/**
 * Admin-only list of recent non-null model remarks. These are the model's own
 * notes about difficulties, inconsistencies or objections it hit while
 * answering a prompt.
 */
export function AdminModelRemarksSection() {
  const auth = useAuth();
  const resource = useApiResource(
    auth.isAuthenticated
      ? `${API_URL}/api/admin/llm-calls/remarks?limit=${LIMIT}`
      : null,
    llmModelRemarksResponseSchema,
    "Loading model remarks",
  );
  const remarks = resource.data?.remarks ?? null;
  const loading = resource.loading;
  const error = resource.error;

  return (
    <Card
      as="section"
      className="flex flex-col gap-3 text-left"
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
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => {
            resource.setData(null);
            resource.reload();
          }}
          disabled={loading}
        >
          Refresh
        </Button>
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
              <FormattedText text={remark.remarks} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
