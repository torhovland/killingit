import { useState } from "react";
import type { AthleteQuestion, QuestionAnswerInput } from "@killingit/shared";
import { AthleteQuestionsForm } from "./AthleteQuestionsForm";

interface AthleteAnswersSectionProps {
  questions: AthleteQuestion[];
  onSubmit: (answers: QuestionAnswerInput[]) => Promise<void>;
}

/**
 * Read-only summary of the athlete's current answers with an inline edit mode.
 * Saving reuses the onboarding upsert route, so the parent's question state and
 * the completion gate stay in sync.
 */
export function AthleteAnswersSection({
  questions,
  onSubmit,
}: AthleteAnswersSectionProps) {
  const [editing, setEditing] = useState(false);

  if (questions.length === 0) {
    return null;
  }

  async function save(answers: QuestionAnswerInput[]): Promise<void> {
    await onSubmit(answers);
    setEditing(false);
  }

  return (
    <section
      className="flex flex-col gap-3 rounded border p-4"
      data-testid="athlete-profile"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Your athlete profile</h2>
        {!editing && (
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setEditing(true)}
          >
            Edit answers
          </button>
        )}
      </div>

      {!editing && (
        <>
          <p className="text-sm opacity-70">
            These answers shape your training plan. You can update them at any
            time.
          </p>
          <dl className="flex flex-col gap-2">
            {questions.map((question) => (
              <div key={question.id} className="rounded border p-3 text-sm">
                <dt className="font-medium">{question.prompt}</dt>
                <dd className="whitespace-pre-wrap opacity-80">
                  {question.answer ??
                    (question.skipped ? "Skipped" : "Not answered")}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {editing && (
        <AthleteQuestionsForm
          questions={questions}
          onSubmit={save}
          variant="edit"
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  );
}
