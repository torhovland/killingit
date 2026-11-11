import { useState } from "react";
import {
  QUESTION_ANSWER_MAX_LENGTH,
  type AthleteQuestion,
  type AthleteQuestionPreviousResponse,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { reportError } from "./reportError";
import { Button } from "./components/Button";
import { Textarea } from "./components/Textarea";
import { Card } from "./components/Card";

interface AthleteAnswersSectionProps {
  questions: AthleteQuestion[];
  onSubmit: (answers: QuestionAnswerInput[]) => Promise<void>;
}

/**
 * The athlete's coaching survey. Unanswered questions are split into updated
 * questions (an earlier version was answered) and new questions, while every
 * resolved question stays editable in place.
 */
export function AthleteAnswersSection({
  questions,
  onSubmit,
}: AthleteAnswersSectionProps) {
  if (questions.length === 0) {
    return null;
  }

  const updated = questions.filter(isUpdatedQuestion);
  const newQuestions = questions.filter(isNewQuestion);
  const answered = questions.filter(isAnsweredQuestion);
  const newHeading =
    updated.length === 0 && answered.length === 0
      ? "Coaching questions"
      : "New questions";

  return (
    <section
      className="flex w-full flex-col gap-6 text-left"
      data-testid="athlete-profile"
    >
      {updated.length > 0 && (
        <QuestionGroup
          title="Updated questions"
          description="Your coach revised these questions. Answer each one for the new wording; you can copy your earlier answer as a starting point."
        >
          {updated.map((question) => (
            <AnswerEditor
              key={question.versionId}
              question={question}
              previous={question.previous}
              onSubmit={onSubmit}
            />
          ))}
        </QuestionGroup>
      )}

      {newQuestions.length > 0 && (
        <QuestionGroup
          title={newHeading}
          description="Your coach added these questions. Answer the required ones so your plan uses the latest information."
        >
          {newQuestions.map((question) => (
            <AnswerEditor
              key={question.versionId}
              question={question}
              onSubmit={onSubmit}
            />
          ))}
        </QuestionGroup>
      )}

      {answered.length > 0 && (
        <QuestionGroup
          title="Answered questions"
          description="Edit any answer directly. Saving a change lets your coach adjust the plan on its next refresh."
        >
          {answered.map((question) => (
            <AnswerEditor
              key={question.versionId}
              question={question}
              onSubmit={onSubmit}
            />
          ))}
        </QuestionGroup>
      )}
    </section>
  );
}

function QuestionGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" className="flex flex-col gap-3 rounded">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-base text-muted-foreground">{description}</p>
      </div>
      {children}
    </Card>
  );
}

function AnswerEditor({
  question,
  previous,
  onSubmit,
}: {
  question: AthleteQuestion;
  previous?: AthleteQuestionPreviousResponse | null;
  onSubmit: (answers: QuestionAnswerInput[]) => Promise<void>;
}) {
  const [value, setValue] = useState(question.answer ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missingRequired = question.required && value.trim() === "";

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (missingRequired) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const answer = value.trim();
      await onSubmit([
        {
          questionId: question.id,
          versionId: question.versionId,
          answer: answer === "" ? null : answer,
        },
      ]);
      setSaved(true);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card variant="inset" className="flex flex-col gap-3 rounded p-3 text-base">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => void submit(event)}
      >
        <label
          htmlFor={`survey-question-${question.versionId}`}
          className="flex flex-wrap items-center gap-2 font-medium"
        >
          {question.prompt}
          <span className="rounded border bg-muted px-2 py-0.5 text-sm font-normal text-muted-foreground">
            {question.required ? "Required" : "Optional"}
          </span>
        </label>
        <Textarea
          id={`survey-question-${question.versionId}`}
          name={`question-${question.id}`}
          rows={6}
          maxLength={QUESTION_ANSWER_MAX_LENGTH}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          size="line"
          placeholder="Your answer"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={saving || missingRequired}
          >
            {saving ? "Saving…" : "Save answer"}
          </Button>
          {previous?.answer != null && previous.answer.trim() !== "" && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setValue(previous.answer ?? "");
                setSaved(false);
              }}
            >
              Copy old answer
            </Button>
          )}
          {saved && (
            <span className="text-muted-foreground" role="status">
              Saved
            </span>
          )}
        </div>
        {question.skipped && !value.trim() && (
          <p className="text-muted-foreground">
            You skipped this optional question. Add an answer above to change
            that.
          </p>
        )}
        {missingRequired && (
          <p className="text-muted-foreground">
            Answer this required question to save it.
          </p>
        )}
        {error && <p className="text-destructive">Error: {error}</p>}
      </form>

      {previous && (
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="text-sm font-medium text-muted-foreground">
            Your previous answer (version {previous.version})
          </p>
          <p className="font-medium">{previous.prompt}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">
            {previous.answer ?? "Skipped"}
          </p>
        </div>
      )}
    </Card>
  );
}

function isAnsweredQuestion(question: AthleteQuestion): boolean {
  return question.answer !== null || question.skipped;
}

function isUpdatedQuestion(question: AthleteQuestion): boolean {
  return !isAnsweredQuestion(question) && question.previous !== null;
}

function isNewQuestion(question: AthleteQuestion): boolean {
  return !isAnsweredQuestion(question) && question.previous === null;
}
