import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmCatalogModel } from "@killingit/shared";
import { ModelTable, type ModelRole } from "./ModelTable";

function model(overrides: Partial<LlmCatalogModel> = {}): LlmCatalogModel {
  return {
    id: "test/model",
    name: "Test Model",
    retired: false,
    discouraged: false,
    ability: "A",
    speed: "A",
    cost: "A",
    benchmarkScore: 11,
    benchmarkTimeMs: 10_000,
    benchmarkCostUsd: 0.01,
    benchmarkedAt: "2026-10-31T15:40:52.865Z",
    ...overrides,
  };
}

const ALPHA = model({ id: "provider/alpha", name: "Alpha" });
const RETIRED = model({
  id: "provider/retired",
  name: "Old Timer",
  retired: true,
  discouraged: true,
});

const noop = (): void => undefined;

function table(
  overrides: Partial<Parameters<typeof ModelTable>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <ModelTable
      models={[ALPHA, RETIRED]}
      loading={false}
      seasonModel={ALPHA.id}
      dailyModel=""
      sortKey="ability"
      sortDirection="desc"
      onSort={noop}
      onChoose={noop}
      isAdmin={false}
      timeZone="UTC"
      {...overrides}
    />,
  );
}

describe("ModelTable", () => {
  it("shows the stored choice as the checked radio in each role", () => {
    table();

    expect(
      screen.getByRole("radio", {
        name: `Use ${ALPHA.name} for season planning`,
      }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("radio", {
        name: `Use ${ALPHA.name} for day-to-day prompts`,
      }),
    ).toHaveProperty("checked", false);
  });

  it("reports the model and role a radio picks", async () => {
    const user = userEvent.setup();
    const choices: Array<[ModelRole, string]> = [];
    table({ onChoose: (role, id) => choices.push([role, id]) });

    await user.click(
      screen.getByRole("radio", {
        name: `Use ${RETIRED.name} for day-to-day prompts`,
      }),
    );

    expect(choices).toEqual([["daily", RETIRED.id]]);
  });

  it("marks a retired model by name", () => {
    table();

    expect(screen.getByText("Old Timer (retired)")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("reports the column a header button sorts", async () => {
    const user = userEvent.setup();
    const sorts: string[] = [];
    table({ onSort: (key) => sorts.push(key) });

    await user.click(screen.getByRole("button", { name: "Cost" }));

    expect(sorts).toEqual(["cost"]);
  });

  it("marks the sorted column and its direction", () => {
    table({ sortKey: "speed", sortDirection: "asc" });

    expect(screen.getByRole("button", { name: "Speed ▲" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ability" })).toBeTruthy();
  });

  it("keeps the last-scored column for the admin only", () => {
    const { unmount } = table({
      models: [model({ benchmarkedAt: null })],
      isAdmin: true,
    });
    expect(
      screen.getByRole("columnheader", { name: "Last scored" }),
    ).toBeTruthy();
    // An unscored model shows a dash rather than a date.
    expect(screen.getByText("—")).toBeTruthy();
    unmount();

    table();
    expect(screen.queryByRole("columnheader", { name: "Last scored" })).toBe(
      null,
    );
  });

  it("says when no model matches the filters", () => {
    table({ models: [] });

    expect(screen.getByText("No models match these filters.")).toBeTruthy();
  });

  it("says when the catalog is still loading", () => {
    table({ models: [], loading: true });

    expect(screen.getByText("Loading models…")).toBeTruthy();
    expect(screen.queryByRole("table")).toBe(null);
  });

  it("keeps a model's two radios in the same row", () => {
    const { container } = table();

    const rows = within(container).getAllByRole("row");
    const alphaRow = rows.find((row) => within(row).queryByText("Alpha"));
    if (alphaRow === undefined) throw new Error("Alpha has no row");
    expect(within(alphaRow).getAllByRole("radio")).toHaveLength(2);
  });
});
