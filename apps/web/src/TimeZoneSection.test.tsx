import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeZoneSection } from "./TimeZoneSection";

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
      options={["Europe/Oslo", "UTC"]}
      saving={saving}
      error={error}
      onChange={() => undefined}
    />,
  );
}

describe("TimeZoneSection", () => {
  it("saves from the dropdown without a save button", () => {
    const html = render();

    expect(html).toContain("Display time zone");
    expect(html).toContain("Device time zone");
    expect(html).toContain("Europe/Oslo");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Save time zone");
  });

  it("reports a save in progress and shows its error", () => {
    expect(render({ saving: true })).toContain("Saving time zone…");
    expect(render({ error: "Could not save" })).toContain("Could not save");
  });
});
