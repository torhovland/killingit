import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachQuote } from "./CoachQuote";

describe("CoachQuote", () => {
  it("renders the rationale as a coach quote with an avatar", () => {
    const html = renderToStaticMarkup(
      <CoachQuote
        text={"I'd keep it easy today.\n\n- One easy run\n- Then rest"}
        testId="day-rationale"
      />,
    );

    expect(html).toContain('data-testid="day-rationale"');
    expect(html).toContain("<figure");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Coach");
    expect(html).toContain("keep it easy today.");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>One easy run</li>");
    expect(html).not.toContain("Coach's rationale");
  });

  it("keeps the caller's layout class", () => {
    const html = renderToStaticMarkup(
      <CoachQuote text="Steady aerobic work." className="mt-3" />,
    );

    expect(html).toContain("mt-3");
  });
});
