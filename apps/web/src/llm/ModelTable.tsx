import type { LlmCatalogModel } from "@killingit/shared";
import { formatDateTime } from "../timeZone";
import type { SortDirection, SortKey } from "./catalogFilters";

/** The two model roles the athlete picks one model for. */
export type ModelRole = "season" | "daily";

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}

/** A column heading that sorts the table when clicked. */
function SortHeader({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
}: SortHeaderProps) {
  const sorted = currentKey === sortKey;
  return (
    <th
      className="p-2"
      aria-sort={
        sorted ? (direction === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        className="text-left font-semibold"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {sorted && (
          <span aria-hidden="true">{direction === "asc" ? " ▲" : " ▼"}</span>
        )}
      </button>
    </th>
  );
}

export interface ModelTableProps {
  /** The models to show, already filtered and sorted. */
  models: readonly LlmCatalogModel[];
  /** True while the catalog is loading, which replaces the table. */
  loading: boolean;
  seasonModel: string;
  dailyModel: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onChoose: (role: ModelRole, modelId: string) => void;
  isAdmin: boolean;
  timeZone: string;
}

/** The sortable model table with one selection radio per role. */
export function ModelTable({
  models,
  loading,
  seasonModel,
  dailyModel,
  sortKey,
  sortDirection,
  onSort,
  onChoose,
  isAdmin,
  timeZone,
}: ModelTableProps) {
  const header = (label: string, key: SortKey) => (
    <SortHeader
      label={label}
      sortKey={key}
      currentKey={sortKey}
      direction={sortDirection}
      onSort={onSort}
    />
  );

  if (loading) {
    return <p className="text-base text-muted-foreground">Loading models…</p>;
  }

  return (
    <div className="max-h-[32rem] overflow-auto rounded border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b">
            {header("Model", "model")}
            {header("Ability", "ability")}
            {header("Speed", "speed")}
            {header("Cost", "cost")}
            {isAdmin && header("Last scored", "benchmarkedAt")}
            {header("Discouraged", "discouraged")}
            <th className="p-2">Season plan</th>
            <th className="p-2">Day to day</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
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
                  onChange={() => onChoose("season", model.id)}
                  aria-label={`Use ${model.name} for season planning`}
                />
              </td>
              <td className="p-2">
                <input
                  type="radio"
                  name="dailyModel"
                  checked={dailyModel === model.id}
                  onChange={() => onChoose("daily", model.id)}
                  aria-label={`Use ${model.name} for day-to-day prompts`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {models.length === 0 && (
        <p className="p-3 text-muted-foreground">
          No models match these filters.
        </p>
      )}
    </div>
  );
}
