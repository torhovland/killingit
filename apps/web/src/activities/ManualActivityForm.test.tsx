import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualActivityForm } from "./ManualActivityForm";

function render(
  overrides: Partial<Parameters<typeof ManualActivityForm>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ManualActivityForm
      editing={false}
      startDate="2026-11-08"
      details=""
      saving={false}
      llmConfigured
      onStartDateChange={() => {}}
      onDetailsChange={() => {}}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("ManualActivityForm", () => {
  it("renders the add form", () => {
    const html = render();

    expect(html).toContain("Manual activity");
    expect(html).toContain("Add manual activity");
    expect(html).toContain('type="date"');
    expect(html).toContain("Describe your activity");
    expect(html).not.toContain("Cancel");
  });

  it("switches to editing with a cancel action", () => {
    const html = render({
      editing: true,
      startDate: "2026-11-01",
      details: "Swim 1500 m",
    });

    expect(html).toContain("Edit manual activity");
    expect(html).toContain("Update activity");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("Swim 1500 m");
    expect(html).toContain("Cancel");
  });

  it("labels a save according to the LLM setup", () => {
    expect(render({ saving: true })).toContain("Coach is thinking…");
    expect(render({ saving: true, llmConfigured: false })).toContain("Saving…");
  });
});
