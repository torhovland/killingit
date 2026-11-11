import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Select } from "./Select";

describe("Select", () => {
  it("renders the standard select surface", () => {
    const html = renderToStaticMarkup(
      <Select aria-label="Range">
        <option>Week</option>
      </Select>,
    );

    expect(html).toStartWith("<select");
    expect(html).toContain("rounded border bg-card px-2 py-1");
    expect(html).toContain("disabled:opacity-50");
  });

  it("merges the caller's classes", () => {
    const html = renderToStaticMarkup(
      <Select className="w-full" aria-label="Range" />,
    );

    expect(html).toContain("w-full");
  });
});
