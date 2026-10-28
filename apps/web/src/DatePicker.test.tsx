import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DatePicker } from "./DatePicker";

describe("DatePicker", () => {
  it("shows the chosen date day-first and keeps the calendar closed", () => {
    const html = renderToStaticMarkup(
      <DatePicker value="2026-10-28" onChange={() => undefined} />,
    );

    expect(html).toContain("28. Oct 2026");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="date-picker-dialog"');
  });

  it("asks for a date when the value is empty", () => {
    const html = renderToStaticMarkup(
      <DatePicker value="" onChange={() => undefined} />,
    );

    expect(html).toContain("Choose a date");
  });

  it("forwards the id, label, and disabled state", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        id="start"
        ariaLabel="Start date"
        value="2026-10-28"
        onChange={() => undefined}
        disabled
      />,
    );

    expect(html).toContain('id="start"');
    expect(html).toContain('aria-label="Start date"');
    expect(html).toContain("disabled");
  });
});
