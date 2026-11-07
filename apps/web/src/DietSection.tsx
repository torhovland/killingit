import { useState } from "react";
import { currentUserSchema } from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The diet-advice opt-in. The dashboard's food log and the food log in every
 * coach prompt are enabled only while this is on.
 */
export function DietSection({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const auth = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/me`,
        auth,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dietAdvice: next }),
        },
      );
      const parsed = currentUserSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Saving the diet advice setting returned an unexpected response",
          { cause: parsed.error },
        );
      }
      onChanged(parsed.data.dietAdvice);
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
