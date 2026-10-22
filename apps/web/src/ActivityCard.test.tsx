import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyzedActivity } from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";

const activity: AnalyzedActivity = {
  id: 1,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  sampleCount: 1,
  analysis: {
    text: "You held a steady aerobic effort.",
    model: "openrouter/auto",
    generatedAt: "2026-10-01T07:00:00Z",
  },
  analysisError: null,
};

describe("ActivityCard", () => {
  it("renders the activity summary and coach analysis", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).toContain("Morning Run");
    expect(html).toContain("5.00 km");
    expect(html).toContain("25:00");
    expect(html).toContain("1 sample");
    expect(html).toContain("You held a steady aerobic effort.");
    expect(html).toContain("openrouter/auto");
  });

  it("renders the analysis error when generation failed", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          analysis: null,
          analysisError: "OpenRouter is unavailable",
        }}
      />,
    );

    expect(html).toContain("Coach analysis unavailable");
    expect(html).toContain("OpenRouter is unavailable");
  });

  it("renders a fallback when no analysis exists yet", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{ ...activity, analysis: null, analysisError: null }}
      />,
    );

    expect(html).toContain("No coach analysis available yet.");
  });

  it("renders a comment form when a submit handler is provided", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve()}
      />,
    );

    expect(html).toContain('data-testid="activity-comment-form"');
    expect(html).toContain("Add a comment about this activity");
    expect(html).toContain("Save comment");
  });

  it("omits the comment form when no submit handler is provided", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).not.toContain('data-testid="activity-comment-form"');
    expect(html).not.toContain("Add a comment about this activity");
  });
});
