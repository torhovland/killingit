import { SubmitButton } from "./SubmitButton";
import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Textarea } from "./components/Textarea";

/**
 * The add/edit form for a manually logged activity. The page owns the values so
 * a saved entry can refresh the feed.
 */
export function ManualActivityForm({
  editing,
  startDate,
  details,
  saving,
  llmConfigured,
  onStartDateChange,
  onDetailsChange,
  onSubmit,
  onCancel,
}: {
  editing: boolean;
  startDate: string;
  details: string;
  saving: boolean;
  llmConfigured: boolean;
  onStartDateChange: (value: string) => void;
  onDetailsChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  // A manual entry is saved with the coach's TSS estimate and reply.
  const submitLabel = saving
    ? llmConfigured
      ? "Coach is thinking…"
      : "Saving…"
    : editing
      ? "Update activity"
      : "Add manual activity";

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
      onSubmit={onSubmit}
    >
      <label className="text-base font-medium" htmlFor="manual-start-date">
        {editing ? "Edit manual activity" : "Manual activity"}
      </label>
      <Input
        id="manual-start-date"
        name="startDate"
        type="date"
        size="sm"
        className="w-fit"
        value={startDate}
        onChange={(event) => onStartDateChange(event.target.value)}
        disabled={saving}
      />
      <Textarea
        name="details"
        placeholder="Describe your activity"
        rows={4}
        value={details}
        onChange={(event) => onDetailsChange(event.target.value)}
        disabled={saving}
      />
      <div className="flex gap-2">
        <SubmitButton
          busy={saving}
          variant="primary"
          size="md"
          className="self-start"
          disabled={!startDate || !details.trim()}
        >
          {submitLabel}
        </SubmitButton>
        {editing && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="self-start"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
