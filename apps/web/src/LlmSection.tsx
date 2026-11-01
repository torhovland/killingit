import { useEffect, useMemo, useRef, useState } from "react";
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
import { browserTimeZone, formatDateTime } from "./timeZone";

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

type SortKey =
  "model" | "benchmarkedAt" | "discouraged" | "ability" | "speed" | "cost";

interface LlmSectionProps {
  settings: LlmSettings;
  onSaved: (settings: LlmSettings) => void;
  isAdmin: boolean;
}

function gradeAtLeast(grade: LlmModelGrade, minimum: LlmModelGrade): boolean {
  return grade !== "?" && GRADE_ORDER[grade] >= GRADE_ORDER[minimum];
}

export interface LlmModelFilters {
  includeUngraded: boolean;
  showDiscouraged: boolean;
  minAbility: LlmModelGrade;
  minSpeed: LlmModelGrade;
  minCost: LlmModelGrade;
}

function gradePasses(
  grade: LlmModelGrade,
  minimum: LlmModelGrade,
  includeUngraded: boolean,
): boolean {
  return grade === "?" ? includeUngraded : gradeAtLeast(grade, minimum);
}

/**
 * Applies the catalog filters. "Include ungraded" only lets a "?" through the
 * grade it belongs to; the other grade filters still apply.
 */
export function modelMatchesFilters(
  model: LlmCatalogModel,
  filters: LlmModelFilters,
): boolean {
  if (!filters.showDiscouraged && model.discouraged) return false;
  return (
    gradePasses(model.ability, filters.minAbility, filters.includeUngraded) &&
    gradePasses(model.speed, filters.minSpeed, filters.includeUngraded) &&
    gradePasses(model.cost, filters.minCost, filters.includeUngraded)
  );
}

function compareGrades(a: LlmModelGrade, b: LlmModelGrade): number {
  return GRADE_ORDER[a] - GRADE_ORDER[b];
}

export function discouragedMessage(name: string): string {
  return `${name} is discouraged. You should choose another model before running the coach.`;
}

function DangerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M10 3 2.5 16.5h15L10 3Z" strokeLinejoin="round" />
      <path d="M10 7.5v4" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function compareModels(
  a: LlmCatalogModel,
  b: LlmCatalogModel,
  key: SortKey,
  direction: "asc" | "desc",
): number {
  if (key === "model") {
    const result = a.name.localeCompare(b.name);
    return direction === "asc" ? result : -result;
  }
  if (key === "benchmarkedAt") {
    const aTime = a.benchmarkedAt === null ? null : Date.parse(a.benchmarkedAt);
    const bTime = b.benchmarkedAt === null ? null : Date.parse(b.benchmarkedAt);
    // Unscored models stay last in either direction.
    if (aTime === null && bTime === null) return a.name.localeCompare(b.name);
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    const result = direction === "asc" ? aTime - bTime : bTime - aTime;
    return result !== 0 ? result : a.name.localeCompare(b.name);
  }
  const primary =
    key === "discouraged"
      ? Number(a.discouraged) - Number(b.discouraged)
      : compareGrades(a[key], b[key]);
  if (primary !== 0) return direction === "asc" ? primary : -primary;
  // Ties always resolve by model name ascending, whatever the column order.
  return a.name.localeCompare(b.name);
}

/**
 * OpenRouter key entry and the graded model picker. The athlete chooses one
 * model for season/block work and one for day-to-day prompts; both choices are
 * saved together as soon as a radio button is clicked so a plan cannot mix an
 * old and a new selection. The key is saved when the input loses focus.
 */
export function LlmSection({ settings, onSaved, isAdmin }: LlmSectionProps) {
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveSequence = useRef(0);
  const [includeUngraded, setIncludeUngraded] = useState(true);
  const [showDiscouraged, setShowDiscouraged] = useState(false);
  const [minAbility, setMinAbility] = useState<LlmModelGrade>("B");
  const [minSpeed, setMinSpeed] = useState<LlmModelGrade>("D");
  const [minCost, setMinCost] = useState<LlmModelGrade>("D");
  const [sortKey, setSortKey] = useState<SortKey>("ability");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const timeZone = browserTimeZone();

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
          modelMatchesFilters(model, {
            includeUngraded,
            showDiscouraged,
            minAbility,
            minSpeed,
            minCost,
          }),
      )
      .sort((a, b) => compareModels(a, b, sortKey, sortDirection));
  }, [
    catalog,
    includeUngraded,
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
    return null;
  }, [catalog, dailyModel, seasonModel]);

  const selectedDiscouraged = useMemo(() => {
    if (catalog === null) return [];
    return catalog.filter(
      (model) => selectedIds.has(model.id) && model.discouraged,
    );
  }, [catalog, selectedIds]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "model" ? "asc" : "desc");
  }

  /**
   * Persists the two model choices, optionally together with a new API key.
   * Saves are queued so rapid radio clicks reach the server in click order, and
   * only the newest attempt reports its result.
   */
  function persist(payload: {
    seasonModel: string;
    dailyModel: string;
    apiKey?: string;
  }): void {
    const sequence = ++saveSequence.current;
    setSaving(true);
    setError(null);
    saveQueue.current = saveQueue.current
      .then(async () => {
        try {
          const response = await fetchJsonAuthed<unknown>(
            `${API_URL}/api/llm/settings`,
            auth,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
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
          if (sequence === saveSequence.current) {
            if (payload.apiKey !== undefined) setApiKey("");
            onSaved(parsed.data);
          }
        } catch (err: unknown) {
          if (sequence === saveSequence.current) setError(reportError(err));
        } finally {
          if (sequence === saveSequence.current) setSaving(false);
        }
      })
      .catch(() => {
        // The queued save above handles its own errors; keep the chain alive.
      });
  }

  function chooseModel(role: "season" | "daily", modelId: string): void {
    const nextSeason = role === "season" ? modelId : seasonModel;
    const nextDaily = role === "daily" ? modelId : dailyModel;
    if (role === "season") setSeasonModel(modelId);
    else setDailyModel(modelId);
    if (nextSeason === "" || nextDaily === "") return;
    persist({
      seasonModel: nextSeason,
      dailyModel: nextDaily,
      // A key typed before the first save travels with the first model choice.
      ...(!settings.configured && apiKey !== "" ? { apiKey } : {}),
    });
  }

  function saveKey(): void {
    if (apiKey === "" || seasonModel === "" || dailyModel === "") return;
    persist({ seasonModel, dailyModel, apiKey });
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
          onBlur={saveKey}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUngraded}
            onChange={(e) => setIncludeUngraded(e.target.checked)}
          />
          Include ungraded
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showDiscouraged}
            onChange={(e) => setShowDiscouraged(e.target.checked)}
          />
          Include discouraged
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
                <th className="p-2">{gradeHeader("Ability", "ability")}</th>
                <th className="p-2">{gradeHeader("Speed", "speed")}</th>
                <th className="p-2">{gradeHeader("Cost", "cost")}</th>
                {isAdmin && (
                  <th className="p-2">
                    {gradeHeader("Last scored", "benchmarkedAt")}
                  </th>
                )}
                <th className="p-2">
                  {gradeHeader("Discouraged", "discouraged")}
                </th>
                <th className="p-2">Season plan</th>
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
                  <td className="p-2">{model.ability}</td>
                  <td className="p-2">{model.speed}</td>
                  <td className="p-2">{model.cost}</td>
                  {isAdmin && (
                    <td className="whitespace-nowrap p-2">
                      {model.benchmarkedAt === null
                        ? "—"
                        : formatDateTime(model.benchmarkedAt, timeZone)}
                    </td>
                  )}
                  <td className="p-2">{model.discouraged ? "Yes" : "No"}</td>
                  <td className="p-2">
                    <input
                      type="radio"
                      name="seasonModel"
                      checked={seasonModel === model.id}
                      onChange={() => chooseModel("season", model.id)}
                      aria-label={`Use ${model.name} for season planning`}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="radio"
                      name="dailyModel"
                      checked={dailyModel === model.id}
                      onChange={() => chooseModel("daily", model.id)}
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

      {selectedDiscouraged.map((model) => (
        <p
          key={model.id}
          className="flex items-start gap-2 rounded bg-accent/15 p-2 text-base text-destructive"
        >
          <DangerIcon />
          <span>{discouragedMessage(model.name)}</span>
        </p>
      ))}

      {saving && (
        <p className="text-base text-muted-foreground">Saving model choices…</p>
      )}
    </section>
  );
}
