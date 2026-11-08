import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppStatusProvider } from "./AppStatus";
import { CoachingInputsSection } from "./CoachingInputsSection";
import { TimeZoneProvider } from "./TimeZoneContext";

describe("CoachingInputsSection", () => {
  it("shows both coach conversation forms", () => {
    const html = renderToStaticMarkup(
      <AppStatusProvider>
        <TimeZoneProvider timeZone="Europe/Oslo">
          <CoachingInputsSection />
        </TimeZoneProvider>
      </AppStatusProvider>,
    );

    expect(html).toContain("Talk to the coach");
    expect(html).toContain("Weekly note");
    expect(html).toContain("By the way");
  });
});
