import type { FoodEntry } from "@killingit/shared";
import { FoodPhoto } from "./FoodPhoto";
import { FormattedText } from "./FormattedText";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";

/** One logged meal with the coach's reading of it. */
export function FoodEntryCard({
  entry,
  compact = false,
  onEdit,
}: {
  entry: FoodEntry;
  /** Tighter spacing for the dashboard's inline confirmation. */
  compact?: boolean;
  /** Opens the edit form. Omitted where the meal is read-only. */
  onEdit?: (() => void) | undefined;
}) {
  const timeZone = useTimeZone();
  const analysis = entry.analysis;

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-card p-4 text-left ${
        compact ? "" : "sm:flex-row"
      }`}
      data-testid="food-entry"
    >
      {entry.hasPhoto && (
        <FoodPhoto
          entryId={entry.id}
          version={entry.updatedAt}
          alt="Photo of the meal"
          className="h-24 w-24 shrink-0 rounded object-cover"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">Meal</h3>
          <div className="flex flex-wrap items-center gap-2">
            <time className="text-sm text-muted-foreground">
              {formatDateTime(entry.eatenAt, timeZone)}
            </time>
            {onEdit && (
              <button
                type="button"
                className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
                onClick={onEdit}
              >
                Edit
              </button>
            )}
          </div>
        </div>
        {entry.description !== null && entry.description.trim() !== "" ? (
          <p className="text-base">{entry.description}</p>
        ) : (
          <p className="text-base text-muted-foreground">
            Logged from a photo.
          </p>
        )}

        {analysis !== null ? (
          <>
            <FormattedText text={analysis.meal} />
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Macro
                label="Carbs"
                value={`${Math.round(analysis.carbsGrams)} g`}
              />
              <Macro
                label="Protein"
                value={`${Math.round(analysis.proteinGrams)} g`}
              />
              <Macro label="Fat" value={`${Math.round(analysis.fatGrams)} g`} />
              <Macro
                label="Energy"
                value={`${Math.round(analysis.caloriesKcal)} kcal`}
              />
            </dl>
            <div
              className="flex flex-col gap-1 rounded border bg-inset p-2 text-base"
              data-testid="food-diet-fit"
            >
              <span className="font-medium">Coach:</span>
              <FormattedText text={analysis.dietFit} />
            </div>
          </>
        ) : (
          <p className="text-base text-muted-foreground">
            The coach could not analyse this meal
            {entry.analysisError !== null ? `: ${entry.analysisError}` : "."}
          </p>
        )}
      </div>
    </article>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
