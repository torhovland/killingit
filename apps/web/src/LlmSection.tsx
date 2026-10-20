import { useEffect, useState } from "react";
import {
  llmModelsResponseSchema,
  llmSettingsSchema,
  type LlmModel,
  type LlmSettings,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface LlmSectionProps {
  settings: LlmSettings;
  onSaved: (settings: LlmSettings) => void;
}

/**
 * OpenRouter configuration (ADR 0004): enter an API key (validated by the API
 * before storage) and choose a model from OpenRouter's catalog. The stored key
 * is never returned; leaving the field blank keeps the existing key.
 */
export function LlmSection({ settings, onSaved }: LlmSectionProps) {
  const auth = useAuth();
  const [editing, setEditing] = useState(!settings.configured);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings.model ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || !auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    fetchJsonAuthed<unknown>(`${API_URL}/api/llm/models`, auth)
      .then((res) => {
        const parsed = llmModelsResponseSchema.safeParse(res);
        if (!parsed.success) {
          throw new Error("OpenRouter models returned an unexpected response", {
            cause: parsed.error,
          });
        }
        if (!cancelled) {
          setModels(parsed.data.models);
          setModelsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setModelsError(reportError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingModels(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editing, auth.isAuthenticated]);

  // Suggest a sensible default once the catalog loads, without overwriting a
  // model the operator has already chosen.
  useEffect(() => {
    if (model !== "" || models.length === 0) {
      return;
    }
    const preferred =
      models.find((candidate) => candidate.id === "openrouter/auto") ??
      models[0];
    if (preferred) {
      setModel(preferred.id);
    }
  }, [model, models]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/llm/settings`,
        auth,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(apiKey === "" ? { model } : { apiKey, model }),
        },
      );
      const parsed = llmSettingsSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error(
          "Saving OpenRouter settings returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      setApiKey("");
      setEditing(false);
      onSaved(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  if (!editing) {
    return (
      <section className="flex flex-col gap-1" data-testid="llm-status">
        <p className="text-sm text-green-600">
          OpenRouter connected · {settings.model}
        </p>
        <button
          type="button"
          className="self-start rounded border px-3 py-1 text-sm"
          onClick={() => setEditing(true)}
        >
          Change model or key
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">OpenRouter setup</h2>
      <p className="text-sm opacity-70">
        Paste an OpenRouter API key and choose the model that analyses your
        workouts. The key is validated, encrypted at rest, and never shown
        again.
      </p>

      {error && (
        <p className="text-red-500" data-testid="llm-error">
          {error}
        </p>
      )}
      {modelsError && (
        <p className="text-amber-600" data-testid="llm-models-error">
          Could not load the model catalog ({modelsError}). You can still enter
          a model id manually.
        </p>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-2"
        data-testid="llm-settings-form"
      >
        <input
          type="password"
          name="apiKey"
          placeholder={
            settings.configured
              ? "Leave blank to keep the current key"
              : "OpenRouter API key (sk-or-v1-…)"
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="rounded border px-3 py-1"
          autoComplete="off"
        />
        <input
          type="text"
          name="model"
          list="openrouter-models"
          placeholder={
            loadingModels
              ? "Loading models…"
              : "Model id (e.g. openrouter/auto)"
          }
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded border px-3 py-1"
        />
        <datalist id="openrouter-models">
          {models.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </datalist>
        <button
          type="submit"
          className="self-start rounded border px-4 py-2"
          disabled={
            saving || model === "" || (!settings.configured && apiKey === "")
          }
        >
          {saving ? "Validating…" : "Save OpenRouter settings"}
        </button>
      </form>
    </section>
  );
}
