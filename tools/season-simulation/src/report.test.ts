import { describe, expect, it } from "bun:test";
import { escapeHtml, lineChart } from "./reportRender.js";

describe("report rendering", () => {
  it("escapes every interpolated value", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;",
    );
  });

  it("draws a polyline and its date labels", () => {
    const svg = lineChart(
      [
        {
          label: "CTL",
          color: "#1f7a4d",
          points: [
            { label: "2026-11-23", value: 0 },
            { label: "2027-01-04", value: 20 },
            { label: "2027-08-23", value: 16 },
          ],
        },
      ],
      "Chronic load",
    );
    expect(svg).toContain("<polyline");
    expect(svg).toContain("2026-11-23");
    expect(svg).toContain("2027-08-23");
    expect(svg).toContain("Chronic load");
  });
});
