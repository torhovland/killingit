import { FormattedText } from "./FormattedText";
import { SubmitButton } from "./SubmitButton";
import { Textarea } from "./components/Textarea";
import { Card } from "./components/Card";

/**
 * The by-the-way form and the coach's answer. The exchange is not stored and
 * does not start a plan revision.
 */
export function QuickQuestionCard({
  question,
  reply,
  asking,
  error,
  onQuestionChange,
  onAsk,
}: {
  question: string;
  reply: string | null;
  asking: boolean;
  error: string | null;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onAsk();
      }}
    >
      <label className="text-base font-medium" htmlFor="by-the-way">
        By the way
      </label>
      <p className="text-sm text-muted-foreground">
        Ask your coach a one-off question. The question and answer are not
        stored and do not influence your training plan.
      </p>
      <Textarea
        id="by-the-way"
        name="question"
        placeholder="e.g. Should I do my long run on Saturday or Sunday?"
        rows={4}
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
      />
      <SubmitButton
        busy={asking}
        variant="primary"
        size="md"
        className="self-start"
        disabled={!question.trim()}
      >
        {asking ? "Coach is thinking…" : "Ask the coach"}
      </SubmitButton>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {reply && (
        <Card
          variant="inset"
          className="flex flex-col gap-1 rounded p-2 text-base"
          data-testid="by-the-way-reply"
        >
          <span className="font-medium">Coach:</span>
          <FormattedText text={reply} />
        </Card>
      )}
    </form>
  );
}
