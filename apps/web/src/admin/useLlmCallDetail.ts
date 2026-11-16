import { useState } from "react";
import { llmCallDetailSchema, type LlmCallDetail } from "@killingit/shared";
import { useAuth } from "../auth";
import { requestParsed } from "../fetchAuthed";
import { reportError } from "../reportError";
import { useAbortableRequest } from "../useApiResource";

/** The detail request's state: one call is loading, shown, or failed to load. */
export type LlmCallDetailState =
  | { status: "idle" }
  | { status: "loading"; id: number }
  | { status: "loaded"; id: number; call: LlmCallDetail }
  | { status: "error"; error: string };

export interface LlmCallDetailRequest {
  state: LlmCallDetailState;
  select: (id: number) => void;
}

/**
 * The row the list highlights. Loading and loaded details name their call; an
 * error clears the selection, as does the idle state before the first pick.
 */
export function selectedCallId(state: LlmCallDetailState): number | null {
  switch (state.status) {
    case "loading":
    case "loaded":
      return state.id;
    default:
      return null;
  }
}

/**
 * Loads one logged call's full detail. Selecting another call aborts the
 * request it supersedes, and a settle path that finds its signal aborted never
 * writes to the selection, so a detail response that arrives late cannot
 * replace the call the admin selected after it.
 */
export function useLlmCallDetail(): LlmCallDetailRequest {
  const auth = useAuth();
  const [state, setState] = useState<LlmCallDetailState>({ status: "idle" });
  const [loadDetail, abortDetail] = useAbortableRequest(
    async (signal: AbortSignal, id: number): Promise<void> => {
      try {
        const call = await requestParsed(
          `/api/admin/llm-calls/${id}`,
          auth,
          llmCallDetailSchema,
          "Loading the LLM call",
          { signal },
        );
        if (!signal.aborted) {
          setState({ status: "loaded", id, call });
        }
      } catch (err: unknown) {
        if (!signal.aborted) {
          setState({ status: "error", error: reportError(err) });
        }
      }
    },
  );

  function select(id: number): void {
    if (selectedCallId(state) === id) {
      return;
    }
    abortDetail();
    setState({ status: "loading", id });
    void loadDetail(id);
  }

  return { state, select };
}
