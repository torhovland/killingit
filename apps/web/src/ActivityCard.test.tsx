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
  programAnalysis: null,
  comment: null,
  coachReply: null,
};

describe("ActivityCard", () => {
  it("renders the activity summary and coach analysis", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).toContain("Morning Run");
    expect(html).toContain("5.00 km");
    expect(html).toContain("25:00");
    expect(html).not.toContain("sample");
    expect(html).toContain("You held a steady aerobic effort.");
    expect(html).not.toContain("openrouter/auto");
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

  it("keeps the plan fit inside the summary and shows the comment and reply", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={{
          ...activity,
          programAnalysis: {
            text: "The effort fit the base block, but the finish was too hard.",
            model: "openrouter/auto",
            generatedAt: "2026-10-01T07:05:00Z",
          },
          comment: "Felt strong on the hills.",
          coachReply: {
            text: "Good work; I will keep Thursday easy.",
            model: "openrouter/auto",
            generatedAt: "2026-10-01T07:06:00Z",
          },
        }}
      />,
    );

    expect(html).not.toContain('data-testid="activity-program-analysis"');
    expect(html).not.toContain("How it fit your plan");
    expect(html).toContain("The effort fit the base block");
    expect(html).toContain("Felt strong on the hills.");
    expect(html).toContain('data-testid="activity-coach-reply"');
    expect(html).toContain("I will keep Thursday easy.");
  });

  it("renders a comment form when a submit handler is provided", () => {
    const html = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain('data-testid="activity-comment-form"');
    expect(html).toContain("Add a comment about this activity");
    expect(html).toContain("Save comment");
  });

  it("renders a no-comment action only when a handler is provided", () => {
    const withNoComment = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
        onNoComment={() => Promise.resolve()}
      />,
    );
    const withoutNoComment = renderToStaticMarkup(
      <ActivityCard
        activity={activity}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(withNoComment).toContain('data-testid="activity-no-comment"');
    expect(withNoComment).toContain("No comment");
    expect(withoutNoComment).not.toContain('data-testid="activity-no-comment"');
  });

  it("renders a delete action only when a delete handler is provided", () => {
    const withDelete = renderToStaticMarkup(
      <ActivityCard activity={activity} onDelete={() => Promise.resolve()} />,
    );
    const withoutDelete = renderToStaticMarkup(
      <ActivityCard activity={activity} />,
    );

    expect(withDelete).toContain('data-testid="activity-delete"');
    expect(withoutDelete).not.toContain('data-testid="activity-delete"');
  });

  it("omits the comment form when no submit handler is provided", () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity} />);

    expect(html).not.toContain('data-testid="activity-comment-form"');
    expect(html).not.toContain("Add a comment about this activity");
  });
});
