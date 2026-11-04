import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LlmCostBucket } from "@killingit/shared";
import { CostBarChart } from "./CostBarChart";
import { dailyCostChart, monthlyCostChart } from "./costChart";

const rows: LlmCostBucket[] = [
  {
    bucket: "2026-10",
    model: "openai/gpt",
    label: "GPT",
    costUsd: 2,
    calls: 3,
  },
  {
    bucket: "2026-10",
    model: "anthropic/claude",
    label: "Claude",
    costUsd: 0.5,
    calls: 1,
  },
  {
    bucket: "2026-11",
    model: "anthropic/claude",
    label: "Claude",
    costUsd: 0.25,
    calls: 2,
  },
];

describe("CostBarChart", () => {
  it("stacks one segment per model and lists the models in the legend", () => {
    const html = renderToStaticMarkup(
      <CostBarChart
        title="Monthly cost"
        description="One bar per month."
        data={monthlyCostChart(rows, "12m", "2026-11-04")}
        emptyMessage="No calls."
        testId="monthly-cost-chart"
      />,
    );

    expect(html.match(/data-testid="cost-bar"/g)).toHaveLength(12);
    expect(html.match(/data-model="openai\/gpt"/g)).toHaveLength(1);
    expect(html.match(/data-model="anthropic\/claude"/g)).toHaveLength(2);
    expect(html).toContain("GPT");
    expect(html).toContain("Claude");
    expect(html).toContain("$2.75 in this period");
  });

  it("shows the empty message when the period has no spend", () => {
    const html = renderToStaticMarkup(
      <CostBarChart
        title="Daily cost"
        description="One bar per day."
        data={dailyCostChart([], "7d", "2026-11-04")}
        emptyMessage="No calls in this period."
        testId="daily-cost-chart"
      />,
    );

    expect(html).toContain("No calls in this period.");
    expect(html).not.toContain('data-testid="daily-cost-chart-svg"');
  });

  it("hides a model that has no spend in the selected range", () => {
    const dailyRows: LlmCostBucket[] = [
      {
        bucket: "2026-10-01",
        model: "openai/gpt",
        label: "GPT",
        costUsd: 1,
        calls: 1,
      },
      {
        bucket: "2026-11-04",
        model: "anthropic/claude",
        label: "Claude",
        costUsd: 0.2,
        calls: 1,
      },
    ];
    const html = renderToStaticMarkup(
      <CostBarChart
        title="Daily cost"
        description="One bar per day."
        data={dailyCostChart(dailyRows, "7d", "2026-11-04")}
        emptyMessage="No calls."
        testId="daily-cost-chart"
      />,
    );

    expect(html).toContain("Claude");
    expect(html).not.toContain(">GPT<");
  });
});
