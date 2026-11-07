import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppStatusProvider } from "./AppStatus";
import { FoodLogSection } from "./FoodLogSection";
import { TimeZoneProvider } from "./TimeZoneContext";

function render(enabled: boolean): string {
  return renderToStaticMarkup(
    <AppStatusProvider>
      <TimeZoneProvider timeZone="Europe/Oslo">
        <FoodLogSection enabled={enabled} />
      </TimeZoneProvider>
    </AppStatusProvider>,
  );
}

describe("FoodLogSection", () => {
  it("stays hidden until the athlete wants diet advice", () => {
    expect(render(false)).toBe("");
  });

  it("offers a description, a meal time, a camera and an upload", () => {
    const html = render(true);

    expect(html).toContain("Log a meal");
    expect(html).toContain("What did you eat?");
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("Take photo");
    expect(html).toContain("Upload image");
    expect(html).toContain('capture="environment"');
    expect(html).toContain("Log meal");
  });
});
