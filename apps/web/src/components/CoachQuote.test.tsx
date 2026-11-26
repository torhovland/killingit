import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachQuote } from "./CoachQuote";

describe("CoachQuote", () => {
  it("renders the rationale between a quote mark and the coach portrait", () => {
    const html = renderToStaticMarkup(
      <CoachQuote
        text={"I'd keep it easy today.\n\n- One easy run\n- Then rest"}
        testId="day-rationale"
      />,
    );

    expect(html).toContain('data-testid="day-rationale"');
    expect(html).toContain("<figure");
    expect(html).toContain("<blockquote");
    // The decorative mark and the labelled portrait are two separate SVGs.
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-label="Your coach"');
    expect(html).toContain("keep it easy today.");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>One easy run</li>");
    expect(html).not.toContain("Coach's rationale");
  });

  it("uses the responsive quote grid and keeps the caller's layout class", () => {
    const html = renderToStaticMarkup(
      <CoachQuote text="Steady aerobic work." className="mt-3" />,
    );

    expect(html).toContain("grid-cols-[22px_minmax(0,1fr)_44px]");
    expect(html).toContain("min-[520px]:grid-cols-[30px_minmax(0,1fr)_56px]");
    expect(html).toContain("mt-3");
  });
});
