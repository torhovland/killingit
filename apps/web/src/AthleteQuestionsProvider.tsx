import { createContext, useContext, type ReactNode } from "react";
import { useAthleteQuestions } from "./useAthleteQuestions";

/** The signed-in athlete's survey questions and their save action. */
type AthleteQuestions = ReturnType<typeof useAthleteQuestions>;

const AthleteQuestionsContext = createContext<AthleteQuestions | null>(null);

/**
 * Owns the survey question set for the whole app. The shell's gate and the
 * survey page read one response instead of two copies, so they cannot
 * disagree, and a question change made on the admin page refreshes it, which
 * releases the gate when the question that forced the survey is deleted.
 */
export function AthleteQuestionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const questions = useAthleteQuestions();
  return (
    <AthleteQuestionsContext.Provider value={questions}>
      {children}
    </AthleteQuestionsContext.Provider>
  );
}

/** The app's survey questions, or a clear failure when used outside the provider. */
export function useAthleteQuestionsContext(): AthleteQuestions {
  const value = useContext(AthleteQuestionsContext);
  if (value === null) {
    throw new Error(
      "useAthleteQuestionsContext must be used inside AthleteQuestionsProvider",
    );
  }
  return value;
}
