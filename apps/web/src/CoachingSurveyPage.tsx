import { useEffect } from "react";
import { AthleteAnswersSection } from "./AthleteAnswersSection";
import { useAppStatus } from "./AppStatus";
import { PlanRegenerationButtons } from "./PlanRegenerationButtons";
import { useAthleteQuestions } from "./useAthleteQuestions";

interface CoachingSurveyPageProps {
  /** Called after answers are saved so the main plan can refresh. */
  onAnswersSaved: () => void;
}

/**
 * The athlete profile survey. Answers are sent to the coach and shape every
 * level of the plan, so the page asks the athlete to be thorough.
 */
export function CoachingSurveyPage({
  onAnswersSaved,
}: CoachingSurveyPageProps) {
  const { setStatus } = useAppStatus();
  const { questions, loading, error, load, saveAnswers } =
    useAthleteQuestions();

  useEffect(() => {
    setStatus("survey-page", loading ? "loading" : null);
    return () => setStatus("survey-page", null);
  }, [loading, setStatus]);

  async function save(
    answers: Parameters<typeof saveAnswers>[0],
  ): Promise<void> {
    await saveAnswers(answers);
    onAnswersSaved();
  }

  return (
    <section
      className="flex w-full flex-col gap-4 text-left"
      data-testid="coaching-survey-page"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">Coaching survey</h2>
        <p className="text-base text-muted-foreground">
          Answer the questions as thoroughly as you can. Everything you provide
          here is sent to your coach and influences your training plan.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {loading && questions === null ? (
        <p className="text-base text-muted-foreground">Loading your answers…</p>
      ) : questions === null ? (
        <button
          type="button"
          className="self-start rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
          onClick={() => void load()}
        >
          Retry
        </button>
      ) : (
        <AthleteAnswersSection
          questions={questions.questions}
          onSubmit={save}
        />
      )}

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <h3 className="text-2xl font-semibold">Training plan</h3>
        <p className="text-base text-muted-foreground">
          After updating your answers, rebuild the plan so your coach can use
          them. Updating an existing season keeps the blocks you have already
          completed.
        </p>
        <PlanRegenerationButtons />
      </section>
    </section>
  );
}
