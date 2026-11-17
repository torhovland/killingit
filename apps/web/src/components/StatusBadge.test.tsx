import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the status in a compact, capitalised badge", () => {
    const html = renderToStaticMarkup(<StatusBadge status="completed" />);

    expect(html).toBe(
      '<span class="rounded border px-2 py-0.5 text-sm bg-muted capitalize">completed</span>',
    );
  });

  it("renders every week session status", () => {
    for (const status of [
      "completed",
      "partial",
      "planned",
      "missed",
      "rest",
    ] as const) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);

      expect(html).toContain(`>${status}</span>`);
    }
  });
});
