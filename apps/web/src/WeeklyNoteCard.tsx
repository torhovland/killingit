import type { CoachAnalysis } from "@killingit/shared";
import { FormattedText } from "./FormattedText";
import { SubmitButton } from "./SubmitButton";
import { Textarea } from "./components/Textarea";
import { Card } from "./components/Card";

/**
 * The weekly note form and the coach's reply. Saving a note asks the coach to
 * revise the affected plan, so the page bumps its plan refresh key afterwards.
 */
export function WeeklyNoteCard({
  note,
  reply,
  saving,
  error,
  onNoteChange,
  onSend,
}: {
  note: string;
  reply: CoachAnalysis | null;
  saving: boolean;
  error: string | null;
  onNoteChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <label className="text-base font-medium" htmlFor="weekly-note">
        Weekly note
      </label>
      <p className="text-sm text-muted-foreground">
        Requests and additional information that should influence your training
        plan. Saving it refreshes the affected plan.
      </p>
      <Textarea
        id="weekly-note"
        name="note"
        placeholder="e.g. I won't have time to train on Thursday this week."
        rows={4}
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
      />
      <SubmitButton
        busy={saving}
        variant="primary"
        size="md"
        className="self-start"
        disabled={!note.trim()}
      >
        {saving ? "Coach is thinking…" : "Send to coach"}
      </SubmitButton>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {reply && (
        <Card
          variant="inset"
          className="flex flex-col gap-1 rounded p-2 text-base"
          data-testid="weekly-note-reply"
        >
          <span className="font-medium">Coach:</span>
          <FormattedText text={reply.text} />
        </Card>
      )}
    </form>
  );
}
