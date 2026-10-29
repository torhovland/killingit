import { useState } from "react";
import {
  QUESTION_ANSWER_MAX_LENGTH,
  type AthleteQuestion,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { reportError } from "./reportError";

export type AthleteQuestionsFormVariant = "onboarding" | "edit";

interface AthleteQuestionsFormProps {
  questions: AthleteQuestion[];
  onSubmit: (answers: QuestionAnswerInput[]) => Promise<void>;
  variant?: AthleteQuestionsFormVariant;
  onCancel?: () => void;
}

const COPY: Record<
  AthleteQuestionsFormVariant,
  { title: string; description: string; submitLabel: string }
> = {
  onboarding: {
    title: "Before we get started",
    description:
      "Tell your coach about yourself. Your answers shape your training plan, and you can revisit them later. Answer the required questions and include or skip the optional ones before you see your activities.",
    submitLabel: "Save and continue",
  },
  edit: {
    title: "Edit your answers",
    description:
      "Update your athlete profile at any time. Changes apply the next time your training plan is generated.",
    submitLabel: "Save changes",
  },
};

function initialAnswers(
  questions: readonly AthleteQuestion[],
): Record<number, string> {
  const values: Record<number, string> = {};
  for (const question of questions) {
    values[question.id] = question.answer ?? "";
  }
  return values;
}

/**
 * Onboarding form for the active athlete questions. Existing answers are
 * pre-filled so a newly added or edited question can be answered without
 * losing earlier input. Required fields must be non-blank to submit; blank
 * optional questions are recorded as explicit skips.
 */
export function AthleteQuestionsForm({
  questions,
  onSubmit,
  variant = "onboarding",
  onCancel,
}: AthleteQuestionsFormProps) {
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    initialAnswers(questions),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[variant];
  const Heading = variant === "edit" ? "h3" : "h2";

  const missingRequired = questions.some(
    (question) =>
      question.required && (answers[question.id] ?? "").trim() === "",
  );

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (missingRequired) {
      return;
    }

    // Blank optional answers are sent as explicit skips so the question does
    // not make the onboarding gate reopen on the next visit.
    const payload: QuestionAnswerInput[] = questions.map((question) => {
      const answer = (answers[question.id] ?? "").trim();
      return {
        questionId: question.id,
        versionId: question.versionId,
        answer: answer === "" ? null : answer,
      };
    });

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(payload);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="flex w-full max-w-3xl flex-col gap-6 text-left"
      data-testid="athlete-questions"
    >
      <div className="flex flex-col gap-2">
        <Heading
          className={
            variant === "edit"
              ? "text-2xl font-semibold"
              : "text-3xl font-semibold"
          }
        >
          {copy.title}
        </Heading>
        <p className="text-base text-muted-foreground">{copy.description}</p>
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 rounded border bg-card p-4"
        data-testid="athlete-questions-form"
      >
        {questions.map((question) => (
          <label
            key={question.id}
            htmlFor={`athlete-question-${question.id}`}
            className="flex flex-col gap-1 text-base"
          >
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {question.prompt}
              <span className="rounded border bg-muted px-2 py-0.5 text-sm font-normal text-muted-foreground">
                {question.required ? "Required" : "Optional"}
              </span>
            </span>
            <textarea
              id={`athlete-question-${question.id}`}
              name={`question-${question.id}`}
              rows={3}
              maxLength={QUESTION_ANSWER_MAX_LENGTH}
              required={question.required}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers((previous) => ({
                  ...previous,
                  [question.id]: event.target.value,
                }))
              }
              className="rounded border bg-card px-3 py-1"
              placeholder="Your answer"
            />
          </label>
        ))}

        {error && (
          <p className="text-destructive" data-testid="athlete-questions-error">
            {error}
          </p>
        )}

        {missingRequired && (
          <p className="text-base text-muted-foreground">
            Answer all required questions to continue.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={submitting || missingRequired}
          >
            {submitting ? "Saving…" : copy.submitLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted disabled:opacity-50"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
