import { useCallback } from "react";
import {
  athleteQuestionsResponseSchema,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { useApiResource } from "./useApiResource";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads and saves the signed-in athlete's questionnaire answers. */
export function useAthleteQuestions() {
  const auth = useAuth();
  const resource = useApiResource(
    auth.isAuthenticated ? `${API_URL}/api/questions` : null,
    athleteQuestionsResponseSchema,
    "Loading your questions",
  );
  const { setData } = resource;

  const saveAnswers = useCallback(
    async (answers: QuestionAnswerInput[]): Promise<void> => {
      const response = await requestParsed(
        `${API_URL}/api/questions/answers`,
        auth,
        athleteQuestionsResponseSchema,
        "Saving your answers",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers }),
        },
      );
      setData(response);
    },
    [auth, setData],
  );

  return {
    questions: resource.data,
    loading: resource.loading,
    error: resource.error,
    load: resource.reload,
    saveAnswers,
  };
}
