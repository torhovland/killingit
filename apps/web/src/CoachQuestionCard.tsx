import { useState } from "react";
import type { CoachQuestion } from "@killingit/shared";
import { FormattedText } from "./FormattedText";
import { SubmitButton } from "./SubmitButton";
import { Card } from "./components/Card";
import { Textarea } from "./components/Textarea";

/**
 * One clarification question from the coach. Pending questions get an answer
 * form; answered questions are shown read-only on the season review page.
 */
export function CoachQuestionCard({
  question,
  onSubmitAnswer,
}: {
  question: CoachQuestion;
  onSubmitAnswer?: (id: number, answer: string) => Promise<string | null>;
}) {
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAnswer, setSavedAnswer] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!onSubmitAnswer || !answer.trim()) {
      return;
    }
    const submitted = answer.trim();
    setSubmitting(true);
    setError(null);
    try {
      const reply = await onSubmitAnswer(question.id, submitted);
      setSavedAnswer(submitted);
      setCoachReply(reply);
      setAnswer("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save answer");
    } finally {
      setSubmitting(false);
    }
  }

  const shownAnswer = savedAnswer ?? question.answer;
  const shownReply = coachReply ?? question.coachReply?.text ?? null;
  const pending = shownAnswer === null;

  return (
    <Card
      as="article"
      className="flex flex-col gap-2 text-left"
      data-testid="coach-question-card"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold">Question from the coach</h3>
      </header>

      <FormattedText text={question.question} testId="coach-question-text" />

      {shownAnswer !== null && (
        <p className="text-base" data-testid="coach-question-answer">
          <span className="font-medium">You:</span> {shownAnswer}
        </p>
      )}

      {shownReply !== null && (
        <div
          className="flex flex-col gap-1 text-base"
          data-testid="coach-question-reply"
        >
          <span className="font-medium">Coach:</span>
          <FormattedText text={shownReply} />
        </div>
      )}

      {pending && onSubmitAnswer && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void handleSubmit(event)}
          data-testid="coach-question-form"
        >
          <Textarea
            aria-label="Answer the coach's question"
            placeholder="Answer the coach so the plan can be adjusted."
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={submitting}
            rows={4}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <SubmitButton
            busy={submitting}
            variant="primary"
            size="md"
            className="self-start"
            disabled={!answer.trim()}
          >
            {submitting ? "Coach is thinking…" : "Send to coach"}
          </SubmitButton>
        </form>
      )}
    </Card>
  );
}
