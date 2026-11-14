import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachReply } from "./CoachReply";

describe("CoachReply", () => {
  it("labels the coach's reply and formats its text", () => {
    const html = renderToStaticMarkup(
      <CoachReply text={"Nice steady effort.\n\n- Keep the cadence"} />,
    );

    expect(html).toContain("Coach:");
    expect(html).toContain("Nice steady effort.");
    // The shared long-text structure renders bullets as a real list.
    expect(html).toContain("<ul");
    expect(html).toContain("Keep the cadence");
  });

  it("keeps the caller's test id and layout class", () => {
    const html = renderToStaticMarkup(
      <CoachReply
        text="Nice steady effort."
        testId="calendar-dialog-coach-reply"
        className="gap-2"
      />,
    );

    expect(html).toContain('data-testid="calendar-dialog-coach-reply"');
    expect(html).toContain("gap-2");
  });
});
