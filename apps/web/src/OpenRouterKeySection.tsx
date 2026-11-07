import { useState } from "react";
import { llmSettingsSchema, type LlmSettings } from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface OpenRouterKeySectionProps {
  configured: boolean;
  /** The models chosen in the picker below; required for the first key save. */
  seasonModel: string;
  dailyModel: string;
  onSaved: (settings: LlmSettings) => void;
}

/**
 * OpenRouter API key entry, mirroring the Garmin credential section: the key is
 * validated by the API before being stored encrypted and is never sent back to
 * the client. Once a key is stored, the form is replaced by a connected status
 * and an update action.
 */
export function OpenRouterKeySection({
  configured,
  seasonModel,
  dailyModel,
  onSaved,
}: OpenRouterKeySectionProps) {
  const auth = useAuth();
  const [editing, setEditing] = useState(!configured);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelsChosen = seasonModel !== "" && dailyModel !== "";
  const canSave = apiKey !== "" && (configured || modelsChosen);

  async function submitKey(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const parsed = await requestParsed(
        `${API_URL}/api/llm/settings`,
        auth,
        llmSettingsSchema,
        "Saving the OpenRouter key",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            configured ? { apiKey } : { apiKey, seasonModel, dailyModel },
          ),
        },
      );
      setApiKey("");
      setEditing(false);
      onSaved(parsed);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  if (configured && !editing) {
    return (
      <section className="flex flex-col gap-1" data-testid="openrouter-status">
        <p className="text-base text-success">OpenRouter connected</p>
        <button
          type="button"
          className="self-start rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted"
          onClick={() => setEditing(true)}
          data-testid="openrouter-edit-key"
        >
          Update OpenRouter API key
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl font-semibold">
        {configured ? "Update OpenRouter API key" : "Connect OpenRouter"}
      </h2>
      {error && (
        <p className="text-destructive" data-testid="openrouter-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => void submitKey(e)}
        className="flex w-full flex-col gap-2"
        data-testid="openrouter-key-form"
      >
        <label className="flex w-full flex-col gap-1 text-base">
          <span className="font-medium">OpenRouter API key</span>
          <input
            type="password"
            name="apiKey"
            placeholder="OpenRouter API key (sk-or-v1-…)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded border bg-card px-3 py-1"
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={saving || !canSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {configured && (
            <button
              type="button"
              className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
              onClick={() => {
                setApiKey("");
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {!configured && !modelsChosen && (
        <p className="text-base text-muted-foreground">
          Choose a season and day-to-day model below, then save the key.
        </p>
      )}
    </section>
  );
}
