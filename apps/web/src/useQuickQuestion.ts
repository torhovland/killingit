import { useCallback, useState } from "react";
import { quickQuestionResponseSchema } from "@killingit/shared";
import { useBusyReporter } from "./AppStatus";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface QuickQuestionState {
  question: string;
  reply: string | null;
  asking: boolean;
  error: string | null;
  setQuestion: (value: string) => void;
  ask: () => Promise<void>;
}

/** A one-off by-the-way question and the coach's answer. */
export function useQuickQuestion(
  auth: AuthState,
  timeZone: string,
): QuickQuestionState {
  const reportAsk = useBusyReporter("by-the-way");
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async (): Promise<void> => {
    if (!question.trim() || asking) {
      return;
    }
    setAsking(true);
    setError(null);
    reportAsk(true);
    try {
      const { today } = getToday(timeZone);
      const response = await requestParsed(
        `${API_URL}/api/coaching/questions`,
        auth,
        quickQuestionResponseSchema,
        "Asking the coach",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today, question: question.trim() }),
        },
      );
      setReply(
        response.reply?.text ??
          "The coach could not answer right now. Try again later.",
      );
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setAsking(false);
      reportAsk(false);
    }
  }, [auth, timeZone, question, asking, reportAsk]);

  return { question, reply, asking, error, setQuestion, ask };
}
