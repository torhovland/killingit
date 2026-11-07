import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CostTooltip } from "./CostTooltip";
import type { CostBucket, CostSeriesTotal } from "./costChart";

const bucket: CostBucket = {
  key: "2026-11",
  label: "Nov",
  title: "November 2026",
  totalUsd: 2.75,
  parts: [
    { series: "openai/gpt", costUsd: 2, calls: 3 },
    { series: "anthropic/claude", costUsd: 0.75, calls: 1 },
  ],
};

const series: CostSeriesTotal[] = [
  { series: "openai/gpt", label: "GPT", totalUsd: 2 },
  { series: "anthropic/claude", label: "Claude", totalUsd: 0.75 },
];

describe("CostTooltip", () => {
  it("shows the period total with its call count", () => {
    const html = renderToStaticMarkup(
      <CostTooltip bucket={bucket} series={series} left="50%" />,
    );

    expect(html).toContain("November 2026");
    expect(html).toContain("$2.75 · 4 calls");
  });

  it("shows each series' cost with its call count", () => {
    const html = renderToStaticMarkup(
      <CostTooltip bucket={bucket} series={series} left="50%" />,
    );

    expect(html.match(/data-testid="cost-tooltip-series"/g)).toHaveLength(2);
    // The larger series is listed first, each cost followed by its own calls.
    const gptCost = html.indexOf("$2.00");
    const gptCalls = html.indexOf(" · 3 calls");
    const claudeCost = html.indexOf("$0.75");
    const claudeCalls = html.indexOf(" · 1 call");
    expect(gptCost).toBeGreaterThan(-1);
    expect(gptCalls).toBeGreaterThan(gptCost);
    expect(claudeCost).toBeGreaterThan(gptCalls);
    expect(claudeCalls).toBeGreaterThan(claudeCost);
  });

  it("leaves out the call count when no calls were recorded", () => {
    const html = renderToStaticMarkup(
      <CostTooltip
        bucket={{ ...bucket, totalUsd: 0.5, parts: [] }}
        series={series}
        left="50%"
      />,
    );

    expect(html).toContain("$0.50");
    expect(html).not.toContain(" call");
  });
});
