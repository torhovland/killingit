import { useState } from "react";
import { reportError } from "./reportError";

/**
 * The diet-advice opt-in. The dashboard's food log and the food log in every
 * coach prompt are enabled only while this is on. The page owns the
 * current-user save; this section owns its progress and failure text.
 */
export function DietSection({
  enabled,
  onSave,
}: {
  enabled: boolean;
  onSave: (enabled: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="diet-section">
      <label className="flex items-start gap-2 text-base">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          disabled={saving}
          onChange={(event) => void save(event.target.checked)}
        />
        <span>
          Give me diet advice and a food log
          <span className="block text-sm text-muted-foreground">
            Adds a meal log to your dashboard and lets the coach consider what
            you eat when it plans and answers. Photos are private to your
            account.
          </span>
        </span>
      </label>
      {error && <p className="text-destructive">Error: {error}</p>}
    </div>
  );
}
