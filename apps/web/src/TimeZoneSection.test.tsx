import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  groupTimeZones,
  splitTimeZone,
  TimeZoneSection,
} from "./TimeZoneSection";

function render({
  selected = "Europe/Oslo",
  saving = false,
  error = null,
}: {
  selected?: string;
  saving?: boolean;
  error?: string | null;
} = {}): string {
  return renderToStaticMarkup(
    <TimeZoneSection
      selected={selected}
      options={["Europe/Oslo", "America/New_York", "UTC"]}
      saving={saving}
      error={error}
      onChange={() => undefined}
    />,
  );
}

describe("splitTimeZone", () => {
  it("splits a zone into a continent and city", () => {
    expect(splitTimeZone("Europe/Oslo")).toEqual({
      region: "Europe",
      city: "Oslo",
    });
  });

  it("keeps every segment after the first slash in the city", () => {
    expect(splitTimeZone("America/Argentina/Buenos_Aires")).toEqual({
      region: "America",
      city: "Argentina/Buenos_Aires",
    });
  });

  it("makes a slash-free zone its own continent and city", () => {
    expect(splitTimeZone("UTC")).toEqual({ region: "UTC", city: "UTC" });
  });
});

describe("groupTimeZones", () => {
  it("groups zones by continent in the given order", () => {
    expect([
      ...groupTimeZones(["Europe/Oslo", "America/New_York", "Europe/Berlin"]),
    ]).toEqual([
      ["Europe", ["Oslo", "Berlin"]],
      ["America", ["New_York"]],
    ]);
  });
});

describe("TimeZoneSection", () => {
  it("offers a continent and a city dropdown instead of one zone list", () => {
    const html = render();

    expect(html).toContain("Device time zone");
    expect(html).toContain(">Continent<");
    expect(html).toContain(">City<");
    expect(html).toContain(
      '<option value="Europe" selected="">Europe</option>',
    );
    expect(html).toContain('<option value="Oslo" selected="">Oslo</option>');
    expect(html).not.toContain("Europe/Oslo");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Save time zone");
  });

  it("asks for a continent when the device zone is selected", () => {
    const html = render({ selected: "" });

    expect(html).toContain("Choose a continent");
    expect(html).toContain("disabled");
  });

  it("shows a stored zone that is not in the runtime list", () => {
    const html = render({ selected: "America/Chicago" });

    expect(html).toContain(
      '<option value="Chicago" selected="">Chicago</option>',
    );
    expect(html).toContain('<option value="New_York">New_York</option>');
  });

  it("reports a save in progress and shows its error", () => {
    expect(render({ saving: true })).toContain("Saving time zone…");
    expect(render({ error: "Could not save" })).toContain("Could not save");
  });
});
