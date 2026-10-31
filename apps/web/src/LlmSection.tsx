import { useEffect, useMemo, useState } from "react";
import {
  llmCatalogResponseSchema,
  llmSettingsSchema,
  type LlmCatalogModel,
  type LlmModelGrade,
  type LlmSettings,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const GRADE_ORDER: Record<LlmModelGrade, number> = {
  "A+": 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  F: 0,
  "?": -1,
};

type SortKey = "model" | "discouraged" | "ability" | "speed" | "cost";

interface LlmSectionProps {
  settings: LlmSettings;
  onSaved: (settings: LlmSettings) => void;
}

function gradeAtLeast(grade: LlmModelGrade, minimum: LlmModelGrade): boolean {
  return grade !== "?" && GRADE_ORDER[grade] >= GRADE_ORDER[minimum];
}

function compareGrades(a: LlmModelGrade, b: LlmModelGrade): number {
  return GRADE_ORDER[a] - GRADE_ORDER[b];
}

function compareModels(
  a: LlmCatalogModel,
  b: LlmCatalogModel,
  key: SortKey,
  direction: "asc" | "desc",
): number {
  let result: number;
  if (key === "model") result = a.name.localeCompare(b.name);
  else if (key === "discouraged")
    result = Number(a.discouraged) - Number(b.discouraged);
  else result = compareGrades(a[key], b[key]);
  if (result === 0) {
    result =
      compareGrades(a.ability, b.ability) ||
      compareGrades(a.speed, b.speed) ||
      compareGrades(a.cost, b.cost) ||
      a.name.localeCompare(b.name);
  }
  return direction === "asc" ? result : -result;
}

/**
 * OpenRouter key entry and the graded model picker. The athlete chooses one
 * model for season/block work and one for day-to-day prompts; both choices are
 * saved together so a plan cannot mix an old and a new selection.
 */
export function LlmSection({ settings, onSaved }: LlmSectionProps) {
  const auth = useAuth();
  const [catalog, setCatalog] = useState<LlmCatalogModel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [seasonModel, setSeasonModel] = useState(
    settings.seasonModel ?? settings.model ?? "",
  );
  const [dailyModel, setDailyModel] = useState(
    settings.dailyModel ?? settings.model ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscouraged, setShowDiscouraged] = useState(false);
  const [minAbility, setMinAbility] = useState<LlmModelGrade>("B");
  const [minSpeed, setMinSpeed] = useState<LlmModelGrade>("D");
  const [minCost, setMinCost] = useState<LlmModelGrade>("E");
  const [sortKey, setSortKey] = useState<SortKey>("ability");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    fetchJsonAuthed<unknown>(`${API_URL}/api/llm/catalog`, auth)
      .then((response) => {
        const parsed = llmCatalogResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error("The model catalog returned an unexpected response", {
            cause: parsed.error,
          });
        }
        if (!cancelled) {
          setCatalog(parsed.data.models);
          setCatalogError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setCatalogError(reportError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated]);

  // Keep a currently selected model visible even when it is retired.
  const selectedIds = useMemo(
    () => new Set([seasonModel, dailyModel].filter((id) => id !== "")),
    [seasonModel, dailyModel],
  );

  const visibleModels = useMemo(() => {
    if (catalog === null) return [];
    return catalog
      .filter((model) => !model.retired || selectedIds.has(model.id))
      .filter(
        (model) =>
          selectedIds.has(model.id) ||
          ((showDiscouraged || !model.discouraged) &&
            gradeAtLeast(model.ability, minAbility) &&
            gradeAtLeast(model.speed, minSpeed) &&
            gradeAtLeast(model.cost, minCost)),
      )
      .sort((a, b) => compareModels(a, b, sortKey, sortDirection));
  }, [
    catalog,
    minAbility,
    minCost,
    minSpeed,
    selectedIds,
    showDiscouraged,
    sortDirection,
    sortKey,
  ]);

  const selectedProblem = useMemo(() => {
    if (catalog === null) return null;
    const selected = catalog.filter(
      (model) => model.id === seasonModel || model.id === dailyModel,
    );
    const retired = selected.find((model) => model.retired);
    if (retired) return `${retired.name} is retired`;
    const discouraged = selected.find((model) => model.discouraged);
    if (discouraged) return `${discouraged.name} is discouraged`;
    return null;
  }, [catalog, dailyModel, seasonModel]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "model" ? "asc" : "desc");
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/llm/settings`,
        auth,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            seasonModel,
            dailyModel,
            ...(apiKey === "" ? {} : { apiKey }),
          }),
        },
      );
      const parsed = llmSettingsSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Saving model choices returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      setApiKey("");
      onSaved(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
    }
  }

  function gradeHeader(label: string, key: SortKey): React.ReactNode {
    const marker =
      sortKey === key ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
    return (
      <button
        type="button"
        className="text-left font-semibold"
        onClick={() => toggleSort(key)}
      >
        {label}
        {marker}
      </button>
    );
  }

  if (!auth.isAuthenticated) return null;

  return (
    <section className="flex flex-col gap-4" data-testid="llm-settings-form">
      <p className="text-base text-muted-foreground">
        Choose a <strong>season planning</strong> model for season plans, season
        refreshes and block planning. Choose a <strong>day-to-day</strong> model
        for the weekly and daily plan, coach questions, workout analysis, metric
        reading, replies and every other routine prompt. The season model
        usually benefits from stronger reasoning; the day-to-day model is used
        far more often.
      </p>

      <label className="flex max-w-md flex-col gap-1 text-base">
        <span className="font-medium">OpenRouter API key</span>
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
          className="rounded border bg-card px-3 py-1"
          autoComplete="off"
        />
      </label>

      {error && <p className="text-destructive">{error}</p>}
      {selectedProblem && (
        <p className="rounded bg-accent/15 p-2 text-base text-destructive">
          {selectedProblem}. Choose another model before running the coach.
        </p>
      )}
      {catalogError && (
        <p className="rounded bg-accent/15 p-2 text-base">
          Could not load the model catalog: {catalogError}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showDiscouraged}
            onChange={(e) => setShowDiscouraged(e.target.checked)}
          />
          Include discouraged
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Ability at least</span>
          <select
            className="rounded border bg-card px-2 py-1"
            value={minAbility}
            onChange={(e) => setMinAbility(e.target.value as LlmModelGrade)}
          >
            {["A+", "A", "B", "C", "D", "E", "F"].map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Speed at least</span>
          <select
            className="rounded border bg-card px-2 py-1"
            value={minSpeed}
            onChange={(e) => setMinSpeed(e.target.value as LlmModelGrade)}
          >
            {["A+", "A", "B", "C", "D", "E", "F"].map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Cost at least</span>
          <select
            className="rounded border bg-card px-2 py-1"
            value={minCost}
            onChange={(e) => setMinCost(e.target.value as LlmModelGrade)}
          >
            {["A+", "A", "B", "C", "D", "E", "F"].map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-base text-muted-foreground">Loading models…</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b">
                <th className="p-2">{gradeHeader("Model", "model")}</th>
                <th className="p-2">
                  {gradeHeader("Discouraged", "discouraged")}
                </th>
                <th className="p-2">{gradeHeader("Ability", "ability")}</th>
                <th className="p-2">{gradeHeader("Speed", "speed")}</th>
                <th className="p-2">{gradeHeader("Cost", "cost")}</th>
                <th className="p-2">Season</th>
                <th className="p-2">Day to day</th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((model) => (
                <tr key={model.id} className="border-b last:border-b-0">
                  <td className="p-2">
                    <div className="font-medium">
                      {model.name}
                      {model.retired ? " (retired)" : ""}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {model.id}
                    </div>
                  </td>
                  <td className="p-2">{model.discouraged ? "Yes" : "No"}</td>
                  <td className="p-2">{model.ability}</td>
                  <td className="p-2">{model.speed}</td>
                  <td className="p-2">{model.cost}</td>
                  <td className="p-2">
                    <input
                      type="radio"
                      name="seasonModel"
                      checked={seasonModel === model.id}
                      onChange={() => setSeasonModel(model.id)}
                      aria-label={`Use ${model.name} for season planning`}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="radio"
                      name="dailyModel"
                      checked={dailyModel === model.id}
                      onChange={() => setDailyModel(model.id)}
                      aria-label={`Use ${model.name} for day-to-day prompts`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleModels.length === 0 && (
            <p className="p-3 text-muted-foreground">
              No models match these filters.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void save()}
        className="self-start rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
        disabled={
          saving ||
          seasonModel === "" ||
          dailyModel === "" ||
          (!settings.configured && apiKey === "")
        }
      >
        {saving ? "Saving…" : "Save model choices"}
      </button>
    </section>
  );
}
