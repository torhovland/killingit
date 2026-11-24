import type { LlmCatalogModel, LlmModelGrade } from "@killingit/shared";

/** A catalog grade's rank; an ungraded `?` ranks below every real grade. */
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

/** A model-table column the athlete can sort by. */
export type SortKey =
  "model" | "benchmarkedAt" | "discouraged" | "ability" | "speed" | "cost";

/** The direction a sort column is applied in. */
export type SortDirection = "asc" | "desc";

/** The grade minimums, inclusions and name search the model table is filtered by. */
export interface LlmModelFilters {
  includeUngraded: boolean;
  showDiscouraged: boolean;
  minAbility: LlmModelGrade;
  minSpeed: LlmModelGrade;
  minCost: LlmModelGrade;
  /** Part of a model name, matched case-insensitively; empty keeps every name. */
  nameQuery: string;
}

function gradeAtLeast(grade: LlmModelGrade, minimum: LlmModelGrade): boolean {
  return grade !== "?" && GRADE_ORDER[grade] >= GRADE_ORDER[minimum];
}

function gradePasses(
  grade: LlmModelGrade,
  minimum: LlmModelGrade,
  includeUngraded: boolean,
): boolean {
  return grade === "?" ? includeUngraded : gradeAtLeast(grade, minimum);
}

/**
 * Whether a model's name contains the athlete's search text, ignoring case and
 * surrounding whitespace. An empty search matches every name.
 */
function nameMatchesQuery(name: string, query: string): boolean {
  const search = query.trim().toLowerCase();
  return search === "" || name.toLowerCase().includes(search);
}

/**
 * Applies the catalog filters. "Include ungraded" only lets a "?" through the
 * grade it belongs to; the other grade filters still apply. The name search is
 * a plain substring match, so any part of a model name narrows the list.
 */
export function modelMatchesFilters(
  model: LlmCatalogModel,
  filters: LlmModelFilters,
): boolean {
  if (!filters.showDiscouraged && model.discouraged) return false;
  if (!nameMatchesQuery(model.name, filters.nameQuery)) return false;
  return (
    gradePasses(model.ability, filters.minAbility, filters.includeUngraded) &&
    gradePasses(model.speed, filters.minSpeed, filters.includeUngraded) &&
    gradePasses(model.cost, filters.minCost, filters.includeUngraded)
  );
}

function compareGrades(a: LlmModelGrade, b: LlmModelGrade): number {
  return GRADE_ORDER[a] - GRADE_ORDER[b];
}

/** The danger notice shown below the table for a discouraged selection. */
export function discouragedMessage(name: string): string {
  return `${name} is discouraged. You should choose another model before running the coach.`;
}

/** Orders two catalog models by one table column and direction. */
export function compareModels(
  a: LlmCatalogModel,
  b: LlmCatalogModel,
  key: SortKey,
  direction: SortDirection,
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
