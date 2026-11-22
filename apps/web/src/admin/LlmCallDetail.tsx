import {
  LLM_PROMPT_KIND_LABELS,
  type LlmCallDetail as LlmCallDetailData,
} from "@killingit/shared";
import { Bullet } from "../Bullet";
import { Card } from "../components/Card";
import { PreBlock } from "../components/PreBlock";
import { formatCostUsd } from "../costs/costChart";
import { formatDateTime } from "../timeZone";
import { useTimeZone } from "../TimeZoneContext";
import { CallBadges, CallStatus } from "./LlmCallBadges";

/** The full prompt, response, and metadata for one logged call. */
export function LlmCallDetail({ call }: { call: LlmCallDetailData }) {
  const timeZone = useTimeZone();
  return (
    <Card
      as="article"
      className="flex flex-col gap-4 rounded"
      data-testid="llm-call-detail"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold">
            {LLM_PROMPT_KIND_LABELS[call.kind]}
          </h3>
          <p className="text-base text-muted-foreground">
            {formatDateTime(call.createdAt, timeZone)}
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
        {call.usage?.cachedTokens != null && (
          <Metadata label="Cached tokens" value={call.usage.cachedTokens} />
        )}
        {call.usage?.cacheWriteTokens != null && (
          <Metadata
            label="Cache write tokens"
            value={call.usage.cacheWriteTokens}
          />
        )}
        {call.usage?.reasoningTokens != null && (
          <Metadata
            label="Reasoning tokens"
            value={call.usage.reasoningTokens}
          />
        )}
        {call.usage?.costUsd !== null && call.usage?.costUsd !== undefined && (
          <Metadata label="Cost" value={formatCostUsd(call.usage.costUsd)} />
        )}
      </dl>

      {Object.keys(call.metadata).length > 0 && (
        <details>
          <summary className="cursor-pointer text-base font-medium">
            Request metadata
          </summary>
          <PreBlock className="mt-2">
            {JSON.stringify(call.metadata, null, 2)}
          </PreBlock>
        </details>
      )}

      <section className="flex flex-col gap-2">
        <h4 className="text-base font-semibold">Prompt</h4>
        {call.messages.map((message, index) => (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-sm font-medium uppercase text-muted-foreground">
              {message.role}
            </p>
            <PreBlock>{message.content}</PreBlock>
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
          <PreBlock tone="destructive">{call.error}</PreBlock>
        )}
        {call.response !== null && <PreBlock>{call.response}</PreBlock>}
      </section>
    </Card>
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
