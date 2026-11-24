import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmModelFilters } from "./catalogFilters";
import { ModelFilters } from "./ModelFilters";

function filters(overrides: Partial<LlmModelFilters> = {}): LlmModelFilters {
  return {
    includeUngraded: true,
    showDiscouraged: false,
    minAbility: "B",
    minSpeed: "D",
    minCost: "D",
    nameQuery: "",
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

describe("grade filters", () => {
  it("offers every filterable grade best first and leaves the ungraded mark out", () => {
    renderFilters();

    const options = within(
      screen.getByLabelText("Ability at least"),
    ).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "A+",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });

  it("reports every grade the catalog can store", async () => {
    const user = userEvent.setup();
    const changes = renderFilters();
    const ability = screen.getByLabelText("Ability at least");

    const grades = ["A+", "A", "B", "C", "D", "E", "F"] as const;

    for (const grade of grades) {
      await user.selectOptions(ability, grade);
      expect(changes.at(-1)).toEqual({ minAbility: grade });
    }
  });

  it("ignores a select value that is not a catalog grade", () => {
    const changes = renderFilters();
    const ability = screen.getByLabelText("Ability at least");

    for (const value of ["Z", "", "b"]) {
      fireEvent.change(ability, { target: { value } });
    }

    expect(changes).toEqual([]);
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

describe("model search", () => {
  it("shows the current search text", () => {
    renderFilters(filters({ nameQuery: "claude" }));

    expect(screen.getByLabelText("Search models")).toHaveProperty(
      "value",
      "claude",
    );
  });

  it("reports every character typed as the search text", async () => {
    const user = userEvent.setup();
    const changes = renderFilters();

    await user.type(screen.getByLabelText("Search models"), "g");

    expect(changes.at(-1)).toEqual({ nameQuery: "g" });
  });
});
