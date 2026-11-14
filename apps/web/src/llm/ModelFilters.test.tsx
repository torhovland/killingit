import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmModelFilters } from "./catalogFilters";
import { isLlmModelGrade, LLM_GRADES, ModelFilters } from "./ModelFilters";

function filters(overrides: Partial<LlmModelFilters> = {}): LlmModelFilters {
  return {
    includeUngraded: true,
    showDiscouraged: false,
    minAbility: "B",
    minSpeed: "D",
    minCost: "D",
    ...overrides,
  };
}

/** Renders the filter bar and records every patch it reports. */
function renderFilters(
  value: LlmModelFilters = filters(),
): Array<Partial<LlmModelFilters>> {
  const changes: Array<Partial<LlmModelFilters>> = [];
  render(
    <ModelFilters filters={value} onChange={(patch) => changes.push(patch)} />,
  );
  return changes;
}

describe("LLM_GRADES", () => {
  it("lists the filterable grades best first, leaving the ungraded mark out", () => {
    expect(LLM_GRADES).toEqual(["A+", "A", "B", "C", "D", "E", "F"]);
  });
});

describe("isLlmModelGrade", () => {
  it("accepts every grade the catalog can store, including the ungraded mark", () => {
    for (const grade of [...LLM_GRADES, "?"]) {
      expect(isLlmModelGrade(grade)).toBe(true);
    }
  });

  it("rejects a value that is not a grade", () => {
    expect(isLlmModelGrade("Z")).toBe(false);
    expect(isLlmModelGrade("")).toBe(false);
    expect(isLlmModelGrade("b")).toBe(false);
  });
});

describe("ModelFilters", () => {
  it("reports the grade a dropdown picks for its own measure", async () => {
    const user = userEvent.setup();
    const changes = renderFilters();

    expect(screen.getByLabelText("Ability at least")).toHaveProperty(
      "value",
      "B",
    );
    expect(screen.getByLabelText("Speed at least")).toHaveProperty(
      "value",
      "D",
    );
    expect(screen.getByLabelText("Cost at least")).toHaveProperty("value", "D");

    await user.selectOptions(screen.getByLabelText("Ability at least"), "C");
    expect(changes.at(-1)).toEqual({ minAbility: "C" });

    await user.selectOptions(screen.getByLabelText("Speed at least"), "A+");
    expect(changes.at(-1)).toEqual({ minSpeed: "A+" });

    await user.selectOptions(screen.getByLabelText("Cost at least"), "F");
    expect(changes.at(-1)).toEqual({ minCost: "F" });
  });

  it("ignores a select value that is not a catalog grade", () => {
    const changes = renderFilters();

    fireEvent.change(screen.getByLabelText("Ability at least"), {
      target: { value: "Z" },
    });

    expect(changes).toEqual([]);
  });

  it("reports both inclusion checkboxes", async () => {
    const user = userEvent.setup();
    const changes = renderFilters(filters({ includeUngraded: false }));

    const ungraded = screen.getByLabelText("Include ungraded");
    expect(ungraded).toHaveProperty("checked", false);
    await user.click(ungraded);
    expect(changes.at(-1)).toEqual({ includeUngraded: true });

    await user.click(screen.getByLabelText("Include discouraged"));
    expect(changes.at(-1)).toEqual({ showDiscouraged: true });
  });
});
