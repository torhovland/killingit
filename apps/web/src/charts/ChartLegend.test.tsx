import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CHART_PADDING, CHART_WIDTH } from "./chartGeometry";
import { CHART_LEGEND_INSET_CLASS, ChartLegend } from "./ChartLegend";

describe("ChartLegend", () => {
  it("draws a line swatch beside a medium-weight label", () => {
    const html = renderToStaticMarkup(
      <ChartLegend
        items={[{ key: "ftp", label: "FTP", swatch: "bg-primary" }]}
      />,
    );

    expect(html).toContain(
      '<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">',
    );
    expect(html).toContain(
      '<span class="inline-block h-0.5 w-4 bg-primary" aria-hidden="true"></span>',
    );
    expect(html).toContain('<span class="font-medium">FTP</span>');
  });

  it("draws a square swatch, a muted detail and custom label classes", () => {
    const html = renderToStaticMarkup(
      <ChartLegend
        testId="legend"
        className={CHART_LEGEND_INSET_CLASS}
        items={[
          {
            key: "ftp",
            label: "FTP",
            swatch: "bg-primary",
            swatchShape: "square",
            detail: "cycling · W",
            text: "text-form-fresh",
            testId: "ftp-entry",
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="legend"');
    expect(html).toContain("pl-[6.25%]");
    expect(html).toContain('data-testid="ftp-entry"');
    expect(html).toContain(
      '<span class="inline-block size-2.5 rounded-sm bg-primary" aria-hidden="true"></span>',
    );
    expect(html).toContain('<span class="text-form-fresh">FTP</span>');
    expect(html).toContain(
      '<span class="text-muted-foreground">cycling · W</span>',
    );
  });

  it("draws a text-only entry and the framed line swatch", () => {
    const html = renderToStaticMarkup(
      <ChartLegend
        items={[
          {
            key: "ctl",
            label: "Fitness (CTL)",
            swatch: "bg-chart-ink",
            swatchShape: "plot-line",
            text: null,
          },
          { key: "awake", label: "Awake", swatchShape: "none" },
        ]}
      />,
    );

    expect(html).toContain(
      '<span class="flex h-3 w-6 items-center justify-center rounded-sm bg-chart-plot" aria-hidden="true"><span class="block h-0.5 w-4 bg-chart-ink"></span></span>',
    );
    expect(html).toContain(
      '<span class="block h-0.5 w-4 bg-chart-ink"></span></span><span>Fitness (CTL)</span></li>',
    );
    expect(html).toContain(
      '<li class="flex items-center gap-1.5"><span class="font-medium">Awake</span></li>',
    );
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1);
  });

  it("keeps the inset at the plot's left edge", () => {
    const percent = (CHART_PADDING.left / CHART_WIDTH) * 100;

    expect(CHART_LEGEND_INSET_CLASS).toBe(`pl-[${percent}%]`);
  });
});
