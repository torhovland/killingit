import { useCallback, useEffect, useState } from "react";
import {
  coachQuestionsResponseSchema,
  coachingInputSaveResponseSchema,
  type CoachQuestion,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface CoachQuestionState {
  question: CoachQuestion | null;
  error: string | null;
  /** Reloads the pending question, for example after a plan refresh. */
  load: () => Promise<void>;
  answer: (id: number, answer: string) => Promise<string | null>;
}

/** Loads the coach's pending clarification question and saves an answer. */
export function useCoachQuestion(
  auth: AuthState,
  timeZone: string,
  onAnswered?: () => void,
): CoachQuestionState {
  const [question, setQuestion] = useState<CoachQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await requestParsed(
        `${API_URL}/api/coaching/coach-questions`,
        auth,
        coachQuestionsResponseSchema,
        "Loading the coach's questions",
      );
      setQuestion(response.pending);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }, [auth]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void load();
  }, [auth, load]);

  const answer = useCallback(
    async (id: number, answer: string): Promise<string | null> => {
      const { today } = getToday(timeZone);
      const parsed = await requestParsed(
        `${API_URL}/api/coaching/coach-questions/${id}/answer`,
        auth,
        coachingInputSaveResponseSchema,
        "Saving your answer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ today, timezone: timeZone, answer }),
        },
      );
      setQuestion((current) =>
        current === null || current.id !== id
          ? current
          : {
              ...current,
              answer,
              coachReply: parsed.reply,
              answeredAt: new Date().toISOString(),
            },
      );
      onAnswered?.();
      return parsed.reply?.text ?? null;
    },
    [auth, timeZone, onAnswered],
  );

  return { question, error, load, answer };
}
