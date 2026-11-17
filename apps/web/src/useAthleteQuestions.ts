import { useCallback, useMemo } from "react";
import {
  athleteQuestionsResponseSchema,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { useApiResource } from "./useApiResource";

/**
 * Loads and saves the signed-in athlete's questionnaire answers. Read the
 * shared {@link useAthleteQuestionsContext} instead of calling this directly:
 * the app reads one response, so the survey gate and the survey page cannot
 * disagree. The returned object is memoised so a re-rendering provider only
 * re-renders its consumers when the questions change.
 */
export function useAthleteQuestions() {
  const auth = useAuth();
  const {
    data: questions,
    loading,
    error,
    reload,
    setData,
  } = useApiResource(
    auth.isAuthenticated ? "/api/questions" : null,
    athleteQuestionsResponseSchema,
    "Loading your questions",
  );

  const saveAnswers = useCallback(
    async (answers: QuestionAnswerInput[]): Promise<void> => {
      const response = await requestParsed(
        "/api/questions/answers",
        auth,
        athleteQuestionsResponseSchema,
        "Saving your answers",
        {
          method: "POST",
          json: { answers },
        },
      );
      setData(response);
    },
    [auth, setData],
  );

  return useMemo(
    () => ({ questions, loading, error, load: reload, saveAnswers }),
    [questions, loading, error, reload, saveAnswers],
  );
}
