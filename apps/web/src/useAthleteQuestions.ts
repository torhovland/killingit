import { useCallback, useEffect, useState } from "react";
import {
  athleteQuestionsResponseSchema,
  type AthleteQuestionsResponse,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads and saves the signed-in athlete's questionnaire answers. */
export function useAthleteQuestions() {
  const auth = useAuth();
  const [questions, setQuestions] = useState<AthleteQuestionsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/questions`,
        auth,
      );
      const parsed = athleteQuestionsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading your questions returned an unexpected response",
          { cause: parsed.error },
        );
      }
      setQuestions(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  const saveAnswers = useCallback(
    async (answers: QuestionAnswerInput[]): Promise<void> => {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/questions/answers`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers }),
        },
      );
      const parsed = athleteQuestionsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Saving your answers returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setQuestions(parsed.data);
    },
    [auth],
  );

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void load();
  }, [auth.isAuthenticated, load]);

  return { questions, loading, error, load, saveAnswers };
}
