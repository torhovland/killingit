import { llmSettingsSchema, type LlmSettings } from "@killingit/shared";
import { useAuth } from "../auth";
import { DangerIcon } from "../DangerIcon";
import { requestParsed } from "../fetchAuthed";
import { discouragedMessage } from "../llm/catalogFilters";
import { ModelFilters } from "../llm/ModelFilters";
import { ModelTable, type ModelRole } from "../llm/ModelTable";
import { useLlmCatalog } from "../llm/useLlmCatalog";
import { useQueuedSave } from "../llm/useQueuedSave";
import { OpenRouterKeySection } from "./OpenRouterKeySection";
import { browserTimeZone } from "../timeZone";
import { usePropDraft } from "../usePropDraft";

interface LlmSectionProps {
  settings: LlmSettings;
  onSaved: (settings: LlmSettings) => void;
  isAdmin: boolean;
}

interface ModelSelection {
  seasonModel: string;
  dailyModel: string;
}

/** The two stored model choices, falling back to the single legacy model. */
function storedModels(settings: LlmSettings): ModelSelection {
  return {
    seasonModel: settings.seasonModel ?? settings.model ?? "",
    dailyModel: settings.dailyModel ?? settings.model ?? "",
  };
}

/** Whether two selections name the same two models. */
function sameModelSelection(
  left: ModelSelection,
  right: ModelSelection,
): boolean {
  return (
    left.seasonModel === right.seasonModel &&
    left.dailyModel === right.dailyModel
  );
}

/**
 * OpenRouter key entry and the graded model picker. The athlete chooses one
 * model for season/block work and one for day-to-day prompts; once a key is
 * stored, both choices are saved together as soon as a radio button is clicked
 * so a plan cannot mix an old and a new selection. Before the first key save the
 * choices stay local and travel with the key. The catalog, its filters, the
 * table and the save queue live in `llm/`. See
 * `docs/specs/llm-model-catalog.md`.
 */
export function LlmSection({ settings, onSaved, isAdmin }: LlmSectionProps) {
  const auth = useAuth();
  const models = usePropDraft(storedModels(settings), sameModelSelection);
  const { seasonModel, dailyModel } = models.value;
  const catalog = useLlmCatalog(seasonModel, dailyModel, auth.isAuthenticated);
  const save = useQueuedSave(
    (selection: ModelSelection) =>
      requestParsed(
        "/api/llm/settings",
        auth,
        llmSettingsSchema,
        "Saving model choices",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(selection),
        },
      ),
    onSaved,
  );
  const timeZone = browserTimeZone();

  function chooseModel(role: ModelRole, modelId: string): void {
    const next: ModelSelection = {
      seasonModel: role === "season" ? modelId : seasonModel,
      dailyModel: role === "daily" ? modelId : dailyModel,
    };
    models.update(next);
    if (!settings.configured) return;
    if (next.seasonModel === "" || next.dailyModel === "") return;
    save.enqueue(next);
  }

  if (!auth.isAuthenticated) return null;

  return (
    <section className="flex flex-col gap-4" data-testid="llm-settings-form">
      <OpenRouterKeySection
        configured={settings.configured}
        seasonModel={seasonModel}
        dailyModel={dailyModel}
        onSaved={onSaved}
      />

      <p className="text-base text-muted-foreground">
        Choose a <strong>season planning</strong> model for season plans, season
        refreshes and block planning. Choose a <strong>day-to-day</strong> model
        for the weekly and daily plan, coach questions, workout analysis, metric
        reading, replies and every other routine prompt. The season model
        usually benefits from stronger reasoning; the day-to-day model is used
        far more often.
      </p>

      {save.error && <p className="text-destructive">{save.error}</p>}
      {catalog.selectedProblem && (
        <p className="rounded bg-accent/15 p-2 text-base text-destructive">
          {catalog.selectedProblem}. Choose another model before running the
          coach.
        </p>
      )}
      {catalog.error && (
        <p className="rounded bg-accent/15 p-2 text-base">
          Could not load the model catalog: {catalog.error}
        </p>
      )}

      <ModelFilters
        filters={catalog.filters}
        onChange={catalog.updateFilters}
      />

      <ModelTable
        models={catalog.visibleModels}
        loading={catalog.loading}
        seasonModel={seasonModel}
        dailyModel={dailyModel}
        sortKey={catalog.sortKey}
        sortDirection={catalog.sortDirection}
        onSort={catalog.toggleSort}
        onChoose={chooseModel}
        isAdmin={isAdmin}
        timeZone={timeZone}
      />

      {catalog.selectedDiscouraged.map((model) => (
        <p
          key={model.id}
          className="flex items-start gap-2 rounded bg-accent/15 p-2 text-base text-destructive"
        >
          <DangerIcon className="mt-0.5" />
          <span>{discouragedMessage(model.name)}</span>
        </p>
      ))}

      {save.saving && (
        <p className="text-base text-muted-foreground">Saving model choices…</p>
      )}
    </section>
  );
}
