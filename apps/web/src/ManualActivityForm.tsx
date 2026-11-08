import { SubmitButton } from "./SubmitButton";

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
      <input
        id="manual-start-date"
        name="startDate"
        type="date"
        className="w-fit rounded border bg-card px-2 py-1 text-base"
        value={startDate}
        onChange={(event) => onStartDateChange(event.target.value)}
        disabled={saving}
      />
      <textarea
        name="details"
        placeholder="Describe your activity"
        className="w-full rounded border bg-card p-2 text-base"
        rows={4}
        value={details}
        onChange={(event) => onDetailsChange(event.target.value)}
        disabled={saving}
      />
      <div className="flex gap-2">
        <SubmitButton
          busy={saving}
          className="self-start rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
          disabled={!startDate || !details.trim()}
        >
          {submitLabel}
        </SubmitButton>
        {editing && (
          <button
            type="button"
            className="self-start rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
