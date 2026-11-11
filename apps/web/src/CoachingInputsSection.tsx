import { useAuth } from "./auth";
import { QuickQuestionCard } from "./QuickQuestionCard";
import { useQuickQuestion } from "./useQuickQuestion";
import { useTimeZone } from "./TimeZoneContext";
import { useWeeklyNote } from "./useWeeklyNote";
import { WeeklyNoteCard } from "./WeeklyNoteCard";
import { Card } from "./components/Card";

/**
 * The two ways the athlete talks to the coach: a weekly note that shapes the
 * plan, and a one-off by-the-way question.
 */
export function CoachingInputsSection({
  onWeeklyNoteSaved,
}: {
  /** Called after a note is saved so the caller can refresh the plan. */
  onWeeklyNoteSaved?: () => void;
}) {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const weeklyNote = useWeeklyNote(auth, timeZone, onWeeklyNoteSaved);
  const quickQuestion = useQuickQuestion(auth, timeZone);

  return (
    <Card
      as="section"
      className="flex flex-col gap-4 text-left"
      data-testid="coaching-inputs"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Talk to the coach</h2>
        <p className="text-base text-muted-foreground">
          Share context with your coach. The weekly note shapes your plan; a
          by-the-way question is only a conversation.
        </p>
      </div>

      <WeeklyNoteCard
        note={weeklyNote.note}
        reply={weeklyNote.reply}
        saving={weeklyNote.saving}
        error={weeklyNote.error}
        onNoteChange={weeklyNote.setNote}
        onSend={() => void weeklyNote.submit()}
      />

      <QuickQuestionCard
        question={quickQuestion.question}
        reply={quickQuestion.reply}
        asking={quickQuestion.asking}
        error={quickQuestion.error}
        onQuestionChange={quickQuestion.setQuestion}
        onAsk={() => void quickQuestion.ask()}
      />
    </Card>
  );
}
