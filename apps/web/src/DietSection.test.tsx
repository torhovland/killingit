import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DietSection } from "./DietSection";

function render(enabled: boolean): string {
  return renderToStaticMarkup(
    <DietSection enabled={enabled} onChanged={() => undefined} />,
  );
}

describe("DietSection", () => {
  it("offers a diet-advice opt-in with an explanation", () => {
    const html = render(false);

    expect(html).toContain("Give me diet advice and a food log");
    expect(html).toContain("Adds a meal log to your dashboard");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
  });

  it("reflects the stored opt-in", () => {
    expect(render(true)).toContain('checked=""');
  });
});
