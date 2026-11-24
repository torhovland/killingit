import type { LlmModelGrade } from "@killingit/shared";
import { llmModelGradeSchema } from "@killingit/shared";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import type { LlmModelFilters } from "./catalogFilters";

/**
 * The grades a filter can require, best first. The ungraded `?` is not a
 * minimum, so it is not offered: the include-ungraded checkbox decides whether
 * an ungraded model passes.
 */
const LLM_GRADES = [
  "A+",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
] as const satisfies readonly LlmModelGrade[];

/** Whether a select's value names a grade the catalog can store. */
function isLlmModelGrade(value: string): value is LlmModelGrade {
  return llmModelGradeSchema.safeParse(value).success;
}

interface GradeSelectProps {
  label: string;
  value: LlmModelGrade;
  onChange: (grade: LlmModelGrade) => void;
}

/** One grade minimum, shared by the ability, speed and cost filters. */
function GradeSelect({ label, value, onChange }: GradeSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <Select
        value={value}
        onChange={(e) => {
          const grade = e.target.value;
          if (isLlmModelGrade(grade)) onChange(grade);
        }}
      >
        {LLM_GRADES.map((grade) => (
          <option key={grade} value={grade}>
            {grade}
          </option>
        ))}
      </Select>
    </label>
  );
}

export interface ModelFiltersProps {
  filters: LlmModelFilters;
  /** Applies the fields the athlete changed, leaving the rest as they are. */
  onChange: (patch: Partial<LlmModelFilters>) => void;
}

/** The filter bar above the model table. */
export function ModelFilters({ filters, onChange }: ModelFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex min-w-64 flex-1 flex-col gap-1">
        <span className="font-medium">Search models</span>
        <Input
          type="search"
          size="sm"
          placeholder="Part of a model name"
          value={filters.nameQuery}
          onChange={(e) => onChange({ nameQuery: e.target.value })}
        />
      </label>
      <GradeSelect
        label="Ability at least"
        value={filters.minAbility}
        onChange={(minAbility) => onChange({ minAbility })}
      />
      <GradeSelect
        label="Speed at least"
        value={filters.minSpeed}
        onChange={(minSpeed) => onChange({ minSpeed })}
      />
      <GradeSelect
        label="Cost at least"
        value={filters.minCost}
        onChange={(minCost) => onChange({ minCost })}
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.includeUngraded}
          onChange={(e) => onChange({ includeUngraded: e.target.checked })}
        />
        Include ungraded
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.showDiscouraged}
          onChange={(e) => onChange({ showDiscouraged: e.target.checked })}
        />
        Include discouraged
      </label>
    </div>
  );
}
