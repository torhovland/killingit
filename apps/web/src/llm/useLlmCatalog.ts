import { useMemo, useState } from "react";
import {
  llmCatalogResponseSchema,
  type LlmCatalogModel,
} from "@killingit/shared";
import { useApiResource } from "../useApiResource";
import {
  compareModels,
  modelMatchesFilters,
  type LlmModelFilters,
  type SortDirection,
  type SortKey,
} from "./catalogFilters";

/** The documented default filters: no search, ungraded included, discouraged hidden. */
const DEFAULT_FILTERS: LlmModelFilters = {
  includeUngraded: true,
  showDiscouraged: false,
  minAbility: "B",
  minSpeed: "D",
  minCost: "D",
  nameQuery: "",
};

/** Sorting starts on ability, strongest first. */
const DEFAULT_SORT: { key: SortKey; direction: SortDirection } = {
  key: "ability",
  direction: "desc",
};

export interface LlmCatalogState {
  loading: boolean;
  error: string | null;
  /** The models the table shows: filtered, sorted, and never hiding a choice. */
  visibleModels: LlmCatalogModel[];
  filters: LlmModelFilters;
  /** Applies the filter fields the athlete changed. */
  updateFilters: (patch: Partial<LlmModelFilters>) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  /** Sorts by a column, reversing the current column on a second click. */
  toggleSort: (key: SortKey) => void;
  /** Why a selected model cannot run the coach, or null when both can. */
  selectedProblem: string | null;
  /** The selected models the catalog discourages. */
  selectedDiscouraged: LlmCatalogModel[];
}

/**
 * Loads the graded model catalog and owns the table's filter and sort state.
 * The athlete's current selections stay visible even when they are retired or
 * filtered out, so a choice that must be replaced can always be found. See
 * `docs/specs/llm-model-catalog.md`.
 */
export function useLlmCatalog(
  seasonModel: string,
  dailyModel: string,
  enabled: boolean,
): LlmCatalogState {
  const resource = useApiResource(
    enabled ? "/api/llm/catalog" : null,
    llmCatalogResponseSchema,
    "Loading the model catalog",
  );
  const catalog = resource.data?.models ?? null;
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);

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
          selectedIds.has(model.id) || modelMatchesFilters(model, filters),
      )
      .sort((a, b) => compareModels(a, b, sort.key, sort.direction));
  }, [catalog, filters, selectedIds, sort]);

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

  function updateFilters(patch: Partial<LlmModelFilters>): void {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function toggleSort(key: SortKey): void {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: key === "model" ? "asc" : "desc" },
    );
  }

  return {
    loading: resource.loading,
    error: resource.error,
    visibleModels,
    filters,
    updateFilters,
    sortKey: sort.key,
    sortDirection: sort.direction,
    toggleSort,
    selectedProblem,
    selectedDiscouraged,
  };
}
