import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { TimeZoneSection } from "./TimeZoneSection";

const options = ["Europe/Oslo", "America/New_York", "Europe/Berlin", "UTC"];

function renderSection({
  selected = "Europe/Oslo",
  saving = false,
  error = null,
}: {
  selected?: string;
  saving?: boolean;
  error?: string | null;
} = {}) {
  render(
    <TimeZoneSection
      selected={selected}
      options={options}
      saving={saving}
      error={error}
      onChange={() => undefined}
    />,
  );
}

function optionsIn(label: string): Array<string | null> {
  return within(screen.getByLabelText(label))
    .getAllByRole("option")
    .map((option) => option.getAttribute("value"));
}

describe("TimeZoneSection", () => {
  it("offers a continent and a city dropdown instead of one zone list", () => {
    renderSection();

    expect(screen.getByLabelText("Continent")).toHaveProperty(
      "value",
      "Europe",
    );
    expect(screen.getByLabelText("City")).toHaveProperty("value", "Oslo");
    expect(optionsIn("Continent")).toEqual(["", "Europe", "America", "UTC"]);
    expect(screen.queryByRole("option", { name: "Europe/Oslo" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("splits the stored zone into its continent and city pickers", () => {
    renderSection({ selected: "America/Argentina/Buenos_Aires" });

    expect(screen.getByLabelText("Continent")).toHaveProperty(
      "value",
      "America",
    );
    expect(screen.getByLabelText("City")).toHaveProperty(
      "value",
      "Argentina/Buenos_Aires",
    );
  });

  it("makes a slash-free zone its own continent and city", () => {
    renderSection({ selected: "UTC" });

    expect(screen.getByLabelText("Continent")).toHaveProperty("value", "UTC");
    expect(screen.getByLabelText("City")).toHaveProperty("value", "UTC");
  });

  it("groups the cities by continent in the given order", () => {
    renderSection();

    expect(optionsIn("City")).toEqual(["Oslo", "Berlin"]);
  });

  it("asks for a continent when the device zone is selected", () => {
    renderSection({ selected: "" });

    expect(optionsIn("Continent")[0]).toBe("");
    expect(optionsIn("City")).toEqual([""]);
    expect(screen.getByLabelText("City")).toHaveProperty("disabled", true);
  });

  it("shows a stored zone that is not in the runtime list", () => {
    renderSection({ selected: "America/Chicago" });

    expect(screen.getByLabelText("City")).toHaveProperty("value", "Chicago");
    expect(optionsIn("City")).toEqual(["Chicago", "New_York"]);
  });

  it("reports a save in progress and shows its error", () => {
    renderSection({ saving: true, error: "Could not save" });

    expect(screen.getByText("Saving time zone…")).toBeDefined();
    expect(screen.getByText("Could not save")).toBeDefined();
  });
});
